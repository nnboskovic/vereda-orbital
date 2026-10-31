"""A few behaviour tests for the Orbital's weather: the ring closes with no seam, the rims hold
the air in, workspace 1 follows the real sky while the far side of the ring doesn't notice, the
maps decode to what the wallpaper expects, and aircraft fly round a storm that grows across
their way. Run with the kit's venv:

    weather/.venv/bin/python -m unittest weather/test_sim.py

They run on the real land map in ~/.cache/vereda-orbital/weather/land.png when there is one
(else on a made-up one), with a fixed clock and a fixed seed, in about a minute.
"""

import json
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import model as wx  # noqa: E402
import sim  # noqa: E402
import traffic as tr  # noqa: E402

T0 = 1_800_000_000.0                         # a fixed moment, so the tests see the same day
LOOK = (0.0, 36.0)                           # workspace 1 at phi 0, places 36 degrees apart


def clock(t):
    """A clock on UTC, independent of the machine's time zone."""
    return (t % 86400) / 3600.0


def land_map():
    path = Path.home() / ".cache/vereda-orbital/weather/land.png"
    if path.exists():
        return sim.load_land(path)[0]
    # Made-up land: a few smooth continents with a mountain range each.
    i, j = np.meshgrid(np.arange(wx.NX), np.arange(wx.NY))
    cont = 0.45 + 0.2 * np.sin(i / 90.0) * np.cos(j / 30.0) + 0.1 * np.sin(i / 23.0 + j / 17.0)
    land = (cont > 0.57).astype(np.float32)
    return np.stack([land, cont, 0.5 * np.ones_like(cont)], -1).astype(np.float32)


def spun_up(hours=12, seed=1, noise=True, land=None):
    m = wx.Model(land_map() if land is None else land, clock=clock, seed=seed, noise=noise)
    m.init_state(T0 - hours * 3600)
    sim.advance(m, T0, 600)
    return m


def copy_of(m, land=None, seed=1):
    c = wx.Model(m_land if land is None else land, clock=clock, seed=seed)
    c.load_state({k: v.copy() for k, v in m.state().items()}, m.t)
    return c


m_land = None


class WeatherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global m_land
        m_land = land_map()
        cls.base = spun_up(land=m_land)

    def test_the_ring_closes_without_a_seam(self):
        # Turn the whole world half way round the ring, land, weather and all, and the sun with
        # it (twelve hours on the clock): every step must then give the same weather, turned
        # the same way. Where the grid's ends meet is just another place.
        half = wx.NX // 2
        a = wx.Model(m_land, clock=clock, noise=False)
        b = wx.Model(np.roll(m_land, half, axis=1), clock=lambda t: clock(t + 43200), noise=False)
        a.load_state({k: v.copy() for k, v in self.base.state().items()}, T0)
        b.load_state({k: np.roll(v, half, axis=1) for k, v in self.base.state().items()}, T0)
        for _ in range(6):
            a.step(300)
            b.step(300)
        # (Not to the last bit: the start-up blurs round differently when turned, which can tip
        # a cell over a threshold here and there. A seam would be off by whole m/s and kelvin.)
        for k in ("u", "v", "th", "q", "ql", "qi", "rhi", "rain"):
            diff = np.abs(np.roll(getattr(b, k), -half, axis=1) - getattr(a, k))
            self.assertLess(diff.max(), 0.05, k)
            self.assertLess(diff.mean(), 1e-4, k)

    def test_the_rims_hold_the_air_in(self):
        # Heat the air along one rim hard: the wind runs toward it, but not into the wall.
        m = copy_of(self.base)
        m.th[:6] += 8.0
        for _ in range(12):
            m.step(300)
            m.th[:6] = np.maximum(m.th[:6], self.base.th[:6] + 8.0)
        self.assertGreater(np.abs(m.v[4:12]).mean(), 1.0, "the heated rim should pull the wind")
        self.assertEqual(np.abs(m.v[0]).max(), 0.0)
        self.assertEqual(np.abs(m.v[-1]).max(), 0.0)
        self.assertTrue(np.isfinite(m.th).all())

    def test_workspace_one_follows_the_real_sky_and_the_far_side_does_not(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "observed.json"
            stamp = datetime.fromtimestamp(T0, timezone.utc).isoformat()
            path.write_text(json.dumps({"cover": 100, "low": 95, "mid": 80, "high": 40, "code": 63,
                                        "precip": 3.5, "wind": 25, "visibility": 6000, "fetched": stamp}))
            targets = sim.read_observed(path, T0)
            self.assertIsNotNone(targets)
            stale = datetime.fromtimestamp(T0 - 3 * 3600, timezone.utc).isoformat()
            path.write_text(json.dumps(json.loads(path.read_text()) | {"fetched": stale}))
            self.assertIsNone(sim.read_observed(path, T0), "a three-hour-old sky should be ignored")

        free, held = copy_of(self.base), copy_of(self.base)
        held.set_observed(targets, sim.place_phi(LOOK, 1))
        for m in (free, held):
            sim.advance(m, T0 + 2 * 3600, 120)
        here = sim.status(held, held.diagnostics(), LOOK, held.t)["places"]
        self.assertEqual(here["1"]["sky"], "rain")
        self.assertAlmostEqual(here["1"]["rain"], 3.5, delta=0.6)
        self.assertAlmostEqual(here["1"]["wind"], 25, delta=4)
        d = held.diagnostics()
        self.assertGreater(d["low"][40:64, :8].mean(), 0.85)
        # Half the ring away, nothing has changed.
        far = slice(wx.NX // 2 - 100, wx.NX // 2 + 100)
        for k in ("low", "high", "rain"):
            np.testing.assert_allclose(held.diagnostics()[k][:, far], free.diagnostics()[k][:, far],
                                       atol=1e-4, err_msg=k)

    def test_the_maps_decode_to_the_documented_ranges(self):
        m = copy_of(self.base)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            sim.write_outputs(m, out, LOOK, m.t)
            sim.save_state(m, out / "state.npz", "test")
            maps = [Image.open(out / f) for f in ("weather.png", "wind.png", "wet.png")]
            weather, wind, wet = (np.asarray(i) for i in maps)
            status = json.loads((out / "status.json").read_text())
            again = wx.Model(m_land, clock=clock)
            self.assertTrue(sim.load_state(again, out / "state.npz", "test"))
            self.assertFalse(sim.load_state(wx.Model(m_land, clock=clock), out / "state.npz", "other land"))
        # Opaque RGB, since Qt would premultiply any alpha into the colours.
        for img, arr in zip(maps, (weather, wind, wet)):
            self.assertEqual(img.mode, "RGB")
            self.assertEqual(arr.shape, (wx.NY, wx.NX, 3))
        low, high, conv = (weather[..., k] / 255 for k in range(3))
        rain, storm = wet[..., 0] / 255, wet[..., 1] / 255
        self.assertEqual(wet[..., 2].max(), 0)
        self.assertTrue(0 <= (storm > 0.1).mean() < 0.02, "thunderstorms are rare")
        # Some sky clear and some overcast, some cirrus, towers and rain, but not everywhere.
        self.assertGreater((low < 0.1).mean(), 0.1)
        self.assertGreater((low > 0.9).mean(), 0.02)
        self.assertTrue(0.2 < (low + high).mean() < 1.2)
        self.assertGreater((conv > 0.5).mean(), 0)
        self.assertTrue(0 < (rain > 0.01).mean() < 0.3)
        # Winds are a few m/s about calm at 0.5, rarely anywhere near the +-40 m/s ends.
        u, v = (wind[..., 0] / 255 - 0.5) * 80, (wind[..., 1] / 255 - 0.5) * 80
        self.assertTrue(1 < np.hypot(u, v).mean() < 15)
        self.assertLess((np.abs(wind[..., :2].astype(int) - 128) > 120).mean(), 0.001)
        self.assertEqual(np.abs(wind[0, :, 1].astype(int) - 128).max(), 0, "no wind into the rim")
        # Every workspace has a place, a sky and its own local time: clock hour minus phi/15.
        skies = {"clear", "partly cloudy", "cloudy", "overcast", "fog", "drizzle", "rain", "showers", "thunderstorm"}
        self.assertEqual(sorted(status["places"], key=int), [str(n) for n in range(1, 11)])
        for n, p in status["places"].items():
            self.assertIn(p["sky"], skies)
            phi = sim.place_phi(LOOK, int(n))
            hour = (clock(m.t) - (int(phi / 360 * wx.NX) + 0.5) * 360 / wx.NX / 15) % 24
            hh, mm = map(int, p["local"].split(":"))
            self.assertLess(abs((hh + mm / 60 - hour + 12) % 24 - 12), 0.05)
            self.assertGreaterEqual(p["rain"], 0)
            self.assertGreaterEqual(p["wind"], 0)
        for phi, z, strength in status["storms"]:
            self.assertTrue(0 <= phi < 360 and abs(z) < 1300 and 0 < strength <= 1)
        # And the saved state carries on as the same weather.
        np.testing.assert_allclose(again.th, m.th, atol=0.02)
        np.testing.assert_allclose(again.q, m.q, atol=0.01)

    def test_flights_go_round_a_storm_that_grows_across_their_way(self):
        # Two cities 4000 km apart along the band's middle; a jet sets off from one to the
        # other, and twenty minutes later a thunderstorm grows right across its way. The crew
        # flies round it, keeping AVOID of its radius from its middle, and still gets there.
        towns = np.zeros((wx.NY, wx.NX, 3), np.float32)
        towns[52, 1000, 0] = towns[52, 1160, 0] = 1.0
        sky = Sky()
        t = tr.Traffic(towns, seed=1)
        self.assertEqual(len(t.ap_s), 2)
        jet = t.launch(int(np.argmin(t.ap_s)), dest=int(np.argmax(t.ap_s)), kind="jet")
        path = [(jet.s, jet.z)]
        for minute in range(400):
            if minute == 20:
                sky.storm[50:55, 1078:1083] = 0.9
                t.see_storms(sky.storm, sky.t)
                middle, radius = t.storms[0, :2], t.storms[0, 2]
            sky.t += 60
            t.step(60, sky)
            path.append((jet.s, jet.z))
            if jet not in t.craft:
                break
        self.assertNotIn(jet, t.craft, "the jet should have landed")
        self.assertAlmostEqual(jet.s, t.ap_s.max(), delta=1)
        # the closest it came to the storm, along every bit of the way flown
        p = np.array(path)
        f = np.linspace(0, 1, 20)[:, None, None]
        along = (p[:-1] + f * (p[1:] - p[:-1])).reshape(-1, 2)
        closest = np.hypot(along[:, 0] - middle[0], along[:, 1] - middle[1]).min()
        self.assertGreaterEqual(closest, tr.AVOID * radius)
        self.assertLess(minute, 4000 / (0.25 * 60) * 1.3, "a detour, not a tour")


class Sky:
    """Just enough of a Model for the traffic: a clock, dry air aloft (no contrails), and a
    storm field to set by hand."""

    def __init__(self):
        self.t = T0
        self.clock = clock
        self.rhi = np.zeros((wx.NY, wx.NX), np.float32)
        self.storm = np.zeros((wx.NY, wx.NX), np.float32)

    def storm_field(self):
        return self.storm

    def add_ice(self, cells, amounts):
        pass


if __name__ == "__main__":
    unittest.main()

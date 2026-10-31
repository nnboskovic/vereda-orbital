#!/usr/bin/env python3
"""Vereda Orbital's weather service. It runs the band's weather (model.py) and its air traffic
(traffic.py) at the pace of real time, one step a minute, and leaves what the wallpaper draws in
~/.cache/vereda-orbital/weather/. Every five minutes, three opaque RGB maps (no alpha, since Qt
premultiplies it into the colours) and then status.json, which tells the shell they are ready:

  weather.png  R low cloud cover (cumulus and stratus, ~2 km), G high cloud (cirrus, anvils and
               the haze of old contrails, ~10 km), B the clouds' convective character (0 a flat
               sheet or fog, 1 a towering cumulonimbus; it also stands for thickness)
  wind.png     R the low wind along the ring and G across it (0.5 calm, 0 and 1 at -+40 m/s),
               B fog at the floor
  wet.png      R rain, 0..1 for 0..10 mm/h, G thunderstorm intensity (where lightning should
               strike, and what aircraft fly round), B 0
  status.json  what each workspace's place has (sky, local time, rain, wind) and the strongest
               storm cells, for lightning

and every minute traffic.json, every craft in the air (see Service.write_traffic). state.npz
keeps the weather and the flights, so a restart carries on where it stopped.

The maps are 3016 x 104, the band unrolled exactly as land.png is: column i at ring angle
(i + 0.5) / 3016 * 360 degrees, spinward to the right, row 0 at one rim.

Workspace 1's place follows the real sky: the shell leaves the current weather outside in
observed.json, and the model pulls the air around that place toward it (see Model.set_observed).

    sim.py                     run as the service does
    sim.py --once              one step, write everything, exit (for tests)
    sim.py --spinup-hours N    start afresh from N hours of spin-up instead of the saved state
    sim.py --status            print status.json
    sim.py --preview out.png   draw the latest maps over the land, for a look
"""

import argparse
import hashlib
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

VENV = Path(__file__).resolve().parent / ".venv"
try:
    import numpy as np
    from PIL import Image, ImageDraw
except ImportError:
    # Started with a python that lacks numpy (the system's): carry on in the kit's own venv.
    if (VENV / "bin/python").exists() and Path(sys.prefix) != VENV:
        os.execv(VENV / "bin/python", [str(VENV / "bin/python"), __file__, *sys.argv[1:]])
    raise

sys.path.insert(0, str(Path(__file__).resolve().parent))
import model as wx  # noqa: E402
import traffic as tr  # noqa: E402

KIT = Path(__file__).resolve().parent.parent
HOME = Path.home()
CACHE = HOME / ".cache/vereda-orbital/weather"
LOOKS = [HOME / ".local/state/omarchy/current/theme/backgrounds/orbital-live.json", KIT / "theme/look.json"]

STEP = 60.0                 # s: one step a minute, at the pace of real time
OUTPUT_EVERY = 300.0        # s between the maps
STATE_EVERY = 900.0         # s between saves of the state (and always on exit)
SPINUP_HOURS = 48.0         # a first start makes two days of weather before showing any
SPINUP_DT = 300.0           # s per step while spinning up or catching up
CATCHUP_MAX = 24 * 3600.0   # after a long gap (a night switched off) catch up at most a day
OBSERVED_MAX_AGE = 2 * 3600.0
VIEW_DEG = 40.0             # how much of the ring a place's camera sees, spinward of the place
STATE_VERSION = 2

log = logging.getLogger("vereda-weather")


# ---------------------------------------------------------------- where things are
def read_look():
    """Workspace 1's place (phi) and the spacing between places, from the installed look, else
    the kit's, else the wallpaper's defaults. Each key is looked for separately, since a look
    need not carry both."""
    found = {}
    for path in LOOKS:
        try:
            look = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        for key in ("phi", "places"):
            if key not in found and isinstance(look.get(key), (int, float)):
                found[key] = float(look[key])
    return found.get("phi", 0.0), found.get("places", 36.0)


def place_phi(look, n):
    """Ring angle of workspace n's place, as Scene.atPlace has it."""
    phi, places = look
    return (phi - places * (n - 1)) % 360.0


def load_land(path):
    """land.png as floats, and a fingerprint of it so a state made for other land isn't reused."""
    img = np.asarray(Image.open(path).convert("RGB"))
    if img.shape != (wx.NY, wx.NX, 3):
        raise SystemExit(f"{path} is {img.shape[1]}x{img.shape[0]}, expected {wx.NX}x{wx.NY}")
    return img.astype(np.float32) / 255.0, hashlib.sha1(img.tobytes()).hexdigest()


# ---------------------------------------------------------------- the real sky outside
# WMO weather codes the shell passes on from Open-Meteo, when it gives no precipitation itself.
RAIN_BY_CODE = {51: 0.2, 53: 0.5, 55: 1.0, 56: 0.3, 57: 1.0, 61: 1.0, 63: 3.0, 65: 8.0, 66: 1.0, 67: 5.0,
                71: 0.5, 73: 1.5, 75: 4.0, 77: 0.3, 80: 2.0, 81: 5.0, 82: 12.0, 85: 1.5, 86: 4.0,
                95: 6.0, 96: 10.0, 99: 14.0}


def _num(o, key):
    try:
        v = float(o[key])
        return v if np.isfinite(v) else None
    except (KeyError, TypeError, ValueError):
        return None


def observed_age(o, path, now):
    """Seconds since the observation was made: the shell's own fetch stamp if there is one, else
    Open-Meteo's (local) time, else the file's."""
    for key in ("fetched", "at"):
        s = o.get(key)
        if isinstance(s, str) and s:
            try:
                when = datetime.fromisoformat(s.replace("Z", "+00:00"))
                return now - when.timestamp()
            except ValueError:
                pass
    return now - path.stat().st_mtime


def read_observed(path, now):
    """The real weather as model targets (see Model.set_observed), or None if there is none or
    it is more than two hours old. Missing fields simply leave that part of the sky free."""
    try:
        o = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(o, dict) or observed_age(o, path, now) > OBSERVED_MAX_AGE:
        return None
    t = {}
    low, mid, cover, high = _num(o, "low"), _num(o, "mid"), _num(o, "cover"), _num(o, "high")
    code, precip, wind, vis = _num(o, "code"), _num(o, "precip"), _num(o, "wind"), _num(o, "visibility")
    if low is not None or mid is not None:
        t["low"] = 1 - (1 - (low or 0) / 100) * (1 - (mid or 0) / 100)
    elif cover is not None:
        t["low"] = cover / 100
    if high is not None:
        t["high"] = high / 100
    code = int(code) if code is not None else None
    if precip is not None:
        t["rain"] = max(precip, 0.0)
    elif code is not None:
        t["rain"] = RAIN_BY_CODE.get(code, 0.0)
    if wind is not None:
        t["wind"] = max(wind, 0.0) / 3.6
    if code in (45, 48):
        t["fog"] = 1.0
    elif vis is not None:
        t["fog"] = float(np.clip((3000 - vis) / 2000, 0, 1))
    elif code is not None:
        t["fog"] = 0.0
    if code is not None:
        if 95 <= code <= 99:
            t["conv"], t["storm"] = 1.0, {95: 0.6, 96: 0.8}.get(code, 1.0)
        else:
            t["storm"] = 0.0
            if 80 <= code <= 86:
                t["conv"] = 0.7
            elif 51 <= code <= 77 or code in (45, 48):
                t["conv"] = 0.1
    for k in ("low", "high"):
        if k in t:
            t[k] = float(np.clip(t[k], 0, 1))
    if t.get("rain", 0) > 0 and "low" not in t:
        t["low"] = 0.9
    return t or None


# ---------------------------------------------------------------- outputs
def _atomic(path, write):
    tmp = path.with_name(path.name + ".tmp")
    write(tmp)
    os.replace(tmp, path)


def _png(path, channels):
    rgb = np.stack([np.round(np.clip(c, 0, 1) * 255) for c in channels], axis=-1).astype(np.uint8)
    _atomic(path, lambda tmp: Image.fromarray(rgb, "RGB").save(tmp, format="PNG", compress_level=3))


def _sky(low, high, conv, rain, fog, storm):
    if storm > 0.3:
        return "thunderstorm"
    if rain >= 0.1:
        if conv >= 0.5:
            return "showers"
        return "drizzle" if rain < 0.5 else "rain"
    if fog > 0.5:
        return "fog"
    total = 1 - (1 - low) * (1 - 0.6 * high)
    if total < 0.15:
        return "clear"
    if total < 0.45:
        return "partly cloudy"
    return "cloudy" if total < 0.8 else "overcast"


def status(m, d, look, now):
    """Each workspace's place, summarised from a neighbourhood about 175 km along the ring by
    200 km across the band's middle, and the strongest storm cells."""
    places = {}
    for n in range(1, 11):
        phi = place_phi(look, n)
        i = int(np.floor(phi / 360 * wx.NX))
        cols = np.arange(i - 3, i + 4) % wx.NX
        rows = slice(wx.NY // 2 - 4, wx.NY // 2 + 4)
        mean = lambda a: float(a[rows][:, cols].mean())
        speed = np.hypot(d["u"][rows][:, cols], d["v"][rows][:, cols]).mean()
        hour = float(wx.local_hours(m.clock(now))[i % wx.NX])
        rain = mean(d["rain"])
        places[str(n)] = {
            "sky": _sky(mean(d["low"]), mean(d["high"]), mean(d["conv"]), rain, mean(d["fog"]),
                        float(d["storm"][rows][:, cols].max())),
            "local": f"{int(hour) % 24:02d}:{int(hour * 60) % 60:02d}",
            "rain": round(rain, 1),
            "wind": round(float(speed) * 3.6),
        }
    return {"at": datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds"),
            "places": places, "storms": storm_cells(d["storm"])}


def storm_cells(storm, limit=16, floor=0.15):
    """The strongest local peaks of thunderstorm intensity: [phi degrees, z km, intensity]."""
    peak = storm.copy()
    for shift in (-2, -1, 1, 2):
        peak = np.maximum(peak, np.roll(storm, shift, axis=1))
    rows = peak.copy()
    for shift in (-2, -1, 1, 2):
        rows[max(shift, 0):wx.NY + min(shift, 0)] = np.maximum(
            rows[max(shift, 0):wx.NY + min(shift, 0)], peak[max(-shift, 0):wx.NY + min(-shift, 0)])
    j, i = np.nonzero((storm >= rows) & (storm > floor))
    order = np.argsort(-storm[j, i])[:limit]
    return [[round(float(wx.PHI[i[k]]), 2), round(float(wx.Z_KM[j[k]])), round(float(storm[j[k], i[k]]), 2)]
            for k in order]


def write_outputs(m, out, look, now):
    d = m.diagnostics()
    out.mkdir(parents=True, exist_ok=True)
    _png(out / "weather.png", (d["low"], d["high"], d["conv"]))
    _png(out / "wind.png", (0.5 + d["u"] / 80, 0.5 + d["v"] / 80, d["fog"]))
    _png(out / "wet.png", (d["rain"] / 10, d["storm"], np.zeros_like(d["storm"])))
    # last, once all three maps are in place: the shell reloads them when this changes
    st = status(m, d, look, now)
    _atomic(out / "status.json", lambda tmp: tmp.write_text(json.dumps(st, indent=1) + "\n"))
    return d, st


def save_state(m, path, land_hash, traffic=None):
    flights = {"traffic": np.array(traffic.dumps())} if traffic else {}
    def write(tmp):
        with open(tmp, "wb") as f:
            # float16 and compression bring it to about 6 MB; 3 significant digits are plenty
            np.savez_compressed(f, t=np.float64(m.t), land=land_hash, version=STATE_VERSION, **flights,
                                **{k: v.astype(np.float16) for k, v in m.state().items()})
    _atomic(path, write)


def load_state(m, path, land_hash, traffic=None):
    """Loads a saved state into m (and the flights into traffic, setting traffic.restored)
    and returns True, or False if there is none usable."""
    try:
        with np.load(path) as z:
            if int(z["version"]) != STATE_VERSION or str(z["land"]) != land_hash:
                log.info("saved state is for another land map or version: starting afresh")
                return False
            m.load_state({k: z[k] for k in wx.FIELDS}, float(z["t"]))
            if traffic is not None and "traffic" in z:
                traffic.loads(str(z["traffic"]))
                traffic.restored = True
            return True
    except (OSError, KeyError, ValueError) as e:
        if path.exists():
            log.warning("couldn't load %s (%s): starting afresh", path, e)
        return False


# ---------------------------------------------------------------- running it
def advance(m, until, dt, label=None, stop=lambda: False, traffic=None):
    """Steps m (and the traffic flying through it) on to time `until` in steps of at most dt,
    logging progress for long runs, and giving up early if stop() says so."""
    total = until - m.t
    mark = time.monotonic()
    while m.t < until - 1 and not stop():
        h = min(dt, until - m.t)
        m.step(h)
        if traffic is not None:
            traffic.step(h, m)
        if label and time.monotonic() - mark > 10:
            mark = time.monotonic()
            log.info("%s: %.0f%%", label, 100 * (1 - (until - m.t) / total))


def summary(d, m, traffic=None):
    sea = m.land < 0.5
    line = ("low cloud %.0f%% (sea %.0f%%, land %.0f%%), high %.0f%%, raining %.1f%% of the band "
            "(mean %.2f mm/h), %d storm cells, fog %.1f%%, wind %.1f m/s (max %.0f)") % (
        100 * d["low"].mean(), 100 * d["low"][sea].mean(), 100 * d["low"][~sea].mean(), 100 * d["high"].mean(),
        100 * (d["rain"] > 0.1).mean(), d["rain"].mean(), len(storm_cells(d["storm"], limit=999)),
        100 * (d["fog"] > 0.5).mean(), np.hypot(d["u"], d["v"]).mean(), np.hypot(d["u"], d["v"]).max())
    if traffic is not None:
        jets = sum(c.kind == "jet" for c in traffic.craft)
        line += ", %d jets and %d airships aloft" % (jets, len(traffic.craft) - jets)
    return line


class Service:
    def __init__(self, out, land_path, observed_path, seed=None, towns_path=None):
        self.out = out
        self.observed_path = observed_path
        self.towns_path = towns_path or out / "towns.png"
        self.seed = seed
        land, self.land_hash = load_land(land_path)
        self.m = wx.Model(land, seed=seed)
        self.traffic = self.load_traffic()
        self.look = read_look()
        self.observed_stamp = None
        self.busy = False           # mid-step: a stop request waits for the step to finish
        self.stopping = False

    def stop(self, *_):
        """SIGTERM: leave at once if idle, else after the step under way, so the state saved on
        the way out is never half a step."""
        if self.busy:
            self.stopping = True
        else:
            raise SystemExit(0)

    def load_traffic(self):
        """The air traffic, with airports at towns.png's cities; None until there is a towns map
        (the run loop keeps looking for one)."""
        try:
            towns = np.asarray(Image.open(self.towns_path).convert("RGB"))
        except OSError:
            log.warning("no towns map at %s yet: no air traffic until there is one", self.towns_path)
            return None
        if towns.shape != (wx.NY, wx.NX, 3):
            log.warning("%s is %dx%d, not %dx%d: no air traffic", self.towns_path, towns.shape[1],
                        towns.shape[0], wx.NX, wx.NY)
            return None
        t = tr.Traffic(towns.astype(np.float32) / 255, seed=self.seed)
        t.restored = False
        log.info("air traffic between %d airports", len(t.ap_s))
        return t

    def start(self, now, spinup_hours=None):
        """Loads the saved state and catches up to now, or spins up afresh (weather and flights
        together, so the contrails' cirrus is there from the start)."""
        m, t = self.m, self.traffic
        if spinup_hours is None and load_state(m, self.out / "state.npz", self.land_hash, t):
            self.observe(now)
            gap = now - m.t
            if gap > 2 * STEP:
                if gap > CATCHUP_MAX:
                    m.t = now - CATCHUP_MAX
                log.info("catching up %.1f hours", (now - m.t) / 3600)
                advance(m, now, SPINUP_DT, "catching up", traffic=t if t and t.restored else None)
            if t and not t.restored:
                t.preroll(m)
            return
        hours = SPINUP_HOURS if spinup_hours is None else spinup_hours
        log.info("no saved state: spinning up %.0f hours of weather", hours)
        t0 = time.monotonic()
        m.init_state(now - hours * 3600)
        self.observe(now)
        advance(m, now, SPINUP_DT, "spin-up", traffic=t)
        log.info("spin-up took %.0f s", time.monotonic() - t0)

    def observe(self, now):
        """Re-reads observed.json and the look when they may have changed."""
        try:
            stamp = self.observed_path.stat().st_mtime
        except OSError:
            stamp = None
        targets = read_observed(self.observed_path, now) if stamp else None
        self.look = read_look()
        self.m.set_observed(targets, place_phi(self.look, 1))
        if stamp != self.observed_stamp:
            self.observed_stamp = stamp
            if targets:
                log.info("workspace 1 follows the real sky: %s", targets)

    def write(self, now, save=True):
        d, st = write_outputs(self.m, self.out, self.look, now)
        if save:
            save_state(self.m, self.out / "state.npz", self.land_hash, self.traffic)
        return d, st

    def write_traffic(self, now):
        """traffic.json: {"at", "craft": [{"id", "kind" (jet or airship), "phi" (deg), "z"
        (km), "alt" (km), "dphi" (deg/s), "dz" (km/s), "beacon", "trail": [[phi, z, unix s],
        ...]}]}, every craft as it is at `at`. dphi and dz carry it on along its heading
        until the next update; trail is the contrail it is laying, oldest first, one point a
        minute, empty if it isn't laying one."""
        craft = self.traffic.snapshot(self.m.t) if self.traffic else []
        doc = {"at": datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds"), "craft": craft}
        _atomic(self.out / "traffic.json", lambda tmp: tmp.write_text(json.dumps(doc, separators=(",", ":"))))

    def run(self):
        """The real-time loop: a step at the top of every minute, maps every five, the state
        every fifteen and on the way out. After a suspend the gap is caught up in bigger steps."""
        now = time.time()
        next_out, next_save, next_log = now + OUTPUT_EVERY, now + STATE_EVERY, now + 3600
        try:
            while not self.stopping:
                time.sleep(max(1.0, (np.floor(time.time() / STEP) + 1) * STEP + 1 - time.time()))
                self.busy = True
                now = time.time()
                self.observe(now)
                gap = now - self.m.t
                if gap > 10 * STEP:
                    self.m.t = max(self.m.t, now - CATCHUP_MAX)
                    log.info("catching up %.0f minutes after a pause", gap / 60)
                    advance(self.m, now, SPINUP_DT, stop=lambda: self.stopping, traffic=self.traffic)
                else:
                    advance(self.m, now, 2 * STEP, traffic=self.traffic)
                self.write_traffic(now)
                if now >= next_out:
                    if self.traffic is None and self.towns_path.exists():
                        self.traffic = self.load_traffic()
                        if self.traffic:
                            self.traffic.preroll(self.m)
                    d, _ = self.write(now, save=now >= next_save)
                    next_out = now + OUTPUT_EVERY
                    if now >= next_save:
                        next_save = now + STATE_EVERY
                    if now >= next_log:
                        log.info(summary(d, self.m, self.traffic))
                        next_log = now + 3600
                self.busy = False
        finally:
            save_state(self.m, self.out / "state.npz", self.land_hash, self.traffic)
            log.info("state saved")


# ---------------------------------------------------------------- a look at it
def preview(out, land_path, dest, rows=3):
    """Draws the latest maps over the land, the band cut into `rows` strips one after another
    from phi 0 (each a third of the ring by default, spinward to the right): sea blue (deep
    basins darker), land green to brown with height, night darker, low cloud white, high cloud
    a pale blue veil, fog yellow-grey, rain blue, storms red, aircraft as dots (jets pale yellow,
    airships orange) trailing their contrails, and each workspace's place marked with its local
    time and sky."""
    land = np.asarray(Image.open(land_path).convert("RGB")).astype(np.float32) / 255
    wpng = np.asarray(Image.open(out / "weather.png").convert("RGB")).astype(np.float32) / 255
    npng = np.asarray(Image.open(out / "wind.png").convert("RGB")).astype(np.float32) / 255
    epng = np.asarray(Image.open(out / "wet.png").convert("RGB")).astype(np.float32) / 255
    st = json.loads((out / "status.json").read_text())
    craft = read_traffic(out)
    r, g, b = land[..., 0:1], land[..., 1:2], land[..., 2:3]
    e = np.clip((g + 0.1 * b - 0.57) / 0.3, 0, 1)
    ground = np.concatenate([0.22 + 0.45 * e, 0.42 + 0.05 * e, 0.16 + 0.1 * e], axis=-1)
    deep = np.clip((g - 0.33) / 0.15, 0, 1)
    water = np.concatenate([0.05 + 0.05 * deep, 0.16 + 0.14 * deep, 0.36 + 0.14 * deep], axis=-1)
    img = r * ground + (1 - r) * water
    at = datetime.fromisoformat(st["at"]).timestamp()
    night = wx.sunlight(wx.clock_hour(at))[None, :, None]
    img *= 0.45 + 0.55 * np.sqrt(night)
    low, high, conv = (wpng[..., k:k + 1] for k in range(3))
    fog = npng[..., 2:3]
    rain, storm = epng[..., 0:1], epng[..., 1:2]
    img = img * (1 - 0.55 * high) + 0.55 * high * np.array([0.75, 0.82, 0.95])
    cloud = np.array([1.0, 1.0, 1.0]) * (1 - 0.35 * conv)
    img = img * (1 - low) + low * cloud
    img = img * (1 - 0.8 * fog) + 0.8 * fog * np.array([0.85, 0.82, 0.7])
    img = img * (1 - 0.7 * np.clip(rain * 4, 0, 1)) + 0.7 * np.clip(rain * 4, 0, 1) * np.array([0.25, 0.4, 0.9])
    st_a = np.clip(storm * 2.5, 0, 1)
    img = img * (1 - st_a) + st_a * np.array([1.0, 0.1, 0.05])
    strips = np.array_split(np.arange(wx.NX), rows)
    width = max(len(s) for s in strips)
    gap = 16
    canvas = Image.new("RGB", (width, rows * (wx.NY + gap) + 4), (20, 20, 24))
    draw = ImageDraw.Draw(canvas)
    look = read_look()
    for k, cols in enumerate(strips):
        y = k * (wx.NY + gap) + gap
        canvas.paste(Image.fromarray((np.clip(img[:, cols], 0, 1) * 255).astype(np.uint8)), (0, y))
        at_xy = lambda phi, z: (phi / 360 * wx.NX - cols[0], y + (z / wx.BAND_KM + 0.5) * wx.NY)
        for c in craft:
            x, yy = at_xy(c["phi"], c["z"])
            if not 0 <= x < len(cols):
                continue
            if len(c["trail"]) > 1:
                draw.line([at_xy(p, z) for p, z, _ in c["trail"]] + [(x, yy)], fill=(225, 225, 235))
            colour = (255, 245, 170) if c["kind"] == "jet" else (255, 150, 60)
            draw.rectangle([x - 1, yy - 1, x + 1, yy + 1], fill=colour)
        for n in range(1, 11):
            i = int(place_phi(look, n) / 360 * wx.NX)
            if cols[0] <= i <= cols[-1]:
                x = i - cols[0]
                p = st["places"][str(n)]
                draw.line([(x, y - 4), (x, y - 1)], fill=(255, 220, 120))
                draw.text((x + 3, y - 13), f"{n} {p['local']} {p['sky']}", fill=(255, 220, 120))
    canvas = canvas.resize((canvas.width * 3 // 2, canvas.height * 3 // 2), Image.LANCZOS)
    canvas.save(dest)
    return dest


def read_traffic(out):
    try:
        return json.loads((out / "traffic.json").read_text())["craft"]
    except (OSError, ValueError, KeyError):
        return []


def in_view(craft, phi):
    """Craft a place's camera sees: it looks spinward from its place, over about 40 degrees of
    ring and the band's whole width."""
    return [c for c in craft if (c["phi"] - phi) % 360 < VIEW_DEG]


def print_status(out):
    try:
        st = json.loads((out / "status.json").read_text())
    except (OSError, ValueError):
        print(f"No status yet in {out} (is vereda-weather running?)")
        return 1
    craft, look = read_traffic(out), read_look()
    print(f"Orbital weather at {st['at']}; {len(craft)} craft in the air")
    for n, p in st["places"].items():
        seen = in_view(craft, place_phi(look, int(n)))
        print(f"  {n:>2}  {p['local']}  {p['sky']:<14} rain {p['rain']:>4} mm/h  wind {p['wind']:>3} km/h"
              f"  {len(seen):>2} craft in view")
    if st["storms"]:
        print(f"  thunderstorms: the strongest of {len(st['storms'])} listed is at phi {st['storms'][0][0]} deg, "
              f"z {st['storms'][0][1]} km ({st['storms'][0][2]})")
    else:
        print("  no thunderstorms anywhere")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="The Vereda Orbital's weather, for the wallpaper's clouds.")
    ap.add_argument("--once", action="store_true", help="one step, write the maps and state, exit")
    ap.add_argument("--spinup-hours", type=float, help="start afresh from this many hours of spin-up")
    ap.add_argument("--status", action="store_true", help="print status.json")
    ap.add_argument("--preview", metavar="PNG", help="draw the latest maps over the land into PNG")
    ap.add_argument("--dir", type=Path, default=CACHE, help=f"where maps and state go (default {CACHE})")
    ap.add_argument("--land", type=Path, help="the land map (default DIR/land.png)")
    ap.add_argument("--observed", type=Path, help="the real weather (default DIR/observed.json)")
    ap.add_argument("--towns", type=Path, help="where people live, for airports (default DIR/towns.png)")
    ap.add_argument("--seed", type=int, help="fix the random triggering")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s" if os.environ.get("INVOCATION_ID")
                        else "%(asctime)s %(message)s", datefmt="%H:%M:%S", stream=sys.stdout)
    land = a.land or a.dir / "land.png"
    if a.status:
        return print_status(a.dir)
    if a.preview:
        print(preview(a.dir, land, Path(a.preview)))
        return 0
    if not land.exists():
        log.error("no land map at %s: run weather/landmap.sh", land)
        return 1
    s = Service(a.dir, land, a.observed or a.dir / "observed.json", seed=a.seed, towns_path=a.towns)
    now = time.time()
    s.start(now, a.spinup_hours)
    if a.once:
        now = max(time.time(), s.m.t + STEP)
        s.observe(now)
        advance(s.m, now, 2 * STEP, traffic=s.traffic)
        d, _ = s.write(now)
        s.write_traffic(now)
        log.info(summary(d, s.m, s.traffic))
        return 0
    signal.signal(signal.SIGTERM, s.stop)
    s.write(now)
    s.write_traffic(now)
    log.info("running: a step a minute, maps every five")
    s.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())

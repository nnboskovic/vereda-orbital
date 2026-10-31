"""Air traffic over the Orbital: jets at cruising height and slow airships lower down, flying
between the band's cities, each airport keeping its own local hours, and finding their way round
thunderstorms. Jets that cross cold, moist air aloft leave contrails, and where that air is
supersaturated over ice the contrails persist and spread into a faint haze of cirrus, which goes
back into the weather's high cloud.

Positions are kept on the unrolled band in km: s along the ring (0 to 75,400, spinward; phi =
s / RING_KM * 360) and z across it (-1300 to 1300, row 0's rim negative). A route is a list of
waypoints in the craft's own unwrapped frame, so a flight across the ring's seam is just a
straight line; everything is wrapped back onto the ring only when it is written out.
"""

import json
import math
from collections import deque

import numpy as np

import model as wx

RING_KM = wx.NX * wx.DX / 1000          # 75,400 km round the ring, as the grid has it
HALF_KM = wx.BAND_KM / 2
CELL_KM = wx.DX / 1000

# The two kinds of craft: cruising height (km), true airspeed (km/s), the range of a hop (km),
# and how far they take to climb out and to come down.
KINDS = {
    "jet": {"alt": 10.0, "speed": (0.230, 0.250), "hop": (700.0, 9000.0), "scale": 2500.0,
            "climb": 150.0, "descent": 200.0},
    "airship": {"alt": 2.0, "speed": (0.025, 0.035), "hop": (150.0, 700.0), "scale": 300.0,
                "climb": 15.0, "descent": 15.0},
}
AIRSHIP_SHARE = 0.25        # of departures
BEACON_SHARE = 0.3          # craft showing a beacon
DEPARTURES = 0.25           # an hour, from an airport of size 1 at the day's usual pace
# How busy airports are through their local day: normal by day, a bump as the morning starts,
# busiest in the evening, and nearly quiet from 23:00 to 05:00.
PACE = np.array([[0, 0.06], [5, 0.06], [7, 1.0], [8, 1.2], [10, 1.0], [16, 1.0], [18, 1.8],
                 [21, 1.8], [23, 0.06], [24, 0.06]])
STORM_FLOOR = 0.25          # thunderstorm intensity (wet.png G) that crews fly round
AVOID = 1.5                 # how many of a storm's radii they keep from its middle
MARGIN = 15.0               # km more, for good measure
LOOKAHEAD = 2500.0          # km of route ahead checked for storms
STORM_EVERY = 300.0         # s between fresh looks at the storms
CRUISE_KM = 8.0             # contrails need the cold of cruising height
RHI_FORM = 0.85             # aloft humidity (relative to ice) above which a contrail forms...
RHI_PERSIST = 1.0           # ...and above which it persists and spreads
K_CONTRAIL = 6e-4           # g/kg of ice a persistent contrail leaves in its cell per km flown
TRAIL_MINUTES = 15
SHORT_TRAIL = 3             # minutes a contrail lasts in air that isn't supersaturated


def find_airports(towns, floor=0.5, apart_km=300.0):
    """Airports at the band's densest cities: local peaks of towns.png's red (where people live)
    above floor, at least apart_km from one another, biggest first. Returns s, z (km) and size
    (0..1, how busy)."""
    r = np.asarray(towns, np.float32)[..., 0]
    j, i = np.nonzero(r > floor)
    order = np.argsort(-r[j, i], kind="stable")
    s_all, z_all = (i + 0.5) * CELL_KM, wx.Z_KM[j]
    picked = []
    for k in order:
        s, z = s_all[k], z_all[k]
        if all(math.hypot(_wrap(s - ps), z - pz) >= apart_km for ps, pz, _ in picked):
            picked.append((s, float(z), float(r[j[k], i[k]])))
    a = np.array(picked, np.float64).reshape(-1, 3)
    return a[:, 0], a[:, 1], np.clip((a[:, 2] - floor + 0.1) / (1.1 - floor), 0.1, 1)


def _wrap(ds):
    """The shorter way round the ring for a difference along it."""
    return (ds + RING_KM / 2) % RING_KM - RING_KM / 2


def pace(hours):
    return np.interp(np.mod(hours, 24.0), PACE[:, 0], PACE[:, 1])


class Craft:
    __slots__ = ("id", "kind", "beacon", "s", "z", "speed", "route", "flown", "alt0", "trail",
                 "forming")

    def __init__(self, id, kind, beacon, s, z, speed, route):
        self.id, self.kind, self.beacon = id, kind, beacon
        self.s, self.z, self.speed, self.route = s, z, speed, route
        self.flown = 0.0
        self.trail = deque(maxlen=TRAIL_MINUTES)
        self.forming = False

    def remaining(self):
        d, s, z = 0.0, self.s, self.z
        for ws, wz in self.route:
            d += math.hypot(ws - s, wz - z)
            s, z = ws, wz
        return d

    def altitude(self):
        k = KINDS[self.kind]
        up = min(self.flown / k["climb"], self.remaining() / k["descent"], 1.0)
        return k["alt"] * max(up, 0.03)

    def heading(self):
        """Unit vector toward the next waypoint."""
        ws, wz = self.route[0]
        d = math.hypot(ws - self.s, wz - self.z) or 1.0
        return (ws - self.s) / d, (wz - self.z) / d


class Traffic:
    """Everything in the air. step(dt, model) moves it on dt seconds of the model's time: new
    departures, flights flown, storms flown round, contrails laid (into model.add_ice)."""

    def __init__(self, towns, seed=None):
        self.ap_s, self.ap_z, self.ap_size = find_airports(towns)
        self.rng = np.random.default_rng(seed)
        self.craft = []
        self.next_id = 1
        self.storms = np.zeros((0, 3))          # s, z, radius (km)
        self.storms_at = -1e18
        self.ice, self.ice_at = [], -1e18       # contrail ice waiting to join the weather

    # ------------------------------------------------------------ the flights
    def step(self, dt, m, contrails=True):
        """Advances the traffic by dt seconds, to the model's current time m.t."""
        t = m.t
        if t - self.storms_at >= STORM_EVERY:
            self.see_storms(m.storm_field(), t)
        self._depart(dt, t, m.clock)
        landed = []
        for c in self.craft:
            s0, z0 = c.s, c.z
            left = c.speed * dt
            while left > 1e-9 and c.route:
                ws, wz = c.route[0]
                d = math.hypot(ws - c.s, wz - c.z)
                if d <= left:
                    c.s, c.z = ws, wz
                    c.route.pop(0)
                    c.flown += d
                    left -= d
                else:
                    c.s += (ws - c.s) * left / d
                    c.z += (wz - c.z) * left / d
                    c.flown += left
                    left = 0.0
            if not c.route:
                landed.append(c)
                continue
            self._contrail(c, m, s0, z0, t)
        if landed:
            gone = set(id(c) for c in landed)
            self.craft = [c for c in self.craft if id(c) not in gone]
        # The ice goes into the weather every five minutes in one go: a contrail's cirrus
        # takes longer than that to spread anyway.
        if not contrails:
            self.ice.clear()
        elif t - self.ice_at >= STORM_EVERY:
            if self.ice:
                cells_, amounts_ = zip(*self.ice)
                m.add_ice(np.concatenate(cells_), np.concatenate(amounts_).astype(np.float32))
            self.ice, self.ice_at = [], t

    def _depart(self, dt, t, clock):
        hours = clock(t) - (self.ap_s / RING_KM * 360.0) / 15.0
        n = self.rng.poisson(DEPARTURES * dt / 3600.0 * self.ap_size * pace(hours))
        for a in np.nonzero(n)[0]:
            for _ in range(n[a]):
                self.launch(a)

    def launch(self, a, dest=None, kind=None):
        """A new flight from airport a (to dest, of kind, if given; else chosen as an airline
        would: a jet three times in four, to a city a few thousand km off, the bigger the
        likelier)."""
        kind = kind or ("airship" if self.rng.random() < AIRSHIP_SHARE else "jet")
        k = KINDS[kind]
        ds = _wrap(self.ap_s - self.ap_s[a])
        dist = np.hypot(ds, self.ap_z - self.ap_z[a])
        if dest is None:
            ok = (dist >= k["hop"][0]) & (dist <= k["hop"][1])
            if not ok.any():
                return None
            w = np.where(ok, self.ap_size * np.exp(-dist / k["scale"]), 0)
            dest = int(self.rng.choice(len(w), p=w / w.sum()))
        s0, z0 = float(self.ap_s[a]), float(self.ap_z[a])
        c = Craft(self.next_id, kind, bool(self.rng.random() < BEACON_SHARE), s0, z0,
                  float(self.rng.uniform(*k["speed"])), [(s0 + float(ds[dest]), float(self.ap_z[dest]))])
        self.next_id += 1
        self.avoid(c)
        self.craft.append(c)
        return c

    # ------------------------------------------------------------ storms
    def see_storms(self, storm, t):
        """Takes a fresh look at the thunderstorms (intensity on the model's grid). A route that
        still keeps clear of them all is left as it is; one that now runs into a storm is
        planned afresh from where the craft is, rather than patched on top of old detours."""
        self.storms = storm_cells(storm)
        self.storms_at = t
        if len(self.storms):
            for c in self.craft:
                if self._first_hit(c) is not None:
                    c.route = [c.route[-1]]
                    self.avoid(c)

    def avoid(self, c):
        """Bends c's route round any storm it would pass within AVOID of its radius in the
        route's next LOOKAHEAD km: for the first leg that runs into one, a detour waypoint
        beside it (and any storms close behind it), out on whichever side is the shorter way
        round and inside the walls, far enough that both new legs keep clear; then the new legs
        are checked again."""
        for _ in range(6):
            hit = self._first_hit(c)
            if hit is None:
                return
            k, w = hit
            if w is None:
                return
            c.route.insert(k, w)

    def _first_hit(self, c):
        """The first leg of c's route (within LOOKAHEAD) that runs into a storm, as its index
        and the detour waypoint that would take it round; None if the way ahead is clear.
        Storms over the craft itself or its destination can't be flown round, and aren't
        counted."""
        st = self.storms
        if not len(st):
            return None
        sx = c.s + _wrap(st[:, 0] - c.s)
        sz, clear = st[:, 1], AVOID * st[:, 2] + MARGIN
        ds, dz = c.route[-1][0] - sx, c.route[-1][1] - sz
        free = (np.hypot(sx - c.s, sz - c.z) > clear) & (np.hypot(ds, dz) > clear)
        if not free.any():
            return None
        ax, az, ahead = c.s, c.z, 0.0
        for k, (bx, bz) in enumerate(c.route):
            length = math.hypot(bx - ax, bz - az) or 1e-9
            ex, ez = (bx - ax) / length, (bz - az) / length
            along = (sx - ax) * ex + (sz - az) * ez
            across = (sz - az) * ex - (sx - ax) * ez          # positive to the left
            u = np.clip(along, 0, length)
            hit = free & (np.hypot(sx - ax - u * ex, sz - az - u * ez) < clear)
            if hit.any():
                n = np.nonzero(hit)[0]
                group = n[along[n] < along[n].min() + 2 * clear[n].max()]
                return k, self._detour(ax, az, ex, ez, length, along[group], across[group], clear[group])
            ahead += length
            if ahead > LOOKAHEAD:
                return None
            ax, az = bx, bz
        return None

    @staticmethod
    def _detour(ax, az, ex, ez, length, along, across, clear):
        """The waypoint for a leg from (ax, az) along (ex, ez) past storms at (along, across)
        from its start: beside them, offset from the leg so that a straight leg to it and on
        from it keeps each storm's clearance (a leg to a point offset by o over a run of r
        passes a storm level with that point at o r / sqrt(r^2 + o^2), so o grows a little past
        the clearance itself), on the side needing the smaller turn, inside the walls; None if
        neither side fits."""
        at = float(np.clip(along.mean(), 0, length))
        run = max(min(at, length - at), float(clear.max()))
        options = []
        for sign in (1.0, -1.0):
            o = float((sign * across + clear).max()) + 10.0
            for _ in range(3):
                o = float((sign * across + clear * math.sqrt(1 + (o / run) ** 2)).max()) + 10.0
            wx_ = ax + ex * at - ez * sign * o
            wz = az + ez * at + ex * sign * o
            if abs(wz) <= HALF_KM - 30.0:
                options.append((o, wx_, wz))
        if not options:
            return None
        o, wx_, wz = min(options)
        return wx_, wz

    # ------------------------------------------------------------ contrails
    def _contrail(self, c, m, s0, z0, t):
        """Jets at cruising height make a contrail where the air aloft is moist enough; where
        it is supersaturated over ice the contrail persists, and its ice, laid along the path
        flown this step, waits in self.ice to join the high cloud."""
        if c.kind != "jet" or c.altitude() < CRUISE_KM:
            c.forming = False
            c.trail.clear()
            return
        rhi = m.rhi.ravel()
        here = int((c.z + HALF_KM) // CELL_KM)
        here = min(max(here, 0), wx.NY - 1) * wx.NX + int(c.s // CELL_KM) % wx.NX
        c.forming = bool(rhi[here] > RHI_FORM)
        persist = bool(rhi[here] > RHI_PERSIST)
        c.trail.append((c.s % RING_KM, c.z, t, persist))
        if not c.forming:
            return
        dist = math.hypot(c.s - s0, c.z - z0)
        n = max(1, int(math.ceil(dist / (CELL_KM / 2))))
        f = (np.arange(n) + 0.5) / n
        idx = _cell(s0 + f * (c.s - s0), z0 + f * (c.z - z0))
        keep = rhi[idx] > RHI_PERSIST
        if keep.any():
            self.ice.append((idx[keep], np.full(keep.sum(), K_CONTRAIL * dist / n)))

    # ------------------------------------------------------------ out
    def snapshot(self, t):
        """traffic.json's contents at time t: every craft's place, height, heading as rates
        (so the shell can carry it on between updates), beacon, and the contrail it is laying,
        if it is laying one: a point a minute for up to 15 minutes in supersaturated air, a
        few minutes otherwise."""
        out = []
        for c in self.craft:
            hs, hz = c.heading()
            trail = []
            if c.forming:
                for s, z, when, persist in reversed(c.trail):
                    age = t - when
                    if age > TRAIL_MINUTES * 60 + 1 or (not persist and age > SHORT_TRAIL * 60 + 1):
                        break
                    trail.append([round(s / RING_KM * 360.0, 4), round(z, 1), int(round(when))])
                trail.reverse()
            out.append({"id": c.id, "kind": c.kind,
                        "phi": round((c.s % RING_KM) / RING_KM * 360.0, 4), "z": round(c.z, 1),
                        "alt": round(c.altitude(), 2),
                        "dphi": round(hs * c.speed / RING_KM * 360.0, 7), "dz": round(hz * c.speed, 5),
                        "beacon": c.beacon, "trail": trail})
        return out

    def dumps(self):
        """The flights in the air, as JSON for state.npz."""
        return json.dumps({"next": self.next_id, "craft": [
            [c.id, c.kind, c.beacon, c.s, c.z, c.speed, c.route, c.flown, [list(p) for p in c.trail]]
            for c in self.craft]})

    def loads(self, text):
        d = json.loads(text)
        self.next_id, self.craft = d["next"], []
        for id, kind, beacon, s, z, speed, route, flown, trail in d["craft"]:
            c = Craft(id, kind, beacon, s, z, speed, [tuple(w) for w in route])
            c.flown = flown
            c.trail.extend(tuple(p) for p in trail)
            self.craft.append(c)

    def preroll(self, m, hours=8.0, dt=120.0):
        """Fills the sky as it would be after hours of flying up to now, with today's storms
        and air, without touching the weather."""
        t_end, m_t = m.t, m.t
        self.see_storms(m.storm_field(), t_end)
        try:
            m.t = t_end - hours * 3600
            while m.t < t_end - 1:
                m.t += dt
                self.storms_at = m.t           # keep today's storms; no fresh looks
                self.step(dt, m, contrails=False)
        finally:
            m.t = m_t
        self.storms_at = -1e18


def _cell(s, z):
    """Flat index of the grid cell under s, z (km), wrapping along the ring."""
    i = np.floor(np.asarray(s) / CELL_KM).astype(np.int64) % wx.NX
    j = np.clip(np.floor((np.asarray(z) + HALF_KM) / CELL_KM).astype(np.int64), 0, wx.NY - 1)
    return j * wx.NX + i


def storm_cells(storm, floor=STORM_FLOOR):
    """Thunderstorms as s, z and radius (km): local peaks of intensity above floor, each as big
    as the patch round it at more than half its peak."""
    peak = storm.copy()
    for shift in (-1, 1):
        peak = np.maximum(peak, np.roll(storm, shift, axis=1))
    rows = peak.copy()
    rows[1:] = np.maximum(rows[1:], peak[:-1])
    rows[:-1] = np.maximum(rows[:-1], peak[1:])
    j, i = np.nonzero((storm >= rows) & (storm > floor))
    order = np.argsort(-storm[j, i], kind="stable")
    out = []
    for jj, ii in zip(j[order], i[order]):
        cols = np.arange(ii - 3, ii + 4) % wx.NX
        patch = storm[max(jj - 3, 0):jj + 4][:, cols]
        cells = (patch > 0.5 * storm[jj, ii]).sum()
        s, z, r = (ii + 0.5) * CELL_KM, float(wx.Z_KM[jj]), max(CELL_KM * math.sqrt(cells / math.pi), 20.0)
        # a peak inside a bigger one already found is the same storm
        if all(math.hypot(_wrap(s - os_), z - oz) > max(r, orad) for os_, oz, orad in out):
            out.append((s, z, r))
    return np.array(out, np.float64).reshape(-1, 3)

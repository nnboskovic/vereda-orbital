"""The Orbital's own weather: a small model of the lowest couple of kilometres of air over the
band, on the same 3016 x 104 grid of 25 km cells the wallpaper's land map is drawn on.

What shapes weather here is not what shapes it on a planet. An Orbital turns about its own axis,
the z direction across the band, so the Coriolis force -2 Omega x v has no horizontal part on the
floor: a wind along the ring only changes its own weight (the Eotvos effect, heavier spinward,
lighter antispinward) and a wind across the band runs parallel to Omega and feels nothing at all.
With nothing to turn the wind, air simply runs from high pressure to low until friction stops it,
so there are no cyclones, no fronts wrapped round a low, and no swirling storms. What is left is
the weather of a planet's calm tropics, writ long: the sun stays fixed while the ring turns once
a day, so the day sweeps spinward round the band at about 873 m/s, far faster than any wind,
and every place heats and cools on its own clock. Land heats and cools fast, shallow shelf seas
slower and deep basins slowest; warm air is light and its pressure low, so sea breezes blow
ashore by day and land breezes back out at night; moist land boils up into afternoon storms;
air driven up mountains rains on their windward sides and comes down dry behind them; cool deep
water breeds fog and low stratus by night. Up at cruising height the air carries a humidity of
its own, moistened by storms' outflow, where cirrus lingers and contrails (traffic.py) persist.
That is all this model has, and it turns out to be enough for weather that looks like weather.

The model state lives in numpy arrays shaped (104, 3016): row j across the band (row 0 one rim),
column i along the ring, increasing spinward. Along the ring the grid closes on itself; at the
rims stand the walls, which no air passes through. Each step moves everything with the wind
(semi-Lagrangian advection, which stays stable however long the step) and then lets the air,
the ground and the sea exchange heat and water cell by cell.

Units: temperatures in degrees C, water in g/kg, winds in m/s, time in seconds, rain in mm/h.
"""

import numpy as np

NX, NY = 3016, 104
DX = 25e3                                   # cell size, m
R_RING = 12000.0                            # ring radius, km (as the shader draws it)
BAND_KM = 2600.0                            # band width, km
KM_PER_DEG = 2 * np.pi * R_RING / 360       # about 209 km of floor per degree along the ring

# Where each column and row sits on the ring: phi in degrees spinward, z in km across.
PHI = ((np.arange(NX) + 0.5) / NX * 360).astype(np.float32)
Z_KM = (((np.arange(NY) + 0.5) / NY - 0.5) * BAND_KM).astype(np.float32)

# ---------------------------------------------------------------- physical constants
CP = 1005.0                 # J/kg/K, heat capacity of air
LV = 2.5e6                  # J/kg, latent heat of condensation
LC = LV / CP / 1000         # K of warming per g/kg condensed: about 2.49
SIGMA = 5.67e-8             # Stefan-Boltzmann
RHO = 1.15                  # kg/m3, air near the floor
GAMMA = 9.8e-3              # K/m, the dry adiabatic lapse rate
H_SLAB = 1000.0             # m: the boundary layer the model carries, as one well-mixed slab
M_SLAB = RHO * H_SLAB       # kg/m2 of air in it
C_AIR = M_SLAB * CP         # J/m2/K: what it takes to warm the slab by a degree

# ---------------------------------------------------------------- the climate's knobs
# These were tuned by eye and by statistics (see sim.py --preview) toward a warm, kind climate,
# as a Culture Orbital's would be: seas in the low to mid twenties, land a little warmer by day.
S_PEAK = 950.0              # W/m2 of sunlight on the floor with the sun overhead, clear sky
TH_FT = 23.5                # the free troposphere's temperature above the slab, as potential
                            # temperature at floor level; with no Coriolis force it is the same
                            # everywhere (the "weak temperature gradient" of the tropics, total here)
TH_FT_PER_M = 3.3e-3        # how that reference rises over high ground (a 6.5 K/km atmosphere)
INVERSION = 3.0             # K warmer, the air just above the slab's capping inversion
Q_FT = 7.0                  # g/kg of water in the air just above the slab
TAU_FT = 2.0 * 86400        # the slab drifts back toward the free troposphere's temperature
W_ENTRAIN = 0.0025          # m/s: dry air from above mixed down through the slab's top
RAD_COOL = 1.5 / 86400      # K/s the slab loses to space by radiation
THE_CRIT = 60.3             # moist static energy (as theta + LC q) above which convection fires
THE_CRIT_PER_M = 2.0e-3     # high ground needs a little more of it
CIN = 2.5                   # K of instability needed to break the inversion and start a cell
MASS_FLUX = 0.25            # kg/m2/s carried up by a fully developed cluster of cells
DOWNDRAFT_CHILL = 6.0       # K colder than the slab that downdraft air arrives at the floor
PRECIP_EFF = 0.6            # share of the water convection lifts that comes down as rain
K_LIFT = 60.0               # K of instability per m/s of broad uplift (convergence lifts parcels)
XI_AMP = 0.35               # K: random triggering, the eddies a 25 km cell can't resolve
K_HEAT = 0.3                # K of instability per K the ground is warmer than the air (thermals)
K_MOIST = 1.5               # K of instability where the air aloft is already moist (anvils)
SIG_STRAT = 0.06            # subgrid spread of water, as a share of saturation, for stratus
SIG_CU = 0.28               # and for cumulus, whose cells are patchier
CU_MAX = 0.45               # cumulus never cover much more than this of the sky
CU_SHARE = 0.25             # and hold a quarter of a sheet's water for the same excess
CU_PATCH = 0.6              # how strongly the mesoscale stirring gathers them into streets
FORCED_SHARE = 0.5          # share of what forced ascent condenses that the slab carries
SST_SHEET = 24.0            # sea colder than this (C) holds a strong enough inversion for stratus
TAU_COND = 600.0            # condensation and evaporation of cloud
CLOUD_SHARE = 0.2           # the slab's mean cloud water, as a share of the excess at its top
QL_CRIT = 0.3               # g/kg of cloud water before drizzle starts
TAU_AUTO = 2400.0           # how fast cloud water past that turns to rain
QI_REF = 0.06               # g/kg of high ice that covers about 63% of the sky
TAU_ICE = 4.0 * 3600        # anvils and cirrus thin away over a few hours in saturated air
K_ANVIL = 0.025             # g/kg of anvil ice per mm of convective rain
RHI_MEAN = 0.65             # the air's usual humidity at ~10 km, relative to ice
RHI_SPREAD = 0.28           # how far the slow drift of moist and dry air aloft swings it
TAU_UT = 8.0 * 3600         # how fast the air aloft forgets
TAU_UT_DRIFT = 12.0 * 3600  # and how fast that large-scale pattern itself changes
K_DETRAIN = 0.12            # rise in that humidity per mm of convective rain (anvil outflow)
K_UPLIFT = 7e-4             # and per m of broad uplift
RHI_CIRRUS = 1.15           # past this the air aloft makes thin cirrus by itself
K_CIRRUS = 1e-5             # g/kg/s of it per unit of humidity past that
TAU_LIFT = 3.0 * 3600       # how far broad uplift raises the cloud level: w times this
TAU_OROG = 2.0 * 3600       # and how far wind blowing up a slope does
W_FORCED = 0.03             # m/s of uplift past which it lifts the air as a whole
W_CAP = 150.0               # mm of water the soil holds
ALPHA = 50.0                # m2/s2 of pressure per K of slab temperature (g H / T for H ~ 1.5 km)
U_DRIFT = -3.0              # m/s, the slow antispinward drift (see Model._winds)
U_UP = -9.0                 # m/s, the same drift aloft, where cirrus and anvils ride
K_OUTFLOW = 0.8             # outflow aloft, against the inflow below
FRICTION_SEA = 1 / (7 * 3600.0)     # surface drag: a breeze left to itself dies in 7 h at sea,
FRICTION_LAND = 1 / (3.0 * 3600.0)  # 3 h over land,
FRICTION_HIGH = 1 / (1.2 * 3600.0)  # and faster still over mountains (this much more per 2 km)
V_MAX = 40.0                # m/s, the wind map's range
SLOW_EVERY = 180.0          # s between updates of what changes slowly (the air aloft, the stirring)
STREAK_NORM = 0.794         # brings _streaks back to unit spread


def qsat(t, p=1013.0):
    """Saturation specific humidity, g/kg, over water at t degrees C and p hPa (Clausius-
    Clapeyron in Bolton's fit: about 7% more water for each degree warmer)."""
    es = 6.112 * np.exp(17.67 * t / (t + 243.5))
    return 622.0 * es / (p - 0.378 * es)


def smooth3(a):
    """A 1-2-1 smoothing across three cells each way, periodic along the ring, the rim rows
    mirrored into the walls."""
    b = np.empty_like(a)
    b[:, 1:-1] = a[:, :-2] + a[:, 2:] + 2 * a[:, 1:-1]
    b[:, 0] = a[:, -1] + a[:, 1] + 2 * a[:, 0]
    b[:, -1] = a[:, -2] + a[:, 0] + 2 * a[:, -1]
    c = np.empty_like(a)
    c[1:-1] = b[:-2] + b[2:] + 2 * b[1:-1]
    c[0] = 3 * b[0] + b[1]
    c[-1] = 3 * b[-1] + b[-2]
    c *= 1 / 16
    return c


def box5(a):
    """A five-cell running mean each way, periodic along the ring, clamped at the rims. Summed
    in the same order everywhere, so it gives the same answer wherever the seam falls."""
    p = np.concatenate([a[:, -2:], a, a[:, :2]], axis=1)
    b = p[:, :-4] + p[:, 1:-3] + p[:, 2:-2] + p[:, 3:-1] + p[:, 4:]
    p = np.concatenate([b[:1], b[:1], b, b[-1:], b[-1:]], axis=0)
    c = p[:-4] + p[1:-3] + p[2:-2] + p[3:-1] + p[4:]
    c *= 1 / 25
    return c


def box_blur(a, r):
    """The mean over a (2r+1)-cell square, periodic along the ring and clamped at the rims; used
    once at start for broad, smooth fields (how far inland a place is, how warm its sea)."""
    if r <= 0:
        return a.astype(np.float32)
    ny, nx = a.shape
    p = np.pad(a.astype(np.float64), ((0, 0), (r, r)), mode="wrap")
    c = np.concatenate([np.zeros((ny, 1)), np.cumsum(p, axis=1)], axis=1)
    b = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
    p = np.pad(b, ((r, r), (0, 0)), mode="edge")
    c = np.concatenate([np.zeros((1, nx)), np.cumsum(p, axis=0)], axis=0)
    return ((c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)).astype(np.float32)


def blur(a, r, passes=3):
    """Three box blurs in a row, close enough to a Gaussian of about r cells."""
    for _ in range(passes):
        a = box_blur(a, r)
    return a


def ddx(a):
    """Centred difference along the ring, per metre, closing round the seam."""
    d = np.empty_like(a)
    d[:, 1:-1] = a[:, 2:] - a[:, :-2]
    d[:, 0] = a[:, 1] - a[:, -1]
    d[:, -1] = a[:, 0] - a[:, -2]
    d *= 1 / (2 * DX)
    return d


def ddy(a, odd=False):
    """Centred difference across the band, per metre. Past the rims a field is mirrored, or for
    a velocity across the band (odd) mirrored with its sign flipped, as flow into a wall is."""
    d = np.empty_like(a)
    d[1:-1] = a[2:] - a[:-2]
    if odd:
        d[0] = a[1] + a[0]
        d[-1] = -a[-1] - a[-2]
    else:
        d[0] = a[1] - a[0]
        d[-1] = a[-1] - a[-2]
    d *= 1 / (2 * DX)
    return d


def local_hours(clock_hour):
    """Local solar hour of every column: the clock hour minus phi/15, wrapped to 0..24."""
    return np.mod(clock_hour - PHI / 15.0, 24.0).astype(np.float32)


def sunlight(clock_hour):
    """Sunlight per column as a share of noon's: the sun stays put while the ring turns."""
    return np.maximum(0.0, np.cos((local_hours(clock_hour) - 12.0) * (np.pi / 12))).astype(np.float32)


# The prognostic fields, saved in state.npz. ADVECTED move with the low wind; qi (high ice) and
# rhi (the humidity up there) ride the wind aloft; the rest stay where they are (ground, sea, soil) or live too briefly to travel far (fog
# forms and lifts within the hour, and drifts a few km meanwhile).
ADVECTED = ("u", "v", "th", "q", "ql", "conv", "xi")
FIELDS = ADVECTED + ("qi", "rhi", "fog", "ts", "soil", "hbl", "rain", "storm", "nudge", "cover", "w")


class Model:
    """The weather over the whole band. Make one from the land map, call init_state(t) (or load
    a saved state), then step(dt) as often as you like; diagnostics() gives the maps to draw.

    land: (104, 3016, 3) floats 0..1, land.png's red (land), green (the continents' broad
    height) and blue (fine detail). clock(t) gives the local clock hour at unix time t (the
    machine's own time zone by default, as the wallpaper uses). seed fixes the random triggering;
    noise=False turns it off."""

    def __init__(self, land, clock=None, seed=None, noise=True):
        self.clock = clock or clock_hour
        self.rng = np.random.default_rng(seed)
        self.noise = noise
        self.t = None
        self.observed = None                 # targets near workspace 1, from set_observed()
        self._coarse = self._pattern = None  # the large-scale pattern aloft (see _drift)
        self._up_dt = self._noise_dt = 0.0   # time waiting for the slow updates
        self.obs_weight = np.zeros((NY, NX), np.float32)
        land = np.asarray(land, np.float32)
        self.land = np.clip(land[..., 0], 0, 1)
        cont, fine = land[..., 1], land[..., 2]
        sea = 1 - self.land

        # Height of the ground: lowlands rise gently from the coast, and where the shader draws
        # mountains (cont + 0.1 fine above 0.7) they climb to about 2.8 km, smoothed a little
        # so slopes span a few cells.
        e = cont + 0.1 * fine
        zs = self.land * (450 * np.clip((e - 0.57) / 0.13, 0, 1) + 2400 * np.clip((e - 0.7) / 0.15, 0, 1) ** 1.2)
        self.zs = smooth3(zs.astype(np.float32))
        self.dzdx, self.dzdy = ddx(self.zs), ddy(self.zs)

        # The sea: shelves (cont 0.4 to 0.57) are a few metres of sun-warmed water over sand and
        # stay near 26-27 C; deep basins (cont under 0.4) mix with cold water from below and sit
        # four or five degrees cooler, which is where fog and stratus like to lie. The mixed
        # layer that the day's sunlight warms is about 8 m deep on the shelves and 40 m in the
        # basins, so shelves warm by a degree on a calm sunny day and basins by a tenth of that.
        shelf = np.clip((cont - 0.33) / 0.15, 0, 1)
        near = blur(self.land, 3)        # the sea right off a coast is the warmest
        self.sst_ref = blur(21.8 + 4.2 * shelf + 1.0 * np.clip(near * 3, 0, 1), 2, 2)
        mixed = 40 - 32 * shelf
        self.heat_cap = (sea * 4.1e6 * mixed + self.land * 1.5e5).astype(np.float32)   # J/m2/K

        # Where the soil starts out wet or dry, after which rain and evaporation keep it (it
        # holds enough water to remember a few weeks): wet near the sea, dry deep inside the big
        # continents, and drier still downwind of mountains, in their rain shadow. The wind
        # here mostly drifts antispinward, so downwind is the lower-phi side.
        coastal = blur(sea, 10)
        shadow = np.zeros_like(zs)
        for k in range(1, 25):
            shadow = np.maximum(shadow, np.roll(self.zs, -k, axis=1) * (1 - k / 30) - self.zs)
        self.soil_prior = np.clip((2.4 * coastal - 0.06) * (1 - 0.7 * np.clip(blur(shadow, 2, 1) / 1200, 0, 1)),
                                  0.03, 1).astype(np.float32)
        friction = FRICTION_SEA + (FRICTION_LAND - FRICTION_SEA) * self.land
        self.friction = (friction + FRICTION_HIGH * np.clip(self.zs / 2000, 0, 1.5)).astype(np.float32)
        self.th_ref = (TH_FT + TH_FT_PER_M * self.zs).astype(np.float32)
        self.p_sfc = (1013.0 * np.exp(-self.zs / 8000)).astype(np.float32)
        self.landish = (0.3 + 0.7 * np.clip(blur(self.land, 2) * 2, 0, 1)).astype(np.float32)

        # Rims: the walls stop flow across the band at the outermost rows, and slow it in the
        # next ones in.
        rim = np.ones(NY, np.float32)
        rim[0] = rim[-1] = 0.0
        rim[1] = rim[-2] = 0.5
        self.rim = rim[:, None]
        self.Ii = np.broadcast_to(np.arange(NX, dtype=np.int32), (NY, NX))
        self.J = np.broadcast_to(np.arange(NY, dtype=np.float32)[:, None], (NY, NX))

    # ------------------------------------------------------------ state
    def init_state(self, t):
        """A plausible quiet start at time t: still warm air, seas at their usual temperatures,
        no cloud. The spin-up makes weather out of it."""
        f = lambda v: np.full((NY, NX), v, np.float32)
        self.t = float(t)
        self.ts = np.where(self.land > 0.5, 24.0, self.sst_ref).astype(np.float32)
        self.th = (0.5 * (self.ts + self.th_ref)).astype(np.float32)
        self.q = (0.75 * qsat(self.th - GAMMA * self.zs, self.p_sfc)).astype(np.float32)
        self.ql, self.qi, self.conv, self.fog, self.xi = f(0), f(0), f(0), f(0), f(0)
        self.rhi = f(RHI_MEAN)
        self.u, self.v = f(U_DRIFT), f(0)
        self.soil = self.soil_prior.copy()
        self.hbl = f(700)
        self.rain, self.storm, self.nudge, self.cover, self.w = f(0), f(0), f(0), f(0), f(0)

    def state(self):
        """The prognostic fields as a dict, for saving."""
        return {k: getattr(self, k) for k in FIELDS}

    def load_state(self, d, t):
        for k in FIELDS:
            a = np.asarray(d[k], np.float32)
            if a.shape != (NY, NX):
                raise ValueError(f"{k} has shape {a.shape}")
            setattr(self, k, a.copy())
        self.t = float(t)

    # ------------------------------------------------------------ workspace 1 and the real sky
    def set_observed(self, targets, phi_deg):
        """Pulls the weather around workspace 1's place (phi_deg along the ring, the band's
        middle across) toward the real sky outside. targets is a dict of any of: low, high
        (cover 0..1), rain (mm/h), wind (m/s), fog (0..1), conv (0..1), storm (0..1); None lets
        that place go free again, which it does gradually. Inside 300 km the pull is full, and
        it fades as a Gaussian to about 2% at 1000 km, so the real weather blends into the
        Orbital's own with no seam."""
        self.observed = targets or None
        if targets:
            dphi = np.mod(PHI - phi_deg + 180.0, 360.0) - 180.0
            d = np.hypot((dphi * KM_PER_DEG)[None, :], Z_KM[:, None])
            self.obs_weight = np.exp(-np.maximum(0, d - 300.0) ** 2 / (2 * 250.0 ** 2)).astype(np.float32)

    # ------------------------------------------------------------ one step
    def step(self, dt):
        """Advance the weather by dt seconds (one minute in real time, five during spin-up)."""
        dt = float(dt)
        sun = sunlight(self.clock(self.t + 0.5 * dt))[None, :]
        self._advect(dt)
        self._noise(dt)
        cl_low, cl_high = self.cover, 1 - np.exp(-self.qi / QI_REF)
        ta = self.th - GAMMA * self.zs               # the slab's temperature at the ground
        speed = np.hypot(self.u, self.v)
        self._surface(dt, sun, ta, speed, cl_low, cl_high)
        ta = self.th - GAMMA * self.zs
        rh_sfc = self.q / qsat(ta, self.p_sfc)
        precip = self._convection(dt, ta)
        precip = self._clouds(dt, ta, rh_sfc, precip)
        self._upper(dt)
        self._fog(dt, ta, speed)
        self._winds(dt)
        self._nudge(dt)
        self.t += dt

    def _advect(self, dt):
        # Everything in the slab moves with the slab's wind. The departure point of each cell is
        # traced back one step and the field read there with bilinear interpolation: periodic
        # along the ring, and across the band never past the outermost rows, since nothing
        # comes in through the walls.
        dep = self._departure(self.u * (dt / DX), self.v * (dt / DX))
        for k in ADVECTED:
            setattr(self, k, _interp(getattr(self, k), dep))
        del dep
        # High ice rides the wind aloft: the same slow drift as below but faster, plus the
        # outflow of the low-level circulation turned the other way, since what converges near
        # the floor rises and spreads out at the top. Anvils fan out from storms and stream off
        # downwind as cirrus.
        # It moves a km or two a minute, so it is moved every three minutes, all at once.
        self._up_dt += dt
        if self._up_dt >= SLOW_EVERY:
            h, self._up_dt = self._up_dt, 0.0
            uu = U_UP - K_OUTFLOW * (self.u - U_DRIFT)
            vu = -K_OUTFLOW * self.v * self.rim
            dep = self._departure(uu * (h / DX), vu * (h / DX))
            self.qi = _interp(self.qi, dep)
            self.rhi = _interp(self.rhi, dep)

    def _departure(self, cx, cy):
        # The fraction of a cell comes from the Courant number alone, never from the column's
        # index: in float32, 3000 - 0.1 keeps only a few digits of the 0.1, and the same air
        # would move a little differently depending on where the grid's ends happen to fall.
        s = -cx
        fs = np.floor(s)
        fx = s - fs
        i0 = np.mod(self.Ii + fs.astype(np.int32), NX)
        yd = np.clip(self.J - cy, 0, NY - 1)
        i1 = i0 + 1
        i1[i1 == NX] = 0
        y0 = np.minimum(np.floor(yd), NY - 2)
        fy = yd - y0
        j0 = y0.astype(np.int32) * NX
        a, b = j0 + i0, j0 + i1
        return a, b, a + NX, b + NX, fx, fy

    def _noise(self, dt):
        # The model's only randomness: a smooth, slowly changing field that rides with the wind
        # and stands for the mesoscale stirring the grid can't resolve. Its blobs are about
        # 75 km across and three times that along the ring, the way rolls in the slab line up
        # with the prevailing drift, so the cumulus it gathers into patches come out as cloud
        # streets with clear lanes between, which the wind then carries and bends. It also nudges
        # where convection breaks out first and stirs the slab's temperature by a few
        # hundredths of a degree, enough to break the symmetry of a perfectly even sea.
        # It changes over two hours, so it is renewed every three minutes.
        if not self.noise:
            return
        self._noise_dt += dt
        if self._noise_dt < SLOW_EVERY:
            return
        h, self._noise_dt = self._noise_dt, 0.0
        a = np.float32(np.exp(-h / 7200.0))
        n = _streaks(self.rng.random((NY, NX), dtype=np.float32) - 0.5)
        self.xi = a * self.xi + np.float32(np.sqrt(1 - a * a)) * n
        self.th += self.xi * np.float32(0.02 * h / 3600)

    def _surface(self, dt, sun, ta, speed, cl_low, cl_high):
        # Sunlight through the clouds: low cloud reflects most, more the deeper it is, high
        # cloud a little, fog a lot.
        deep = 0.55 + 0.4 * self.conv
        trans = (1 - 0.72 * cl_low * deep) * (1 - 0.2 * cl_high) * (1 - 0.45 * self.fog)
        albedo = self.land * (0.32 - 0.17 * self.soil) + (1 - self.land) * 0.07
        sw = (S_PEAK * sun) * trans * (1 - albedo)
        del deep, trans, albedo
        # Longwave: the ground glows at sigma T^4 and the air glows back, more when it is humid
        # and almost as much as the ground under low cloud, which is why cloudy nights stay warm
        # and clear dry ones (deserts) get cold.
        tks = self.ts + 273.15
        tka = ta + 273.15
        lw_up = SIGMA * (tks * tks) ** 2
        eps = np.clip(0.68 + 0.013 * self.q, 0.6, 0.92)
        cloud = np.clip(cl_low + 0.8 * self.fog, 0, 1)
        eps = eps + (1 - eps) * (0.95 * cloud + 0.35 * cl_high * (1 - cloud))
        lw_net = lw_up - eps * SIGMA * (tka * tka) ** 2
        del tka, lw_up, eps, cloud
        # Turbulent exchange: wind plus the gusts of thermals when the ground is warmer than the
        # air (and a couple of m/s of the gusts any real sky has, which keep calm seas
        # evaporating); under a night-time inversion turbulence dies down and the ground cools
        # alone.
        d = self.ts - ta
        gust = 2.5 + np.clip(0.6 * d, 0, 5)
        exch = (1.3e-3 + 2.4e-3 * self.land) * (speed + gust) / (1 + 0.35 * np.maximum(0, -d))   # land is rougher
        sens = (RHO * CP) * exch * d
        qs = qsat(self.ts, self.p_sfc)
        # Water: the sea evaporates freely; on land the plants and soil hold it back, a little
        # when the ground is wet and a great deal when it is dry (a surface resistance in series
        # with the air's), which is what lets dry interiors bake while wet coasts stay mild.
        r_soil = self.land * (50.0 / np.clip(self.soil / 0.5, 0.04, 1))
        beta = 1 / (1 + exch * r_soil)
        evap = (RHO / 1000) * exch * beta * (qs - self.q)                 # kg/m2/s
        evap = np.where(evap > 0, evap, 0.4 * evap)                       # dew forms more slowly
        # The ocean below the mixed layer, and its currents, hold the sea near its usual
        # temperature over a few weeks.
        restore = (1 - self.land) * 12.0                                  # W/m2/K
        flux = sw - lw_net - sens - LV * evap + restore * (self.sst_ref - self.ts)
        del sw, lw_net
        # The skin's temperature, implicitly, so steps of several minutes stay stable: lam is
        # how much the losses grow per degree warmer.
        lam = 4 * SIGMA * tks ** 3 + (RHO * CP) * exch + (LV * RHO / 1000) * exch * beta * 0.065 * qs + restore
        self.ts += dt * flux / (self.heat_cap + dt * lam)
        del flux, lam, tks, qs, r_soil, beta, restore, gust, exch
        # The slab takes the heat and water, loses heat to space, and mixes with the free
        # troposphere above: dry air from over its capping inversion, a few degrees warmer, is
        # entrained through its top at a few mm/s, a little faster where the air above is
        # sinking onto it (w < 0). Mostly, though, sinking air presses the slab's top down,
        # which is what clears skies under subsidence (see _clouds). Its temperature also
        # drifts toward the free troposphere's. Over land at night the air near the ground is
        # cut off from the air above by the inversion, and entrainment nearly stops until the
        # morning's thermals start it again, so dew can gather into dawn fog; and a shallow
        # night layer still has the day's residual layer above it, so the mixing never acts on
        # less than 600 m.
        stir = 1 - self.land * (1 - np.clip(0.2 + 0.4 * (self.ts - ta), 0.2, 1))
        top = (W_ENTRAIN * stir + 0.3 * np.maximum(0, -self.w)) / np.maximum(self.hbl, 600)
        # A deck of low cloud cools the slab from its top all night (it radiates to space like
        # a black body) and soaks up a little sunlight by day, so stratus thickens toward dawn and
        # thins through the afternoon.
        deck = cl_low * (1 - self.conv) * ((0.07 * S_PEAK) * sun - 45.0)
        self.th += dt * ((sens + deck) / C_AIR - RAD_COOL + (self.th_ref - self.th) * (1 / TAU_FT)
                         + (self.th_ref + INVERSION - self.th) * top)
        self.q += dt * (evap * (1000 / M_SLAB) + (Q_FT - self.q) * top)
        np.maximum(self.q, 0.1, out=self.q)
        # The soil keeps the rain that falls on it and gives it back by evaporation, and over a
        # month or so drifts back toward its usual wetness, for the groundwater and rivers the
        # model doesn't have; that keeps a service that runs for weeks from slowly drying out.
        self.soil += self.land * ((dt / W_CAP) * (self.rain / 3600 - evap)
                                  + (dt / (30 * 86400)) * (self.soil_prior - self.soil))
        np.clip(self.soil, 0, 1, out=self.soil)
        # The mixed layer: thermals push it up to 2-3 km over hot land by mid-afternoon, and at
        # night it collapses to a shallow stable layer. Over the sea it stays near 600-800 m,
        # shallower where warm air has come out over cold water.
        on_land = np.clip(np.where(d > 0, 500 + 220 * d, 500 + 250 * d), 120, 3000)
        on_sea = np.clip(650 + 100 * d, 500, 1300)
        target = self.land * on_land + (1 - self.land) * on_sea
        self.hbl += (target - self.hbl) * np.float32(1 - np.exp(-dt / 3600))

    def _convection(self, dt, ta):
        # Deep convection. It can fire where the slab's moist static energy (as theta + LC qt)
        # beats what the free troposphere above can hold by more than a little, since the
        # inversion's inhibition has to be overcome first: by thermals off hot ground, by broad
        # uplift (convergence lifts parcels toward their level of free convection) or by a lucky
        # gust. Once a cell is going it runs at full strength until the instability is spent,
        # and spreads to its neighbours while they have any to spend, the way squall lines
        # travel. Its updrafts carry the slab's air up at up to a quarter of a kg/m2/s per m2,
        # raining out most of the water they carry (drawing on the whole moist column, which
        # holds far more than the slab), and its rain-cooled downdrafts bring dry air down
        # several degrees cooler than the slab: the cold pools that spread from storms, end them
        # within an hour or two, and set off new cells along their edges.
        #
        # Convection also comes easier where it has already been: its towers leave the air aloft
        # moist (the anvils and cirrus mark it), so new updrafts there aren't choked by dry air
        # mixing in, while long-dry places stay quiet. That is how showers gather into clusters
        # that live for hours instead of popping up evenly everywhere.
        the = self.th + LC * (self.q + self.ql)
        inst = (the - (THE_CRIT + THE_CRIT_PER_M * self.zs) + K_LIFT * self.w + XI_AMP * self.xi
                + (K_HEAT * self.land) * np.maximum(self.ts - ta, 0) + K_MOIST * (1 - np.exp(-self.qi / QI_REF)))
        going = self.conv > 0.2
        firing = (inst > CIN) | (going & (inst > -0.3))
        act = np.where(firing, np.clip(0.5 + inst * (1 / 3.0), 0, 1), 0).astype(np.float32)
        act = np.minimum(smooth3(smooth3(act)) * 2.0, 1)
        tau = np.where(act > self.conv, 900.0, 2700.0).astype(np.float32)
        self.conv += (act - self.conv) * (1 - np.exp(-dt / tau))
        grown = np.maximum(self.conv - 0.25, 0) * (1 / 0.75)    # a few towers don't rain much
        flux = (MASS_FLUX * grown) * (1 + np.clip(inst, 0, 6) * (1 / 3.0))     # kg/m2/s
        k = flux * np.float32(dt / M_SLAB)
        precip = (PRECIP_EFF / 1000) * flux * self.q                           # kg/m2/s = mm/s
        # A storm's updrafts are fed by inflow from a hundred km around, so the water they take
        # comes out of that whole neighbourhood, which is how one storm keeps others from
        # growing too close to it; the chill of its downdrafts lands under it.
        self.q -= box5(k * np.maximum(self.q - Q_FT, 0))
        self.th -= smooth3(k) * DOWNDRAFT_CHILL
        # Anvil ice spreads out from strong cells along the tropopause, a hundred km and more
        # before the wind aloft carries it off as cirrus, and the outflow leaves the air up
        # there moist; broad uplift also leaves thin cirrus.
        outflow = box5(dt * precip)
        self.qi += K_ANVIL * outflow + box5(dt * 2e-6 * np.maximum(self.w - 0.01, 0))
        self.rhi += K_DETRAIN * outflow
        # Thunder: only the strongest, wettest towers, and mostly over land and near it. Out at
        # sea the updrafts are gentler and the same rain comes with a tenth of the lightning.
        storm = np.clip((precip * 3600 - 4.0) / 5.0, 0, 1) * np.clip(1.6 * self.conv - 0.6, 0, 1) * self.landish
        self.storm += (storm - self.storm) * np.float32(1 - np.exp(-dt / 600))
        return precip

    def _upper(self, dt):
        # The air at cruising height, ~10 km, carries a humidity of its own, relative to ice
        # (rhi). It drifts toward a slowly changing large-scale pattern of moist and dry air,
        # some hundreds of km across, which leaves a share of the sky aloft supersaturated
        # over ice (rhi > 1), as it is on Earth: there contrails persist and spread, cirrus
        # lives longest, and past RHI_CIRRUS the air makes thin cirrus of its own. Storms'
        # outflow moistens it (in _convection) and broad uplift a little. Ice in drier air
        # sublimates within an hour or two.
        bg = RHI_MEAN + RHI_SPREAD * self._drift(dt) if self.noise else RHI_MEAN
        self.rhi += (bg - self.rhi) * np.float32(1 - np.exp(-dt / TAU_UT)) + (dt * K_UPLIFT) * self.w
        np.clip(self.rhi, 0.05, 1.6, out=self.rhi)
        self.qi += (dt * K_CIRRUS) * np.maximum(self.rhi - RHI_CIRRUS, 0)
        self.qi *= np.exp(-dt / (TAU_ICE * np.clip(self.rhi, 0.35, 1.3)))

    def _drift(self, dt):
        """The large-scale pattern aloft, unit spread: smoothed noise on a grid eight times
        coarser, evolving over half a day, read back at full size by bilinear interpolation
        (periodic along the ring). It changes so slowly that it is read back only every ten
        minutes."""
        if self._coarse is None:
            self._coarse, self._since = _coarse_noise(self.rng), 1e9
        self._since += dt
        if self._since >= 600 or self._pattern is None:
            a = np.exp(-self._since / TAU_UT_DRIFT) if self._since < 1e8 else 0.0
            self._coarse = a * self._coarse + np.sqrt(1 - a * a) * _coarse_noise(self.rng)
            c = self._coarse
            rows = c[:, _CX0] * (1 - _CWX) + c[:, _CX1] * _CWX
            self._pattern = (rows[_CY0] * (1 - _CWY)[:, None] + rows[_CY1] * _CWY[:, None]).astype(np.float32)
            self._since = 0.0
        return self._pattern

    def add_ice(self, cells, amounts):
        """Contrail ice (from traffic.py): amounts in g/kg at flat cell indices, spread as the
        cirrus of many old contrails is, into a faint haze some 200 km wide along the busy
        corridors rather than lines the 25 km grid couldn't hold."""
        if len(cells):
            d = np.zeros(NY * NX, np.float32)
            np.add.at(d, cells, amounts)
            self.qi += box5(box5(d.reshape(NY, NX)))

    def storm_field(self):
        """Thunderstorm intensity as the wallpaper gets it, with the real sky laid over
        workspace 1's place."""
        s = np.clip(self.storm, 0, 1)
        if self.observed and "storm" in self.observed:
            s = s + self.nudge * (np.float32(self.observed["storm"]) - s)
        return s

    def _clouds(self, dt, ta, rh_sfc, precip_conv):
        # Low cloud. The slab is well mixed, so its air reaches the top of the mixed layer, and
        # broad uplift pushes that level higher still while sinking air pushes it down. Air
        # there is GAMMA * height colder (th is a potential temperature at floor level, so air
        # carried up a mountain cools by itself and rains, and comes down the far side dry: the
        # rain shadow). How much of the sky that saturation fills depends on the inversion
        # over the slab. The free troposphere's temperature is the same everywhere, so the
        # inversion is strong over cold ground and cold water and weak over warm: over the cool
        # deep basins, and over land at night, a capped, even layer saturates all at once into a
        # stratus sheet with a sharp edge; over warm shelves and sunlit land only the strongest
        # thermals reach their condensation level, as cumulus, which cover a fraction of the
        # sky that grows with the air's humidity and never much passes half. Both use a uniform
        # spread of the water within a 25 km cell, narrow for stratus, wide for cumulus.
        lift = np.clip(TAU_LIFT * self.w, -0.5 * self.hbl, 1500)
        qt = self.q + self.ql
        d = self.ts - ta
        sea = 1 - self.land
        sheet = np.maximum(np.clip(0.3 - d, 0, 1), sea * np.clip((SST_SHEET - self.ts) * 0.5, 0, 1))
        if self.observed and "low" in self.observed:
            sheet = np.maximum(sheet, self.nudge * min(max(2 * self.observed["low"] - 1, 0.0), 1.0))
        # The condensation level above the ground, 125 m per degree of dewpoint depression.
        e = self.q * self.p_sfc / (622.0 + 0.378 * self.q)
        lnr = np.log(np.maximum(e, 0.05) * (1 / 6.112))
        lcl = np.maximum(125.0 * (ta - 243.5 * lnr / (17.67 - lnr)), 0)
        self._lcl = lcl
        # Over the sea a capped layer is stirred from its top as well as its bottom, and
        # entrainment deepens it until it reaches its condensation level, though no further than
        # the inversion lets it, about 1.2 km: so cold water wears a deck of stratocumulus unless
        # the air is very dry. Over land a stable night layer is only as deep as it is.
        top = np.where(sea > 0.5, np.clip(np.maximum(self.hbl, lcl + 150), 0, 1200), self.hbl)
        del sea, e, lnr                    # (the grid is big: temporaries go as soon as they're used)
        z0 = self.zs + top + np.minimum(lift, 0)
        del top
        qs0 = qsat(self.th - GAMMA * z0, 1013.0 * np.exp(-z0 / 8000))
        frac, excess = _spread(qt, qs0, SIG_STRAT)
        # A mixed layer topped by cumulus stops growing about where its thermals condense:
        # past that the cumulus carry the heat up instead. So cumulus see the air at most a few
        # hundred metres above the condensation level, more where convergence lifts the layer
        # (cloud lines along sea-breeze fronts and outflows) and less where air sinks onto it.
        zcu = self.zs + np.minimum(self.hbl, lcl + 400.0) + lift
        qscu = qsat(self.th - GAMMA * zcu, 1013.0 * np.exp(-zcu / 8000))
        if self.observed:
            self._qs0, self._qscu = qs0, qscu        # for _nudge
        frac_cu, excess_cu = _spread(qt, qscu, SIG_CU)
        # The mesoscale stirring gathers cumulus into patches and streets.
        frac_cu = np.clip(frac_cu * (1 + CU_PATCH * self.xi), 0, 1)
        frac = sheet * frac + (CU_MAX * (1 - sheet)) * frac_cu
        # The excess at the top is what the cloud holds where it is thickest; averaged over the
        # slab's depth, and with condensation warming the rising air, the mean is a fifth for a
        # sheet. Cumulus hold far less across a whole cell, and the ones deep enough to rain
        # are the convection's business.
        excess = (sheet * excess + (CU_MAX * CU_SHARE) * (1 - sheet) * excess_cu) * CLOUD_SHARE
        del frac_cu, excess_cu
        # Forced ascent is different: air pushed up a strong convergence line (a sea-breeze
        # front, a gust front), or blown up a mountainside, rises as a whole, not in thermals,
        # so whatever it condenses beyond the cloud it already had fills the cell as a raining
        # sheet (nimbostratus). Upslope wind lifts the cloud's top by the height it would climb
        # in a couple of hours, so moist air rains on the windward slopes and comes down the far
        # side dried out, into the rain shadow. The gentle convergence of every sunny afternoon
        # over land only feeds cumulus and convection, and is left out.
        zb = sheet * z0 + (1 - sheet) * zcu
        qsb = sheet * qs0 + (1 - sheet) * qscu
        del z0, zcu, qs0, qscu, lift
        upslope = np.maximum(self.u * self.dzdx + self.v * self.dzdy, 0)
        zf = zb + TAU_LIFT * np.maximum(self.w - W_FORCED, 0) + np.minimum(TAU_OROG * upslope, 2500)
        del zb, upslope
        qsf = qsat(self.th - GAMMA * zf, 1013.0 * np.exp(-zf / 8000))
        del zf
        forced = np.maximum(np.maximum(qt - qsf, 0) - np.maximum(qt - qsb, 0), 0)
        del qsf, qsb, qt
        frac = np.maximum(frac, np.minimum(forced * (1 / 0.6), 1))
        ql_eq = excess + FORCED_SHARE * forced
        del excess, forced
        dql = (ql_eq - self.ql) * np.float32(1 - np.exp(-dt / TAU_COND))
        del ql_eq
        dql = np.maximum(dql, -self.ql)
        self.ql += dql
        self.q -= dql
        # Drizzle and rain from cloud water past a threshold (autoconversion). th is the
        # liquid-water potential temperature, which condensing and evaporating cloud leave as
        # it is, and rain that falls out takes the heat of its condensation with it: that heat
        # is released up in the cloud and, with no Coriolis force to hold a warm patch in place,
        # the free troposphere spreads it round the ring at once (the weak temperature gradient
        # of the tropics, total here). Left in the slab, it would lower the pressure under every
        # raining cloud, pull in air, make more cloud and more rain, and the sky would curdle
        # into a honeycomb of cells.
        auto = np.maximum(self.ql - QL_CRIT, 0) * np.float32(1 - np.exp(-dt / TAU_AUTO))
        self.ql -= auto
        strat = auto * (M_SLAB / 1000 / dt)
        # Some rain evaporates on its way down through dry air, which cools and moistens the
        # slab under it: the cold pools under showers.
        total = strat + precip_conv
        evap = np.clip(1 - rh_sfc, 0, 1) * (0.25 * strat + 0.3 * precip_conv)
        self.q += evap * (dt * 1000 / M_SLAB)
        self.th -= (LC * 1000 / M_SLAB * dt) * evap
        rain = (total - evap) * 3600                                     # mm/h at the floor
        self.rain += (rain - self.rain) * np.float32(1 - np.exp(-dt / 600))
        # What the sky shows: the sheet or cumulus, plus convective towers.
        self.cover = 1 - (1 - frac) * (1 - 0.75 * self.conv)
        self._cu = (1 - sheet) * np.clip(d * 0.5, 0, 1)
        return total

    def _fog(self, dt, ta, speed):
        # Fog: the air right at the floor is colder than the slab's mean under a night-time
        # inversion, nearly as cold as the ground; where it saturates and the wind is light, it
        # fogs. Over cool deep basins warm moist air coming off land or warm shelves does the
        # same by day (sea fog). The sun burns it off once the ground warms past the air.
        near = ta - 0.7 * np.maximum(ta - self.ts, 0)
        rh = self.q / qsat(near, self.p_sfc)
        calm = np.clip((8 - speed) * 0.2, 0, 1)
        stable = np.clip((ta + 0.5 - self.ts) * 2, 0, 1)
        target = np.clip((rh - 0.93) * 16, 0, 1) * calm * stable
        # And over cold water, where the stratus deck's base comes down to the sea.
        target = np.maximum(target, (1 - self.land) * np.clip((SST_SHEET - self.ts) * 0.5, 0, 1)
                            * np.clip((150 - self._lcl) * (1 / 120), 0, 1) * calm)
        tau = np.where(target > self.fog, 2400.0, 1500.0).astype(np.float32)
        self.fog += (target - self.fog) * (1 - np.exp(-dt / tau))

    def _winds(self, dt):
        # Pressure from temperature: warm (and moist, and cloud-free) air is light, so its
        # pressure at the floor is low, and air runs toward it. Measured against the free
        # troposphere's reference at the ground's height, so mountains themselves pull no wind,
        # only their heating by day and cooling by night (valley and mountain breezes). Smoothed
        # over about 50 km, since pressure is an integral over the air above and the slab's
        # smallest wrinkles of temperature don't reach the floor as pressure.
        #
        # There is no Coriolis term, as explained at the top of this file, and so nothing in the
        # model can spin up a vortex: the wind is the push of the pressure field, carried along
        # by itself, against friction. What it adds instead is a slow antispinward drift. The
        # heating that drives the air sweeps spinward round the ring every day, and a heat
        # source moving over a fluid drags the fluid the other way (the "moving flame" effect of
        # Schubert and Whitehead's mercury, and of Venus's super-rotation); the model doesn't
        # resolve that, so it is put in by hand as friction relaxing toward U_DRIFT instead of
        # toward rest. It is why cloud streets and cirrus trails here mostly run along the ring.
        thv = self.th + 0.18 * self.q - 0.3 * self.ql - self.th_ref
        p = box5(box5(thv)) * np.float32(-ALPHA)
        r = self.friction * dt
        self.u = (self.u - dt * ddx(p) + r * U_DRIFT) / (1 + r)
        self.v = (self.v - dt * ddy(p)) / (1 + r)
        # A little diffusion of momentum, the eddies' mixing, which mostly damps the grid's own
        # two-cell wiggles (a 1-2-1 filter removes those entirely): about 5% a minute. Then the
        # walls: no wind across the band at the rims, and half of it a row in.
        k = np.float32(min(0.5, 0.05 * dt / 60))
        self.u += k * (smooth3(self.u) - self.u)
        self.v += k * (smooth3(self.v) - self.v)
        self.v *= self.rim
        speed = np.hypot(self.u, self.v)
        over = speed > V_MAX
        if over.any():
            k = np.where(over, V_MAX / np.maximum(speed, 1e-6), 1.0).astype(np.float32)
            self.u *= k
            self.v *= k
        # Where the slab's air converges it has to go up; w is that uplift at the slab's top
        # (m/s), smoothed so a single cell's convergence doesn't make a single cell's storm.
        div = ddx(self.u) + ddy(self.v, odd=True)
        self.w = np.clip(-smooth3(div) * self.hbl, -0.3, 0.3)

    def _nudge(self, dt):
        # Workspace 1 follows the real sky. nudge is how strongly each cell is held to the
        # observation; it grows toward the Gaussian weight over twenty minutes while an
        # observation is fresh and lets go just as gradually when it goes stale. The state
        # itself is pulled with it (water toward the amount that makes the observed low cover,
        # ice toward the observed high cover, wind speed, fog and convection), so the model's own
        # physics agrees with the sky it is shown and the free weather around blends in;
        # diagnostics() then lays the observation over the outputs with the same weight.
        # Where the hold fades out, the mesoscale stirring frays its edge, so the real sky ends
        # the way weather does and not as a circle.
        o = self.observed
        w = self.obs_weight
        target = np.clip(w * (1 + 1.2 * self.xi * (1 - w)), 0, 1) if o else 0.0
        self.nudge += (target - self.nudge) * np.float32(1 - np.exp(-dt / 1200))
        if not o:
            return
        k = self.nudge * np.float32(1 - np.exp(-dt / 900))
        if "low" in o:
            # The water content whose subgrid spread gives exactly the observed cloudy share: as
            # a sheet when the real sky is mostly covered (_clouds also takes the sheet's form
            # there), as cumulus when it is broken.
            c = min(max(o["low"], 0.0), 1.0)
            edge = 0.03 if c > 0.98 else (-0.05 if c < 0.02 else 0.0)
            sheet = min(max(2 * c - 1, 0.0), 1.0)
            as_sheet = (1 - SIG_STRAT + 2 * SIG_STRAT * c + edge) * self._qs0
            as_cu = (1 - SIG_CU + 2 * SIG_CU * min(c / CU_MAX, 1.0) + edge) * self._qscu
            want = sheet * as_sheet + (1 - sheet) * as_cu
            self.q += k * (want - self.q - self.ql)
        if o.get("rain", 0) > 0.05:
            # Enough cloud water to rain at the observed rate by itself.
            want = QL_CRIT + o["rain"] * (TAU_AUTO / 3600 * 1000 / M_SLAB)
            self.ql += k * np.maximum(want - self.ql, 0)
        if "high" in o:
            want = -QI_REF * np.log(1 - min(max(o["high"], 0.0), 0.97))
            self.qi += k * (want - self.qi)
        for name in ("conv", "fog", "storm"):
            if name in o:
                f = getattr(self, name)
                f += k * (o[name] - f)
        if "wind" in o:
            speed = np.hypot(self.u, self.v)
            scale = 1 + k * (o["wind"] / np.maximum(speed, 0.5) - 1)
            self.u *= scale
            self.v *= scale

    # ------------------------------------------------------------ what the wallpaper draws
    def diagnostics(self):
        """The maps for the wallpaper, each (104, 3016) float32: low and high cloud cover, the
        clouds' convective character (0 a flat sheet, 1 a towering cumulonimbus), rain in mm/h,
        the wind (u along the ring, v across, m/s), fog and thunderstorm intensity, all 0..1
        where not stated, with the real sky laid over workspace 1's place."""
        cu = getattr(self, "_cu", np.zeros((NY, NX), np.float32))
        out = {
            "low": np.clip(self.cover, 0, 1),
            "high": 1 - np.exp(-self.qi / QI_REF),
            # Shallow cumulus over warm ground counts as a third of the way to a tower.
            "conv": np.clip(self.conv + (1 - self.conv) * 0.35 * cu, 0, 1),
            "rain": np.maximum(self.rain, 0),
            "u": self.u.copy(), "v": self.v.copy(),
            "fog": np.clip(self.fog, 0, 1),
            "storm": self.storm_field(),
        }
        o = self.observed
        if o:
            n = self.nudge
            for name in ("low", "high", "conv", "rain", "fog"):
                if name in o:
                    out[name] = out[name] + n * (np.float32(o[name]) - out[name])
            if "wind" in o:
                speed = np.hypot(out["u"], out["v"])
                scale = 1 + n * (o["wind"] / np.maximum(speed, 0.5) - 1)
                out["u"] *= scale
                out["v"] *= scale
        return out


# The coarse grid of the pattern aloft, and where each fine column and row reads it from.
_CNX, _CNY = NX // 8, NY // 8
_cx = (np.arange(NX) + 0.5) / 8 - 0.5
_CX0 = np.floor(_cx).astype(int) % _CNX
_CX1 = (_CX0 + 1) % _CNX
_CWX = (_cx - np.floor(_cx)).astype(np.float32)
_cy = np.clip((np.arange(NY) + 0.5) / 8 - 0.5, 0, _CNY - 1)
_CY0 = np.minimum(np.floor(_cy).astype(int), _CNY - 2)
_CY1 = _CY0 + 1
_CWY = (_cy - _CY0).astype(np.float32)


def _coarse_noise(rng):
    """White noise on the coarse grid, 1-2-1 smoothed each way (periodic along the ring) and
    scaled back to unit spread."""
    n = rng.standard_normal((_CNY, _CNX))
    n = (np.roll(n, 1, 1) + 2 * n + np.roll(n, -1, 1)) / 4
    n[1:-1] = (n[:-2] + 2 * n[1:-1] + n[2:]) / 4
    return n / 0.42


def _streaks(a):
    """White noise smoothed over 9 cells along the ring by 3 across (and a 1-2-1 pass), scaled
    back to unit spread."""
    p = np.concatenate([a[:, -4:], a, a[:, :4]], axis=1)
    b = p[:, :-8] + p[:, 1:-7] + p[:, 2:-6] + p[:, 3:-5] + p[:, 4:-4] + p[:, 5:-3] + p[:, 6:-2] + p[:, 7:-1] + p[:, 8:]
    c = np.empty_like(b)
    c[1:-1] = b[:-2] + b[1:-1] + b[2:]
    c[0] = 2 * b[0] + b[1]
    c[-1] = 2 * b[-1] + b[-2]
    c = smooth3(c)
    c *= np.float32(STREAK_NORM)
    return c


def _spread(qt, qs, sig):
    """Water spread evenly over qt +- sig qs within a cell: the cloudy share of the cell, and
    the mean excess over saturation (g/kg) across the whole cell."""
    half = sig * qs
    x = qt + half - qs
    frac = np.clip(x / (2 * half), 0, 1)
    excess = np.where(frac >= 1, qt - qs, np.maximum(x, 0) ** 2 / (4 * half))
    return frac, excess


def _interp(f, dep):
    """Bilinear interpolation of f at the departure points, worked in place to keep memory low."""
    a, b, c, d, fx, fy = dep
    flat = f.ravel()
    top, right = flat.take(a), flat.take(b)
    right -= top
    right *= fx
    top += right
    bot, right = flat.take(c), flat.take(d)
    right -= bot
    right *= fx
    bot += right
    bot -= top
    bot *= fy
    bot += top
    return bot


def clock_hour(t):
    """The local clock hour at unix time t, in the machine's own time zone, as the wallpaper
    reads it."""
    import time
    lt = time.localtime(t)
    return ((t + lt.tm_gmtoff) % 86400) / 3600.0

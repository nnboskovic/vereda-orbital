.pragma library
// Camera, sun and look for the Orbital background, shared by the live
// wallpaper and the still renderer so both frame the same shot.

var R = 12000;

// The look. Angles in degrees, distances in km, z as a fraction of the band width.
var defaults = {
  phi: 0,          // where on the ring the camera hangs
  alt: 1600,       // height above the floor
  z: 0.35,         // across the band, as a fraction of its width
  yaw: 15,         // away from spinward, about the local up
  pitch: -22,      // up toward the hub (+) or down at the floor (-)
  roll: -50,
  fov: 84,         // vertical
  dayCycle: true,  // the sun follows the local clock; sunEl/sunAz are used when false
  hour: -1,        // a fixed local hour for stills; -1 follows the clock
  noon: 12,        // local hour with the sun overhead
  sunTilt: 12.7,   // the sun's daily path out of the ring plane, so the far side never eclipses it
  sunEl: 50,       // fixed sun: elevation over the band where the camera hangs
  sunAz: 160,      // fixed sun: bearing from spinward, turning toward +z
  exposure: 0.95,
  nightExposure: 1.8, // the camera opens up after dark
  lights: 1.0,     // towns, ashore and afloat, at night
  ringshine: 0.4,  // night light from the sunlit far side of the ring
  clouds: 0.55,    // cloud threshold: lower is cloudier
  cloudEdge: 0.08, // softness of cloud edges
  streak: 1.5,     // cloud stretch along the band
  land: 0.9,       // land threshold: higher is more sea
  rayleigh: 2.6,
  sea: [0.0, 0.16, 0.36],
  deep: [0.0, 0.03, 0.12],
  sunColor: [1.0, 0.98, 0.96],
  cloudColor: [0.86, 0.92, 0.98],
  width: 2600,     // band width, km (the painting cheats it wide)
  weather: true,   // real local weather changes the clouds, haze and wind (see weatherLook)
  ship: "GCU Still Reading The Manual",  // this machine's own ship name (notifications, the drone)
  sway: 0.6,       // slow look-around over ~26 min, degrees
  speed: 1.0       // scene seconds per real second
};

function merge(base, over) {
  var o = {}, k;
  for (k in base) o[k] = base[k];
  if (over) for (k in over) o[k] = over[k];
  return o;
}

function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { return mul(a, 1 / Math.sqrt(dot(a, a))); }
function rad(d) { return d * Math.PI / 180; }
function rot(v, k, an) { return add(add(mul(v, Math.cos(an)), mul(cross(k, v), Math.sin(an))), mul(k, dot(k, v) * (1 - Math.cos(an)))); }
function ringPt(phi, h, z) { return [(R - h) * Math.cos(phi), (R - h) * Math.sin(phi), z]; }
function upAt(p) { return norm([-p[0], -p[1], 0]); }
function tanAt(phi) { return [-Math.sin(phi), Math.cos(phi), 0]; }

// Local hour as a fraction, e.g. 14.55 for 14:33.
function clockHour(d) { d = d || new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }

// Everything the shader needs at scene time t and local hour h, as plain arrays.
function frame(p, t, h) {
  var phi = rad(p.phi), pos = ringPt(phi, p.alt, p.z * p.width), up = upAt(pos), tg = tanAt(phi);
  var yaw = rad(p.yaw + Math.sin(t * 0.004) * p.sway), pitch = rad(p.pitch);
  var f = rot(tg, up, yaw);
  f = norm(add(mul(f, Math.cos(pitch)), mul(up, Math.sin(pitch))));
  var r = norm(cross(f, up)), u = cross(r, f), rl = rad(p.roll);
  r = rot(r, f, rl); u = rot(u, f, rl);
  var sun;
  if (p.hour >= 0) h = p.hour;
  if (p.dayCycle && h !== undefined && h >= 0) {
    // The Orbital turns under its star once a day: overhead at noon, under the floor at midnight.
    var th = rad(180 + (h - p.noon) * 15), al = rad(p.sunTilt);
    sun = [Math.cos(th) * Math.cos(al), Math.sin(th) * Math.cos(al), Math.sin(al)];
  } else {
    // A fixed sun: elevation over the floor, bearing from spinward toward +z.
    var el = rad(p.sunEl), az = rad(p.sunAz);
    sun = norm(add(mul(up, Math.sin(el)), mul(add(mul(tg, Math.cos(az)), mul([0, 0, 1], Math.sin(az))), Math.cos(el))));
  }
  // After dusk the camera opens up, so the night side and its lights read.
  var dark = Math.min(1, Math.max(0, (0.05 - dot(up, sun)) / 0.3));
  dark = dark * dark * (3 - 2 * dark);
  return {cam: pos, right: r, up: u, fwd: f, F: 1 / Math.tan(rad(p.fov) / 2), sun: sun, dark: dark,
          exposure: p.exposure * (1 + (p.nightExposure - 1) * dark)};
}

// Real weather as a change of look. w: {cover, low, mid, high: cloud cover in %,
// code: WMO weather code, precip: mm/h, wind: km/h, visibility: m}; missing fields are skipped.
// Cloud cover goes through a curve measured on the afternoon look (the threshold that
// covers that share of the band), so 40% overcast outside is 40% of the band.
var coverCurve = [[0, 0.86], [5, 0.78], [12, 0.70], [24, 0.62], [37, 0.55], [52, 0.48], [68, 0.40], [83, 0.30], [100, 0.18]];

function interp(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (var i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) {
      var a = curve[i - 1], b = curve[i];
      return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
  }
  return curve[curve.length - 1][1];
}

function weatherLook(p, w) {
  var o = merge(p, {storm: 0});
  if (!w || !p.weather) return o;
  var code = w.code || 0;
  if (w.cover !== undefined && w.cover !== null) o.clouds = interp(coverCurve, w.cover);
  // high cloud (cirrus) is long and wispy
  var layers = (w.low || 0) + (w.mid || 0) + (w.high || 0), cirrus = layers > 0 ? (w.high || 0) / layers : 0;
  o.streak = p.streak * (1 + 0.5 * cirrus);
  o.cloudEdge = p.cloudEdge + 0.12 * cirrus;
  // rain greys the clouds; a thunderstorm darkens them and brings lightning
  var showery = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  var storm = code >= 95 ? 1 : 0;
  var rain = Math.max(showery ? 0.45 : 0, Math.min(1, (w.precip || 0) / 4), storm);
  var grey = 1 - 0.75 * rain;
  // the camera exposes for the scene: a band full of bright cloud is shot darker, which also
  // brings out the texture of an overcast deck; rain darkens it further
  var full = Math.min(1, Math.max(0, ((w.cover || 0) - 50) / 50));
  o.exposure = p.exposure * (1 - 0.4 * full) * (1 - 0.35 * rain);
  var snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
  o.cloudColor = snow ? [0.95, 0.97, 1.0]
                      : [p.cloudColor[0] * grey, p.cloudColor[1] * (grey + 0.02 * rain), p.cloudColor[2] * (grey + 0.06 * rain)];
  // fog and mist thicken the haze and soften the cloud edges
  if (code === 45 || code === 48 || (w.visibility !== undefined && w.visibility < 2000)) {
    o.rayleigh = p.rayleigh * 1.5;
    o.cloudEdge += 0.12;
  }
  // windier days, faster clouds
  if (w.wind !== undefined) o.speed = p.speed * Math.min(2.5, Math.max(0.5, 0.5 + w.wind / 20));
  o.storm = storm;
  return o;
}

// a eased toward b by k (0..1): numbers and number arrays blend, anything else switches.
function blend(a, b, k) {
  var o = merge(a, null), key;
  for (key in b) {
    var x = a[key], y = b[key];
    if (typeof y === "number" && typeof x === "number") o[key] = x + (y - x) * k;
    else if (Array.isArray(y) && Array.isArray(x) && x.length === y.length) o[key] = y.map(function (v, i) { return x[i] + (v - x[i]) * k; });
    else o[key] = y;
  }
  return o;
}

// Where the ray through screen point x, y (-1..1, y up) meets the cloud deck: {t: km, pos},
// or null when it misses the band; v is a frame() result.
function cloudPoint(v, width, x, y, aspect) {
  var d = norm(add(add(mul(v.right, x * aspect), mul(v.up, y)), mul(v.fwd, v.F)));
  var t = cloudDistance(v, width, x, y, aspect);
  return t > 0 ? {t: t, pos: add(v.cam, mul(d, t))} : null;
}

// Screen point (-1..1, y up) of world point p, or null behind the camera.
function project(v, p, aspect) {
  var rel = sub(p, v.cam), z = dot(rel, v.fwd);
  return z > 1 ? [dot(rel, v.right) / z * v.F / aspect, dot(rel, v.up) / z * v.F] : null;
}

// Distance (km) to the cloud deck along the ray through screen point x, y, or -1.
function cloudDistance(v, width, x, y, aspect) {
  var d = norm(add(add(mul(v.right, x * aspect), mul(v.up, y)), mul(v.fwd, v.F)));
  var o = v.cam, r = R - 10;
  var a = d[0] * d[0] + d[1] * d[1], b = o[0] * d[0] + o[1] * d[1], c = o[0] * o[0] + o[1] * o[1] - r * r, q = b * b - a * c;
  if (q < 0) return -1;
  var t = (-b + Math.sqrt(q)) / a, z = o[2] + d[2] * t;
  return t > 0 && Math.abs(z) < width / 2 - 80 ? t : -1;
}

// Where ray x, y meets the shell alt km above the floor: {t, pos}, or null off the band.
function skyPoint(v, width, x, y, aspect, alt) {
  var d = norm(add(add(mul(v.right, x * aspect), mul(v.up, y)), mul(v.fwd, v.F)));
  var o = v.cam, r = R - alt;
  var a = d[0] * d[0] + d[1] * d[1], b = o[0] * d[0] + o[1] * d[1], c = o[0] * o[0] + o[1] * o[1] - r * r, q = b * b - a * c;
  if (q < 0) return null;
  var t = (-b + Math.sqrt(q)) / a, pos = add(o, mul(d, t));
  return t > 0 && Math.abs(pos[2]) < width / 2 - 40 ? {t: t, pos: pos} : null;
}

// --- Session lights: Claude Code sessions as ships moored in a line off the band's near edge,
// receding round the ring toward the ribbon (slot 0 nearest).
function mooring(p, k) {
  var phi = 0.22 + 0.11 * k, alt = 300, out = 900 + 1100 * (phi - 0.22);
  return [(R - alt) * Math.cos(phi), (R - alt) * Math.sin(phi), p.width / 2 + out];
}

// The site's own ship names: invented in the Culture's manner, never Banks' own.
var shipNames = ["Weather Permitting", "Some Assembly Required", "Running Slightly Late", "Kindly Ignore The Noise",
  "Ask Again Later", "Technically Correct", "No Fixed Itinerary", "Fond Of Detours", "Reading Between The Lines",
  "Purely Decorative", "Mostly Paperwork", "Batteries Not Included", "Thought It Was Tuesday", "Left The Oven On",
  "Back In Five Minutes", "Not Strictly Necessary", "Closer Than It Appears", "Please Hold", "Lost Interest Halfway",
  "Second Draft", "Rounding Error", "Close Enough For Now", "Works On My Machine", "Read Receipts Off",
  "All Things Considered", "Assume Good Faith", "Further Reading", "Footnote Seven", "Unscheduled Maintenance",
  "Gone Fishing", "Ordinary Sunday", "The Long Way Round", "Mild Curiosity", "Polite Disagreement", "One More Thing",
  "Do Not Disturb", "Napkin Sketch", "Moderately Famous", "Fresh Paint", "Under New Management", "Lights Left On",
  "Nothing To Declare", "Excellent Posture", "Overthinking It", "Better Late", "Small Talk", "Unreasonably Optimistic",
  "Cold Feet", "Spare Key Under The Mat", "Best Before Never", "Light Reading", "Kettle's On", "Room For Dessert",
  "Fully Refundable", "No Particular Hurry", "Agreeable Silence", "Inherited Problems", "Sunday Best", "Calculated Shrug",
  "Two Sugars", "Window Seat", "Out Of Office", "Edge Case", "Low Tide", "Change Of Plans", "Long Weekend",
  "Probably Fine", "Still Thinking About It", "Annotated Edition", "A Bit Much", "Happy Accident", "Very Small Print",
  "Courtesy Call", "Extended Warranty", "Ample Leg Room", "Carry On Regardless", "Polite Applause", "Brief Intermission",
  "Subject To Change", "Under Advisement", "Pending Review", "Light Housekeeping", "Deliberately Vague", "In Good Company",
  "Room Temperature", "Generous Margins", "Night Shift", "Barely Supervised", "Gentle Reminder", "Minor Revisions",
  "Wrong Turn, Right Place", "Accidentally On Purpose", "Kind Regards", "As Previously Discussed", "Per My Last Message",
  "Loose Ends", "Tea And Sympathy", "Fair Weather Friend", "Seemed Like A Good Idea", "Unrelated Errand", "Mild Peril",
  "Standing Room Only", "Slightly Haunted", "Recently Repainted", "Do Try To Keep Up", "Plenty Of Time",
  "Overdue Library Book", "Leftovers Again", "Uncommonly Punctual", "Spare Change", "Tidy Desk Policy", "Halfway Decent",
  "Borrowed Umbrella", "Quiet Carriage", "Last Orders", "Scenic Route", "Strongly Worded Letter", "Promising Start",
  "Notes In The Margin", "Fine Print Reader"];
var shipClasses = ["GCU", "LSV", "MSV", "GOU", "Eccentric"];

function hashString(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// Names for a list of session ids, stable per id and never two alike at once.
function shipsFor(ids) {
  var used = {}, out = [];
  for (var i = 0; i < ids.length; i++) {
    var h = hashString(ids[i]), n = h % shipNames.length;
    while (used[n]) n = (n + 1) % shipNames.length;
    used[n] = true;
    out.push({cls: shipClasses[(h >>> 8) % shipClasses.length], name: shipNames[n]});
  }
  return out;
}

// --- Meteor showers on their real dates. peak: [month, day]; w: days for the rate to fall by e;
// zhr: rate at peak; speed km/s; az: their direction over the band (deg from spinward toward +z).
// The Taurids are the broad autumn pair, known for slow fireballs.
var showers = [
  {name: "Quadrantids", peak: [1, 3.5], w: 0.6, zhr: 110, speed: 41, az: 30, color: [0.85, 0.9, 1.0]},
  {name: "Lyrids", peak: [4, 22.5], w: 1.2, zhr: 18, speed: 49, az: 120, color: [1.0, 0.95, 0.85]},
  {name: "Eta Aquariids", peak: [5, 6], w: 4, zhr: 50, speed: 66, az: 200, color: [1.0, 0.9, 0.7]},
  {name: "Delta Aquariids", peak: [7, 30], w: 5, zhr: 25, speed: 41, az: 250, color: [0.95, 0.95, 1.0]},
  {name: "Perseids", peak: [8, 12.5], w: 2.5, zhr: 100, speed: 59, az: 60, color: [0.85, 1.0, 0.85]},
  {name: "Draconids", peak: [10, 8.5], w: 0.5, zhr: 10, speed: 20, az: 330, color: [1.0, 0.85, 0.7]},
  {name: "Orionids", peak: [10, 21.5], w: 3, zhr: 20, speed: 66, az: 150, color: [1.0, 0.95, 0.8]},
  {name: "Taurids", peak: [11, 5], w: 14, zhr: 10, speed: 27, az: 100, color: [1.0, 0.7, 0.4], fireballs: true},
  {name: "Leonids", peak: [11, 17.5], w: 1, zhr: 15, speed: 71, az: 20, color: [0.8, 1.0, 0.9]},
  {name: "Geminids", peak: [12, 14.5], w: 1.5, zhr: 150, speed: 35, az: 210, color: [0.95, 0.97, 1.0]},
  {name: "Ursids", peak: [12, 22.5], w: 1, zhr: 10, speed: 33, az: 300, color: [0.9, 0.95, 1.0]}
];
var sporadic = {name: "sporadic", zhr: 8, speed: 40, az: -1, color: [1.0, 0.97, 0.92]};

function dayOfYear(m, d, year) { return (Date.UTC(year, m - 1, 1) - Date.UTC(year, 0, 1)) / 86400000 + d; }

// What is falling tonight: [{shower, rate}] (rate in ZHR), sporadic meteors included.
function meteorsOn(date) {
  var y = date.getFullYear(), now = dayOfYear(date.getMonth() + 1, date.getDate() + date.getHours() / 24, y), out = [{shower: sporadic, rate: sporadic.zhr}];
  for (var i = 0; i < showers.length; i++) {
    var s = showers[i], dd = now - dayOfYear(s.peak[0], s.peak[1], y);
    if (dd > 182) dd -= 365; else if (dd < -182) dd += 365;   // the Quadrantids straddle New Year
    var rate = s.zhr * Math.exp(-Math.abs(dd) / s.w);
    if (rate > 0.5) out.push({shower: s, rate: rate});
  }
  return out;
}

// A shower's peak this year, for previews.
function showerPeak(name, year) {
  for (var i = 0; i < showers.length; i++) {
    var s = showers[i];
    if (s.name.toLowerCase() === String(name).toLowerCase()) return new Date(year, s.peak[0] - 1, Math.floor(s.peak[1]), Math.round((s.peak[1] % 1) * 24));
  }
  return null;
}

// --- The login intro's 3D move: the Vereda Labs mark, flat before the camera at the boot
// logo's size, turns in space and flies down to lie along the band, its long stroke running
// spinward toward the ribbon and curving with the ring as it lands. Mark coordinates are its
// SVG units about its centre (89, 58) with y up; the long stroke runs along (86, 116).
var markLong = [[-43, -58], [43, 58], [89, 58], [7, -58]];
var markShort = [[-89, 23], [-49, 23], [-27, -14], [-50, -43]];

function quatFromBasis(r, u, n) {   // rotation whose columns are r, u, n
  var m00 = r[0], m01 = u[0], m02 = n[0], m10 = r[1], m11 = u[1], m12 = n[1], m20 = r[2], m21 = u[2], m22 = n[2];
  var tr = m00 + m11 + m22, s;
  if (tr > 0) { s = Math.sqrt(tr + 1) * 2; return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  if (m00 > m11 && m00 > m22) { s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  if (m11 > m22) { s = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
  s = Math.sqrt(1 + m22 - m00 - m11) * 2; return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}
function quatSlerp(a, b, k) {
  var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map(function (x) { return -x }); d = -d; }
  if (d > 0.9995) { var q = a.map(function (x, i) { return x + (b[i] - x) * k }); var l = Math.sqrt(q.reduce(function (s, x) { return s + x * x }, 0)); return q.map(function (x) { return x / l }); }
  var th = Math.acos(d), sa = Math.sin((1 - k) * th) / Math.sin(th), sb = Math.sin(k * th) / Math.sin(th);
  return a.map(function (x, i) { return x * sa + b[i] * sb });
}
function quatAxes(q) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  return [[1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
          [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)]];
}
function slerpDir(a, b, k) {
  var d = Math.max(-1, Math.min(1, dot(a, b))), th = Math.acos(d);
  if (th < 1e-5) return a;
  return add(mul(a, Math.sin((1 - k) * th) / Math.sin(th)), mul(b, Math.sin(k * th) / Math.sin(th)));
}

// Start and end poses for screen size w x h (logical px), the mark markPx wide at the start.
function introSetup(p, v, w, h, markPx) {
  var aspect = w / h, D = 300;
  var unit0 = (markPx / 178) * D / (v.F * h / 2);
  var land = skyPoint(v, p.width, p.introX !== undefined ? p.introX : -0.12, p.introY !== undefined ? p.introY : -0.05, aspect, 10);
  if (!land) return null;
  var P = land.pos, phi = Math.atan2(P[1], P[0]), up = upAt(P), e1 = tanAt(phi), a = Math.atan2(116, 86), end = null;
  for (var sign = 1; sign >= -1; sign -= 2) {
    var e2 = [0, 0, sign];
    var r1 = sub(mul(e1, Math.cos(a)), mul(e2, Math.sin(a))), u1 = add(mul(e1, Math.sin(a)), mul(e2, Math.cos(a))), n1 = cross(r1, u1);
    if (dot(n1, up) > 0) { end = {r: r1, u: u1, n: n1}; break; }
  }
  var toP = sub(P, v.cam), d1 = Math.sqrt(dot(toP, toP));
  // The band's visible arc, for the stroke to spread over: the range of phi on screen,
  // stretched just past the frame (but kept in front of the camera).
  var lo = 1e9, hi = -1e9;
  for (var gx = 0; gx <= 32; gx++) for (var gy = 0; gy <= 18; gy++) {
    var hit = skyPoint(v, p.width, gx / 16 - 1, gy / 9 - 1, aspect, 10);
    if (!hit) continue;
    var ph = Math.atan2(hit.pos[1], hit.pos[0]);
    lo = Math.min(lo, ph); hi = Math.max(hi, ph);
  }
  var edge = p.width / 2 + 20, alt = R - Math.sqrt(P[0] * P[0] + P[1] * P[1]);
  var inFront = function (ph) { return project(v, ringPt(ph, alt, edge), aspect) && project(v, ringPt(ph, alt, -edge), aspect); };
  var near = lo - 0.03; while (!inFront(near) && near < lo) near += 0.005;
  var across = dot(end.u, [0, 0, 1]) * Math.cos(a) - dot(end.r, [0, 0, 1]) * Math.sin(a) > 0 ? 1 : -1;
  return {near: near, far: hi + 0.08, edge: edge * across,
          v: v, aspect: aspect, w: w, h: h, D: D, unit0: unit0, unit1: (p.introLength || 7000) / 144.4,
          d1: d1, dir1: mul(toP, 1 / d1), P: P, phi: phi, z: P[2], alt: R - Math.sqrt(P[0] * P[0] + P[1] * P[1]),
          q0: quatFromBasis(v.right, v.up, mul(v.fwd, -1)), q1: quatFromBasis(end.r, end.u, end.n), end: end};
}

function smooth01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

// The outline of a stroke at progress k (0..1), as screen points [x, y] in logical px. One
// smooth move: the mark turns in space as a rigid plane toward lying along the band, and all
// the while the long stroke stretches toward the band's whole visible arc (from just behind
// the frame's near edge to past the ribbon, edge to edge), arriving there as the move ends.
// Edges are subdivided so the curve shows; spread says whether this stroke stretches (the
// long one) or only turns (the short one, which fades early).
function introOutline(s, poly, k, spread) {
  var a = 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, k)));
  var r = smooth01(a / 0.8), w = spread ? smooth01((a - 0.1) / 0.9) : 0, bend = r * r;
  var axes = quatAxes(quatSlerp(s.q0, s.q1, r)), unit = s.unit0 * Math.pow(s.unit1 / s.unit0, r);
  var c = add(s.v.cam, mul(slerpDir(s.v.fwd, s.dir1, r), s.D * Math.pow(s.d1 / s.D, r)));
  var span = s.far - s.near, out = [], n = 16;
  for (var i = 0; i < poly.length; i++) {
    var p0 = poly[i], p1 = poly[(i + 1) % poly.length];
    for (var j = 0; j < n; j++) {
      var t = j / n, mu = p0[0] + (p1[0] - p0[0]) * t, mv = p0[1] + (p1[1] - p0[1]) * t;
      var wv = mul(add(mul(s.end.r, mu), mul(s.end.u, mv)), s.unit1);
      var landPhi = s.phi + dot(wv, tanAt(s.phi)) / (R - s.alt), landZ = s.z + wv[2];
      var X = add(c, mul(add(mul(axes[0], mu), mul(axes[1], mv)), unit));
      X = add(X, mul(sub(ringPt(landPhi, s.alt, landZ), add(s.P, wv)), bend));
      if (w > 0) {
        // its four edges head for the arc: the long sides to the band's two edges, the ends
        // to straight cuts across the band beyond each end of the frame
        var ph = i === 0 ? s.near + span * t : i === 1 ? s.far : i === 2 ? s.far - span * t : s.near;
        var zz = i === 0 ? s.edge : i === 1 ? s.edge * (1 - 2 * t) : i === 2 ? -s.edge : -s.edge * (1 - 2 * t);
        X = add(X, mul(sub(ringPt(ph, s.alt, zz), X), w));
      }
      var sp = project(s.v, X, s.aspect);
      if (sp) out.push([(sp[0] + 1) / 2 * s.w, (1 - sp[1]) / 2 * s.h]);
    }
  }
  return out;
}

// The intro as a zoom: precomputes, in screen space, where each outline point starts (the
// mark, flat before the camera) and ends (the band's whole visible arc), around the mark's
// centre and the band's visual centre, and the overall turn between them.
function introZoom(s) {
  var longA = introOutline(s, markLong, 0, false), longB = introOutline(s, markLong, 1, true);
  var shortA = introOutline(s, markShort, 0, false);
  var centroid = function (pts) { var x = 0, y = 0; pts.forEach(function (q) { x += q[0]; y += q[1] }); return [x / pts.length, y / pts.length]; };
  // the band's centre as it sits on screen
  var bx = 0, by = 0, nb = 0;
  for (var gx = 0; gx <= 48; gx++) for (var gy = 0; gy <= 27; gy++) {
    if (!skyPoint(s.v, s.edge ? Math.abs(s.edge) * 2 - 40 : 2600, gx / 24 - 1, gy / 13.5 - 1, s.aspect, 10)) continue;
    bx += (gx / 48) * s.w; by += (1 - gy / 27) * s.h; nb++;
  }
  // the turn, from the stroke's axis as drawn to the band's: mid near end to mid far end
  var n = longA.length / 4, axis = function (pts) {
    var a = pts[3 * n + Math.floor(n / 2)], b = pts[n + Math.floor(n / 2)];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  var len = function (pts) { var a = pts[3 * n + Math.floor(n / 2)], b = pts[n + Math.floor(n / 2)]; return Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2)); };
  var turn = axis(longB) - axis(longA);
  return {longA: longA, longB: longB, shortA: shortA, cA: centroid(longA), cB: nb ? [bx / nb, by / nb] : [s.w / 2, s.h / 2],
          turn: Math.atan2(Math.sin(turn), Math.cos(turn)), zoom: len(longB) / len(longA)};
}

// Points at progress k (0..1). The stroke zooms as one rigid shape, scaling up around a
// centre that slides from the mark's to the band's and turning to the band's angle, so both
// ends reach outward together; through the second half its outline eases into the band's
// exact arc. The short stroke only rides along (and fades).
function introZoomAt(z, which, k) {
  var e = k * k * k * (k * (k * 6 - 15) + 10);
  var rot = z.turn * e, zoom = Math.pow(z.zoom, e), co = Math.cos(rot), si = Math.sin(rot);
  var cx = z.cA[0] + (z.cB[0] - z.cA[0]) * e, cy = z.cA[1] + (z.cB[1] - z.cA[1]) * e;
  var A = which === "short" ? z.shortA : z.longA, m = which === "short" ? 0 : smooth01((e - 0.3) / 0.7), out = [];
  for (var i = 0; i < A.length; i++) {
    var ax = (A[i][0] - z.cA[0]) * zoom, ay = (A[i][1] - z.cA[1]) * zoom;
    var x = cx + ax * co - ay * si, y = cy + ax * si + ay * co;
    if (m > 0) { x += (z.longB[i][0] - x) * m; y += (z.longB[i][1] - y) * m; }
    out.push([x, y]);
  }
  return out;
}

// The intro as a ribbon: the long stroke as a spine (its centre line) with a half-width
// either side. At the start the spine is the stroke's straight axis and the width nearly
// even; at the end it is the band's centre line as the camera sees it, wide near and narrow
// toward the ribbon. In between the ribbon zooms and turns as one piece, its ends heading
// straight for the band's ends, while the spine bends into the band's curve and the width
// eases into its taper, so every frame is a smooth ribbon. Screen space, logical px.
function introRibbon(s, markPx, samples) {
  var N = samples || 48, px = markPx / 178, cx = s.w / 2, cy = s.h / 2;
  var mark = function (u, v) { return [cx + u * px, cy - v * px]; };
  var A = [], L0 = [], R0 = [], B = [], L1 = [], R1 = [];
  for (var i = 0; i <= N; i++) {
    var f = i / N;
    // the stroke: bottom edge from (-43,-58) to (7,-58), top edge from (43,58) to (89,58)
    var bl = [-43 + 86 * f, -58 + 116 * f], br = [7 + 82 * f, -58 + 116 * f], mid = [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2];
    var m = mark(mid[0], mid[1]), l = mark(bl[0], bl[1]), r = mark(br[0], br[1]);
    A.push(m); L0.push([l[0] - m[0], l[1] - m[1]]); R0.push([r[0] - m[0], r[1] - m[1]]);
    // the band at the same share of its visible arc
    var ph = s.near + (s.far - s.near) * f;
    var c = project(s.v, ringPt(ph, s.alt, 0), s.aspect), e1 = project(s.v, ringPt(ph, s.alt, s.edge), s.aspect), e2 = project(s.v, ringPt(ph, s.alt, -s.edge), s.aspect);
    var sc = [(c[0] + 1) / 2 * s.w, (1 - c[1]) / 2 * s.h], s1 = [(e1[0] + 1) / 2 * s.w, (1 - e1[1]) / 2 * s.h], s2 = [(e2[0] + 1) / 2 * s.w, (1 - e2[1]) / 2 * s.h];
    B.push(sc); L1.push([s1[0] - sc[0], s1[1] - sc[1]]); R1.push([s2[0] - sc[0], s2[1] - sc[1]]);
  }
  // keep the stroke's left side on the band's same side, so the ribbon never twists
  var cr = function (d, o) { return d[0] * o[1] - d[1] * o[0]; }, h = Math.floor(N / 2);
  var dA = [A[N][0] - A[0][0], A[N][1] - A[0][1]], dB = [B[h + 1][0] - B[h - 1][0], B[h + 1][1] - B[h - 1][1]];
  if ((cr(dA, L0[h]) > 0) !== (cr(dB, L1[h]) > 0)) { var t = L1; L1 = R1; R1 = t; }
  // the one-piece zoom: carries the stroke's ends onto the band's ends
  var ca = [A[N][0] - A[0][0], A[N][1] - A[0][1]], cb = [B[N][0] - B[0][0], B[N][1] - B[0][1]];
  var turn = Math.atan2(cb[1], cb[0]) - Math.atan2(ca[1], ca[0]);
  return {N: N, A: A, L0: L0, R0: R0, B: B, L1: L1, R1: R1, turn: Math.atan2(Math.sin(turn), Math.cos(turn)),
          zoom: Math.sqrt(cb[0] * cb[0] + cb[1] * cb[1]) / Math.sqrt(ca[0] * ca[0] + ca[1] * ca[1]),
          midA: [(A[0][0] + A[N][0]) / 2, (A[0][1] + A[N][1]) / 2], midB: [(B[0][0] + B[N][0]) / 2, (B[0][1] + B[N][1]) / 2]};
}

// The ribbon's outline at progress k (0..1): its left side out, its right side back. Two
// motions at once: the whole ribbon zooms and turns as one piece (which alone carries its ends
// onto the band's ends), while in its own frame, scaled back by that zoom, its spine bends into
// the band's curve and its half-widths ease (on a log scale) into the band's taper. So the
// bend and the widening grow with the zoom instead of flaring ahead of it.
function introRibbonAt(z, k) {
  var e = k * k * k * (k * (k * 6 - 15) + 10), w = e;
  var rot = z.turn * e, zoom = Math.pow(z.zoom, e), co = Math.cos(rot), si = Math.sin(rot);
  var mx = z.midA[0] + (z.midB[0] - z.midA[0]) * e, my = z.midA[1] + (z.midB[1] - z.midA[1]) * e;
  var c1 = Math.cos(-z.turn), s1 = Math.sin(-z.turn);
  var back = function (v) { return [(v[0] * c1 - v[1] * s1) / z.zoom, (v[0] * s1 + v[1] * c1) / z.zoom]; };   // end frame -> stroke frame
  var place = function (v) { return [(v[0] * co - v[1] * si) * zoom, (v[0] * si + v[1] * co) * zoom]; };     // stroke frame -> screen now
  var blendWidth = function (a, b) {
    var ra = Math.max(1e-3, Math.sqrt(a[0] * a[0] + a[1] * a[1])), rb = Math.max(1e-3, Math.sqrt(b[0] * b[0] + b[1] * b[1]));
    var ta = Math.atan2(a[1], a[0]), d = Math.atan2(b[1], b[0]) - ta;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    var r = ra * Math.pow(rb / ra, w), t = ta + d * w;
    return [r * Math.cos(t), r * Math.sin(t)];
  };
  var left = [], right = [];
  for (var i = 0; i <= z.N; i++) {
    var a = [z.A[i][0] - z.midA[0], z.A[i][1] - z.midA[1]], b = back([z.B[i][0] - z.midB[0], z.B[i][1] - z.midB[1]]);
    var sp = place([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]);
    var l = place(blendWidth(z.L0[i], back(z.L1[i]))), r = place(blendWidth(z.R0[i], back(z.R1[i])));
    left.push([mx + sp[0] + l[0], my + sp[1] + l[1]]);
    right.push([mx + sp[0] + r[0], my + sp[1] + r[1]]);
  }
  return left.concat(right.reverse());
}

// The intro as a 3D ribbon. The long stroke is a strip with a spine (its centre line) and a
// half-width either side; at the start it floats flat before the camera at the boot logo's
// size, at the end it is the band's centre strip on the ring, the band's full width. Between,
// the strip moves as one piece in space (turning, growing and travelling so its ends head for
// the band's two ends) while, in its own frame, it bends onto the ring's curve and its width
// eases to the band's. Every frame is projected through the scene's camera, so the near end
// widens because it really comes toward you, as a card does when it tilts.
function introRibbon3(s, markPx, samples) {
  var N = samples || 48, v = s.v, px = markPx / 178;
  var D = 300, unit0 = px * D / (v.F * s.h / 2);
  var C0 = add(v.cam, mul(v.fwd, D));
  var markW = function (u, w) { return add(C0, mul(add(mul(v.right, u), mul(v.up, w)), unit0)); };
  // the stroke's own frame: spine from bottom mid (-18,-58) to top mid (66,58), centred at (24,0)
  var ax = [84 / 143.2, 116 / 143.2], pr = [-ax[1], ax[0]];
  var X0 = norm(add(mul(v.right, ax[0]), mul(v.up, ax[1]))), Y0 = norm(add(mul(v.right, pr[0]), mul(v.up, pr[1]))), N0 = cross(X0, Y0);
  var M0 = markW(24, 0);
  // the band's centre strip, its spine at z = 0 from the near cut to the far one, anchored at
  // the point of the band nearest the screen's centre (where the mark starts), so the stroke
  // zooms in place and its two halves reach down the near band and up the ribbon together
  var toPx = function (p) { var q = project(v, p, s.aspect); return q ? [(q[0] + 1) / 2 * s.w, (1 - q[1]) / 2 * s.h] : null; };
  var mid = s.near, best = 1e18;
  for (var ph = s.near; ph <= s.far; ph += 0.002) {
    var q = toPx(ringPt(ph, s.alt, 0));
    if (!q) continue;
    var d2 = Math.pow(q[0] - s.w / 2, 2) + Math.pow(q[1] - s.h / 2, 2);
    if (d2 < best) { best = d2; mid = ph; }
  }
  var phiAt = function (f) { return f < 0.5 ? s.near + (mid - s.near) * f / 0.5 : mid + (s.far - mid) * (f - 0.5) / 0.5; };
  var spineW = function (f) { return ringPt(phiAt(f), s.alt, 0); };
  var M1 = spineW(0.5), X1 = tanAt(mid), Y1 = null, N1 = null;
  for (var sg = 1; sg >= -1; sg -= 2) {
    var zz = [0, 0, sg], y = norm(sub(zz, mul(X1, dot(zz, X1)))), n = cross(X1, y);
    if (dot(n, sub(v.cam, M1)) > 0) { Y1 = y; N1 = n; break; }
  }
  var s0 = unit0, s1 = (R - s.alt) * (s.far - s.near) / 143.2 * 0.6;
  var local1 = function (p) { var d = sub(p, M1); return [dot(d, X1) / s1, dot(d, Y1) / s1, dot(d, N1) / s1]; };
  var edgeW = Math.abs(s.edge) * (dot(Y1, [0, 0, 1]) > 0 ? 1 : -1);   // the band edge on the stroke's left
  var spine0 = [], left0 = [], right0 = [], spine1 = [], left1 = [], right1 = [];
  for (var i = 0; i <= N; i++) {
    var f = i / N, along = -71.6 + 143.2 * f;
    // the stroke's sides are horizontal cuts in the mark, so its half-widths lean off the spine
    // (a horizontal half-width hw in the mark, in the stroke's frame: along its axis and across it)
    var hw = 25 - 2 * f;
    spine0.push([along, 0, 0]);
    left0.push([-hw * ax[0], -hw * pr[0], 0]);
    right0.push([hw * ax[0], hw * pr[0], 0]);
    var ph = phiAt(f), c = ringPt(ph, s.alt, 0), cl = local1(c);
    spine1.push(cl);
    var el = local1(ringPt(ph, s.alt, edgeW)), er = local1(ringPt(ph, s.alt, -edgeW));
    left1.push(sub(el, cl)); right1.push(sub(er, cl));
  }
  var dir0 = sub(M0, v.cam), dir1 = sub(M1, v.cam), d0 = Math.sqrt(dot(dir0, dir0)), d1 = Math.sqrt(dot(dir1, dir1));
  // the short stroke, in the same frame, rides along unbent
  var shortLocal = markShort.map(function (m) { var d = [m[0] - 24, m[1]]; return [d[0] * ax[0] + d[1] * ax[1], d[0] * pr[0] + d[1] * pr[1], 0]; });
  return {v: v, s: s, N: N, s0: s0, s1: s1, q0: quatFromBasis(X0, Y0, N0), q1: quatFromBasis(X1, Y1, N1), shortLocal: shortLocal,
          dir0: mul(dir0, 1 / d0), dir1: mul(dir1, 1 / d1), d0: d0, d1: d1,
          spine0: spine0, left0: left0, right0: right0, spine1: spine1, left1: left1, right1: right1};
}

function introRibbon3At(z, k) {
  var e = k * k * k * (k * (k * 6 - 15) + 10), w = e;
  var q = quatSlerp(z.q0, z.q1, e), ax = quatAxes(q), X = ax[0], Y = ax[1], Nn = cross(X, Y);
  var sc = z.s0 * Math.pow(z.s1 / z.s0, e), M = add(z.v.cam, mul(slerpDir(z.dir0, z.dir1, e), z.d0 * Math.pow(z.d1 / z.d0, e)));
  var mix = function (a, b) { return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]; };
  var world = function (l) { return add(M, mul(add(add(mul(X, l[0]), mul(Y, l[1])), mul(Nn, l[2])), sc)); };
  var toScreen = function (p) { var sp = project(z.v, p, z.s.aspect); return sp ? [(sp[0] + 1) / 2 * z.s.w, (1 - sp[1]) / 2 * z.s.h] : null; };
  var left = [], right = [];
  for (var i = 0; i <= z.N; i++) {
    var sp = mix(z.spine0[i], z.spine1[i]);
    var L = toScreen(world(add(sp, mix(z.left0[i], z.left1[i])))), Rr = toScreen(world(add(sp, mix(z.right0[i], z.right1[i]))));
    if (L) left.push(L);
    if (Rr) right.push(Rr);
  }
  return left.concat(right.reverse());
}

// The short stroke at progress k: the same motion in space as the long one, but unbent.
function introShort3At(z, k) {
  var e = k * k * k * (k * (k * 6 - 15) + 10);
  var ax = quatAxes(quatSlerp(z.q0, z.q1, e)), X = ax[0], Y = ax[1];
  var sc = z.s0 * Math.pow(z.s1 / z.s0, e), M = add(z.v.cam, mul(slerpDir(z.dir0, z.dir1, e), z.d0 * Math.pow(z.d1 / z.d0, e)));
  var out = [];
  for (var i = 0; i < z.shortLocal.length; i++) {
    var l = z.shortLocal[i], sp = project(z.v, add(M, mul(add(mul(X, l[0]), mul(Y, l[1])), sc)), z.s.aspect);
    if (sp) out.push([(sp[0] + 1) / 2 * z.s.w, (1 - sp[1]) / 2 * z.s.h]);
  }
  return out;
}

// The progress at which the long stroke first covers a share of the band on screen (0..1),
// so the intro's fade can wait until the stroke really covers the Orbital.
function introCoverAt(z, share) {
  var v = z.v, s = z.s, band = [];
  for (var x = 0; x <= s.w; x += 32) for (var y = 0; y <= s.h; y += 32)
    if (skyPoint(v, Math.abs(s.edge) * 2 - 40, x / s.w * 2 - 1, 1 - y / s.h * 2, s.aspect, 10)) band.push([x, y]);
  if (!band.length) return 0.7;
  var inside = function (poly, x, y) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++)
      if ((poly[i][1] > y) !== (poly[j][1] > y) && x < (poly[j][0] - poly[i][0]) * (y - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
    return c;
  };
  for (var k = 0.3; k < 1; k += 0.01) {
    var poly = introRibbon3At(z, k), n = 0;
    for (var b = 0; b < band.length; b++) if (inside(poly, band[b][0], band[b][1])) n++;
    if (n / band.length >= share) return k;
  }
  return 0.9;
}

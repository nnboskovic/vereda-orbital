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

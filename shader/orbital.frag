#version 440
// The Vereda Labs Orbital as a desktop background: a lighter cut of
// lookdev/orbital from veredalabs-dev, without the ships, the GSV or its wake.
// Renders one rectangle (uOrigin, uSize) of a uRes frame, so the shell can
// build each new frame a slice at a time.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
  mat4 qt_Matrix;
  float qt_Opacity;
  float uTime;
  float uF;
  float uExp;
  float uClo;
  float uLand;
  float uBr;
  float uStreak;
  float uW;
  float uEdge;
  float uLights;
  float uShine;
  vec2 uRes;
  vec2 uOrigin;
  vec2 uSize;
  vec3 uCam;
  vec3 uRight;
  vec3 uUp;
  vec3 uFwd;
  vec3 uSun;
  vec3 uSea;
  vec3 uDeep;
  vec3 uSunC;
  vec3 uCloudC;
  vec3 uBolt;
  float uBoltR;
  float uFlash;
  float uMode;      // 0 draws the Orbital; 1 draws the land map the weather simulation runs on
  float uHasSky;    // 1 once the weather simulation's maps are in uSky and uAir
  float uClock;     // seconds by the clock, over a week: ships keep sailing across frames and places
};

// The weather simulation's maps (weather/sim.py): the band unrolled, 3016 x 104 cells of 25 km,
// wrapping round the ring, all opaque (Qt premultiplies alpha, so it can't carry data). uSky:
// low cloud, high cloud, how convective the low cloud is (flat sheets at 0, towering
// cumulonimbus at 1). uAir: the wind along and across the band (0.5 is calm), sea fog. uWet:
// rain, thunderstorms.
layout(binding = 1) uniform sampler2D uSky;
layout(binding = 2) uniform sampler2D uAir;
layout(binding = 3) uniform sampler2D uWet;

#define W uW
const float R = 12000.0, HA = 170.0, HC = 10.0, HW = 190.0, HUB = 140.0;
const float LOWC = 2.0, HIGHC = 10.0;   // the low and the high cloud decks, km above the floor
const float H = 30.0, HM = 6.0, PI = 3.14159265;
const float MIE = 2.0, SPILL = 70.0;
const float BM = 3.0e-3 * MIE;

vec3 BR() { return vec3(1.55e-3, 3.6e-3, 8.8e-3) * uBr; }

#define SUNC (uSunC * 10.0)
// faint night light from the sunlit far side of the ring, overhead
#define SHINE (vec3(0.03, 0.05, 0.09) * uShine)

float rs(float a, float b, float x) { return 1.0 - smoothstep(b, a, x); }
float h3(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), u.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), u.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
vec3 hg(vec3 p) { return normalize(vec3(h3(p), h3(p + 17.13), h3(p + 31.71)) * 2.0 - 1.0); }
float gn(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hg(i), f), b = dot(hg(i + vec3(1, 0, 0)), f - vec3(1, 0, 0)), c = dot(hg(i + vec3(0, 1, 0)), f - vec3(0, 1, 0)), d = dot(hg(i + vec3(1, 1, 0)), f - vec3(1, 1, 0));
  float e = dot(hg(i + vec3(0, 0, 1)), f - vec3(0, 0, 1)), g = dot(hg(i + vec3(1, 0, 1)), f - vec3(1, 0, 1)), h = dot(hg(i + vec3(0, 1, 1)), f - vec3(0, 1, 1)), k = dot(hg(i + vec3(1, 1, 1)), f - vec3(1, 1, 1));
  return 0.5 + 0.75 * mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
float gfbm(vec3 p, float fp, int oct) {
  float s = 0.0, a = 0.5, f = 1.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float w = 1.0 - smoothstep(0.5, 1.6, fp * f);
    s += a * w * (gn(p * f + float(i) * 17.3) - 0.5); n += a; a *= 0.52; f *= 2.07;
  }
  return 0.5 + s / n * 1.6;
}
// fbm with a footprint fade so the far arch does not shimmer
float fbm(vec3 p, float fp, int oct) {
  float s = 0.0, a = 0.5, f = 1.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float w = rs(1.0, 0.35, fp * f);
    s += a * w * vn(p * f + float(i) * 17.3); n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

vec2 cyl(vec3 o, vec3 d, float r) {
  float a = dot(d.xy, d.xy), b = dot(o.xy, d.xy), c = dot(o.xy, o.xy) - r * r, q = b * b - a * c;
  if (q < 0.0) return vec2(1e9, -1e9);
  q = sqrt(q); return vec2((-b - q) / a, (-b + q) / a);
}
vec3 upAt(vec3 p) { return -normalize(vec3(p.xy, 0.0)); }
// Is the sun hidden from p by the ring itself (its floor, or the far side of the band)?
// The sun is a disc ~0.27 deg across, so the shadow's edge softens with the distance to the band casting it.
float ringShadow(vec3 p) {
  vec2 t = cyl(p, uSun, R); float tt = t.y; if (tt < 0.0) return 1.0;
  float z = p.z + uSun.z * tt, pen = max(6.0, tt * 0.0047);
  return smoothstep(W * 0.5 - pen, W * 0.5 + pen, abs(z));
}

// ---------------------------------------------------------------- weather and clouds
vec2 skyUV(vec3 p) { return vec2(atan(p.y, p.x) / (2.0 * PI), p.z / W + 0.5); }

// The weather over a point: from the simulation's maps, or without them a procedural stand-in
// of broad cloudy regions, some of them convective, with high wisps.
// skyAt: low, high, convective, rain. airAt: wind along, across, fog, thunderstorms.
vec4 skyAt(vec3 p) {
  if (uHasSky > 0.5) { vec2 uv = skyUV(p); return vec4(texture(uSky, uv).rgb, texture(uWet, uv).r); }
  float big = gfbm(p / 900.0, 0.0, 3), mid = gfbm(p / 260.0 + 3.1, 0.0, 3);
  return vec4(smoothstep(0.45, 0.85, big * 0.7 + mid * 0.4), smoothstep(0.55, 0.85, gfbm(p / 700.0 + 9.7, 0.0, 3)),
              smoothstep(0.45, 0.8, mid), 0.0);
}
vec4 airAt(vec3 p) {
  if (uHasSky > 0.5) { vec2 uv = skyUV(p); return vec4(texture(uAir, uv).rgb, texture(uWet, uv).g); }
  return vec4(0.55, 0.5, 0.0, 0.0);
}

// Cells, for cumulus and the honeycomb of stratocumulus: the distances to the nearest and the
// second nearest of one jittered point per cell, on the band unrolled (along the ring, across
// it) and warped a little so no cell is round, with a whole number of cells round the ring so
// the pattern closes on itself.
vec2 cells(vec3 p, float size) {
  float n = floor(2.0 * PI * R / size);
  vec2 x = vec2((atan(p.y, p.x) / (2.0 * PI) + 0.5) * n, p.z / size);
  x += (vec2(vn(p / (size * 1.7)), vn(p / (size * 1.7) + 7.3)) - 0.5) * 0.9;
  vec2 i = floor(x), f = fract(x);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int k = -1; k <= 1; k++) {
    vec2 g = vec2(float(k), float(y)), c = vec2(mod(i.x + g.x, n), i.y + g.y);
    vec2 o = vec2(h3(vec3(c, 1.7 + size)), h3(vec3(c, 4.1 + size))) * 0.9 + 0.05, r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(vec2(d1, d2));
}

// Low cloud at q on its deck: the map's cover, given the shape of its kind. Flat sheets and fog
// are smooth; stratocumulus is a sheet made lumpy by its cells, dimpled where they meet;
// cumulus is clumps of popcorn a few km across, a soft speckle from this height; storm towers
// are great rounded heads. Edges are soft and frayed, so nothing ends in a clean curve or line.
// Far away the shapes blur into their mean cover. `thick` is how tall the cloud stands, km.
float lowCloud(vec3 q, float fp, vec4 sky, vec4 air, out float thick) {
  float fog = air.b, cover = max(sky.r, fog), conv = sky.b * (1.0 - fog);
  thick = 0.0;
  if (cover < 0.004) return 0.0;
  float t = uTime * 0.0006;               // the shapes change slowly; the map moves the weather
  float sheet = gfbm(q / 55.0 + vec3(0.0, 0.0, t), fp / 55.0, 5), n = sheet;
  float wComb = smoothstep(0.1, 0.35, conv) * (1.0 - smoothstep(0.45, 0.65, conv));
  float wCu = smoothstep(0.45, 0.65, conv) * (1.0 - smoothstep(0.8, 0.95, conv));
  float wTower = smoothstep(0.8, 0.95, conv);
  if (wComb > 0.01) {
    vec2 c = cells(q, 24.0);
    n = mix(n, sheet * 0.72 + (0.62 - smoothstep(0.15, 0.95, c.x)) * 0.3, wComb);
  }
  if (wCu > 0.01) {
    float clump = gfbm(q / 40.0 + 3.3, fp / 40.0, 3);
    float pop = fp < 9.0 ? 0.55 - cells(q, 4.5).x * 0.6 : 0.0;   // smaller than a pixel: only its average
    n = mix(n, clump * 0.8 + pop * (1.0 - clamp(fp / 9.0, 0.0, 1.0)) * 0.45 + 0.05, wCu);
  }
  if (wTower > 0.01) {
    vec2 c = cells(q, 32.0);
    n = mix(n, 1.1 - c.x + (gfbm(q / 7.0, fp / 7.0, 4) - 0.5) * 0.45, wTower);
  }
  n += (gfbm(q / 3.5 + 11.0, fp / 3.5, 3) - 0.5) * 0.22;   // frayed edges
  float edge = mix(0.24, 0.13, conv);
  float d = smoothstep(1.0 - cover - edge, 1.0 - cover + edge, n);
  d = mix(d, cover, clamp(fp / 10.0 - 0.3, 0.0, 1.0) * (1.0 - wTower));
  thick = mix(0.4, 2.0, d) + conv * conv * d * 10.0;
  return d * rs(W * 0.5, W * 0.5 - 60.0, abs(q.z));   // thinning out toward the rims
}

// High cloud at q: cirrus drawn out along the wind, or over a storm its anvil, smooth and dense.
float highCloud(vec3 q, float fp, vec4 sky, vec4 air) {
  float cover = sky.g;
  if (cover < 0.004) return 0.0;
  vec3 tg = normalize(vec3(-q.y, q.x, 0.0)); vec2 w = air.rg * 2.0 - 1.0;
  vec3 dir = length(w) > 0.05 ? normalize(w.x * tg + vec3(0.0, 0.0, w.y)) : tg;
  vec3 s = q / 70.0; s -= dir * dot(s, dir) * 0.75;   // features four times longer along the wind
  float n = gfbm(s + vec3(0.0, 0.0, uTime * 0.0004), fp / 70.0, 5);
  float anvil = smoothstep(0.6, 0.9, sky.b);
  n = mix(n, gfbm(q / 120.0, fp / 120.0, 3) * 0.6 + 0.4, anvil);
  return smoothstep(1.0 - cover - 0.12, 1.0 - cover + 0.12, n) * mix(0.55, 0.95, anvil) * rs(W * 0.5, W * 0.5 - 60.0, abs(q.z));
}

// How much of a deck's sunlight a point of floor or lower cloud loses to the cloud above it,
// found where the sun's ray crosses the deck. Storm towers cast from their tops, so higher.
float cloudShadow(vec3 p, float mu, float fp) {
  mu = max(mu, 0.12);
  vec3 cl = p + uSun * ((LOWC + 5.0 * skyAt(p).b) / mu); vec4 sky = skyAt(cl), air = airAt(cl);
  float thick; float dl = lowCloud(cl, fp, sky, air, thick);
  float high = skyAt(p + uSun * (HIGHC / mu)).g;          // cirrus: its cover is enough at this scale
  return clamp((1.0 - 0.85 * (1.0 - exp(-dl * thick * 1.5))) * (1.0 - 0.3 * high), 0.0, 1.0);
}

vec3 tSun(vec3 p) {
  float h = max(R - length(p.xy), 0.0); float mu = dot(upAt(p), uSun); if (mu <= 0.0) return vec3(0); mu = max(mu, 0.03);
  return exp(-(BR() * H * exp(-h / H) + BM * 1.1 * HM * exp(-h / HM)) / mu);
}

// Land or sea at a point on the floor: continents from a broad noise, coasts from a fine one.
float landAt(vec3 p, float fp, out float cont, out float det) {
  cont = fbm(p / 1400.0, fp / 1400.0, 7); det = fbm(p / 90.0, fp / 90.0, 5);
  return smoothstep(uLand, uLand + 0.015, cont + det * 0.06);
}

// The local solar hour at a point on the floor: noon where the sun stands overhead.
float localHour(vec3 p) {
  float th = atan(uSun.y, uSun.x), ph = atan(p.y, p.x);
  return mod(12.0 + (th - ph - PI) * 12.0 / PI, 24.0);
}

// How much of a place's night life is out at its hour: all of it through the evening, thinning
// after ten to the cities that never sleep, picking up again from three toward dawn.
float nightLife(float hr) {
  float h = mod(hr - 12.0, 24.0);          // hours since noon
  if (h < 10.0) return 1.0;
  if (h < 15.0) return mix(1.0, 0.35, smoothstep(10.0, 15.0, h));
  return mix(0.35, 0.8, smoothstep(15.0, 17.5, h));
}

// Where people live: towns gather in clusters, densest in the cities, and string along the
// coasts as harbours; out at sea, fewer, the floating towns.
float townDensity(vec3 p, float fp, float land, float cont, float det) {
  float dens = smoothstep(0.6, 0.78, fbm(p / 150.0, fp / 150.0, 4));
  float coast = 1.0 - smoothstep(0.0, 0.012, abs(cont + det * 0.06 - uLand));
  dens = max(dens, coast * 0.8 * smoothstep(0.42, 0.62, fbm(p / 60.0 + 5.0, fp / 60.0, 3)));
  return dens * mix(0.45, 1.0, land);
}

// Ships on the shipping lanes: eight lanes run along the ring at their own places across the
// band, a ship every few hundred km on each (a whole number of them round the ring, so the
// lanes close on themselves), sailing at 30 to 50 km/h by the clock. Each leaves a V of wake
// 35 km long, the arms at the 19.5 degrees every ship's wake opens to, with a churned line down
// the middle; at night it is a faint moving light. Wakes under a km wide fade into the water
// from afar, as they do from orbit.
void shipping(vec3 p, float fp, out float wake, out float light) {
  wake = 0.0; light = 0.0;
  float a = atan(p.y, p.x) * R;
  for (int j = 0; j < 8; j++) {
    float fj = float(j), y = p.z - (h3(vec3(fj, 2.2, 9.1)) - 0.5) * 2200.0;
    if (abs(y) > 40.0) continue;
    float N = floor(2.0 * PI * R / (350.0 + 350.0 * h3(vec3(fj, 3.3, 9.1)))), L = 2.0 * PI * R / N;
    float dir = h3(vec3(fj, 5.5, 9.1)) < 0.5 ? -1.0 : 1.0, v = (0.008 + 0.006 * h3(vec3(fj, 4.4, 9.1))) * dir;
    float s = a - v * uClock, k0 = floor(s / L);
    for (int dk = -1; dk <= 1; dk++) {
      float k = k0 + float(dk), kk = mod(k, N);
      float x = (s - (k + 0.2 + 0.6 * h3(vec3(kk, fj, 6.6))) * L) * dir;      // ahead of the ship, km
      float yy = y - (h3(vec3(kk, fj, 7.7)) - 0.5) * 16.0;
      if (x < 0.0 && x > -35.0) {
        float db = -x, arm = abs(yy) - db * 0.354, wd = 0.5 + db * 0.04;
        wake = max(wake, (exp(-arm * arm / (wd * wd)) * 0.7 + exp(-yy * yy / 0.3) * exp(-db / 6.0)) * exp(-db / 16.0));
      }
      float r = max(fp, 0.6);
      light = max(light, exp(-(x * x + yy * yy) / (r * r)) * min(1.0, 0.36 / (r * r)));
    }
  }
  wake *= clamp(1.2 / fp, 0.0, 1.0);
}

vec3 ground(vec3 p, vec3 rd, float t, float fp, out vec3 lights) {
  vec3 n = upAt(p); float mu = dot(n, uSun); float sh = ringShadow(p + n * 0.5);
  float cont, det; float land = landAt(p, fp, cont, det);
  vec3 ocean = mix(uDeep, uSea, smoothstep(0.4, 0.53, cont) * (0.7 + 0.3 * det));
  // the land by how high and how far inland it lies: forest and grass along the coasts and
  // lowlands, drier going inland to savanna and desert, bare rock on the mountains, snow on the
  // highest of them
  float inland = smoothstep(uLand, uLand + 0.12, cont), hgt = cont + det * 0.1;
  float arid = smoothstep(0.4, 0.8, inland * 0.75 + fbm(p / 600.0, fp / 600.0, 3) * 0.55);
  vec3 lc = mix(vec3(0.02, 0.05, 0.018), vec3(0.07, 0.075, 0.03), smoothstep(0.4, 0.7, det));
  lc = mix(lc, vec3(0.2, 0.145, 0.08), arid);
  lc = mix(lc, vec3(0.16, 0.15, 0.14), smoothstep(0.68, 0.73, hgt));
  lc = mix(lc, vec3(0.72, 0.75, 0.8), smoothstep(0.76, 0.8, hgt));
  vec3 alb = mix(ocean, lc, land);
  // shadows of the clouds overhead
  float cs = 1.0 - cloudShadow(p, mu, fp);
  vec3 E = SUNC * tSun(p) * sh * (1.0 - cs);
  vec3 col = alb * (E * max(mu, 0.0) + vec3(0.08, 0.14, 0.26) * 0.6 * clamp(mu + 0.3, 0.0, 1.0) + SHINE);
  // sun glint on water
  vec3 hv = normalize(uSun - rd); float sp = pow(max(dot(n, hv), 0.0), 180.0) * (1.0 - land) * (1.0 - cs);
  col += E * sp * 0.6;
  // ships: their wakes where the sun glints off the water, their lights at night
  float dusk = mu * sh + (sh - 1.0) * 0.2;                 // how far the sun is up here (< 0: down)
  float wake, shipLight; shipping(p, fp, wake, shipLight);
  col += E * (pow(max(dot(n, hv), 0.0), 40.0) * 0.3 + 0.004) * wake * (1.0 - land);
  lights = vec3(1.0, 0.85, 0.65) * shipLight * (1.0 - land) * smoothstep(-0.02, -0.1, dusk) * uLights * 2.0;
  // towns light up one by one as dusk passes over them, each waiting for its own depth of
  // twilight; through the night they keep to the hour (nightLife), the small ones going dark
  // after ten while the cities stay lit; rain dims them. One light per 9 km cell at most, drawn
  // at least a pixel wide so it doesn't sparkle, its brightness spread as it shrinks, turning
  // into the same average glow once cells are smaller than pixels.
  if (dusk < 0.06 && uLights > 0.0) {
    float dens = townDensity(p, fp, land, cont, det);
    if (dens > 0.0) {
      float life = nightLife(localHour(p)), rain = skyAt(p).a;
      vec2 bp = vec2(atan(p.y, p.x) * R, p.z) / 9.0;
      vec2 id = floor(bp), f = fract(bp) - 0.5;
      float h = h3(vec3(id, 3.7)), rank = h3(vec3(id, 7.7)), wait = 0.02 + 0.16 * h3(vec3(id, 8.8));
      vec2 off = (vec2(h3(vec3(id, 1.3)), h3(vec3(id, 2.9))) - 0.5) * 0.7;
      float rad = max(fp, 0.8) / 9.0, d = length(f - off);
      float on = smoothstep(0.02 - wait, -0.02 - wait, dusk) * smoothstep(1.0 - life - 0.05, 1.0 - life + 0.05, rank * 0.7 + dens * 0.5);
      float pt = step(1.0 - dens * 0.45, h) * (0.25 + 1.5 * pow(rank, 3.0)) * on * exp(-d * d / (rad * rad)) * min(1.0, 0.012 / (rad * rad));
      float glow = dens * 0.45 * 0.625 * 0.0377 * smoothstep(0.0, -0.12, dusk) * mix(0.45, 1.0, life);
      float far = clamp(fp / 9.0 * 2.0 - 0.6, 0.0, 1.0);
      // warm city cores, paler outskirts, the odd cool light
      vec3 hue = mix(vec3(1.0, 0.66, 0.34), vec3(0.85, 0.92, 1.0), max(smoothstep(0.8, 0.5, dens) * 0.45, step(0.86, h3(vec3(id, 5.1)))));
      lights += hue * mix(pt, glow, far) * uLights * 5.0 * (1.0 - 0.45 * rain);
    }
  }
  col += lights;
  return col;
}

float hgPhase(float c, float g) { return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5); }

// The light on a cloud: sunlight that has crossed the air (tSun reddens it at a low sun), less
// what cloud higher up or the cloud's own bulk toward the sun takes; thick cloud reflects more,
// thin edges seen toward the sun glow with forward scattering, and rain greys it a little.
// `lit` is the share of sunlight reaching it; `slope` is how much higher the cloud stands here
// than a little way toward the sun (km): sunward faces catch the light, lee sides fall into
// shade, and more so the lower the sun.
vec3 cloudLight(vec3 q, vec3 rd, float d, float thick, float lit, float slope, float rain) {
  vec3 n = upAt(q); float mu = dot(n, uSun); float sh = ringShadow(q + n * 0.5);
  vec3 E = SUNC * tSun(q) * sh * lit;
  float A = 1.0 - exp(-d * thick * 1.5);
  float self = clamp(1.0 + slope * 0.35 * (0.3 + smoothstep(0.0, 0.7, 1.0 - mu)), 0.3, 1.25);
  vec3 direct = E * max(mu, 0.0) * self * (0.55 + 0.45 * A);
  vec3 glow = E * hgPhase(dot(rd, uSun), 0.7) * 0.06 * (1.0 - A) * smoothstep(-0.05, 0.2, mu);
  vec3 sky = vec3(0.1, 0.17, 0.3) * 0.7 * clamp(mu + 0.3, 0.0, 1.0) * (0.5 + 0.5 * A) + SHINE * 1.4;
  vec3 col = uCloudC * (direct * 0.9 + sky + glow) * (1.0 - 0.3 * rain);
  // glory: diffraction rings around the anti-solar point, seen on cloud tops
  float th = acos(clamp(dot(rd, -uSun), -1.0, 1.0));
  col += E * max(mu, 0.0) * (0.5 + 0.5 * cos(th * vec3(70.0, 82.0, 98.0) * 6.2832 / 1.5)) * exp(-th / 0.045) * 0.35 * d;
  return col;
}

// atmosphere: single scattering through the annulus R-HA<r<R inside the band, with the ring's own shadow
void scatter(vec3 ro, vec3 rd, float t0, float t1, inout vec3 L, inout vec3 T, float j) {
  if (t1 <= t0) return;
  const int N = 16; float ds = (t1 - t0) / float(N);
  float cth = dot(rd, uSun); float pr = 0.75 * (1.0 + cth * cth); float g = 0.76;
  float pm = 1.5 * ((1.0 - g * g) / (2.0 + g * g)) * (1.0 + cth * cth) / pow(1.0 + g * g - 2.0 * g * cth, 1.5);
  vec3 br = BR();
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (t0 + ds * (float(i) + j)); float h = R - length(p.xy);
    float edge = 1.0 - smoothstep(W * 0.5 - 10.0, W * 0.5 + SPILL, abs(p.z)); edge *= edge;
    float dr = exp(-h / H) * edge, dm = exp(-h / HM) * edge; vec3 ext = (br * dr + BM * 1.1 * dm) * ds;
    vec3 S = SUNC * tSun(p) * ringShadow(p);
    L += T * (br * dr * pr + BM * dm * pm) * S * ds / (4.0 * PI) + T * br * dr * ds * vec3(0.05, 0.09, 0.2) * 0.25;
    T *= exp(-ext);
  }
}
void atmo(vec3 ro, vec3 rd, float tEnd, inout vec3 L, inout vec3 T, float j) {
  vec2 to = cyl(ro, rd, R), ti = cyl(ro, rd, R - HA); float zA, zB; // slab |z|<W/2
  if (abs(rd.z) < 1e-6) { zA = -1e9; zB = 1e9; } else { float a = (-W * 0.5 - SPILL - ro.z) / rd.z, b = (W * 0.5 + SPILL - ro.z) / rd.z; zA = min(a, b); zB = max(a, b); }
  float lo = max(max(to.x, 0.0), zA), hi = min(min(to.y, tEnd), zB);
  if (ti.y < ti.x) { scatter(ro, rd, lo, hi, L, T, j); return; }
  scatter(ro, rd, lo, min(hi, ti.x), L, T, j); scatter(ro, rd, max(lo, ti.y), hi, L, T, j);
}
vec3 stars(vec3 d) {
  vec3 sp = d * 170.0, id = floor(sp), f = fract(sp) - 0.5; float h = h3(id + 11.0);
  vec3 off = (vec3(h3(id + 1.0), h3(id + 2.0), h3(id + 3.0)) - 0.5) * 0.6; float dd = length(f - off);
  float s = step(0.982, h) * rs(0.13, 0.0, dd) * (0.15 + pow(h3(id + 7.0), 3.0) * 3.0);
  vec3 c = mix(vec3(1.0, 0.8, 0.65), vec3(0.7, 0.85, 1.0), h3(id + 5.0));
  vec3 mwn = normalize(vec3(0.3, -0.4, 0.86)); float band = exp(-pow(dot(d, mwn) / 0.22, 2.0));
  float mw = band * smoothstep(0.45, 0.75, fbm(d * 9.0, 0.0, 6));
  return c * s + vec3(0.5, 0.58, 0.78) * mw * 0.0035;
}

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

#ifndef FLASH
// The land map for the weather simulation: the band unrolled, the ring's angle across the frame
// (0 to 360 degrees, spinward to the right) and the band's width down it (-W/2 at the top).
// Land in red, the continents' broad height in green (mountains above about 0.7, deep sea below
// 0.4), the fine detail in blue. Drawn by the shader itself so it matches the drawn land exactly.
void landMap() {
  vec2 px = uOrigin + qt_TexCoord0 * uSize;
  float phi = px.x / uRes.x * 2.0 * PI, z = (px.y / uRes.y - 0.5) * W;
  vec3 p = vec3(R * cos(phi), R * sin(phi), z);
  float cont, det; float land = landAt(p, 2.0 * PI * R / uRes.x, cont, det);
  if (uMode > 1.5) {   // mode 2: where people live, for the simulation's air routes between the cities
    fragColor = vec4(townDensity(p, 2.0 * PI * R / uRes.x, land, cont, det), land, 0.0, 1.0);
    return;
  }
  fragColor = vec4(land, clamp(cont, 0.0, 1.0), clamp(det, 0.0, 1.0), 1.0);
}

void main() {
  if (uMode > 0.5) { landMap(); return; }
  vec2 px = uOrigin + qt_TexCoord0 * uSize;          // frame pixel, y down
  vec2 fc = vec2(px.x, uRes.y - px.y);               // y up, as in the lookdev
  vec2 uv = (2.0 * fc - uRes) / uRes.y; vec3 rd = normalize(uv.x * uRight + uv.y * uUp + uF * uFwd), ro = uCam;
  float pix = 2.0 / uRes.y / uF; float j = fract(sin(dot(floor(fc), vec2(12.9898, 78.233))) * 43758.5453);
  vec3 col = vec3(0); float tHit = 1e9; int kind = 0;
  vec2 tc = cyl(ro, rd, R);
  if (tc.x > 0.0 && abs(ro.z + rd.z * tc.x) < W * 0.5) { tHit = tc.x; kind = 2; }        // underside
  else if (tc.y > 0.0 && abs(ro.z + rd.z * tc.y) < W * 0.5) { tHit = tc.y; kind = 1; }   // inner floor
  // hub
  float bh = dot(ro, rd), ch = dot(ro, ro) - HUB * HUB, qh = bh * bh - ch; if (qh > 0.0) { float th = -bh - sqrt(qh); if (th > 0.0 && th < tHit) { tHit = th; kind = 3; } }
  vec3 p = ro + rd * tHit; float fp = tHit * pix;
  if (kind == 0) { col = stars(rd); }
  else if (kind == 1) {
    vec3 lightsBelow; col = ground(p, rd, tHit, fp, lightsBelow);
    vec3 qL = ro + rd * cyl(ro, rd, R - LOWC).y, qH = ro + rd * cyl(ro, rd, R - HIGHC).y;
    vec4 sky = skyAt(qL), air = airAt(qL);
    float thick; float dL = lowCloud(qL, fp, sky, air, thick), dH = highCloud(qH, fp, sky, air);
    if (dL > 0.003) {
      vec3 n = upAt(qL); float mu = dot(n, uSun);
      vec3 ts = normalize(uSun - n * mu + vec3(1e-4));
      float tt; float toward = lowCloud(qL + ts * min(30.0, (1.0 + thick) / max(mu, 0.2)), fp, sky, air, tt);
      vec3 cc = cloudLight(qL, rd, dL, thick, 1.0 - 0.35 * dH, dL * thick - toward * tt, sky.a);
      cc += lightsBelow * exp(-dL * thick * 0.6) * 0.8;   // town light glowing up through thin cloud
      col = mix(col, cc, dL);
    }
    if (dH > 0.003) col = mix(col, cloudLight(qH, rd, dH, 0.8, 1.0, 0.0, 0.0) * vec3(0.97, 0.99, 1.02), dH * 0.85);
  }
  else if (kind == 2) {
    vec3 n = normalize(vec3(p.xy, 0.0)); float l = max(dot(n, uSun), 0.0); float pan = 0.8 + 0.2 * vn(vec3(p.xy / 40.0, p.z / 40.0));
    col = vec3(0.035, 0.037, 0.042) * pan * (SUNC * l * 0.03 + 0.004);
    float lights = step(0.995, h3(floor(vec3(atan(p.y, p.x) * R / 25.0, p.z / 25.0, 1.0)))); col += vec3(1.0, 0.8, 0.5) * lights * 0.4;
  }
  else if (kind == 3) { vec3 n = normalize(p); float l = max(dot(n, uSun), 0.0); col = vec3(0.5, 0.52, 0.56) * SUNC * l * 0.08 + vec3(0.6, 0.85, 1.0) * rs(0.08, 0.0, abs(n.z)) * 0.6; }
  vec3 L = vec3(0), T = vec3(1);
  atmo(ro, rd, tHit, L, T, j);
  col = col * T + L;
  // walls: thin glass at z=+-W/2 between r=R-HW and R
  for (int s = 0; s < 2; s++) {
    float zw = (s == 0 ? -0.5 : 0.5) * W; float tw = (zw - ro.z) / rd.z;
    if (tw > 0.0 && tw < tHit) {
      vec3 pw = ro + rd * tw; float r = length(pw.xy);
      if (r > R - HW && r < R) {
        float fr = pow(1.0 - abs(rd.z), 5.0); float topEdge = exp(-(r - (R - HW)) / 1.5); float lit = step(0.0, dot(upAt(pw), uSun));
        col = col * 0.985 + vec3(0.6, 0.8, 1.0) * (fr * 0.012 + topEdge * 0.03 * lit);
      }
    }
  }
  // the sun, its glare and diffraction spikes from a six-bladed aperture, near its image only
  float sz = dot(uSun, uFwd);
  if (sz > 0.0) {
    vec2 su = vec2(dot(uSun, uRight), dot(uSun, uUp)) / sz * uF;
    vec2 dv = uv - su; float dist = length(dv);
    if (dist < 1.2) {
      float occ = 0.0;
      for (int k = 0; k < 5; k++) {
        vec3 dd = normalize(uSun + (k == 0 ? vec3(0) : vec3(k == 1 ? 1. : k == 2 ? -1. : 0., k == 3 ? 1. : k == 4 ? -1. : 0., 0.) * 0.0045)); vec2 c2 = cyl(ro, dd, R);
        float zz = c2.x > 0.0 ? ro.z + dd.z * c2.x : ro.z + dd.z * c2.y; occ += (abs(zz) < W * 0.5 ? 1.0 : 0.0);
      }
      float vis = 1.0 - occ / 5.0; vec3 Ls = vec3(0), Ts = vec3(1); atmo(ro, uSun, 1e7, Ls, Ts, 0.5);
      vec3 tint = Ts * vis;
      float disc = rs(0.0095, 0.0075, dist); col += SUNC * disc * tint * 3.0 * (kind == 0 ? 1.0 : 0.0);
      col += SUNC * tint * 0.02 / (1.0 + pow(dist / 0.02, 2.0));
      vec3 sp = vec3(0);
      for (int k = 0; k < 3; k++) {
        float an = 0.35 + float(k) * PI / 3.0; vec2 ax = vec2(cos(an), sin(an)); float al = abs(dot(dv, ax)), pe = abs(dot(dv, vec2(-ax.y, ax.x)));
        vec3 lam = vec3(1.0, 0.84, 0.68); vec3 len = 0.16 * lam; vec3 wid = 0.0012 + al * 0.004 * lam;
        sp += exp(-pe / wid) * exp(-al / len) / (1.0 + al * 18.0) * (1.0 + 0.5 * cos(al * vec3(150.0, 180.0, 215.0)));
      }
      float ang = atan(dv.y, dv.x); float streak = pow(vn(vec3(ang * 48.0, 0.5, 0.5)), 6.0) * exp(-dist / 0.12) * 0.6;
      col += SUNC * tint * (sp * 0.05 + streak * 0.03 / (1.0 + dist * 25.0));
    }
  }
  col *= uExp; col = aces(col); col = pow(col, vec3(1.0 / 2.2));
  col += (j - 0.5) / 255.0;
  fragColor = vec4(col, 1.0) * qt_Opacity;
}
#else
// Lightning (built with -DFLASH): a strike under the cloud deck at uBolt lights the clouds
// around it, brightest inside thick cloud. Drawn in a small box over the finished frame as
// pure added light (premultiplied, alpha 0), uFlash flickering it.
void main() {
  vec2 px = uOrigin + qt_TexCoord0 * uSize;
  vec2 fc = vec2(px.x, uRes.y - px.y);
  vec2 uv = (2.0 * fc - uRes) / uRes.y; vec3 rd = normalize(uv.x * uRight + uv.y * uUp + uF * uFwd), ro = uCam;
  vec2 tcl = cyl(ro, rd, R - LOWC); vec3 q = ro + rd * tcl.y;
  float d = length(q - uBolt), fall = exp(-d * d / (uBoltR * uBoltR));
  if (tcl.y <= 0.0 || abs(q.z) > W * 0.5 || fall < 0.002) { fragColor = vec4(0.0); return; }
  float thick; float c = lowCloud(q, tcl.y * 2.0 / uRes.y / uF, skyAt(q), airAt(q), thick), depth = clamp(thick / 8.0, 0.0, 1.0);
  float lit = fall * (0.12 + 0.88 * c * (0.35 + 0.65 * depth));
  lit *= 1.0 - smoothstep(0.72, 1.0, length(qt_TexCoord0 * 2.0 - 1.0));  // round fade: no box edge
  fragColor = vec4(min(vec3(0.78, 0.85, 1.0) * lit * uFlash, vec3(1.0)), 0.0) * qt_Opacity;
}
#endif

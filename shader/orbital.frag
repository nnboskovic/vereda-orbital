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
};

#define W uW
const float R = 12000.0, HA = 170.0, HC = 10.0, HW = 190.0, HUB = 140.0;
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

// Clouds on the r=R-HC shell, in 3D noise space so there is no seam; stretched spinward.
float clouds(vec3 q, float fp, out float depth) {
  vec3 p = q / vec3(340.0 * uStreak, 340.0 * uStreak, 120.0 / uStreak); float t = uTime * 0.004; fp /= 160.0;
  vec3 w = vec3(gfbm(p * 0.6 + vec3(0, 0, t), fp * 0.6, 4), gfbm(p * 0.6 + vec3(5.2, 1.3, -t), fp * 0.6, 4), 0.0) - 0.5;
  float big = gfbm(p * 0.18 + vec3(2.0, 7.0, t * 0.3), fp * 0.18, 3);
  float c = gfbm(p + w * 1.8 + vec3(t * 0.6, 0, 0), fp, 7);
  float th = uClo + (0.5 - big) * 0.9;
  float cov = smoothstep(th, th + uEdge, c);
  depth = smoothstep(th, th + 0.45, c);
  cov *= rs(W * 0.5, W * 0.5 - 60.0, abs(q.z)); // thin out toward the rim
  return clamp(cov, 0.0, 1.0);
}
float clouds(vec3 q, float fp) { float d; return clouds(q, fp, d); }

vec3 tSun(vec3 p) {
  float h = max(R - length(p.xy), 0.0); float mu = dot(upAt(p), uSun); if (mu <= 0.0) return vec3(0); mu = max(mu, 0.03);
  return exp(-(BR() * H * exp(-h / H) + BM * 1.1 * HM * exp(-h / HM)) / mu);
}

vec3 ground(vec3 p, vec3 rd, float t, float fp) {
  vec3 n = upAt(p); float mu = dot(n, uSun); float sh = ringShadow(p + n * 0.5);
  vec3 pn = p / 1400.0; float cont = fbm(pn, fp / 1400.0, 7); float det = fbm(p / 90.0, fp / 90.0, 5);
  float land = smoothstep(uLand, uLand + 0.015, cont + det * 0.06);
  vec3 ocean = mix(uDeep, uSea, smoothstep(0.4, 0.53, cont) * (0.7 + 0.3 * det));
  vec3 lc = mix(vec3(0.02, 0.05, 0.015), vec3(0.06, 0.065, 0.035), smoothstep(0.4, 0.7, det)); lc = mix(lc, vec3(0.5), smoothstep(0.7, 0.75, cont + det * 0.1));
  vec3 alb = mix(ocean, lc, land);
  // cloud shadow
  vec3 cp = p + uSun * (HC / max(mu, 0.15)); float cs = clouds(cp, fp);
  vec3 E = SUNC * tSun(p) * sh * (1.0 - 0.75 * cs);
  vec3 col = alb * (E * max(mu, 0.0) + vec3(0.08, 0.14, 0.26) * 0.6 * clamp(mu + 0.3, 0.0, 1.0) + SHINE);
  // sun glint on water
  vec3 hv = normalize(uSun - rd); float sp = pow(max(dot(n, hv), 0.0), 180.0) * (1.0 - land) * (1.0 - cs);
  col += E * sp * 0.6;
  // night lights where it is dark
  float night = rs(0.05, -0.15, mu * sh + (sh - 1.0) * 0.2);
  if (night > 0.0 && uLights > 0.0) {
    // towns, ashore and afloat: where people live, then at most one light per 9 km cell,
    // drawn at least a pixel wide so it does not sparkle, its brightness spread as it shrinks,
    // turning into the same average glow once cells are smaller than pixels
    float dens = smoothstep(0.6, 0.78, fbm(p / 150.0, fp / 150.0, 4));
    if (dens > 0.0) {
      vec2 bp = vec2(atan(p.y, p.x) * R, p.z) / 9.0;
      vec2 id = floor(bp), f = fract(bp) - 0.5;
      float h = h3(vec3(id, 3.7));
      vec2 off = (vec2(h3(vec3(id, 1.3)), h3(vec3(id, 2.9))) - 0.5) * 0.7;
      float rad = max(fp, 0.8) / 9.0, d = length(f - off);
      float bright = 0.25 + 1.5 * pow(h3(vec3(id, 7.7)), 3.0);
      float pt = step(1.0 - dens * 0.45, h) * bright * exp(-d * d / (rad * rad)) * min(1.0, 0.012 / (rad * rad));
      float glow = dens * 0.45 * 0.625 * 0.0377;
      float far = clamp(fp / 9.0 * 2.0 - 0.6, 0.0, 1.0);
      vec3 hue = mix(vec3(1.0, 0.66, 0.34), vec3(0.85, 0.92, 1.0), step(0.82, h3(vec3(id, 5.1))));
      col += hue * mix(pt, glow, far) * night * uLights * 5.0;
    }
  }
  return col;
}

vec3 cloudShade(vec3 q, vec3 rd, float fp, float c, float depth) {
  vec3 n = upAt(q); float mu = dot(n, uSun); float sh = ringShadow(q + n * 0.5);
  vec3 ts = normalize(uSun - n * mu); float ds = clouds(q + ts * 6.0, fp);
  vec3 E = SUNC * tSun(q) * sh;
  vec3 col = uCloudC * (E * max(mu, 0.0) * (0.55 + 0.45 * (1.0 - ds)) * (0.62 + 0.38 * depth) * 0.9 + vec3(0.1, 0.17, 0.3) * 0.7 * clamp(mu + 0.3, 0.0, 1.0) + SHINE * 1.4);
  // glory: diffraction rings around the anti-solar point, seen on cloud tops
  float th = acos(clamp(dot(rd, -uSun), -1.0, 1.0));
  vec3 g = 0.5 + 0.5 * cos(th * vec3(70.0, 82.0, 98.0) * 6.2832 / 1.5);
  col += E * max(mu, 0.0) * g * exp(-th / 0.045) * 0.35 * c;
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
void main() {
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
    vec3 g = ground(p, rd, tHit, fp); vec2 tcl = cyl(ro, rd, R - HC); vec3 q = ro + rd * tcl.y; float depth; float c = clouds(q, fp, depth);
    col = mix(g, cloudShade(q, rd, fp, c, depth), c);
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
  vec2 tcl = cyl(ro, rd, R - HC); vec3 q = ro + rd * tcl.y;
  float d = length(q - uBolt), fall = exp(-d * d / (uBoltR * uBoltR));
  if (tcl.y <= 0.0 || abs(q.z) > W * 0.5 || fall < 0.002) { fragColor = vec4(0.0); return; }
  float depth; float c = clouds(q, tcl.y * 2.0 / uRes.y / uF, depth);
  float lit = fall * (0.12 + 0.88 * c * (0.35 + 0.65 * depth));
  lit *= 1.0 - smoothstep(0.72, 1.0, length(qt_TexCoord0 * 2.0 - 1.0));  // round fade: no box edge
  fragColor = vec4(min(vec3(0.78, 0.85, 1.0) * lit * uFlash, vec3(1.0)), 0.0) * qt_Opacity;
}
#endif

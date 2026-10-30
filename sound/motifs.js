// Vereda Orbital's sounds, every one synthesised here from code (no samples). The palette leans
// on the user's two touchstones: Jamiroquai (a Rhodes electric piano with its tremolo, warm
// extended chords, a round finger bass, disco strings) and Daft Punk's Interstella 5555 (warm
// analog pads behind a slow filter sweep, chorus, a soft "ooh" pad, a four-on-the-floor pulse).
// Everything is kept round: sines and band-limited saws under 24 dB lowpasses, nothing
// metallic, a smooth convolution hall, and the harsh top end rolled off.
//
// One cell runs through all of it, shaped like the Vereda mark: a short drop then a long rise,
// E5 - A4 - B5. The theme follows the shape of the Windows 95 startup sound (a sparkle, a warm
// chord swelling in, a chime melody, a lift, a bloom that rings out), not its notes, over a soul
// lift: Dmaj9, E9sus, Amaj9, landing as the intro's ivory dissolves into the Orbital.
//
// Plain JS: render.js runs it in Node to write the WAV files the desktop plays.

const SR = 48000;

// ---------------------------------------------------------------- helpers
function rng(seed) {
  let s = seed >>> 0 || 1;
  return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const NAMES = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
function hz(name) {   // "C#6" -> frequency
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  const midi = 12 * (+m[3] + 1) + NAMES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}
const notes = list => list.map(hz);
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const smoother = k => k * k * k * (k * (k * 6 - 15) + 10);
const envAR = (t, dur, attack, release) => smooth(t / attack) * (1 - smooth((t - (dur - release)) / release));

// A stereo track: dry, and a send to the hall.
function track(seconds) {
  const n = Math.ceil(seconds * SR);
  return {n, L: new Float32Array(n), R: new Float32Array(n), sL: new Float32Array(n), sR: new Float32Array(n)};
}
function stereo(n) { return {L: new Float32Array(n), R: new Float32Array(n)}; }
// Place a mono voice at time t, pan -1..1, with a share sent to the hall.
function place(tr, v, t, gain, pan, send) {
  const o = Math.round(t * SR), l = Math.cos((pan + 1) * Math.PI / 4) * gain, r = Math.sin((pan + 1) * Math.PI / 4) * gain;
  for (let i = 0; i < v.length; i++) {
    const j = o + i; if (j < 0 || j >= tr.n) continue;
    tr.L[j] += v[i] * l; tr.R[j] += v[i] * r; tr.sL[j] += v[i] * l * send; tr.sR[j] += v[i] * r * send;
  }
}
// Place a stereo voice.
function placeSt(tr, st, t, gain, send) {
  const o = Math.round(t * SR);
  for (let i = 0; i < st.L.length; i++) {
    const j = o + i; if (j < 0 || j >= tr.n) continue;
    const l = st.L[i] * gain, r = st.R[i] * gain;
    tr.L[j] += l; tr.R[j] += r; tr.sL[j] += l * send; tr.sR[j] += r * send;
  }
}
// A voice with a dotted ping-pong echo, as a delay pedal would give it.
function echoed(tr, v, t, gain, pan, send, taps = 2, gap = 0.19) {
  for (let k = 0; k <= taps; k++) place(tr, v, t + k * gap, gain * Math.pow(0.38, k), k === 0 ? pan : (k % 2 ? -0.7 : 0.7), send + 0.15 * k);
}

// ---------------------------------------------------------------- filters
// RBJ biquad; the cutoff may be a function of time (coefficients every 32 samples).
function biquad(input, type, freq, q) {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0, b1, b2, a1, a2;
  const coef = f => {
    const w = 2 * Math.PI * Math.min(Math.max(f, 20), SR * 0.45) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 = -2 * c / a0; a2 = (1 - al) / a0;
  };
  for (let i = 0; i < input.length; i++) {
    if (i % 32 === 0) coef(typeof freq === "function" ? freq(i / SR) : freq);
    const x = input[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}
// A smooth 24 dB lowpass (two Butterworth stages); res lifts the second stage for a filter sweep's "wow".
const lp24 = (x, cut, res = 1.31) => biquad(biquad(x, "lp", cut, 0.54), "lp", cut, res);

// Stereo chorus: a short delay, slowly swaying, different on each side.
function chorus(st, o = {}) {
  const base = (o.base || 0.014) * SR, depth = (o.depth || 0.0025) * SR, rate = o.rate || 0.33, mix = o.mix === undefined ? 0.5 : o.mix;
  const out = stereo(st.L.length);
  for (const [src, dst, ph] of [[st.L, out.L, 0], [st.R, out.R, Math.PI / 2]]) {
    for (let i = 0; i < src.length; i++) {
      const d = base + depth * Math.sin(2 * Math.PI * rate * i / SR + ph), p = i - d, j = Math.floor(p), f = p - j;
      const w = j >= 0 && j + 1 < src.length ? src[j] * (1 - f) + src[j + 1] * f : 0;
      dst[i] = src[i] * (1 - mix * 0.5) + w * mix;
    }
  }
  return out;
}

// ---------------------------------------------------------------- instruments
// Rhodes: two-operator FM at 1:1 (so its overtones are harmonic, round), bright on the strike
// and mellowing, a faint tine, a long decay that is shorter up high, and the suitcase tremolo
// panning it gently side to side.
function rhodes(f, dur, o = {}) {
  const vel = o.vel === undefined ? 0.7 : o.vel, n = Math.ceil(dur * SR), out = stereo(n);
  const decay = o.decay || 1.9 * Math.pow(220 / f, 0.35), rate = o.trem || 4.6, depth = o.tremDepth === undefined ? 0.28 : o.tremDepth;
  const release = Math.min(0.35, dur * 0.3);
  let pc = 0, pm = 0, pt = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, idx = o.wurli ? vel * (1.45 * Math.exp(-t / 0.05) + 0.45) : vel * (1.1 * Math.exp(-t / 0.09) + 0.22);
    pc += 2 * Math.PI * f / SR; pm += 2 * Math.PI * f / SR; pt += 2 * Math.PI * f * 7 / SR;
    const env = smooth(t / 0.003) * Math.exp(-t / decay) * (1 - smooth((t - (dur - release)) / release));
    const reed = o.wurli ? 0.28 * vel * Math.exp(-t / 0.08) * Math.sin(2 * pm) : 0;
    const s = (Math.sin(pc + idx * Math.sin(pm) + reed) + 0.035 * vel * Math.exp(-t / 0.025) * Math.sin(pt)) * env * vel;
    const tr = Math.sin(2 * Math.PI * rate * t);
    out.L[i] = s * (1 - depth * (0.5 + 0.5 * tr)); out.R[i] = s * (1 - depth * (0.5 - 0.5 * tr));
  }
  return out;
}
function rhodesChord(names, dur, o = {}) {
  const out = stereo(Math.ceil((dur + 0.05) * SR));
  names.forEach((nm, k) => {
    const v = rhodes(hz(nm), dur, Object.assign({}, o, {vel: (o.vel || 0.6) * (1 - 0.05 * k)}));
    const off = Math.round((o.roll || 0) * k * SR);
    for (let i = 0; i < v.L.length && i + off < out.L.length; i++) { out.L[i + off] += v.L[i]; out.R[i + off] += v.R[i]; }
  });
  return out;
}

// Celesta: a soft struck glass tone, a sine with a little octave that fades quickly. Round.
function celesta(f, dur, o = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n), decay = o.decay || 0.9;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; p += 2 * Math.PI * f / SR;
    out[i] = (Math.sin(p) + 0.22 * Math.exp(-t / 0.12) * Math.sin(2 * p) + 0.05 * Math.exp(-t / 0.05) * Math.sin(3 * p))
           * smooth(t / 0.002) * Math.exp(-t / decay) * (1 - smooth((t - dur + 0.15) / 0.15));
  }
  return out;
}

// A warm analog pad: per note a few detuned band-limited saws, split across the sides, under a
// 24 dB lowpass whose cutoff can sweep (cut(t) -> Hz), with a little vibrato, then chorused.
function pad(freqs, dur, o = {}) {
  const n = Math.ceil(dur * SR), attack = o.attack || 0.8, release = o.release || 1.5, spread = o.spread || 9;
  const vib = o.vib || 0.0015, r = rng(o.seed || 5), raw = stereo(n);
  const voices = [];
  freqs.forEach(f => [-1, -0.35, 0.35, 1].forEach((d, k) => voices.push({f: f * Math.pow(2, d * spread / 1200), ph: r(), side: k % 2, vr: 4.8 + r()})));
  for (const v of voices) {
    const dst = v.side ? raw.R : raw.L;
    let ph = v.ph;
    for (let i = 0; i < n; i++) {
      const t = i / SR, dt = v.f * (1 + vib * Math.sin(2 * Math.PI * v.vr * t)) / SR;
      ph += dt; if (ph >= 1) ph -= 1;
      let s = 2 * ph - 1;                                            // a saw, with polyBLEP smoothing its edge
      if (ph < dt) { const x = ph / dt; s -= x + x - x * x - 1; } else if (ph > 1 - dt) { const x = (ph - 1) / dt; s -= x * x + x + x + 1; }
      dst[i] += s;
    }
  }
  const cut = o.cut || (() => 1800), out = stereo(n), norm = 2 / voices.length;
  for (const side of ["L", "R"]) {
    let f = lp24(raw[side], cut, o.res || 1.31);
    if (o.formants) {   // the "ooh" pad: two vowel formants over the filtered saws
      const a = biquad(f, "bp", o.formants[0], 5), b = biquad(f, "bp", o.formants[1], 6);
      f = f.map((x, i) => 0.25 * x + 1.6 * a[i] + 1.1 * b[i]);
    }
    for (let i = 0; i < n; i++) out[side][i] = f[i] * norm * envAR(i / SR, dur, attack, release);
  }
  return o.chorus === false ? out : chorus(out);
}

// Round bass: a sine with a touch of its octave, a soft pluck, gliding from note to note.
// line: [[time, "E2"], ...] within dur.
function bass(line, dur, o = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n), glide = o.glide || 0.06;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let k = 0; while (k + 1 < line.length && line[k + 1][0] <= t) k++;
    const f0 = hz(line[Math.max(0, k - 1)][1]), f1 = hz(line[k][1]), since = t - line[k][0];
    const f = k === 0 ? f1 : f0 * Math.pow(f1 / f0, smooth(since / glide));
    p += 2 * Math.PI * f / SR;
    const pluck = o.pluck ? 0.65 + 0.35 * Math.exp(-since / 0.18) : 1;
    const s = Math.sin(p) + 0.22 * Math.sin(2 * p) + 0.05 * Math.sin(3 * p);
    out[i] = Math.tanh(1.3 * s) / 1.3 * pluck * envAR(t, dur, o.attack || 0.02, o.release || 0.5);
  }
  return out;
}

// A round kick: a sine falling fast in pitch, softly saturated.
function kick() {
  const n = Math.ceil(0.4 * SR), out = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = 46 + 90 * Math.exp(-t / 0.035);
    p += 2 * Math.PI * f / SR;
    out[i] = Math.tanh(1.6 * Math.sin(p) * Math.exp(-t / 0.13) * smooth(t / 0.002));
  }
  return out;
}

// A tone gliding from f0 to f1.
function glide(f0, f1, dur, o = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = f0 * Math.pow(f1 / f0, smooth(t / dur));
    p += 2 * Math.PI * f / SR;
    out[i] = (Math.sin(p) + (o.h2 || 0) * Math.sin(2 * p)) * envAR(t, dur, o.attack || 0.02, o.release || dur * 0.6);
  }
  return out;
}

// Noise, white / pink / brown, shaped by env(t).
function noise(dur, color, seed, env) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n), r = rng(seed);
  let b0 = 0, b1 = 0, b2 = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    let v = w;
    if (color === "pink") { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; v = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    else if (color === "brown") { br = (br + 0.02 * w) / 1.02; v = br * 3.5; }
    out[i] = v * (env ? env(i / SR) : 1);
  }
  return out;
}
// A soft whoosh: pink noise through a band sweeping up.
function whoosh(dur, seed, from, to, peakAt) {
  return biquad(noise(dur, "pink", seed, t => smooth(t / peakAt) * (1 - smooth((t - peakAt) / (dur - peakAt)))), "bp", t => from * Math.pow(to / from, smooth(t / dur)), 0.9);
}

// ---------------------------------------------------------------- the hall
// Convolution with a generated hall: decorrelated noise for each side, a short pre-delay and
// a tail that darkens as it dies, so the room is smooth rather than grainy.
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len * (inverse ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function hallIR(seconds, seed, o = {}) {
  const n = Math.ceil(seconds * SR), ir = new Float32Array(n), r = rng(seed), rt60 = o.rt60 || 2.4, pre = Math.round(0.016 * SR);
  let y = 0, e = 0;
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / SR, cut = 900 + 8500 * Math.exp(-t / 0.55), a = 1 - Math.exp(-2 * Math.PI * cut / SR);
    y += a * ((r() * 2 - 1) - y);
    ir[i] = y * Math.exp(-t * 6.91 / rt60) * smooth(t / 0.02);
    e += ir[i] * ir[i];
  }
  const g = 1 / Math.sqrt(e);
  for (let i = 0; i < n; i++) ir[i] *= g;
  return ir;
}
function convolve(x, ir) {
  let N = 1; while (N < x.length + ir.length) N <<= 1;
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  ar.set(x); br.set(ir);
  fft(ar, ai, false); fft(br, bi, false);
  for (let i = 0; i < N; i++) { const r = ar[i] * br[i] - ai[i] * bi[i]; ai[i] = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = r; }
  fft(ar, ai, true);
  return ar.subarray(0, x.length);
}

// The hall, a gentle roll-off of the top, soft saturation, then the peak at peakDb.
function finish(tr, peakDb, o = {}) {
  const wet = o.wet === undefined ? 0.35 : o.wet, irL = hallIR(o.hall || 2.8, 101, o), irR = hallIR(o.hall || 2.8, 202, o);
  const wl = convolve(tr.sL, irL), wr = convolve(tr.sR, irR);
  let peak = 1e-9;
  for (const [side, w] of [["L", wl], ["R", wr]]) {
    const x = tr[side];
    for (let i = 0; i < tr.n; i++) x[i] += w[i] * wet;
    const top = biquad(x, "hp", 7500, 0.6);                 // a softer top end
    for (let i = 0; i < tr.n; i++) { x[i] = Math.tanh((x[i] - 0.4 * top[i]) * 1.1) / 1.1; peak = Math.max(peak, Math.abs(x[i])); }
  }
  const g = Math.pow(10, peakDb / 20) / peak, fade = Math.round(0.1 * SR);
  for (let i = 0; i < tr.n; i++) { const f = i > tr.n - fade ? (tr.n - i) / fade : 1; tr.L[i] *= g * f; tr.R[i] *= g * f; }
  return tr;
}

// ---------------------------------------------------------------- the theme
// Timed to the login intro: 0-1.4 s the mark and the ship's name; 1.4-6.6 s the stroke zooms
// onto the band; 5.3 s the ivory starts dissolving into the Orbital (the bloom).
const MOVE = 1.4, LEN = 5.2, BLOOM = MOVE + 0.75 * LEN;
const CELL = ["E5", "A4", "B5"];
const IV = {bass: "D2", pad: ["D3", "A3", "C#4", "E4", "F#4"], keys: ["F#3", "A3", "C#4", "E4"]};
const V = {bass: "E2", pad: ["E3", "B3", "D4", "F#4", "A4"], keys: ["A3", "B3", "D4", "F#4"]};
const I = {bass: "A1", pad: ["A2", "E3", "G#3", "B3", "C#4", "E4"], keys: ["A2", "G#3", "B3", "C#4", "E4"], strings: ["A4", "C#5", "E5", "G#5", "B5"]};

// Where in time the move covers a share of its way (the arpeggio lands densest where it is fastest).
function moveTime(share) {
  let lo = 0, hi = 1; for (let s = 0; s < 30; s++) { const m = (lo + hi) / 2; if (smoother(m) < share) lo = m; else hi = m; }
  return MOVE + lo * LEN;
}

function theme(flavour) {
  const tr = track(11), disco = flavour === "disco", funk = flavour === "funk";
  // 1. the sparkle: a cascade up the first chord, and a whoosh
  place(tr, whoosh(1.6, 7, 300, 3800, 0.55), 0, 0.5, 0, 0.6);
  ["A4", "C#5", "D5", "E5", "F#5", "A5", "C#6", "E6"].forEach((nm, i) =>
    echoed(tr, celesta(hz(nm), 1.4, {decay: 0.5}), 0.02 + i * 0.048 * (1 - i * 0.04), 0.13, -0.75 + 1.5 * i / 7, 0.55, 1));
  // 2. the warm chord swelling in (IV), its bass under it
  placeSt(tr, pad(notes(IV.pad), 1.9, {attack: 0.55, release: 0.6, cut: t => 450 + 1500 * smooth(t / 1.2), seed: 1}), 0.12, 0.5, 0.45);
  place(tr, bass([[0, IV.bass]], 1.6, {attack: 0.25, release: 0.5}), 0.12, 0.42, 0, 0.1);
  // 3. the chime melody: the cell, on the Rhodes, as the mark appears
  CELL.forEach((nm, i) => placeSt(tr, rhodes(hz(nm), 2.2, {vel: 0.75}), 0.3 + i * 0.36, 0.42, 0.4));
  // 4. the lift (V) through the zoom: the filter sweeps open as the stroke grows
  const sweep = t => 650 * Math.pow(disco ? 9 : 6, smooth(t / (BLOOM - MOVE)));
  placeSt(tr, pad(notes(V.pad), BLOOM - MOVE + 0.35, {attack: 0.7, release: 0.35, cut: sweep, res: disco ? 2.6 : 1.4, seed: 2}), MOVE + 0.05, 0.46, 0.45);
  if (disco) placeSt(tr, pad(notes(["E4", "B4", "F#5"]), BLOOM - MOVE + 0.3, {attack: 1.2, release: 0.3, cut: () => 2400, formants: [420, 1050], seed: 3}), MOVE + 0.5, 0.5, 0.5);
  if (!funk) placeSt(tr, rhodesChord(V.keys, 1.8, {vel: 0.48, roll: 0.012}), MOVE + 0.05, 0.4, 0.4);
  if (funk) {
    // Rhodes chops on the off-beats, a walking bass, and disco strings rising into the bloom
    const beat = 60 / 108 / 4;
    [2, 3, 6, 10, 11, 14, 18, 19, 22, 26].forEach((s, k) => { const t = MOVE + 0.1 + s * beat; if (t < BLOOM - 0.15) placeSt(tr, rhodesChord(V.keys, 0.26, {vel: 0.42 + 0.1 * (k % 2), decay: 0.3}), t, 0.42, 0.3); });
    place(tr, bass([[0, "E2"], [0.56, "G2"], [0.83, "A2"], [1.39, "B2"], [1.67, "D3"], [2.22, "B2"], [2.5, "A2"], [3.05, "G2"], [3.35, "E2"]], BLOOM - MOVE + 0.1, {pluck: true, glide: 0.04, release: 0.1}), MOVE + 0.1, 0.48, 0, 0.08);
    placeSt(tr, pad(notes(["E4", "B4", "D5"]).map(f => f), 0.75, {attack: 0.6, release: 0.1, cut: t => 1500 + 3000 * t, spread: 6, seed: 4}), BLOOM - 0.7, 0.35, 0.4);
  } else {
    place(tr, bass([[0, V.bass]], BLOOM - MOVE, {attack: 0.3, release: 0.25}), MOVE + 0.05, 0.42, 0, 0.1);
  }
  if (disco) {
    // a soft four-on-the-floor heartbeat under the zoom, growing, landing on the bloom
    const beat = 0.5; for (let t = MOVE + 0.4; t < BLOOM - 0.05; t += beat) place(tr, kick(), t, 0.25 + 0.3 * smooth((t - MOVE) / (BLOOM - MOVE)), 0, 0.05);
    for (let t = MOVE + 0.65; t < BLOOM - 0.2; t += beat) place(tr, biquad(noise(0.12, "white", Math.round(t * 100), x => Math.exp(-x / 0.03)), "hp", 8000, 0.7), t, 0.05, 0.3, 0.2);
  }
  // the ripple: glass notes climbing, densest where the move is fastest
  ["B4", "D5", "E5", "F#5", "A5", "B5", "D6", "E6"].forEach((nm, i, all) =>
    echoed(tr, celesta(hz(nm), 1.2, {decay: 0.45}), moveTime((i + 0.5) / all.length * 0.9), funk ? 0.06 : 0.085, -0.6 + 1.2 * i / 7, 0.6, 1));
  // 5. the bloom (I): the chord on the Rhodes, strings, the bass landing, the chime answering
  placeSt(tr, rhodesChord(I.keys, 4.5, {vel: 0.68, roll: 0.018}), BLOOM, 0.5, 0.5);
  placeSt(tr, pad(notes(I.pad), 5.2, {attack: 0.18, release: 3.6, cut: t => 3200 - 1900 * smooth(t / 3.5), seed: 6}), BLOOM - 0.05, 0.5, 0.5);
  placeSt(tr, pad(notes(I.strings), 5, {attack: 0.45, release: 3.4, cut: t => 4200 - 2200 * smooth(t / 4), spread: 7, vib: 0.0025, seed: 8}), BLOOM, 0.3, 0.65);
  if (disco) placeSt(tr, pad(notes(["E4", "C#5", "G#5"]), 4.6, {attack: 0.3, release: 3.4, cut: () => 2400, formants: [420, 1050], seed: 9}), BLOOM, 0.45, 0.6);
  place(tr, bass([[0, "E1"], [0.1, "A1"]], 4.4, {glide: 0.09, attack: 0.01, release: 3.2}), BLOOM - 0.1, 0.55, 0, 0.1);
  if (disco) place(tr, kick(), BLOOM, 0.55, 0, 0.05);
  ["C#6", "E6"].forEach((nm, i) => echoed(tr, celesta(hz(nm), 2.6, {decay: 1.1}), BLOOM + 0.32 + i * 0.36, 0.16, i ? 0.35 : -0.2, 0.7, 2));
  place(tr, biquad(noise(2.2, "pink", 11, t => smooth(t / 0.3) * Math.exp(-t / 0.7)), "bp", 6000, 0.6), BLOOM, 0.12, 0, 0.9);
  return finish(tr, -5, {wet: 0.38});
}


// ---------------------------------------------------------------- the way in: digital
// An homage to Daft Punk's Digital Love, in sound and feel (the notes are its own): a filtered
// disco loop at 125 BPM, Wurlitzer chords pulsing in swung eighths, a vocoder-ish "ooh" pad
// pumping against a soft four-on-the-floor, claps on two and four, an octave-jumping bass, and
// a bright, round synth run climbing like that famous solo. The bar lines are set so a
// downbeat lands on the bloom: the mark hears a muffled pickup and the cell on the Wurlitzer;
// the zoom opens the filter as the drums come in over Dmaj9, C#m9, Bm9, E9sus; the bloom is
// Amaj9 wide open, the lead holding the cell's resolution; one more bar, then the filter closes.
function clap() {
  const n = Math.ceil(0.3 * SR), raw = new Float32Array(n), r = rng(61);
  for (let i = 0; i < n; i++) {
    const t = i / SR, hits = [0, 0.011, 0.023].reduce((a, h) => a + (t >= h ? Math.exp(-(t - h) / (h === 0.023 ? 0.09 : 0.006)) : 0), 0);
    raw[i] = (r() * 2 - 1) * hits;
  }
  return biquad(biquad(raw, "bp", 1150, 0.9), "hp", 500, 0.7);
}
function hat(seed) { return biquad(noise(0.08, "white", seed, t => Math.exp(-t / 0.018)), "hp", 7000, 0.7); }
// A round lead: a pulse (two band-limited saws, one shifted) gliding between notes, softened by
// a lowpass, with a little vibrato. line: [[time, "E5", length], ...].
function lead(line, dur, o = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n), width = o.width || 0.32;
  const saw = (ph, dt) => { let s = 2 * ph - 1; if (ph < dt) { const x = ph / dt; s -= x + x - x * x - 1; } else if (ph > 1 - dt) { const x = (ph - 1) / dt; s -= x * x + x + x + 1; } return s; };
  let ph = 0, f = hz(line[0][1]);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let k = -1; for (let j = 0; j < line.length; j++) if (line[j][0] <= t) k = j;
    let amp = 0;
    if (k >= 0) {
      const [t0, nm, len] = line[k], since = t - t0, target = hz(nm);
      f += (target - f) * (1 - Math.exp(-1 / (SR * 0.012)));                // portamento
      amp = since < len ? smooth(since / 0.006) * (1 - smooth((since - len + 0.04) / 0.04)) : 0;
    }
    const vf = f * (1 + 0.004 * smooth((t - (line[Math.max(k, 0)][0])) / 0.25) * Math.sin(2 * Math.PI * 5.5 * t)), dt = vf / SR;
    ph += dt; if (ph >= 1) ph -= 1;
    let p2 = ph + width; if (p2 >= 1) p2 -= 1;
    out[i] = (saw(ph, dt) - saw(p2, dt)) * 0.5 * amp;
  }
  return lp24(out, o.cut || 2600);
}

function themeDigital() {
  const tr = track(11), loop = track(11), pump = track(11);
  const BPM = 125, beat = 60 / BPM, down = BLOOM - 8 * beat;          // bar 1's downbeat: the bloom is bar 3's
  const at = k => down + k * beat, swing = 0.035;                      // beat k from bar 1; upbeats swung late
  const chords = [
    {from: -4, to: 2, keys: ["F#3", "A3", "C#4", "E4"], pad: ["F#4", "A4", "E5"], root: "D2"},
    {from: 2, to: 4, keys: ["E3", "G#3", "B3", "D#4"], pad: ["E4", "G#4", "D#5"], root: "C#2"},
    {from: 4, to: 6, keys: ["D3", "F#3", "A3", "C#4"], pad: ["D4", "F#4", "C#5"], root: "B1"},
    {from: 6, to: 8, keys: ["D3", "F#3", "A3", "B3"], pad: ["D4", "A4", "B4"], root: "E2"},
    {from: 8, to: 16, keys: ["G#3", "B3", "C#4", "E4"], pad: ["G#4", "C#5", "E5"], root: "A1"},
  ];
  const chordAt = k => chords.find(c => k >= c.from && k < c.to);

  // the loop: Wurlitzer chords in swung eighths, from the pickup to the end
  for (let k = -3; k < 16; k += 0.5) {
    const c = chordAt(Math.floor(k)), up = k % 1 !== 0, t = at(k) + (up ? swing : 0);
    if (t < 0) continue;
    const fade = k >= 12 ? 1 - (k - 12) / 4 : 1;
    placeSt(loop, rhodesChord(c.keys, 0.42, {wurli: true, vel: (up ? 0.36 : 0.5) * fade, decay: 0.3, trem: 5.6, tremDepth: 0.16, roll: 0.004}), t, 0.5, 0.35);
  }
  // the "ooh" pad, one per chord, pumping against the kick
  for (const c of chords) {
    const t0 = Math.max(0, at(c.from)), len = at(Math.min(c.to, 14)) - t0 + 0.25;
    placeSt(pump, pad(notes(c.pad), len, {attack: 0.25, release: 0.3, cut: () => 2600, formants: [430, 1080], seed: 31 + c.from}), t0, 0.5, 0.45);
  }
  // the bass: root on the beat, its octave on the swung upbeat, from bar 1
  const bl = [];
  for (let k = 0; k < 15; k += 0.5) {
    const c = chordAt(Math.floor(k)), up = k % 1 !== 0, root = c.root, oct = root.replace(/\d/, d => +d + 1);
    bl.push([at(k) + (up ? swing : 0) - at(0), up ? oct : root]);
  }
  place(loop, bass(bl, at(15) - at(0), {pluck: true, glide: 0.018, attack: 0.01, release: 0.4}), at(0), 0.62, 0, 0.08);
  // drums: a soft four-on-the-floor, hats on the upbeats, claps on two and four
  const kicks = [];
  for (let k = 0; k < 16; k++) {
    const g = k >= 12 ? 1 - (k - 12) / 4.5 : 1;
    place(loop, kick(), at(k), 0.62 * g, 0, 0.04); kicks.push(at(k));
    place(loop, hat(70 + k), at(k + 0.5) + swing, 0.07 * g, 0.25, 0.15);
    if (k % 2 === 1) place(loop, clap(), at(k), 0.3 * g, -0.05, 0.35);
  }
  // the pump: the pad ducks under each kick and swells back
  const duck = t => { let d = 0; for (const kt of kicks) if (t >= kt && t - kt < 0.4) d = Math.max(d, smooth((t - kt) / 0.006) * Math.exp(-(t - kt) / 0.13)); return 1 - 0.55 * d; };
  for (const side of ["L", "R", "sL", "sR"]) for (let i = 0; i < pump.n; i++) pump[side][i] *= duck(i / SR);
  // the filter over the loop and the pad: muffled for the mark, sweeping open through the zoom,
  // wide at the bloom, closing again at the end
  const cut = t => t < MOVE ? 420 : t < BLOOM ? 600 * Math.pow(14, smooth((t - MOVE) / (BLOOM - MOVE))) : t < at(12) ? 11000 : 11000 * Math.pow(0.05, smooth((t - at(12)) / (at(16) - at(12))));
  for (const bus of [loop, pump]) {
    for (const side of ["L", "R", "sL", "sR"]) bus[side] = lp24(bus[side], cut, 1.9);
    for (const side of ["L", "R", "sL", "sR"]) for (let i = 0; i < tr.n; i++) tr[side][i] += bus[side][i] * smooth(i / SR / 0.35);
  }
  // the cell on the Wurlitzer, clear over the muffled pickup, as the mark appears
  [["E5", -2.5], ["A4", -2], ["B5", -1]].forEach(([nm, k]) => placeSt(tr, rhodes(hz(nm), 1.6, {wurli: true, vel: 0.72, trem: 5.6, tremDepth: 0.18}), at(k) + (k % 1 ? swing : 0), 0.46, 0.4));
  // the run, climbing through the last two beats before the bloom, then the lead holds the
  // cell's resolution, C#, and settles on A
  const run = ["E4", "F#4", "A4", "B4", "D5", "E5", "F#5", "A5", "B5", "D6", "E6"];
  const step = (2 * beat) / (run.length + 1), line = run.map((nm, i) => [at(6) + i * step, nm, step * 0.95]);
  line.push([BLOOM, "C#6", 0.85], [BLOOM + 0.96, "B5", 0.2], [BLOOM + 1.2, "A5", 1.1]);
  const ld = lead(line.map(([t, nm, len]) => [t - at(6), nm, len]), BLOOM + 2.6 - at(6), {cut: 2800});
  const ldst = chorus({L: ld, R: ld.slice()}, {mix: 0.6, depth: 0.003});
  placeSt(tr, ldst, at(6), 0.3, 0.45);
  echoed(tr, celesta(hz("E6"), 2, {decay: 0.9}), BLOOM + 0.02, 0.1, 0.3, 0.7, 2);
  // the bloom: a soft swell of air, the sub landing on A
  place(tr, biquad(noise(2, "pink", 91, t => smooth(t / 0.2) * Math.exp(-t / 0.6)), "bp", 5200, 0.6), BLOOM, 0.14, 0, 0.9);
  place(tr, glide(hz("E1"), hz("A1"), 2.6, {attack: 0.02, release: 2, h2: 0.25}), BLOOM, 0.34, 0, 0.1);
  return finish(tr, -5, {wet: 0.3});
}

// ---------------------------------------------------------------- ships, signals, sky
function arrive() {   // a session comes alongside: a soft whoosh, a warm swell, the cell's first two notes
  const tr = track(4.5);
  place(tr, whoosh(1.4, 3, 250, 2400, 0.5), 0, 0.3, 0.2, 0.6);
  placeSt(tr, pad(notes(["D3", "A3", "E4", "F#4"]), 2.2, {attack: 0.5, release: 1.4, cut: t => 600 + 1400 * smooth(t / 0.8), seed: 21}), 0, 0.42, 0.45);
  echoed(tr, celesta(hz("E5"), 1.6, {decay: 0.7}), 0.32, 0.3, -0.2, 0.5, 1);
  echoed(tr, celesta(hz("A4"), 1.8, {decay: 0.8}), 0.62, 0.3, 0.15, 0.5, 1);
  return finish(tr, -14);
}
function needsYou() {  // waiting on you: the cell on the Rhodes, rising to the sharp fourth and holding there, asking
  const tr = track(4.5);
  placeSt(tr, rhodes(hz("E5"), 1.4, {vel: 0.7}), 0, 0.45, 0.4);
  placeSt(tr, rhodes(hz("A4"), 1.4, {vel: 0.7}), 0.24, 0.45, 0.4);
  placeSt(tr, rhodes(hz("D#5"), 2.6, {vel: 0.78, decay: 1.6}), 0.48, 0.5, 0.45);
  placeSt(tr, pad(notes(["B2", "F#3", "A3", "D#4"]), 2.6, {attack: 0.35, release: 1.6, cut: () => 1100, seed: 22}), 0.45, 0.26, 0.4);
  return finish(tr, -12);
}
function done() {     // a turn finished: the cell resolved, quick and bright, then the home chord
  const tr = track(3.8);
  ["A4", "E5", "C#6"].forEach((nm, i) => placeSt(tr, rhodes(hz(nm), 1.1, {vel: 0.65, decay: 0.7}), i * 0.075, 0.45, 0.35));
  placeSt(tr, rhodesChord(["A3", "G#4", "B4", "C#5"], 2, {vel: 0.42, roll: 0.01}), 0.22, 0.4, 0.45);
  echoed(tr, celesta(hz("E6"), 1.4, {decay: 0.6}), 0.24, 0.12, 0.3, 0.6, 1);
  return finish(tr, -15);
}
function depart() {   // a session ends: the cell turned round, in glass, drifting off
  const tr = track(4.8);
  ["B5", "E5", "A4"].forEach((nm, i) => echoed(tr, celesta(hz(nm), 2, {decay: 0.8 + 0.25 * i}), i * 0.3, 0.3 - 0.06 * i, 0.3 - 0.25 * i, 0.65, 1));
  placeSt(tr, pad(notes(["A2", "E3", "C#4"]), 2.6, {attack: 0.6, release: 1.8, cut: t => 1400 - 900 * smooth(t / 2), seed: 23}), 0.2, 0.3, 0.5);
  return finish(tr, -17);
}
function swept() {      // low urgency: one faint glass ping, far off
  const tr = track(2.4);
  echoed(tr, celesta(hz("E6"), 1.2, {decay: 0.4}), 0, 0.4, 0.2, 0.7, 1);
  return finish(tr, -22);
}
function tightPoint() { // normal: a two-ping transmission, B to E
  const tr = track(2.6);
  echoed(tr, celesta(hz("B5"), 1.2, {decay: 0.35}), 0, 0.4, -0.15, 0.5, 1);
  echoed(tr, celesta(hz("E6"), 1.2, {decay: 0.45}), 0.1, 0.4, 0.2, 0.5, 1);
  return finish(tr, -16);
}
function broadcast() {  // critical: three pings over a low Rhodes, to be noticed
  const tr = track(3.6);
  placeSt(tr, rhodes(hz("A3"), 2.6, {vel: 0.85}), 0, 0.6, 0.35);
  ["A5", "E6", "A6"].forEach((nm, i) => echoed(tr, celesta(hz(nm), 1.2, {decay: 0.35}), 0.04 + i * 0.12, 0.34, -0.2 + 0.2 * i, 0.45, 1));
  return finish(tr, -11);
}
function thunder() {   // distant thunder after the flash: a low rumble in rolls
  const tr = track(6.5), r = rng(29), rolls = [0, 0.55, 1.3, 2.2].map(t => ({t: t + r() * 0.2, a: 0.5 + r() * 0.5}));
  const env = t => rolls.reduce((s, b) => s + (t > b.t ? b.a * smooth((t - b.t) / 0.15) * Math.exp(-(t - b.t) / 1.0) : 0), 0);
  place(tr, lp24(noise(6, "brown", 13, env), t => 150 - 70 * smooth(t / 4)), 0, 1, -0.1, 0.35);
  place(tr, lp24(noise(6, "pink", 17, t => 0.25 * env(t)), 420), 0, 0.5, 0.2, 0.5);
  return finish(tr, -12, {wet: 0.3});
}
// id, group, name, when it plays, render
const MOTIFS = [
  ["theme", "Theme", "The way in: boot", "At login, with the intro. Closest to the Windows 95 startup's shape: a sparkle, a warm chord swelling in, the cell as a chime melody, a lift, a bloom that rings out.", () => theme("boot")],
  ["theme-disco", "Theme", "The way in: disco", "The same skeleton, leaning Interstella 5555: a resonant filter sweep opening through the zoom, an \"ooh\" pad, and a soft four-on-the-floor heartbeat that lands on the bloom.", () => theme("disco")],
  ["theme-funk", "Theme", "The way in: funk", "The same skeleton, leaning Jamiroquai: Rhodes chops on the off-beats, a walking bass, and disco strings rising into the bloom.", () => theme("funk")],
  ["theme-digital", "Theme", "The way in: digital", "An homage to Daft Punk's Digital Love, in sound and feel: a filtered disco loop at 125 BPM, Wurlitzer chords in swung eighths, an \"ooh\" pad pumping against the kick, claps, an octave bass, and a bright round run climbing into the bloom as the filter opens.", themeDigital],
  ["arrive", "Ships", "Comes alongside", "A Claude Code session starts.", arrive],
  ["needs-you", "Ships", "Needs you", "A session is waiting on a permission prompt or a question.", needsYou],
  ["done", "Ships", "Holding", "A session finishes its turn: your move.", done],
  ["depart", "Ships", "Leaves", "A session ends.", depart],
  ["swept", "Signals", "Swept, M4", "A low-urgency notification.", swept],
  ["tight-point", "Signals", "Tight point, M16", "A normal notification.", tightPoint],
  ["broadcast", "Signals", "Broadcast, M32", "A critical notification.", broadcast],
  ["thunder", "Sky", "Thunder", "A second or few after each lightning strike in a real thunderstorm, while the desktop shows.", thunder],
].map(([id, group, name, when, render]) => ({id, group, name, when, render}));

module.exports = {SR, MOTIFS};

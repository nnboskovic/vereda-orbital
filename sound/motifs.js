// Vereda Orbital's sounds, every one synthesised here from code (no samples), in the palette of
// veredalabs.dev's own sound: FM bells, a low A hum, air, and a long soft room.
//
// One cell runs through all of them, shaped like the Vereda mark: a short drop then a long rise,
// E5 - A4 - B5 (the fifth, down to the home note, up past the octave to the ninth). The theme
// opens with it; the ships answer with it resolved (done), questioning (needs you) or turned
// round (leaving); signals and the sky borrow its notes. A major with a Lydian sharp fourth,
// the open, unhurried sound of the Culture.
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
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const smoother = k => k * k * k * (k * (k * 6 - 15) + 10);

// A stereo track: dry and a send to the room, mixed and normalised at the end.
function track(seconds) {
  const n = Math.ceil(seconds * SR);
  return {n, L: new Float32Array(n), R: new Float32Array(n), sL: new Float32Array(n), sR: new Float32Array(n)};
}
// Place a mono voice at time t (s), pan -1..1, with a share of it sent to the room.
function place(tr, voice, t, gain, pan, send) {
  const o = Math.round(t * SR), l = Math.cos((pan + 1) * Math.PI / 4) * gain, r = Math.sin((pan + 1) * Math.PI / 4) * gain;
  for (let i = 0; i < voice.length; i++) {
    const j = o + i; if (j < 0 || j >= tr.n) continue;
    const v = voice[i];
    tr.L[j] += v * l; tr.R[j] += v * r; tr.sL[j] += v * l * send; tr.sR[j] += v * r * send;
  }
}

// ---------------------------------------------------------------- voices
// An FM bell: bright as it is struck, mellowing as it rings, with a faint inharmonic partial.
function bell(f, dur, o = {}) {
  const ratio = o.ratio || 1.4, index = o.index === undefined ? 1.2 : o.index, attack = o.attack || 0.004;
  const n = Math.ceil(dur * SR), out = new Float32Array(n), decay = o.decay || dur * 0.45;
  let pc = 0, pm = 0, pp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = Math.min(1, t / attack) * Math.exp(-t / decay), idx = index * Math.exp(-t / (decay * 0.35));
    pm += 2 * Math.PI * f * ratio / SR; pc += 2 * Math.PI * f / SR; pp += 2 * Math.PI * f * 2.76 / SR;
    out[i] = env * (Math.sin(pc + idx * Math.sin(pm)) + 0.08 * Math.exp(-t / 0.4) * Math.sin(pp));
  }
  return out;
}

// A soft pad: each note a few detuned sines (with a little third harmonic, so laptop speakers
// carry it), a slow swell, and a lowpass that can open over time (cut(t) -> Hz).
function pad(freqs, dur, o = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n), attack = o.attack || 1.5, release = o.release || 2;
  const cut = o.cut || (() => 4000), voices = [];
  freqs.forEach((f, k) => [-4, 0, 4].forEach(c => voices.push({f: f * Math.pow(2, c / 1200), p: k * 1.7 + c})));
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = smooth(t / attack) * (1 - smooth((t - (dur - release)) / release));
    let s = 0;
    for (const v of voices) { v.p += 2 * Math.PI * v.f / SR; s += Math.sin(v.p) + 0.18 * Math.sin(3 * v.p); }
    const a = 1 - Math.exp(-2 * Math.PI * cut(t) / SR);
    y += a * (s / voices.length - y);
    out[i] = y * env;
  }
  return out;
}

// A tone gliding from f0 to f1 (exponential), with its own envelope.
function glide(f0, f1, dur, o = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n), attack = o.attack || 0.01, release = o.release || dur * 0.6;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = f0 * Math.pow(f1 / f0, t / dur);
    p += 2 * Math.PI * f / SR;
    out[i] = (Math.sin(p) + (o.h3 || 0) * Math.sin(3 * p)) * smooth(t / attack) * (1 - smooth((t - (dur - release)) / release));
  }
  return out;
}

// RBJ biquad, with coefficients recomputed every 32 samples when the cutoff moves.
function biquad(input, type, freq, q) {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0, b1, b2, a1, a2;
  const coef = f => {
    const w = 2 * Math.PI * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
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

// Noise, white / pink / brown, shaped by an envelope env(t) (0..1).
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

// ---------------------------------------------------------------- the room
// Freeverb (Schroeder-Moorer): eight damped combs and four allpasses a channel, a long soft room.
function room(tr, o = {}) {
  const size = o.size || 0.86, damp = o.damp || 0.32, wet = o.wet === undefined ? 0.5 : o.wet, sc = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], alls = [556, 441, 341, 225];
  const run = (input, spread) => {
    const out = new Float32Array(input.length);
    const cs = combs.map(d => ({b: new Float32Array(Math.round((d + spread) * sc)), i: 0, f: 0}));
    const as = alls.map(d => ({b: new Float32Array(Math.round((d + spread) * sc)), i: 0}));
    for (let n = 0; n < input.length; n++) {
      const x = input[n] * 0.015;
      let s = 0;
      for (const c of cs) {
        const y = c.b[c.i]; c.f = y * (1 - damp) + c.f * damp; c.b[c.i] = x + c.f * size; c.i = (c.i + 1) % c.b.length; s += y;
      }
      for (const a of as) { const y = a.b[a.i]; a.b[a.i] = s + y * 0.5; s = y - s; a.i = (a.i + 1) % a.b.length; }
      out[n] = s;
    }
    return out;
  };
  const wl = run(tr.sL, 0), wr = run(tr.sR, 23);
  for (let i = 0; i < tr.n; i++) { tr.L[i] += wl[i] * wet; tr.R[i] += wr[i] * wet; }
}

// Room, a gentle limiter, then the peak set to peakDb and a short fade at the very end.
function finish(tr, peakDb, roomOpts) {
  room(tr, roomOpts);
  let peak = 1e-9;
  for (let i = 0; i < tr.n; i++) { tr.L[i] = Math.tanh(tr.L[i] * 1.2) / 1.2; tr.R[i] = Math.tanh(tr.R[i] * 1.2) / 1.2; peak = Math.max(peak, Math.abs(tr.L[i]), Math.abs(tr.R[i])); }
  const g = Math.pow(10, peakDb / 20) / peak, fade = Math.round(0.08 * SR);
  for (let i = 0; i < tr.n; i++) {
    const f = i > tr.n - fade ? (tr.n - i) / fade : 1;
    tr.L[i] *= g * f; tr.R[i] *= g * f;
  }
  return tr;
}

// ---------------------------------------------------------------- the motifs
const CELL = ["E5", "A4", "B5"];

// The way in: timed to the login intro. 0-1.4 s the mark and the ship's name: the hum swells
// and the cell rings out. 1.4-6.6 s the stroke turns and zooms onto the band: a rising
// arpeggio, densest where the move is fastest, over a pad that opens with it. 5.3 s, as the
// ivory dissolves into the Orbital: the chord blooms (Lydian, the sharp fourth on top) and
// everything settles into the room.
function theme() {
  const tr = track(11), move0 = 1.4, moveLen = 5.2, bloom = move0 + 0.75 * moveLen;
  // the hum, swelling with the mark and again at the bloom
  place(tr, pad(["A1", "A2", "E3"].map(hz), 10.5, {attack: 1.4, release: 4, cut: t => 300 + 900 * smooth((t - bloom + 1) / 2)}), 0, 0.55, 0, 0.2);
  // air, rising with the move
  place(tr, biquad(noise(9.5, "pink", 7, t => smooth(t / 1.5) * (0.35 + 0.65 * smooth((t - move0) / 4)) * (1 - smooth((t - bloom - 0.8) / 3.2))),
                   "bp", t => 380 + 1600 * smooth((t - move0) / 4.2), 0.7), 0, 0.22, 0, 0.6);
  // the cell as the mark appears: V-shaped, from the short stroke's side to the long one's
  CELL.forEach((n, i) => place(tr, bell(hz(n), 4, {index: 1.1, decay: 1.6}), 0.3 + i * 0.36, 0.34, [-0.35, -0.1, 0.4][i], 0.55));
  // the rising arpeggio, one note each time the move covers another ninth of its way
  const arp = ["A3", "E4", "B4", "C#5", "E5", "G#5", "B5", "D#6", "E6"];
  arp.forEach((n, i) => {
    const target = (i + 0.6) / (arp.length + 0.4);
    let lo = 0, hi = 1; for (let s = 0; s < 30; s++) { const m = (lo + hi) / 2; if (smoother(m) < target) lo = m; else hi = m; }
    place(tr, bell(hz(n), 3, {index: 0.75, decay: 1.1}), move0 + lo * moveLen, 0.16 + 0.04 * (i / arp.length), -0.6 + 1.2 * i / (arp.length - 1), 0.7);
  });
  // the pad opening with the move, and gaining the Lydian colour at the bloom
  place(tr, pad(["A3", "E4", "B4", "C#5"].map(hz), 8.5, {attack: 2.4, release: 3.4, cut: t => 350 + 2600 * smooth(t / 4)}), move0, 0.42, 0, 0.5);
  place(tr, pad(["A2", "D#5", "G#5", "E5"].map(hz), 5.5, {attack: 0.35, release: 3.8, cut: t => 2400 - 1400 * smooth(t / 4)}), bloom - 0.15, 0.4, 0, 0.6);
  // the bloom: the chord struck softly, a shimmer, and the sub swelling under it
  ["A4", "E5", "C#6"].forEach((n, i) => place(tr, bell(hz(n), 5, {index: 0.6, decay: 2.2}), bloom + i * 0.025, 0.2, [-0.3, 0.1, 0.35][i], 0.75));
  place(tr, biquad(noise(2.4, "white", 11, t => smooth(t / 0.25) * Math.exp(-t / 0.7)), "hp", 6500, 0.7), bloom, 0.07, 0, 0.9);
  place(tr, glide(hz("A1") * 1.5, hz("A1"), 3.5, {attack: 0.4, release: 2.6, h3: 0.25}), bloom - 0.1, 0.5, 0, 0.1);
  return finish(tr, -5, {wet: 0.55});
}

// Ships: Claude Code sessions, moored alongside.
function arrive() {   // a session starts: a soft swell, and the cell's first two notes
  const tr = track(4);
  place(tr, glide(hz("A2"), hz("A1"), 1.6, {attack: 0.15, release: 1.2, h3: 0.3}), 0, 0.5, 0, 0.3);
  place(tr, biquad(noise(1.2, "white", 3, t => smooth(t / 0.1) * Math.exp(-t / 0.35)), "hp", 5000, 0.7), 0.05, 0.05, 0.3, 0.9);
  place(tr, bell(hz("E5"), 3, {index: 0.9, decay: 1.2}), 0.25, 0.3, -0.2, 0.6);
  place(tr, bell(hz("A4"), 3, {index: 0.9, decay: 1.2}), 0.52, 0.3, 0.1, 0.6);
  return finish(tr, -14);
}
function needsYou() {  // waiting on you: the cell, but it rises to the sharp fourth and asks
  const tr = track(4);
  place(tr, bell(hz("E5"), 3, {index: 0.7, ratio: 2, decay: 1.1}), 0, 0.32, -0.2, 0.55);
  place(tr, bell(hz("A4"), 3, {index: 0.7, ratio: 2, decay: 1.1}), 0.24, 0.32, 0, 0.55);
  place(tr, bell(hz("D#5"), 3.2, {index: 0.9, ratio: 2, decay: 1.5}), 0.48, 0.36, 0.25, 0.6);
  return finish(tr, -12);
}
function done() {     // a turn finished: the cell resolved, quick and bright, up to the major third
  const tr = track(3.5);
  ["A4", "E5", "C#6"].forEach((n, i) => place(tr, bell(hz(n), 2.6, {index: 1.4, decay: 0.9}), i * 0.085, 0.3, -0.2 + 0.25 * i, 0.5));
  return finish(tr, -15);
}
function depart() {   // a session ends: the cell turned round, softening as it goes
  const tr = track(4.5);
  ["B5", "E5", "A4"].forEach((n, i) => place(tr, bell(hz(n), 3, {index: 0.6, decay: 1.2 + 0.3 * i}), i * 0.3, 0.3 - 0.06 * i, 0.3 - 0.25 * i, 0.7));
  return finish(tr, -17);
}

// Signals: notifications, by their transmission (see the signal-traffic header).
function swept() {      // low urgency: one faint pip, far off
  const tr = track(2.2);
  place(tr, bell(hz("E6"), 1.6, {index: 0.3, decay: 0.35}), 0, 0.4, 0.2, 0.8);
  return finish(tr, -22);
}
function tightPoint() { // normal: a two-pip transmission, B to E
  const tr = track(2.4);
  place(tr, bell(hz("B5"), 1.6, {index: 0.5, ratio: 2, decay: 0.3}), 0, 0.4, -0.1, 0.55);
  place(tr, bell(hz("E6"), 1.6, {index: 0.5, ratio: 2, decay: 0.38}), 0.11, 0.4, 0.15, 0.55);
  return finish(tr, -16);
}
function broadcast() {  // critical: three pips over a low bell, to be noticed
  const tr = track(3.4);
  place(tr, bell(hz("A3"), 3, {index: 1.4, decay: 1.2}), 0, 0.45, 0, 0.4);
  ["A5", "E6", "A6"].forEach((n, i) => place(tr, bell(hz(n), 1.6, {index: 0.6, ratio: 2, decay: 0.32}), 0.04 + i * 0.12, 0.38, -0.2 + 0.2 * i, 0.45));
  return finish(tr, -11);
}

// The sky.
function thunder() {   // distant thunder, after the flash: a low rumble in rolls
  const tr = track(6), r = rng(29), rolls = [0, 0.55, 1.3, 2.2].map(t => ({t: t + r() * 0.2, a: 0.5 + r() * 0.5}));
  const env = t => rolls.reduce((s, b) => s + (t > b.t ? b.a * smooth((t - b.t) / 0.12) * Math.exp(-(t - b.t) / 0.9) : 0), 0);
  place(tr, biquad(noise(5.5, "brown", 13, env), "lp", t => 180 - 90 * smooth(t / 4), 0.7), 0, 1, -0.1, 0.35);
  place(tr, biquad(noise(5.5, "pink", 17, t => 0.3 * env(t)), "bp", 420, 0.9), 0, 0.5, 0.2, 0.5);
  return finish(tr, -12, {wet: 0.4});
}
function meteor() {    // a meteor: a faint falling whistle and hiss, crossing
  const tr = track(2);
  const w = glide(3300, 1500, 0.55, {attack: 0.08, release: 0.35});
  const h = biquad(noise(0.6, "white", 5, t => smooth(t / 0.08) * (1 - smooth((t - 0.3) / 0.3))), "hp", 6000, 0.7);
  place(tr, w, 0, 0.18, -0.4, 0.9); place(tr, w, 0.004, 0.18, 0.4, 0.9);
  place(tr, h, 0, 0.12, 0, 0.9);
  return finish(tr, -24);
}
function fireball() {  // a Taurid fireball: lower, slower, crackling, and a far-off thump
  const tr = track(4), r = rng(41);
  place(tr, glide(900, 260, 1.3, {attack: 0.1, release: 0.8, h3: 0.2}), 0, 0.3, -0.3, 0.7);
  const crackle = new Float32Array(Math.ceil(1.3 * SR));
  for (let i = 0; i < crackle.length; i++) if (r() < 0.0035) crackle[i] = (r() * 2 - 1) * (1 - i / crackle.length);
  place(tr, biquad(crackle, "bp", 2400, 1.2), 0.05, 2.2, 0.2, 0.6);
  place(tr, glide(hz("A1"), 40, 1.4, {attack: 0.02, release: 1.2, h3: 0.4}), 1.25, 0.45, 0, 0.5);
  return finish(tr, -16);
}

// id, group, name, when it plays, render
const MOTIFS = [
  ["theme", "Theme", "The way in", "At login, with the intro: the mark, its name, the zoom onto the band and the bloom as it dissolves into the Orbital.", theme],
  ["arrive", "Ships", "Comes alongside", "A Claude Code session starts.", arrive],
  ["needs-you", "Ships", "Needs you", "A session is waiting on a permission prompt or a question.", needsYou],
  ["done", "Ships", "Holding", "A session finishes its turn: your move.", done],
  ["depart", "Ships", "Leaves", "A session ends.", depart],
  ["swept", "Signals", "Swept, M4", "A low-urgency notification.", swept],
  ["tight-point", "Signals", "Tight point, M16", "A normal notification.", tightPoint],
  ["broadcast", "Signals", "Broadcast, M32", "A critical notification.", broadcast],
  ["thunder", "Sky", "Thunder", "A second or few after each lightning strike in a real thunderstorm, while the desktop shows.", thunder],
  ["meteor", "Sky", "Meteor", "A meteor crossing, on the real shower calendar.", meteor],
  ["fireball", "Sky", "Fireball", "The odd slow fireball (the Taurids are known for them).", fireball],
].map(([id, group, name, when, render]) => ({id, group, name, when, render}));

module.exports = {SR, MOTIFS};

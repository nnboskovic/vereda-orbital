#!/usr/bin/env node
// Renders every motif in motifs.js to a 16-bit stereo WAV in sound/out/, plus motifs.json
// listing them (for the desktop and the listening page).  node sound/render.js [id ...]
const fs = require("fs"), path = require("path");
const {SR, MOTIFS} = require("./motifs.js");

const out = path.join(__dirname, "out");
fs.mkdirSync(out, {recursive: true});
const only = process.argv.slice(2);

function wav(tr) {
  const n = tr.n, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, tr.L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, tr.R[i])) * 32767), 46 + i * 4);
  }
  return buf;
}

const list = [];
for (const m of MOTIFS) {
  const file = m.id + ".wav";
  if (!only.length || only.includes(m.id)) {
    const t0 = Date.now(), tr = m.render();
    fs.writeFileSync(path.join(out, file), wav(tr));
    console.log(`${m.id.padEnd(12)} ${(tr.n / SR).toFixed(1)} s  ${Date.now() - t0} ms`);
  }
  list.push({id: m.id, group: m.group, name: m.name, when: m.when, file});
}
fs.writeFileSync(path.join(out, "motifs.json"), JSON.stringify(list, null, 2) + "\n");

// AI Video Editor room-tone continuity check (reviewer): ambience runs continuously under every join of the final audio.
//   node ai-video-editor/check/room-tone.mjs <project-dir> <final.mp4> [--json] [--drop DB] [--click X]
// Joins = edited times between assets/edit-decisions.json keeps[] (keep.end, or cumulative sourceEnd-sourceStart).
// On the final's mono 48 kHz audio:
//   DROP  any 5 ms window within +-80 ms of a join more than --drop (15) dB under the clip's ambient floor
//         (10th percentile of 5 ms windows) or under -70 dBFS: a drop to silence at the join.
//   SILENCE  any run >= 10 ms of digital silence (< -80 dBFS) anywhere between 0.1 s and end-0.3 s.
//   CLICK  the largest sample step within +-6 ms of a join more than --click (4) x the 95th percentile of
//         1 ms step peaks in the surrounding +-150 ms (join zone excluded) and above 0.02: an unfaded splice.
// Fix: 20-40 ms crossfades at every join, or a room-tone fill under the join. Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SR = 48000;
const db = (x) => 20 * Math.log10(Math.max(x, 1e-10));

export function joinsFromKeeps(keeps) {
  const out = []; let t = 0;
  keeps.forEach((k, i) => {
    const end = Number.isFinite(k.end) ? k.end : t + (k.sourceEnd - k.sourceStart);
    if (i < keeps.length - 1) out.push(+end.toFixed(4));
    t = end;
  });
  return out;
}

/** samples Float32Array (mono, SR), joins [s] -> {pass, floorDb, joins:[{t, minDb, step, ref, drop, click}], silences:[{start,end}]} */
export function roomTone(x, joins, { dropDb = 15, clickX = 4, sr = SR } = {}) {
  const w = Math.round(sr * 0.005), n = Math.floor(x.length / w), win = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * w; j < (i + 1) * w; j++) s += x[j] * x[j]; win[i] = db(Math.sqrt(s / w)); }
  const lo = Math.floor(0.1 / 0.005), hi = Math.max(lo + 1, n - Math.floor(0.3 / 0.005));
  const sorted = Array.from(win.slice(lo, hi)).sort((a, b) => a - b), floorDb = sorted[Math.floor(sorted.length * 0.1)] ?? -120;
  const thr = Math.max(floorDb - dropDb, -70);
  const silences = []; let run = -1;
  for (let i = lo; i <= hi; i++) {
    const quiet = i < hi && win[i] < -80;
    if (quiet && run < 0) run = i;
    if (!quiet && run >= 0) { if ((i - run) * 0.005 >= 0.01) silences.push({ start: +(run * 0.005).toFixed(3), end: +(i * 0.005).toFixed(3) }); run = -1; }
  }
  const stepPeak = (a, b) => { let m = 0; for (let i = Math.max(1, a); i < Math.min(x.length, b); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  const ms = Math.round(sr / 1000);
  const res = joins.map((t) => {
    const c = Math.round(t * sr);
    let minDb = Infinity;
    for (let i = Math.floor((t - 0.08) / 0.005); i <= Math.floor((t + 0.08) / 0.005); i++) if (i >= 0 && i < n) minDb = Math.min(minDb, win[i]);
    const step = stepPeak(c - 6 * ms, c + 6 * ms), around = [];
    for (let k = -150; k < 150; k++) { if (Math.abs(k) < 20) continue; around.push(stepPeak(c + k * ms, c + (k + 1) * ms)); }
    around.sort((a, b) => a - b);
    const ref = around[Math.floor(around.length * 0.95)] || 0;
    const drop = minDb < thr, click = step > 0.02 && step > clickX * ref;
    return { t, minDb: +minDb.toFixed(1), step: +step.toFixed(4), ref: +ref.toFixed(4), drop, click };
  });
  return { pass: !silences.length && res.every((j) => !j.drop && !j.click), floorDb: +floorDb.toFixed(1), thr: +thr.toFixed(1), joins: res, silences };
}

export function decode(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const b = r.stdout; return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2), [proj, fin] = argv.filter((a, i) => !a.startsWith('--') && !/^--(drop|click)$/.test(argv[i - 1]));
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
  const ed = proj && path.join(proj, 'assets/edit-decisions.json');
  if (!ed || !fs.existsSync(ed) || !fin || !fs.existsSync(fin)) { console.error('usage: room-tone.mjs <project-dir> <final.mp4> [--json] [--drop DB] [--click X]'); process.exit(2); }
  const joins = joinsFromKeeps(JSON.parse(fs.readFileSync(ed, 'utf8')).keeps || []);
  const r = roomTone(decode(fin), joins, { dropDb: opt('--drop', 15), clickX: opt('--click', 4) });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    const bad = r.joins.filter((j) => j.drop || j.click);
    console.log(`room-tone: ${r.pass ? 'PASS' : 'FAIL'} ${joins.length} joins, ambient floor ${r.floorDb} dBFS (drop limit ${r.thr}), ${bad.length} bad join(s), ${r.silences.length} digital silence run(s)`);
    for (const j of bad) console.log(`  FAIL join ${j.t.toFixed(3)} s:${j.drop ? ` drops to ${j.minDb} dBFS` : ''}${j.click ? ` click (step ${j.step} vs ${j.ref} around)` : ''}`);
    for (const s of r.silences) console.log(`  FAIL digital silence ${s.start}-${s.end} s`);
    if (!r.pass) console.log('  Fix: 20-40 ms crossfade at every join (acrossfade / afade on each keep) or a room-tone fill under it.');
  }
  process.exit(r.pass ? 0 : 1);
}

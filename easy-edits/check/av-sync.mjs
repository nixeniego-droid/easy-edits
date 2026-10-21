#!/usr/bin/env node
// A/V sync of a composited export. The soundtrack places the edited voice at --offset, so the speaker picture in the
// final at (offset + t) must be the edited clip's frame t. Measured on motion, not pixels (the composition scales,
// pushes and overlays the picture): per-frame motion energy (mean |frame - previous frame| of a 48x48 grey thumbnail
// of the --crop band) of the final over [offset + from, offset + to] vs the clip over the same edited range; the lag
// (in frames, -5..5) with the highest correlation is the picture offset. PASS when it is 0 (+- --tolerance).
//   node easy-edits/check/av-sync.mjs <final.mp4> <clip.mp4> --offset 1.7 --range 0.5,3.3 [--crop W:H:X:Y] [--clip-crop W:H:X:Y] [--fps 30] [--tolerance 0]
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [final, clip] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!final || !clip) { console.error('usage: av-sync.mjs <final.mp4> <clip.mp4> --offset S --range from,to [--crop W:H:X:Y] [--clip-crop W:H:X:Y] [--fps 30] [--tolerance 0]'); process.exit(2); }
const off = Number(opt('--offset', 0)), fps = Number(opt('--fps', 30)), tol = Number(opt('--tolerance', 0)), L = 5;
const [from, to] = opt('--range', '0.5,3.5').split(',').map(Number);
const N = 48;
function motion(file, start, dur, crop) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(start), '-i', file, '-t', String(dur), '-vf', `fps=${fps}${crop ? `,crop=${crop}` : ''},scale=${N}:${N},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  const b = r.stdout, n = Math.floor(b.length / (N * N)), e = [];
  for (let f = 1; f < n; f++) { let s = 0; for (let i = 0; i < N * N; i++) s += Math.abs(b[f * N * N + i] - b[(f - 1) * N * N + i]); e.push(s / (N * N)); }
  return e;
}
const corr = (a, b) => {
  const n = Math.min(a.length, b.length); if (n < 10) return 0;
  const ma = a.slice(0, n).reduce((x, y) => x + y) / n, mb = b.slice(0, n).reduce((x, y) => x + y) / n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb || 1);
};
const fin = motion(final, off + from, to - from, opt('--crop'));
const src = motion(clip, Math.max(0, from - L / fps), to - from + (2 * L) / fps, opt('--clip-crop', opt('--crop')));
// src index (k + L) aligns the clip at t + k/fps with the final at t
const scores = [];
for (let k = -L; k <= L; k++) scores.push({ k, c: corr(fin, src.slice(k + L)) });
const best = scores.reduce((a, b) => (b.c > a.c ? b : a));
const pass = Math.abs(best.k) <= tol && best.c > 0.5;
console.log(`${pass ? 'PASS' : 'FAIL'}  picture offset ${best.k} frame(s) (corr ${best.c.toFixed(3)}; ${scores.map((s) => `${s.k}:${s.c.toFixed(2)}`).join(' ')})`);
console.log(pass ? 'AV-SYNC PASS' : 'AV-SYNC FAIL');
process.exit(pass ? 0 : 1);

// Easy Edits layout-jump check on the FINAL frames + the project plan: no jump to a solid slate, no hard layout swap.
//   node easy-edits/check/layout-jump.mjs <project-dir> <final.mp4> [--flash-only] [--json]
// --flash-only (edit.sh fault-only default): only SOLID JUMPs (a black / white / flat slate flash) FAIL; hard swaps
// are a cutting choice and are reported as INFO. --strict-look runs drop the flag.
// Frames: gray 108x192 at the video fps, 12 px blocks. A block is flat when its std < 4 and its mean is within 8 of
// the frame's median block; a frame is SOLID when >= 60% of its blocks are flat AND those blocks are frozen (mean
// abs change vs the previous frame < 0.5 levels). An ink idea panel at ~80% over the blurred, dimmed footage keeps
// the footage moving under it, so it is never solid; a fully opaque full-frame slate is.
//   SOLID JUMP  a solid run that starts after footage (FAIL; prints how many frames the entry took).
//   HARD SWAP   one frame where >= 40% of the blocks change by > 25 levels, with both neighbours < 20% (a single
//               frame layout change, no eased transition), that is not a source cut covered by a punch-in: plan.json
//               `scenes[]` starts with layout face / punch (jump cuts under a punch-in) and `punch-in` events, matched
//               within 2 frames after shifting the plan by the render offset (the lead-in post adds; estimated as the
//               0-0.5 s shift that matches the most hot frames to those cuts).
// Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const W = 108, H = 192, B = 12, NB = (W / B) * (H / B);

/** gray frames (Uint8Array W*H each) -> per frame {flat, frozen, hot} */
export function frameStats(frames) {
  return frames.map((g, f) => {
    const p = f ? frames[f - 1] : null, q = frames[f + 1] || p, bl = [];
    for (let by = 0; by < H; by += B) for (let bx = 0; bx < W; bx += B) {
      let a = 0, a2 = 0, d = 0, z = 0;
      for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) { const v = g[y * W + x]; a += v; a2 += v * v; if (p) d += Math.abs(v - p[y * W + x]); if (q) z += Math.abs(v - q[y * W + x]); }
      const m = a / (B * B); bl.push({ m, sd: Math.sqrt(Math.max(0, a2 / (B * B) - m * m)), d: d / (B * B), z: z / (B * B) });
    }
    const med = bl.map((b) => b.m).sort((x, y) => x - y)[bl.length >> 1];
    const flatB = bl.filter((b) => b.sd < 4 && Math.abs(b.m - med) < 8);
    return { flat: flatB.length / NB, frozen: flatB.length ? Math.min(p ? flatB.reduce((s, b) => s + b.d, 0) : Infinity, frames[f + 1] ? flatB.reduce((s, b) => s + b.z, 0) : Infinity) / flatB.length : 0, hot: p ? bl.filter((b) => b.d > 25).length / NB : 0 };
  });
}

export const isSolid = (s) => s.flat >= 0.6 && s.frozen < 0.5;
/** one frame where >= 40% of the blocks change, both neighbours < 20% */
export const isSwap = (st, f) => f > 0 && st[f].hot >= 0.4 && st[f - 1].hot < 0.2 && (st[f + 1]?.hot ?? 0) < 0.2;

/** stats + fps + allowed cut times (final s) -> {jumps, swaps} */
export function judge(stats, fps, allowed = []) {
  const jumps = [], swaps = [];
  for (let f = 1; f < stats.length; f++) {
    if (isSolid(stats[f]) && !isSolid(stats[f - 1])) {
      let k = f - 1; while (k > 0 && f - k < 10 && stats[k].flat > 0.2 && !isSolid(stats[k])) k--;
      if (stats[k].flat <= 0.2) jumps.push({ t: +(f / fps).toFixed(2), frames: f - k });
    }
    const h = stats[f];
    if (isSwap(stats, f)) {
      const t = f / fps;
      if (!allowed.some((a) => Math.abs(a - t) <= 2 / fps + 1e-6)) swaps.push({ t: +t.toFixed(2), hot: +h.hot.toFixed(2) });
    }
  }
  return { jumps, swaps };
}

/** plan -> cut times (plan s) covered by a punch-in */
export const punchCuts = (plan) => [...(plan.scenes || []).filter((s) => /^(face|punch)$/.test(s.layout)).map((s) => s.start), ...(plan.events || []).filter((e) => e.type === 'punch-in').map((e) => e.time)];

/** hot frame times + plan cut times -> best render offset in [0, 0.5] s */
export function renderOffset(hotTimes, cuts, fps) {
  let best = 0, bestN = -1, bestE = Infinity;
  for (let o = 0; o <= 0.5 + 1e-9; o += 1 / fps) {
    const d = hotTimes.map((t) => Math.min(...cuts.map((c) => Math.abs(c + o - t)))).filter((x) => x <= 2 / fps + 1e-6);
    const e = d.reduce((a, b) => a + b, 0);
    if (d.length > bestN || (d.length === bestN && e < bestE - 1e-9)) { bestN = d.length; bestE = e; best = o; }
  }
  return +best.toFixed(3);
}

export function decode(video) {
  const pr = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout.trim().split('/');
  const fps = +pr[0] / (+pr[1] || 1);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', video, '-an', '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`decode ${video}: ${r.stderr}`);
  const n = Math.floor(r.stdout.length / (W * H));
  return { fps, frames: Array.from({ length: n }, (_, f) => r.stdout.subarray(f * W * H, (f + 1) * W * H)) };
}

function main(argv) {
  const json = argv.includes('--json'), flash = argv.includes('--flash-only'), pos = argv.filter((a) => a !== '--json' && a !== '--flash-only');
  if (pos.length !== 2 || !fs.existsSync(pos[1])) { console.error('usage: layout-jump.mjs <project-dir> <final.mp4> [--json]'); return 2; }
  const planF = path.join(pos[0], 'assets/plan.json');
  const plan = fs.existsSync(planF) ? JSON.parse(fs.readFileSync(planF, 'utf8')) : {};
  const { fps, frames } = decode(pos[1]), stats = frameStats(frames);
  const cuts = punchCuts(plan), hotT = stats.map((s, f) => (isSwap(stats, f) ? f / fps : null)).filter((t) => t != null);
  const off = renderOffset(hotT, cuts, fps), r = judge(stats, fps, cuts.map((c) => c + off));
  if (json) console.log(JSON.stringify({ fps, offset: off, ...r }, null, 1));
  for (const j of r.jumps) console.log(`  FAIL SOLID JUMP ${j.t.toFixed(2)} s: footage -> fully opaque solid frame in ${j.frames} frame(s) (use an ~80% ink panel over the blurred live footage)`);
  for (const s of r.swaps) console.log(`  ${flash ? 'INFO' : 'FAIL'} HARD SWAP  ${s.t.toFixed(2)} s: ${Math.round(s.hot * 100)}% of the frame changes in one frame, not a punch-in cut (ease 8-10 frames)`);
  const n = r.jumps.length + (flash ? 0 : r.swaps.length);
  console.log(`layout-jump: ${n ? 'FAIL' : 'PASS'} ${r.jumps.length} solid jump(s), ${r.swaps.length} hard swap(s) (render offset ${off} s, ${cuts.length} punch-in cut(s))`);
  return n ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));

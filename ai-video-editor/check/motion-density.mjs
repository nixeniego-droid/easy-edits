// AI Video Editor motion-density check: no stretch longer than --max (3.0 s) without a new visual event.
//   node ai-video-editor/check/motion-density.mjs <project-dir> [<video.mp4>] [--max 3.0] [--json]
// Events = <project>/assets/plan.json scene starts (layout changes) and events[].time (overlay / chip / kinetic
// entries, punch-ins, zooms); the stretch from 0 to the first event and from the last event to `duration` count
// too. Captions are not events. FAIL when any gap between consecutive events is over --max.
// With <video> (the composition render), each gap is cross-checked by frame differencing: gray 108x192 at 10 fps,
// 12 px blocks, a frame is a cut when >= 40% of the blocks change by > 25 levels (gen-talk-v3: every layout change
// and punch-in is 53-89%, speaker gestures and chip pops stay under 30%). A gap with no cut inside it (0.2 s in
// from each edge) is `confirmed` static. Overlay entries look like gestures to a frame diff, so the plan's events
// stand for them; the diff only confirms that nothing larger happened. Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** plan -> [{start, end, dur}] gaps between visual events (sorted, deduped within 0.05 s). */
export function eventGaps(plan) {
  const ts = [0, ...(plan.scenes || []).map((s) => s.start), ...(plan.events || []).map((e) => e.time)].filter((t) => t >= 0 && t < plan.duration).sort((a, b) => a - b);
  const pts = ts.filter((t, i) => !i || t - ts[i - 1] > 0.05);
  pts.push(plan.duration);
  return pts.slice(1).map((end, i) => ({ start: pts[i], end, dur: +(end - pts[i]).toFixed(3) }));
}

/** video -> times (s) of frames where >= frac of 12 px blocks change by > thr. */
export function frameCuts(video, { fps = 10, thr = 25, frac = 0.4 } = {}) {
  const W = 108, H = 192, B = 12;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', video, '-an', '-vf', `fps=${fps},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`decode ${video}: ${r.stderr}`);
  const n = Math.floor(r.stdout.length / (W * H)), cuts = [];
  for (let f = 1; f < n; f++) {
    const a = (f - 1) * W * H, b = f * W * H;
    let hot = 0;
    for (let by = 0; by < H; by += B) for (let bx = 0; bx < W; bx += B) {
      let s = 0;
      for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) s += Math.abs(r.stdout[b + y * W + x] - r.stdout[a + y * W + x]);
      if (s / (B * B) > thr) hot++;
    }
    if (hot >= frac * (W / B) * (H / B)) cuts.push(+(f / fps).toFixed(2));
  }
  return cuts;
}

export function checkDensity(plan, { max = 3.0, cuts = null } = {}) {
  const gaps = eventGaps(plan).map((g) => ({ ...g, over: g.dur > max + 1e-9, ...(cuts && { confirmed: !cuts.some((t) => t > g.start + 0.2 && t < g.end - 0.2) }) }));
  return { gaps, bad: gaps.filter((g) => g.over), longest: Math.max(...gaps.map((g) => g.dur)) };
}

function main(argv) {
  const pos = [], o = { max: 3.0 };
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i] === '--max' ? (o.max = +argv[++i]) : pos.push(argv[i]);
  if (pos.length < 1 || pos.length > 2) { console.error('usage: motion-density.mjs <project-dir> [<video.mp4>] [--max 3.0] [--json]'); return 2; }
  const planF = path.join(pos[0], 'assets/plan.json');
  if (!fs.existsSync(planF)) { console.error(`motion-density: missing ${planF}`); return 2; }
  const plan = JSON.parse(fs.readFileSync(planF, 'utf8'));
  const cuts = pos[1] ? frameCuts(pos[1]) : null;
  const r = checkDensity(plan, { max: o.max, cuts });
  if (o.json) console.log(JSON.stringify({ ...r, cuts }, null, 1));
  for (const g of r.bad) console.log(`  STATIC  ${g.start.toFixed(2)}-${g.end.toFixed(2)} s (${g.dur.toFixed(2)} s)${cuts ? (g.confirmed ? ' confirmed by frame diff (no cut inside)' : ' frame diff sees a cut inside: plan events missing?') : ''}`);
  console.log(`motion-density: ${r.bad.length ? 'FAIL' : 'PASS'} ${r.bad.length} stretch(es) over ${o.max} s without a visual event, longest ${r.longest.toFixed(2)} s (${r.gaps.length} gaps)`);
  return r.bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));

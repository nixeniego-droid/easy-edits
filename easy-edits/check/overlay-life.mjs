// Easy Edits overlay-life check on the FINAL frames: no static card once it has settled.
//   node easy-edits/check/overlay-life.mjs <project-dir> <final.mp4> [--min 1.0] [--win 0.5] [--json]
// Cards (UI cards per card-fill.mjs: own class token `card` / `*-card` / `card-*`) and their settled box come from
// card-fill's headless DOM sample (box at the last settled moment, clip window s..e). Hold = [s + 0.4 s entry, that
// last settled moment], shifted by the render offset (layout-jump.mjs, plan punch cuts). The final is decoded
// cropped to the card box inset 10% (masks the footage: only card pixels count), gray 1/4 scale, at the video fps.
// Per --win (0.5 s) window of the hold: life = max over its frames of the mean abs difference to the window's first
// frame (levels 0-255). A 1-2% float / drift, rising bars, a counter or a route drawing all move card pixels;
// FAIL when any window's life < --min (1.0 level): the card sits frozen. Exit 1 on FAIL, 2 on usage / no browser.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sampleCards } from './card-fill.mjs';
import { decode, frameStats, punchCuts, renderOffset, isSwap } from './layout-jump.mjs';

export const ENTRY = 0.4, INSET = 0.1, MIN_LIFE = 1.0, WIN = 0.5;

/** frames (equal-size gray Uint8Arrays) over a hold at fps -> [{t0, life}] per window (t0 relative to the first) */
export function windowLife(frames, fps, win = WIN) {
  const n = Math.max(2, Math.round(win * fps)), out = [];
  for (let a = 0; a + 1 < frames.length; a += n) {
    const f0 = frames[a]; let life = 0;
    for (let k = a + 1; k < Math.min(frames.length, a + n + 1); k++) { let d = 0; const g = frames[k]; for (let i = 0; i < g.length; i++) d += Math.abs(g[i] - f0[i]); life = Math.max(life, d / g.length); }
    if (Math.min(frames.length, a + n + 1) - a >= Math.max(2, n / 2)) out.push({ t0: +(a / fps).toFixed(2), life: +life.toFixed(2) });
  }
  return out;
}

function cropFrames(video, t0, t1, box, fps) {
  const w = Math.max(4, Math.round(box.w / 4) & ~1), h = Math.max(4, Math.round(box.h / 4) & ~1);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t0), '-to', String(t1), '-i', video, '-an', '-vf', `crop=${box.w}:${box.h}:${box.x}:${box.y},scale=${w}:${h},format=gray`, '-r', String(fps), '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  const n = Math.floor(r.stdout.length / (w * h));
  return Array.from({ length: n }, (_, f) => r.stdout.subarray(f * w * h, (f + 1) * w * h));
}

async function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 2 || !fs.existsSync(pos[1])) { console.error('usage: overlay-life.mjs <project-dir> <final.mp4> [--min 1.0] [--win 0.5] [--json]'); return 2; }
  const min = +(o.min || MIN_LIFE), win = +(o.win || WIN);
  let cards;
  try { cards = (await sampleCards(pos[0])).filter((c) => c.x != null); } catch (e) { console.error(String(e.message || e)); return 2; }
  const planF = path.join(pos[0], 'assets/plan.json'), plan = fs.existsSync(planF) ? JSON.parse(fs.readFileSync(planF, 'utf8')) : {};
  const { fps, frames } = decode(pos[1]), st = frameStats(frames);
  const off = renderOffset(st.map((s, f) => (isSwap(st, f) ? f / fps : null)).filter((t) => t != null), punchCuts(plan), fps);
  const res = [];
  for (const c of cards) {
    const t0 = c.s + ENTRY + off, t1 = c.t + off;
    if (t1 - t0 < win / 2) { res.push({ ...c, skip: `hold ${(t1 - t0).toFixed(2)} s too short` }); continue; }
    const ix = Math.round(c.w * INSET), iy = Math.round(c.h * INSET), box = { x: Math.max(0, c.x + ix), y: Math.max(0, c.y + iy), w: (c.w - 2 * ix) & ~1, h: (c.h - 2 * iy) & ~1 };
    const wl = windowLife(cropFrames(pos[1], t0, t1, box, fps), fps, win).map((w) => ({ ...w, t0: +(w.t0 + t0).toFixed(2) }));
    res.push({ ...c, hold: [+t0.toFixed(2), +t1.toFixed(2)], windows: wl, dead: wl.filter((w) => w.life < min) });
  }
  if (o.json) console.log(JSON.stringify({ offset: off, cards: res }, null, 1));
  for (const c of res) {
    if (c.skip) { console.log(`  skip OVERLAY LIFE #${c.id} "${c.text}" (${c.skip})`); continue; }
    const lo = Math.min(...c.windows.map((w) => w.life));
    console.log(`  ${c.dead.length ? 'FAIL' : 'ok  '} OVERLAY LIFE #${c.id} "${c.text}" hold ${c.hold[0].toFixed(2)}-${c.hold[1].toFixed(2)} s, min life ${lo.toFixed(2)}${c.dead.length ? ` < ${min} in ${c.dead.length}/${c.windows.length} window(s) at ${c.dead.map((w) => w.t0.toFixed(2)).join(', ')} s (static card: add a 1-2% float / drift, rising bars, a counter)` : ''}`);
  }
  const bad = res.filter((c) => c.dead?.length).length;
  console.log(`overlay-life: ${bad ? 'FAIL' : 'PASS'} ${bad} of ${res.filter((c) => !c.skip).length} card(s) static in a ${win} s window (render offset ${off} s)`);
  return bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv.slice(2));

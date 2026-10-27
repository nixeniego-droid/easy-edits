// AI Video Editor shot-length check on the FINAL frames: a visible change at least every --max (1.5) s.
//   node ai-video-editor/check/shot-length.mjs <project-dir> <final.mp4> [--max 1.5] [--zoom 1.13] [--json]
// motion-density.mjs judges the plan; this one measures the render. Frames: gray 108x192 at 10 fps. A change is
//   cut      a frame where >= 40% of the 12 px blocks change by > 25 levels (or the 16-bin histogram moves > 0.35)
//            and no zoom of the previous frame explains it (a scene / layout change)
//   zoom     the previous frame, scaled about its centre and shifted, predicts this one better than unscaled
//            (residual <= 0.92 x; caption chunks often swap on the same frame) with a scale step >= --zoom (1.13:
//            the brief's 115-125% punch, less the 0.025 log grid; style2c's 115% punches measure 1.133-1.162).
//            A smaller step that explains the frame (residual <= 0.55 x: a 104% push, a 108% punch) is the same shot.
//   overlay  a non-caption clip (card / panel / kinetic / ibox: a timed .clip in index.html) enters or leaves, at
//            its data-start / end + lead-in, confirmed by >= 5% of the blocks changing from 0.15 s before to 0.35
//            s after. Caption chunks and text swaps inside a card are not shots.
// FAIL any span (0 .. duration) longer than --max with no change; the spans are printed in final time.
// Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { leadOffset } from '../tools/dom-sample.mjs';

const W = 108, H = 192, B = 12, FPS = 10;

export function decode(video) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', video, '-an', '-vf', `fps=${FPS},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`decode ${video}: ${r.stderr}`);
  const n = Math.floor(r.stdout.length / (W * H));
  return Array.from({ length: n }, (_, i) => r.stdout.subarray(i * W * H, (i + 1) * W * H));
}

/** fraction of 12 px blocks whose mean abs difference is over thr */
export function hotFrac(a, b, thr = 25) {
  let hot = 0, n = 0;
  for (let by = 0; by < H; by += B) for (let bx = 0; bx < W; bx += B) {
    let s = 0;
    for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) s += Math.abs(a[y * W + x] - b[y * W + x]);
    n++; if (s / (B * B) > thr) hot++;
  }
  return hot / n;
}

function histDist(a, b) {
  const ha = new Float64Array(16), hb = new Float64Array(16);
  for (let i = 0; i < a.length; i++) { ha[a[i] >> 4]++; hb[b[i] >> 4]++; }
  let d = 0; for (let k = 0; k < 16; k++) d += Math.abs(ha[k] - hb[k]); return d / a.length / 2;
}

/** best {scale, ratio} with b ~ a scaled about the centre and shifted (+-15 x, +-24 y px of 108x192: any anchor,
 *  plus a reframe); ratio = best residual / unshifted unscaled residual */
export function zoomStep(a, b) {
  const res = (s, ax, ay) => {
    let e = 0, n = 0;
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
      const sx = Math.round(W / 2 + (x - W / 2 - ax) / s), sy = Math.round(H / 2 + (y - H / 2 - ay) / s);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      e += Math.abs(b[y * W + x] - a[sy * W + sx]); n++;
    }
    return n ? e / n : Infinity;
  };
  const base = res(1, 0, 0);
  let best = { scale: 1, r: base };
  for (let k = -12; k <= 12; k++) {
    if (!k) continue;
    const s = Math.exp(k * 0.025);
    for (let ax = -15; ax <= 15; ax += 3) for (let ay = -24; ay <= 24; ay += 3) {
      const r = res(s, ax, ay);
      if (r < best.r) best = { scale: +s.toFixed(3), r };
    }
  }
  return { scale: best.scale, ratio: base ? +(best.r / base).toFixed(3) : 1 };
}

/** timed non-caption clips of a composition: [{id, start, end}] */
export function overlayClips(html) {
  const out = [];
  for (const m of html.matchAll(/<div\b[^>]*>/g)) {
    const t = m[0], cls = (t.match(/class="([^"]*)"/) || [])[1] || '';
    const tok = cls.split(/\s+/);
    if (!tok.includes('clip') || tok.includes('cap')) continue;
    const id = (t.match(/id="([^"]*)"/) || [])[1], s = t.match(/data-start="([\d.]+)"/), d = t.match(/data-duration="([\d.]+)"/);
    if (s && d) out.push({ id, start: +s[1], end: +(+s[1] + +d[1]).toFixed(3) });
  }
  return out;
}

/** frames + overlay clips (composition time) + lead-in -> {events, spans, bad} */
export function shotChanges(frames, clips = [], { lead = 0, max = 1.5, zoom = 1.13 } = {}) {
  const ev = [];
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f - 1], b = frames[f], hf = hotFrac(a, b), t = +(f / FPS).toFixed(2);
    if (hf < 0.15 && histDist(a, b) <= 0.35) continue;
    const z = zoomStep(a, b);
    if (z.ratio <= 0.92 && Math.abs(Math.log(z.scale)) >= Math.log(zoom) - 1e-9) { ev.push({ t, kind: 'zoom', scale: z.scale, ratio: z.ratio }); continue; }
    if (z.ratio <= 0.55) continue; // a smaller zoom / reframe of the same picture: same shot
    if (hf >= 0.4 || histDist(a, b) > 0.35) ev.push({ t, kind: 'cut', frac: +hf.toFixed(2) });
  }
  const dur = frames.length / FPS, at = (t) => Math.max(0, Math.min(frames.length - 1, Math.round(t * FPS)));
  for (const c of clips) for (const [edge, t0] of [['in', c.start], ['out', c.end]]) {
    const t = t0 + lead; if (t <= 0.05 || t >= dur - 0.05) continue;
    const hf = hotFrac(frames[at(t - 0.15)], frames[at(t + 0.35)]);
    if (hf >= 0.05) ev.push({ t: +t.toFixed(2), kind: 'overlay', id: c.id, edge, frac: +hf.toFixed(2) });
  }
  ev.sort((x, y) => x.t - y.t);
  const pts = [0, ...ev.map((e) => e.t), +dur.toFixed(2)], spans = [];
  for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > 1e-6) spans.push({ start: pts[i - 1], end: pts[i], dur: +(pts[i] - pts[i - 1]).toFixed(2) });
  return { events: ev, spans, bad: spans.filter((s) => s.dur > max + 1e-9), duration: +dur.toFixed(2) };
}

const durOf = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);
export const mmss = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

function main(argv) {
  const pos = [], o = { max: 1.5, zoom: 1.13 };
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i] === '--max' ? (o.max = +argv[++i]) : argv[i] === '--zoom' ? (o.zoom = +argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 2 || !fs.existsSync(pos[1])) { console.error('usage: shot-length.mjs <project-dir> <final.mp4> [--max 1.5] [--zoom 1.13] [--json]'); return 2; }
  const html = fs.readFileSync(path.join(pos[0], 'index.html'), 'utf8');
  const comp = +((html.match(/data-composition-id="[^"]*"[^>]*data-duration="([\d.]+)"/) || html.match(/data-duration="([\d.]+)"[^>]*data-composition-id/) || [])[1] || 0);
  const lead = comp ? leadOffset(durOf(pos[1]), comp) : 0;
  const r = shotChanges(decode(pos[1]), overlayClips(html), { lead, max: o.max, zoom: o.zoom });
  if (o.json) console.log(JSON.stringify({ lead, ...r }, null, 1));
  console.log(`shot-length: ${r.bad.length ? 'FAIL' : 'PASS'} ${r.bad.length} span(s) over ${o.max} s with no cut, >= ${Math.round((o.zoom - 1) * 100)}% zoom step or overlay entry / exit (final frames, lead-in ${lead} s; ${r.events.filter((e) => e.kind === 'cut').length} cuts, ${r.events.filter((e) => e.kind === 'zoom').length} zooms, ${r.events.filter((e) => e.kind === 'overlay').length} overlay edges)`);
  for (const s of r.bad) console.log(`  HOLD ${mmss(s.start)}-${mmss(s.end)} (${s.dur.toFixed(2)} s): no new shot; punch 115-125%, cut, or bring in / take out a card`);
  return r.bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));

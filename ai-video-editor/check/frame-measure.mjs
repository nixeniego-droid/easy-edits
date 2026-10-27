// AI Video Editor frame measurement helpers: measure what the ENCODED frame shows, not what the DOM claims.
// The DOM (tools/dom-sample.mjs, index.html) only locates candidate boxes and times; the numbers come from pixels.
//   frameAt(video, t)            -> {w, h, data} rgb24 at full output resolution
//   whiteCard(frame, seed)       -> bbox of the near-white connected component overlapping the seed box
//   textRows(frame, box)         -> dark-ink rows inside a card: [{y0, y1, h, x0, x1}] (cap / x-height in px)
//   inFrame(png, ox, oy)         -> a frozen crop pasted back into a 1080 x 1920 frame
//   regionStats(frame, box)      -> {mean [r,g,b], std, edge}: luma std and mean |gradient| (texture)
import { spawnSync } from 'node:child_process';

export function frameAt(video, t, { w = 1080, h = 1920 } = {}) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, t)), '-i', video, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
  if (r.status !== 0 || r.stdout.length < w * h * 3) throw new Error(`frameAt: no frame at ${t} s in ${video}`);
  return { w, h, data: r.stdout };
}

/** PNG / image file -> {w, h, data} rgb24 (fixtures). */
export function framePng(file) {
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = p.stdout.trim().split(',').map(Number);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
  return { w, h, data: r.stdout };
}

/** crop fixture (PNG) pasted into a black W x H frame at its original offset (tests on frozen final crops). */
export function inFrame(file, ox, oy, W = 1080, H = 1920) {
  const c = framePng(file), data = Buffer.alloc(W * H * 3);
  for (let y = 0; y < c.h; y++) c.data.copy(data, 3 * ((oy + y) * W + ox), 3 * y * c.w, 3 * (y + 1) * c.w);
  return { w: W, h: H, data };
}

export const WHITE = 222;
const isWhite = (d, i, thr) => d[i] >= thr && d[i + 1] >= thr && d[i + 2] >= thr;

/** frame + seed box [x, y, w, h] -> {x, y, w, h, area} of the largest near-white 4-connected component with a
 *  pixel inside the seed (the card surface), or null. Ink on the card is a hole, not a split: the bbox spans it. */
export function whiteCard({ w, h, data }, seed, { thr = WHITE, minArea = 4000 } = {}) {
  const lab = new Int32Array(w * h), stack = new Int32Array(w * h);
  const [sx, sy, sw, sh] = seed.map(Math.round);
  let best = null, id = 0;
  for (let y = Math.max(0, sy); y < Math.min(h, sy + sh); y += 2) for (let x = Math.max(0, sx); x < Math.min(w, sx + sw); x += 2) {
    const p = y * w + x;
    if (lab[p] || !isWhite(data, 3 * p, thr)) continue;
    id++; let n = 0, top = 0, x0 = x, x1 = x, y0 = y, y1 = y;
    stack[top++] = p; lab[p] = id;
    while (top) {
      const q = stack[--top], qx = q % w, qy = (q / w) | 0; n++;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      for (const r of [q - 1, q + 1, q - w, q + w]) {
        if (r < 0 || r >= w * h || lab[r] || (r === q - 1 && qx === 0) || (r === q + 1 && qx === w - 1)) continue;
        if (!isWhite(data, 3 * r, thr)) continue;
        lab[r] = id; stack[top++] = r;
      }
    }
    if (n >= minArea && (!best || n > best.area)) best = { id, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area: n };
  }
  if (!best) return null;
  // trim thin bright spill (a lit wall / collar touching the card edge): keep rows / columns where the
  // component covers >= TRIM of its widest row / tallest column
  const rows = new Int32Array(best.h), cols = new Int32Array(best.w);
  for (let y = best.y; y < best.y + best.h; y++) for (let x = best.x; x < best.x + best.w; x++) if (lab[y * w + x] === best.id) { rows[y - best.y]++; cols[x - best.x]++; }
  const span = (a) => { const m = Math.max(...a) * TRIM; let i = 0, j = a.length - 1; while (i < j && a[i] < m) i++; while (j > i && a[j] < m) j--; return [i, j]; };
  const [r0, r1] = span(rows), [c0, c1] = span(cols);
  return { x: best.x + c0, y: best.y + r0, w: c1 - c0 + 1, h: r1 - r0 + 1, area: best.area };
}
export const TRIM = 0.5;

/** Card inner ink rows: rows inside box (inset) holding >= minRun dark pixels (luma < dark), merged into text
 *  lines; each line's height is its ink extent (cap height for caps-only type). */
export function textRows({ w, data }, [bx, by, bw, bh], { dark = 110, inset = 0.05, minPx = 3, gap = 2 } = {}) {
  const x0 = Math.round(bx + bw * inset), x1 = Math.round(bx + bw * (1 - inset)), y0 = Math.round(by + bh * inset), y1 = Math.round(by + bh * (1 - inset));
  const rows = [];
  for (let y = y0; y < y1; y++) {
    let n = 0, lx = x1, rx = x0;
    for (let x = x0; x < x1; x++) { const i = 3 * (y * w + x); if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < dark) { n++; if (x < lx) lx = x; rx = x; } }
    rows.push(n >= minPx ? { y, lx, rx } : null);
  }
  const lines = []; let cur = null, miss = 0;
  for (const r of rows) {
    if (r) { if (cur && miss <= gap) { cur.y1 = r.y; cur.x0 = Math.min(cur.x0, r.lx); cur.x1 = Math.max(cur.x1, r.rx); } else { cur = { y0: r.y, y1: r.y, x0: r.lx, x1: r.rx }; lines.push(cur); } miss = 0; }
    else miss++;
  }
  return lines.map((l) => ({ ...l, h: l.y1 - l.y0 + 1 }));
}

/** Region stats: mean rgb, luma std and mean absolute horizontal+vertical luma gradient (texture). */
export function regionStats({ w, data }, [bx, by, bw, bh]) {
  const L = (x, y) => { const i = 3 * (y * w + x); return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  let n = 0, s = 0, s2 = 0, g = 0; const m = [0, 0, 0];
  for (let y = by; y < by + bh - 1; y++) for (let x = bx; x < bx + bw - 1; x++) {
    const i = 3 * (y * w + x), l = L(x, y);
    m[0] += data[i]; m[1] += data[i + 1]; m[2] += data[i + 2]; s += l; s2 += l * l; g += Math.abs(L(x + 1, y) - l) + Math.abs(L(x, y + 1) - l); n++;
  }
  const mu = s / n;
  return { mean: m.map((v) => +(v / n).toFixed(1)), std: +Math.sqrt(Math.max(0, s2 / n - mu * mu)).toFixed(2), edge: +(g / n).toFixed(2) };
}

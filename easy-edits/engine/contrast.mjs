// Easy Edits caption auto contrast: sample the footage behind each caption and pick light or dark text.
// lumaGrid() decodes the clip once to a tiny greyscale grid (2 fps, 64 px wide, cached next to the clip);
// regionStats() reads the mean luminance and its spread under a source-pixel rect over a time window; pickInk()
// turns that into 'light' (white text, dark edge) or 'dark' (near-black text, light edge). White is the house
// look, so it wins unless dark text is clearly easier to read, and a hysteresis band stops captions flickering
// between the two on footage that sits near the threshold. Contrast maths: WCAG 2 relative luminance.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const r3 = (v) => Math.round(v * 1000) / 1000;

/** '#RRGGBB' -> [r, g, b] 0-255. */
export function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** one sRGB channel 0-255 -> linear 0-1. */
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i));
/** WCAG relative luminance of a '#RRGGBB' colour or an [r, g, b] triple. */
export function relLum(c) {
  const [r, g, b] = Array.isArray(c) ? c : hexRgb(c);
  return 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
}
/** WCAG contrast ratio of two colours (hex) or luminances (numbers 0-1); 1 .. 21. */
export function contrastRatio(a, b) {
  const la = typeof a === 'number' ? a : relLum(a), lb = typeof b === 'number' ? b : relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** '#RRGGBB' + alpha -> 'rgba(r,g,b,a)'. */
export const rgba = (hex, a) => `rgba(${hexRgb(hex).join(',')},${a})`;

/** the two text inks. light: white with a dark edge (the house captions); dark: near-black with a light edge. */
export const INK = { light: '#FFFFFF', dark: '#111111' };

/**
 * Greyscale grid of a clip: {fps, w, h, n, srcW, srcH, data (Buffer, n frames of w*h bytes)}. Cached as
 * <out> (raw) + <out>.json (meta); a re-run reuses it unless the clip is newer.
 */
export function lumaGrid(clip, out, { fps = 2, width = 64 } = {}) {
  const meta = `${out}.json`;
  const stale = () => !fs.existsSync(out) || !fs.existsSync(meta) || fs.statSync(out).mtimeMs < fs.statSync(clip).mtimeMs;
  if (stale()) {
    const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', clip], { encoding: 'utf8' })).streams[0];
    const h = Math.max(2, Math.round((width * pr.height) / pr.width / 2) * 2);
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', clip, '-an', '-vf', `fps=${fps},scale=${width}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
    fs.writeFileSync(out, raw);
    fs.writeFileSync(meta, JSON.stringify({ fps, w: width, h, n: Math.floor(raw.length / (width * h)), srcW: pr.width, srcH: pr.height }));
  }
  const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
  return { ...m, data: fs.readFileSync(out) };
}

/**
 * Luminance under `rect` ({x, y, w, h} in SOURCE px) from t0 to t1 (clip seconds): {lum (mean relative luminance
 * 0-1), mean (mean grey 0-255), std (grey spread), cover (share of the rect inside the frame)}. null when the
 * rect misses the frame or the grid has no frame in the window.
 */
export function regionStats(grid, t0, t1, rect) {
  if (!grid?.n) return null;
  const sx = grid.w / grid.srcW, sy = grid.h / grid.srcH;
  const x0 = Math.max(0, Math.floor(rect.x * sx)), x1 = Math.min(grid.w, Math.ceil((rect.x + rect.w) * sx));
  const y0 = Math.max(0, Math.floor(rect.y * sy)), y1 = Math.min(grid.h, Math.ceil((rect.y + rect.h) * sy));
  if (x1 <= x0 || y1 <= y0) return null;
  const cover = Math.min(1, ((x1 - x0) * (y1 - y0)) / Math.max(1, rect.w * sx * rect.h * sy));
  let f0 = Math.max(0, Math.floor(t0 * grid.fps)), f1 = Math.min(grid.n - 1, Math.floor(t1 * grid.fps));
  if (f0 > grid.n - 1) f0 = f1 = grid.n - 1;
  if (f1 < f0) f1 = f0;
  let sum = 0, sum2 = 0, sl = 0, k = 0;
  const fs_ = grid.w * grid.h;
  for (let f = f0; f <= f1; f++) {
    for (let y = y0; y < y1; y++) {
      const row = f * fs_ + y * grid.w;
      for (let x = x0; x < x1; x++) { const g = grid.data[row + x]; sum += g; sum2 += g * g; sl += LIN[g]; k++; }
    }
  }
  if (!k) return null;
  const mean = sum / k;
  return { lum: r3(sl / k), mean: r3(mean), std: r3(Math.sqrt(Math.max(0, sum2 / k - mean * mean))), cover: r3(cover) };
}

/** blend footage stats with a flat backdrop colour for the part of the caption that is not over the footage. */
export function blendBackdrop(stats, backdropHex, share) {
  const lb = relLum(backdropHex);
  if (!stats) return { lum: r3(lb), mean: null, std: 0, cover: 0 };
  const s = Math.max(0, Math.min(1, share));
  return { ...stats, lum: r3(stats.lum * s + lb * (1 - s)), std: r3(stats.std * s) };
}

/**
 * 'light' | 'dark' for a background luminance. Light text wins unless dark text has `bias` times its contrast
 * (bias 2.5: the switch sits near grey 160 of 255, i.e. clearly bright footage: a white wall, sky, paper); with
 * `prev` the switch needs a wider margin (hysteresis), so neighbouring captions keep one ink.
 */
export function pickInk(lum, { prev = null, bias = 2.5, band = 0.5 } = {}) {
  if (lum == null) return prev || 'light';
  const cLight = contrastRatio(INK.light, lum), cDark = contrastRatio(INK.dark, lum);
  const toDark = bias + (prev === 'light' ? band : 0), toLight = bias - (prev === 'dark' ? band : 0);
  if (prev === 'dark') return cDark >= cLight * toLight ? 'dark' : 'light';
  return cDark >= cLight * toDark ? 'dark' : 'light';
}

/** a busy background (high grey spread): heavier edge and shadow. */
export const isBusy = (stats) => (stats?.std ?? 0) > 48;

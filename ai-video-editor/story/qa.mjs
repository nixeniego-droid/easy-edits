// Per-shot QA for generated (and user) clips: black and frozen frames (ffmpeg blackdetect / freezedetect), duration
// match against the request, a flicker score from signalstats YDIF / YAVG, and identity drift against the
// character reference images (identityDrift below: face + torso regions when a face is found, else a background-aware
// colour proxy). Problems become WEAK_SHOTS entries: shot id, timestamp, reason, suggested fix.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ff, r3 } from './ffx.mjs';
import { PY, REPO } from '../engine/media.mjs';

// Identity-drift limits, calibrated on a real host-generated story (one character: a grey-backdrop studio portrait
// as the reference, three 9:16 cinematic shots; whole-frame histograms scored the right character 0.67-0.71, the same
// as unrelated pictures 0.70-0.84, so no threshold on them was defensible):
//   drift (face + torso regions, story/identity.py): same character 0.34 / 0.36 per shot (single frames 0.24-0.32,
//     also under a +-20 degree hue shift of the lighting); the same shots with the outfit recoloured (hue +60..+300)
//     or in greyscale 0.80-1.0. 0.55 sits in the middle of that gap.
//   driftColour (no face found / no OpenCV: background-aware colour containment, colourMissing share 0.4): same
//     character 0.05 / 0.41 per shot; unrelated scenes (sea, neon city, test patterns) and the recoloured / greyscale
//     shots 0.63-1.0, but pictures sharing the character's palette (yellow bees and flowers vs a yellow raincoat)
//     0.30-0.43 pass. 0.5 flags the clearly unrelated ones only.
export const QA_LIMITS = { blackSec: 0.25, blackRatio: 0.2, frozenRatio: 0.6, durationSec: 0.2, flicker: 3.0, drift: 0.55, driftColour: 0.5 };

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** One decode pass: black + frozen intervals and per-frame YDIF / YAVG. */
export function scanClip(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-an', '-vf', 'blackdetect=d=0.05:pix_th=0.10,freezedetect=n=-60dB:d=0.4,signalstats,metadata=mode=print:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`QA scan failed: ${(r.stderr || '').slice(-600)}`);
  const black = [...r.stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const fs0 = [...r.stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const fe = [...r.stderr.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ydif = [...r.stdout.matchAll(/lavfi\.signalstats\.YDIF=([\d.]+)/g)].map((m) => Number(m[1]));
  const yavg = [...r.stdout.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  return { black, freezeStarts: fs0, freezeEnds: fe, ydif, yavg };
}

/**
 * Flicker score (0 = steady): the mean YDIF spike above its 5-frame rolling median (pops, glitch frames) plus the
 * mean up-down oscillation of average luma (brightness pumping). Smooth motion scores near 0.
 */
export function flickerScore(ydif, yavg) {
  const d = ydif.slice(1);
  const spikes = d.map((v, i) => Math.max(0, v - median(d.slice(Math.max(0, i - 2), i + 3))));
  const osc = [];
  for (let i = 2; i < yavg.length; i++) {
    const a = yavg[i - 1] - yavg[i - 2], b = yavg[i] - yavg[i - 1];
    osc.push(a * b < 0 ? Math.min(Math.abs(a), Math.abs(b)) : 0);
  }
  return r3(mean(spikes) + mean(osc));
}

function hist(px) {
  const h = new Float64Array(512);
  for (let i = 0; i < px.length; i += 3) h[((px[i] >> 5) << 6) | ((px[i + 1] >> 5) << 3) | (px[i + 2] >> 5)]++;
  const n = px.length / 3;
  return h.map((v) => v / n);
}
function ahash(px) {
  const g = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let s = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) { const o = ((y * 4 + dy) * 32 + x * 4 + dx) * 3; s += 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]; }
    g.push(s / 16);
  }
  const m = mean(g);
  return g.map((v) => v > m);
}

/**
 * Whole-image proxy (Bhattacharyya distance of 8x8x8 RGB histograms, 0 same .. 1 disjoint, and aHash Hamming/64) on
 * 32x32 RGB thumbnails. No longer the drift score: the background dominates it (see QA_LIMITS).
 */
export function imageDistance(a, b) {
  const ha = hist(a), hb = hist(b);
  let bc = 0;
  for (let i = 0; i < 512; i++) bc += Math.sqrt(ha[i] * hb[i]);
  const pa = ahash(a), pb = ahash(b);
  return { hist: r3(Math.sqrt(Math.max(0, 1 - bc))), hash: r3(pa.filter((v, i) => v !== pb[i]).length / 64) };
}

/** RGB pixels of one frame (or an image), 64 px wide, aspect kept: {px, w, h}. */
function pixels(file, t) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', ...(t != null ? ['-ss', t.toFixed(3)] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=64:-2,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  if (r.status !== 0 || r.stdout.length < 64 * 2 * 3) return null;
  return { px: r.stdout, w: 64, h: r.stdout.length / 3 / 64 };
}

/** Lighting-tolerant colour bin: 12 hues x 3 saturations, 4 grey levels; -1 = too dark to tell. */
function colourBin(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
  if (mx < 40) return -1;
  if (s < 0.22) return 36 + Math.min(3, Math.floor((mx + mn) / 128));
  const d = mx - mn;
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.floor(h * 2) * 3 + Math.min(2, Math.floor((s - 0.22) / 0.26));
}

/**
 * Colour histogram of an image. foreground: drop the pixels close to the median colour of the outer 8% ring (a
 * studio backdrop), so a reference portrait describes the character, not its background.
 */
export function colourHist({ px, w, h }, { foreground = false } = {}) {
  let keep = () => true;
  if (foreground) {
    const m = Math.max(2, Math.round(Math.min(w, h) * 0.08)), ring = [[], [], []];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < m || y < m || x >= w - m || y >= h - m) for (let k = 0; k < 3; k++) ring[k].push(px[(y * w + x) * 3 + k]);
    const med = ring.map((a) => median(a));
    const fg = (o) => Math.hypot(px[o] - med[0], px[o + 1] - med[1], px[o + 2] - med[2]) > 45;
    let n = 0;
    for (let i = 0; i < w * h; i++) if (fg(i * 3)) n++;
    if (n >= w * h * 0.05) keep = fg;   // a reference that is all "background" keeps every pixel
  }
  const H = new Float64Array(40);
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 3;
    if (!keep(o)) continue;
    const k = colourBin(px[o], px[o + 1], px[o + 2]);
    if (k >= 0) { H[k]++; n++; }
  }
  return H.map((v) => v / Math.max(1, n));
}

/**
 * How much of the reference's (foreground) colour the frame is missing: 0 = every colour of the character is there,
 * 1 = none. A colour counts as present once it covers 40% of its share in the reference (the character fills
 * less of a scene than of a portrait); colours the frame adds (its background) cost nothing.
 */
export function colourMissing(refHist, frameHist, share = 0.4) {
  let c = 0;
  for (let b = 0; b < refHist.length; b++) if (refHist[b] > 0) c += refHist[b] * Math.min(1, frameHist[b] / (share * refHist[b]));
  return r3(1 - c);
}

/** Face + torso distances of frames to refs (story/identity.py); null when OpenCV / the face model is unavailable. */
function faceDistances(frames, refs) {
  if (process.env.AI_VIDEO_EDITOR_IDENTITY === 'colour') return null;
  const out = path.join(path.dirname(frames[0]), 'identity.json');
  const r = spawnSync(PY, ['-I', path.join(REPO, 'ai-video-editor/story/identity.py'), out, ...refs.flatMap((f) => ['--ref', f]), ...frames], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) return null;
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  return j.model ? j : null;
}

/**
 * Drift of a clip from its reference images, on frames at 25 / 50 / 75 %. A face in a reference and in the frames:
 * method "face", the mean best-reference face + torso distance (limit QA_LIMITS.drift). Otherwise (no face found, a
 * back view, no OpenCV): method "colour", the mean best-reference colourMissing() (limit QA_LIMITS.driftColour).
 */
export function identityDrift(file, len, refs) {
  const okRefs = refs.filter((f) => fs.existsSync(f));
  if (!okRefs.length) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-identity-'));
  try {
    const frames = [];
    for (const [k, p] of [0.25, 0.5, 0.75].entries()) {
      const f = path.join(tmp, `f${k}.png`);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-ss', (len * p).toFixed(3), '-i', file, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", f]);
      if (r.status === 0 && fs.existsSync(f)) frames.push(f);
    }
    if (!frames.length) return null;
    const fd = faceDistances(frames, okRefs);
    const faced = fd ? fd.frames.filter((x) => x.d && x.d.length) : [];
    if (faced.length) return { method: 'face', score: r3(mean(faced.map((x) => Math.min(...x.d)))), faceFrames: faced.length, frames: frames.length };
    const rh = okRefs.map((f) => pixels(f)).filter(Boolean).map((p) => colourHist(p, { foreground: true }));
    // pixels straight from the clip: a PNG round trip shifts the colours (another YUV -> RGB conversion)
    const ds = [0.25, 0.5, 0.75].map((p) => pixels(file, len * p)).filter(Boolean).map((p) => { const h = colourHist(p); return Math.min(...rh.map((r) => colourMissing(r, h))); });
    if (!rh.length || !ds.length) return null;
    const note = !fd ? null : fd.refs.some((x) => x.face) ? 'no face found in the sampled frames' : 'no face in the reference image(s)';
    return { method: 'colour', score: r3(mean(ds)), faceFrames: 0, frames: frames.length, ...(note ? { note } : {}) };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const FIX = {
  black: 're-generate the shot with a new seed, or replace it with a still',
  frozen: 're-generate the shot, or use a generated still with a Ken Burns move',
  duration: "re-generate at the backend's max clip length, or let the planner split the beat into more shots",
  flicker: 're-generate with a new seed, or trim the shot to its steady part',
  drift: 're-generate with the character reference images (a backend with references), or cut the shot',
  card: 'configure a video or image backend (AI_VIDEO_EDITOR_BACKEND or ~/.ai-video-editor/providers.json) and re-render',
  fallback: 'check the backend error in report.json, then re-render this shot',
};
export const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/**
 * QA of one conformed shot. `raw` is the produceShot() result (duration match + source), `len` the conformed length,
 * `start` its place on the final timeline. Returns {metrics, weak:[{shot, timestamp, startSec, reason, fix}]}.
 */
export function qaShot({ shot, raw, file, len, start, refs = [], limits = QA_LIMITS }) {
  const s = scanClip(file);
  const blackSec = r3(s.black.reduce((a, b) => a + (b.end - b.start), 0));
  const frozen = s.freezeStarts.map((st, i) => ({ start: st, end: s.freezeEnds[i] ?? len }));
  const frozenSec = r3(frozen.reduce((a, b) => a + (b.end - b.start), 0));
  const flicker = flickerScore(s.ydif, s.yavg);
  const metrics = {
    source: raw.source, blackSec, frozenSec, ydifMean: r3(mean(s.ydif.slice(1))), flicker,
    requestedSec: raw.requestedSec ?? null, rawSec: raw.rawDuration != null ? r3(raw.rawDuration) : null,
  };
  const weak = [];
  const add = (key, reason, at = 0) => weak.push({ shot: shot.id, timestamp: fmtTime(start + at), startSec: r3(start + at), check: key, reason, fix: FIX[key] });
  if (raw.source === 'card') add('card', raw.fallbacks?.length ? `no generated picture (${raw.fallbacks.join('; ')}); a text card stands in` : 'no generation backend; a text card stands in');
  else if (raw.fallbacks?.length) add('fallback', `fell back to ${raw.source}: ${raw.fallbacks.join('; ')}`);
  if (s.black.length && blackSec >= Math.min(limits.blackSec, len * limits.blackRatio)) add('black', `${blackSec} s of black frames (from ${r3(s.black[0].start)} s into the shot)`, s.black[0].start);
  if (raw.source !== 'card' && raw.source !== 'still' && frozenSec >= len * limits.frozenRatio) add('frozen', `frozen for ${frozenSec} of ${r3(len)} s`, frozen[0].start);
  if (raw.source === 'video' && metrics.rawSec != null && metrics.requestedSec != null && Math.abs(metrics.rawSec - metrics.requestedSec) > limits.durationSec) {
    metrics.durationMatch = false;
    add('duration', `backend returned ${metrics.rawSec} s for a ${metrics.requestedSec} s request${metrics.rawSec < metrics.requestedSec ? ' (last frame held to fill)' : ' (trimmed)'}`);
  } else if (raw.source === 'video' && metrics.rawSec != null && metrics.rawSec + 1 < shot.durationSec) {
    // a shot longer than the backend's clip limit (an edited plan): the clip ends early and its last frame is held
    metrics.durationMatch = false;
    add('duration', `generated clip is ${metrics.rawSec.toFixed(1)} s for a ${Number(shot.durationSec).toFixed(1)} s shot; the last frame is held for ${(shot.durationSec - metrics.rawSec).toFixed(1)} s`);
  } else if (raw.source === 'video') metrics.durationMatch = true;
  if (flicker > limits.flicker) add('flicker', `flicker score ${flicker} (limit ${limits.flicker})`);
  if (refs.length && raw.source !== 'card') {
    const d = identityDrift(file, len, refs);
    if (d) {
      metrics.identity = d;
      const lim = d.method === 'face' ? limits.drift : (limits.driftColour ?? QA_LIMITS.driftColour);
      if (d.score > lim) add('drift', `identity drift ${d.score} from the reference image(s) of ${shot.characters.join(', ')} (limit ${lim}, ${d.method === 'face' ? 'face + torso' : 'colour only, no face found'})`);
    }
  }
  return { metrics, weak };
}

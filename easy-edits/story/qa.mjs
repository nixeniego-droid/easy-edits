// Per-shot QA for generated (and user) clips: black and frozen frames (ffmpeg blackdetect / freezedetect), duration
// match against the request, a flicker score from signalstats YDIF / YAVG, and identity drift against the
// character reference images (a colour-histogram distance plus an average-hash distance, a cheap proxy that needs
// no face model). Problems become WEAK_SHOTS entries: shot id, timestamp, reason, suggested fix.
import { spawnSync } from 'node:child_process';
import { ff, r3 } from './ffx.mjs';

export const QA_LIMITS = { blackSec: 0.25, blackRatio: 0.2, frozenRatio: 0.6, durationSec: 0.2, flicker: 3.0, drift: 0.55 };

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

/** 32x32 RGB pixels of one frame (or of an image), cover-cropped to square. */
function thumb(file, t) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', ...(t != null ? ['-ss', t.toFixed(3)] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=32:32:force_original_aspect_ratio=increase,crop=32:32,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  if (r.status !== 0 || r.stdout.length < 32 * 32 * 3) return null;
  return r.stdout;
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

/** Identity-drift proxy: Bhattacharyya distance of 8x8x8 RGB histograms (0 same .. 1 disjoint) and aHash Hamming/64. */
export function imageDistance(a, b) {
  const ha = hist(a), hb = hist(b);
  let bc = 0;
  for (let i = 0; i < 512; i++) bc += Math.sqrt(ha[i] * hb[i]);
  const pa = ahash(a), pb = ahash(b);
  return { hist: r3(Math.sqrt(Math.max(0, 1 - bc))), hash: r3(pa.filter((v, i) => v !== pb[i]).length / 64) };
}

/** Drift of a clip from its reference images: frames at 25 / 50 / 75 %, best-matching ref per frame, averaged. */
export function identityDrift(file, len, refs) {
  const rt = refs.map((f) => thumb(f)).filter(Boolean);
  if (!rt.length) return null;
  const ds = [0.25, 0.5, 0.75].map((p) => thumb(file, len * p)).filter(Boolean).map((fr) => rt.map((r) => imageDistance(fr, r)).sort((x, y) => x.hist - y.hist)[0]);
  if (!ds.length) return null;
  return { hist: r3(mean(ds.map((d) => d.hist))), hash: r3(mean(ds.map((d) => d.hash))), score: r3(mean(ds.map((d) => 0.7 * d.hist + 0.3 * d.hash))) };
}

const FIX = {
  black: 're-generate the shot with a new seed, or replace it with a still',
  frozen: 're-generate the shot, or use a generated still with a Ken Burns move',
  duration: "re-generate at the backend's max clip length, or let the planner split the beat into more shots",
  flicker: 're-generate with a new seed, or trim the shot to its steady part',
  drift: 're-generate with the character reference images (a backend with references), or cut the shot',
  card: 'configure a video or image backend (EASY_EDITS_BACKEND or ~/.easy-edits/providers.json) and re-render',
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
      if (d.score > limits.drift) add('drift', `identity drift ${d.score} from the reference image(s) of ${shot.characters.join(', ')} (limit ${limits.drift})`);
    }
  }
  return { metrics, weak };
}

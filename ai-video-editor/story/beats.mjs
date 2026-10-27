// Local beat / onset detection for music video, in plain node over ffmpeg-decoded PCM (no extra dependencies).
// Onset envelope: half-wave-rectified log-energy rise of the full band plus a crude high band (first difference),
// at a 128-sample hop (5.8 ms at 22.05 kHz). Tempo: autocorrelation of the envelope with a soft prior around
// 120 BPM. Beats: dynamic-programming beat tracking over the envelope (onset strength vs. tempo consistency), each
// beat then moved onto the strongest onset within 40 ms. Downbeats: every 4th beat, phase with the most energy.
import { spawnSync } from 'node:child_process';
import { r3 } from './ffx.mjs';

const SR = 22050, HOP = 128, WIN = 256;

export function decodeMono(file, sr = SR) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`could not decode the song: ${String(r.stderr).slice(-400)}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}

/** Onset strength per hop and the time (s) of each hop's window end, where a new sound first shows. */
export function onsetEnvelope(x, sr = SR) {
  const n = Math.max(0, Math.floor((x.length - WIN) / HOP) + 1);
  const eF = new Float64Array(n), eH = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0, b = 0;
    for (let k = i * HOP, e = k + WIN; k < e; k++) { a += x[k] * x[k]; const d = k ? x[k] - x[k - 1] : 0; b += d * d; }
    eF[i] = Math.log10(1e-10 + a / WIN); eH[i] = Math.log10(1e-10 + b / WIN);
  }
  const env = new Float64Array(n);
  for (let i = 1; i < n; i++) env[i] = Math.max(0, eF[i] - eF[i - 1]) + Math.max(0, eH[i] - eH[i - 1]);
  const peak = env.reduce((m, v) => Math.max(m, v), 0) || 1;
  for (let i = 0; i < n; i++) env[i] /= peak;
  return { env, hopSec: HOP / sr, t0: WIN / sr };
}

/** Peaks of the envelope over a local adaptive threshold, >= 60 ms apart. */
export function pickOnsets(env, hopSec, t0) {
  const w = Math.round(0.25 / hopSec), gap = Math.round(0.06 / hopSec), out = [];
  let last = -gap;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] < env[i - 1] || env[i] < env[i + 1] || env[i] < 0.08) continue;
    let s = 0, c = 0;
    for (let j = Math.max(0, i - w); j < Math.min(env.length, i + w); j++) { s += env[j]; c++; }
    if (env[i] < (s / c) * 1.5 + 0.05) continue;
    if (i - last < gap) { if (env[i] > env[last]) out[out.length - 1] = i; else continue; } else out.push(i);
    last = i;
  }
  return out.map((i) => ({ i, t: r3(t0 + (i - 1) * hopSec), strength: r3(env[i]) }));
}

/** Tempo (beat period in hops) from the envelope autocorrelation, 60-200 BPM, prior centred on 120 BPM. */
export function estimatePeriod(env, hopSec) {
  const lo = Math.round(60 / 200 / hopSec), hi = Math.round(60 / 60 / hopSec);
  let best = lo, bestV = -1;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    const bpm = 60 / (lag * hopSec), w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.0) ** 2);
    const v = (s / (env.length - lag)) * w;
    if (v > bestV) { bestV = v; best = lag; }
  }
  return best;
}

/** Dynamic-programming beat tracking (onset strength + log-interval penalty from the period), then backtrace. */
export function trackBeats(env, period, { alpha = 100 } = {}) {
  const n = env.length, score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0, arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const v = score[p] - alpha * Math.log((t - p) / period) ** 2;
      if (v > best || arg < 0) { best = v; arg = p; }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  let end = n - 1;
  for (let t = Math.max(0, n - period); t < n; t++) if (score[t] > score[end]) end = t;
  const beats = [];
  for (let t = end; t >= 0; t = back[t]) { beats.unshift(t); if (back[t] < 0) break; }
  return beats;
}

/**
 * Analyse a song: {durationSec, bpm, beats[], downbeats[], onsets[], method}. Beats with almost no onset strength
 * (silence before the music starts / after it ends) are dropped.
 */
export function analyseBeats(file) {
  const x = decodeMono(file);
  const durationSec = r3(x.length / SR);
  const { env, hopSec, t0 } = onsetEnvelope(x);
  const onsets = pickOnsets(env, hopSec, t0);
  if (onsets.length < 4) return { durationSec, bpm: null, beats: [], downbeats: [], onsets: onsets.map((o) => o.t), method: 'energy-onset+dp', note: 'too few onsets for a beat grid' };
  const period = estimatePeriod(env, hopSec);
  const raw = trackBeats(env, period);
  const snapW = Math.round(0.04 / hopSec), first = onsets[0].i - snapW, lastOn = onsets[onsets.length - 1].i + snapW;
  const beats = raw.filter((i) => i >= first && i <= lastOn).map((i) => {
    const near = onsets.filter((o) => Math.abs(o.i - i) <= snapW).sort((a, b) => b.strength - a.strength)[0];
    return near ? near.t : r3(t0 + (i - 1) * hopSec);
  }).filter((t, k, a) => !k || t - a[k - 1] > 0.1);
  const strength = (t) => { const i = Math.round((t - t0) / hopSec) + 1; return env[Math.min(env.length - 1, Math.max(0, i))]; };
  let phase = 0, bestS = -1;
  for (let p = 0; p < 4; p++) { let s = 0; for (let k = p; k < beats.length; k += 4) s += strength(beats[k]); if (s > bestS) { bestS = s; phase = p; } }
  const ivs = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
  const bpm = ivs.length ? r3(60 / ivs[Math.floor(ivs.length / 2)]) : r3(60 / (period * hopSec));
  return { durationSec, bpm, beats, downbeats: beats.filter((_, k) => k % 4 === phase), onsets: onsets.map((o) => o.t), method: 'energy-onset+dp' };
}

/**
 * Cut points for a song: walk the song in steps of ~shotSec, snapping each cut to the nearest beat (a downbeat
 * when one is about as close) within `tolerance` s, never letting a shot exceed `maxSec`. Cuts land on the 30 fps
 * grid; snapErrorMs is the distance from the frame-quantised cut to the nearest detected beat.
 */
export function beatCuts(analysis, { shotSec = 2, tolerance = 0.25, maxSec = Infinity, minSec = 0.5, fps = 30 } = {}) {
  const end = Math.floor(analysis.durationSec * fps) / fps, beats = analysis.beats || [], down = new Set(analysis.downbeats || []);
  const q = (t) => Math.round(t * fps) / fps, cuts = [];
  const nearest = (t) => beats.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), beats[0] ?? t);
  let t = 0;
  for (let guard = 0; guard < 10000; guard++) {
    const target = t + shotSec;
    if (end - t <= Math.min(maxSec, shotSec + minSec)) break;
    const cands = beats.filter((b) => b > t + minSec && b <= Math.min(t + maxSec, end - minSec) && Math.abs(b - target) <= tolerance);
    let pick = null;
    if (cands.length) {
      cands.sort((a, b) => (Math.abs(a - target) - (down.has(a) ? 0.06 : 0)) - (Math.abs(b - target) - (down.has(b) ? 0.06 : 0)));
      pick = cands[0];
    }
    const at = q(pick ?? Math.min(target, t + maxSec));
    const nb = beats.length ? nearest(at) : null;
    cuts.push({ at: r3(at), target: r3(target), beat: pick != null ? pick : null, snapped: pick != null, downbeat: pick != null && down.has(pick), snapErrorMs: nb != null ? Math.round(Math.abs(at - nb) * 1000) : null });
    t = at;
  }
  return { cuts, end: r3(end) };
}

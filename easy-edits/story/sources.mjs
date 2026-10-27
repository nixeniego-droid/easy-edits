// Per-shot sources for story / music-video. Order of preference: the video backend (getBackend('video')), then the
// image backend + a Ken Burns move, then a code-drawn text card. User footage (shot.clip) is used as given.
// Every shot is conformed to WxH, 30 fps, BT.709 yuv420p, at exactly the length the timeline needs.
import fs from 'node:fs';
import path from 'node:path';
import { getBackend } from '../gen/index.mjs';
import { ff, probe, conformFilter, nearestAspect, X264, TAG709, FPS, r3, sha } from './ffx.mjs';
import { genOpts } from '../new/hostflow.mjs';

/** The backends for a run: injected ones (tests / callers) win, else the gen registry (EASY_EDITS_BACKEND, --backend). */
export function resolveBackends(name, injected = {}) {
  const get = (kind) => { if (injected[kind]) return injected[kind]; try { return getBackend(kind, { name }); } catch { return getBackend(kind, { name: 'none' }); } };
  return { video: get('video'), image: get('image'), tts: get('tts') };
}
export const usable = (b, kind) => !!b && b.name !== 'none' && (kind !== 'video' || (b.capabilities?.maxClipSeconds || 0) > 0);

/** The source the plan should use when a shot has no clip: video > still > card. */
export function plannedSource(backends) {
  return usable(backends.video, 'video') ? 'video' : usable(backends.image, 'image') ? 'still' : 'card';
}

const seedOf = (shot, planId) => (shot.seed != null ? Number(shot.seed) : parseInt(sha(`${planId}:${shot.id}`).slice(0, 8), 16));

/**
 * Generate (or take) the raw media for one shot. Falls back video -> still -> card and records why.
 * Returns {source, file, rawDuration, requestedSec, refsPassed, cost, cached, fallbacks:[...], request}.
 * With the host backend (the assistant generates the asset) the request goes into <hostDir>/GENERATION_MANIFEST.json
 * and the result is {source: 'pending'}: the caller collects those and stops before conforming anything.
 */
export async function produceShot(shot, { backends, width, height, work, offline, planId = 'plan', hostDir = work }) {
  const fallbacks = [];
  const genDir = path.join(work, 'gen');
  if (shot.source === 'clip') return { source: 'clip', file: shot.clip, rawDuration: probe(shot.clip).duration, requestedSec: shot.durationSec, refsPassed: 0, cost: 0, fallbacks };
  const order = { video: ['video', 'still', 'card'], still: ['still', 'card'], card: ['card'] }[shot.source] || ['card'];
  for (const src of order) {
    if (src === 'card') return { source: 'card', file: null, rawDuration: null, requestedSec: shot.durationSec, refsPassed: 0, cost: 0, fallbacks };
    const kind = src === 'video' ? 'video' : 'image', b = backends[kind];
    if (!usable(b, kind)) { fallbacks.push(`${kind} backend "${b?.name || 'none'}" not available`); continue; }
    const caps = b.capabilities || {};
    const refs = caps.references ? (shot.refs || []) : [];
    const req = {
      prompt: shot.fullPrompt || shot.prompt, aspect: nearestAspect(width, height, caps.aspects) || `${width}:${height}`, width, height,
      refs, seed: seedOf(shot, planId), ...(kind === 'video' ? { durationSec: Math.min(shot.durationSec, caps.maxClipSeconds || shot.durationSec) } : {}),
    };
    try {
      const r = await b.generate(req, genOpts(b, { out: hostDir, dir: genDir, id: shot.id, kind, req, offline }));
      if (r?.pending) return { source: 'pending', kind, file: r.file, rawDuration: null, requestedSec: req.durationSec ?? shot.durationSec, refsPassed: refs.length, cost: 0, fallbacks, backend: b.name };
      if (!r?.file || !fs.existsSync(r.file)) throw new Error('backend returned no file');
      return {
        source: src, file: r.file, rawDuration: kind === 'video' ? (r.durationSec ?? probe(r.file).duration) : null,
        requestedSec: req.durationSec ?? shot.durationSec, refsPassed: refs.length, cost: r.cost || 0, cached: !!r.cached, fallbacks,
        request: { ...req, refs: refs.map((f) => path.basename(f)) }, backend: b.name,
      };
    } catch (e) { fallbacks.push(`${kind} backend "${b.name}" failed: ${String(e.message).split('\n')[0]}`); }
  }
  return { source: 'card', file: null, rawDuration: null, requestedSec: shot.durationSec, refsPassed: 0, cost: 0, fallbacks };
}

function wrap(text, perLine) {
  const out = []; let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if ((cur + ' ' + w).trim().length > perLine && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out.slice(0, 8);
}

/** Ken Burns moves, cycled per shot: zoom in, zoom out, pan right, pan left (on a 2x cover-scaled still). */
function kenBurns(w, h, n, i) {
  const z = ['1+0.12*on/N', '1.12-0.12*on/N', '1.08', '1.08'][i % 4].replace(/N/g, String(Math.max(1, n - 1)));
  const x = ['iw/2-(iw/zoom/2)', 'iw/2-(iw/zoom/2)', `(iw-iw/zoom)*on/${Math.max(1, n - 1)}`, `(iw-iw/zoom)*(1-on/${Math.max(1, n - 1)})`][i % 4];
  return `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='${z}':x='${x}':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${FPS},setsar=1,format=yuv420p,${TAG709}`;
}

/**
 * Conform a shot's raw media to `len` seconds at WxH / 30 fps / BT.709: video and clips are scaled to cover and
 * cropped, then padded by holding the last frame if short; stills get a Ken Burns move; cards are drawn.
 */
export function conformShot(raw, shot, { width: w, height: h, len, out, index = 0 }) {
  const n = Math.round(len * FPS), t = (len).toFixed(3);
  if (raw.source === 'video' || raw.source === 'clip') {
    const ss = raw.source === 'clip' && shot.clipStart ? ['-ss', String(shot.clipStart)] : [];
    ff(['-v', 'error', ...ss, '-i', raw.file, '-an', '-vf', `${conformFilter(w, h)},tpad=stop_mode=clone:stop_duration=${t},trim=end_frame=${n},setpts=PTS-STARTPTS`, '-frames:v', String(n), ...X264, out], { label: `conform ${shot.id}` });
  } else if (raw.source === 'still') {
    ff(['-v', 'error', '-loop', '1', '-framerate', String(FPS), '-t', t, '-i', raw.file, '-vf', kenBurns(w, h, n, index), '-frames:v', String(n), ...X264, out], { label: `ken burns ${shot.id}` });
  } else {
    const fs1 = Math.round(Math.min(w, h) / 16), lines = wrap(shot.prompt || shot.id, Math.max(12, Math.floor(w / (fs1 * 0.58))));
    const tf = `${out}.txt`;
    fs.writeFileSync(tf, lines.join('\n'));
    const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    ff(['-v', 'error', '-f', 'lavfi', '-i', `color=c=0x1d2433:s=${w}x${h}:r=${FPS}:d=${t}`, '-vf',
      `drawtext=font=Sans:textfile='${esc(tf)}':fontcolor=white:fontsize=${fs1}:line_spacing=${Math.round(fs1 * 0.35)}:x=(w-tw)/2:y=(h-th)/2,drawtext=font=Sans:text='${String(shot.id).replace(/[^A-Za-z0-9_.-]/g, '')}':fontcolor=0x9aa4b8:fontsize=${Math.round(fs1 * 0.6)}:x=${Math.round(fs1 * 0.6)}:y=${Math.round(fs1 * 0.6)},format=yuv420p,${TAG709}`,
      '-frames:v', String(n), ...X264, out], { label: `card ${shot.id}` });
    fs.rmSync(tf, { force: true });
  }
  return { file: out, duration: r3(probe(out).duration) };
}

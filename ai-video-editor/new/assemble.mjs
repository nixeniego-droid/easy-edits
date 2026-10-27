// Shared render toolkit for `ai-video-editor new` recipes (ffmpeg only, no HyperFrames):
//   formats      parseFormats('9x16,4x5,720x1280') -> [{ id, w, h }]
//   shots        conformClip / stillClip / codeCard: one WxH 30 fps BT.709 clip per shot, exact duration
//   timeline     assembleVideo: crossfade the clips (xfade), burn captions, write a video-only mp4
//   audio        voiceTimeline (TTS segments + turn gaps), premix (voice + room tone + bed), synthBed
//   captions     captionsFromSegments (known script text timed per TTS segment), writeSrt / writeVtt
//   finish       muxAndMaster (masterTo, social / podcast preset)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { masterVideoAudio } from './finish.mjs';

export const FPS = 30;
export const ASPECTS = { '9x16': [1080, 1920], '16x9': [1920, 1080], '1x1': [1080, 1080], '4x5': [1080, 1350] };

/** --format 9x16 | 16x9 | 1x1 | 4x5 | WxH (custom, even, 128-4096) | all (9x16, 1x1, 16x9); comma-separated. */
export function parseFormats(spec = '9x16') {
  const ids = String(spec).toLowerCase() === 'all' ? ['9x16', '1x1', '16x9'] : String(spec).split(',').map((s) => s.trim().toLowerCase().replace(':', 'x')).filter(Boolean);
  const out = [];
  for (const id of ids) {
    if (ASPECTS[id]) { out.push({ id, w: ASPECTS[id][0], h: ASPECTS[id][1] }); continue; }
    const m = id.match(/^(\d{3,4})x(\d{3,4})$/);
    if (!m) throw new Error(`unknown format ${id} (9x16, 16x9, 1x1, 4x5, all, or a custom WxH such as 720x1280)`);
    const [w, h] = [Number(m[1]), Number(m[2])];
    if (w < 128 || h < 128 || w > 4096 || h > 4096 || w % 2 || h % 2) throw new Error(`custom format ${id}: width and height must be even and 128-4096`);
    out.push({ id, w, h });
  }
  if (!out.length) throw new Error('--format: no format given');
  return out;
}

export const aspectOf = ({ w, h }) => { const g = (a, b) => (b ? g(b, a % b) : a); const d = g(w, h); return `${w / d}:${h / d}`; };

export function ff(args, label = 'ffmpeg', { logFile } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (logFile) fs.appendFileSync(logFile, `\n$ ffmpeg ${args.join(' ')}\n${r.stderr || ''}exit ${r.status}\n`);
  if (r.status !== 0) throw new Error(`${label} failed: ${(r.stderr || '').slice(-1500)}`);
  return r;
}

const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
const TO709 = 'out_color_matrix=bt709:out_range=tv';
// frame-level tags: ffmpeg 7 takes the encoder's colour description from the frames, so tag them explicitly
export const TAG709 = 'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709';
const q = (s) => `'${String(s).replace(/\\/g, '/').replace(/'/g, '')}'`;

let fontCache;
/**
 * drawtext font option: AI_VIDEO_EDITOR_NEW_FONT (a font file), else the first STATIC bold sans fontconfig finds
 * (drawtext renders only the default instance of a variable font, which for Montserrat is Thin), else any sans.
 */
export function fontOpt() {
  if (fontCache) return fontCache;
  if (process.env.AI_VIDEO_EDITOR_NEW_FONT && fs.existsSync(process.env.AI_VIDEO_EDITOR_NEW_FONT)) return (fontCache = `fontfile=${q(process.env.AI_VIDEO_EDITOR_NEW_FONT)}`);
  for (const pat of ['Montserrat:bold', 'Liberation Sans:bold', 'DejaVu Sans:bold', 'Noto Sans:bold', 'sans:bold']) {
    const r = spawnSync('fc-match', ['-f', '%{file}', pat], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout || !fs.existsSync(r.stdout)) continue;
    const v = spawnSync('fc-query', ['-f', '%{variable}|', r.stdout], { encoding: 'utf8' });
    if (/True/i.test(v.stdout || '')) continue;
    return (fontCache = `fontfile=${q(r.stdout)}`);
  }
  return (fontCache = 'font=Sans');
}

/** Greedy word wrap to `max` characters per line. */
export function wrap(text, max) {
  const lines = []; let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

let textSeq = 0;
/** A drawtext filter reading its text from a file (no escaping problems; % is literal). */
export function drawText(work, text, { size, color = '#FFFFFF', x = '(w-text_w)/2', y, box = null, enable = null, alpha = null, borderw = 0, bordercolor = 'black' }) {
  fs.mkdirSync(path.join(work, 'text'), { recursive: true });
  const f = path.join(work, 'text', `t${process.pid}_${++textSeq}.txt`);
  fs.writeFileSync(f, String(text));
  const parts = [fontOpt(), `textfile=${q(f)}`, 'expansion=none', `fontsize=${Math.round(size)}`, `fontcolor=${color}`, `x='${x}'`, `y='${y}'`, `line_spacing=${Math.round(size * 0.22)}`];
  if (box) parts.push('box=1', `boxcolor=${box}`, `boxborderw=${Math.round(size * 0.25)}`);
  if (borderw) parts.push(`borderw=${borderw}`, `bordercolor=${bordercolor}`);
  if (alpha) parts.push(`alpha='${alpha}'`);
  if (enable) parts.push(`enable='${enable}'`);
  return `drawtext=${parts.join(':')}`;
}

/** One drawtext per line so every line is centred; `top` is the y of the first line (a number or an expression). */
export function drawLines(work, lines, { size, top, lineH = size * 1.22, ...o }) {
  return lines.map((ln, i) => drawText(work, ln, { ...o, size, y: `${top}+${Math.round(i * lineH)}` })).join(',');
}

const enc = (out, dur) => [...ENC, '-t', dur.toFixed(3), '-an', out];

/** Conform a video clip to WxH / 30 fps / BT.709, cover-cropped, exactly `dur` s (the last frame is held if short). */
export function conformClip(src, out, { w, h, dur, logFile }) {
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase:${TO709},crop=${w}:${h},setsar=1,fps=${FPS},format=yuv420p,${TAG709},tpad=stop_mode=clone:stop_duration=${(dur + 1).toFixed(2)},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS`;
  ff(['-i', src, '-vf', vf, ...enc(out, dur)], 'conform clip', { logFile });
  return out;
}

/** A still (generated or the user's image) as a clip with a slow Ken Burns push across it. */
export function stillClip(img, out, { w, h, dur, dir = 1, logFile }) {
  const W = Math.ceil(w * 1.12 / 2) * 2, H = Math.ceil(h * 1.12 / 2) * 2;
  const x = dir > 0 ? `(iw-ow)*t/${dur.toFixed(3)}` : `(iw-ow)*(1-t/${dur.toFixed(3)})`;
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase:${TO709},crop=${w}:${h}:x='${x}':y='(ih-oh)/2',setsar=1,fps=${FPS},format=yuv420p,${TAG709}`;
  ff(['-loop', '1', '-framerate', String(FPS), '-t', dur.toFixed(3), '-i', img, '-vf', vf, ...enc(out, dur)], 'still clip', { logFile });
  return out;
}

/**
 * A code-drawn scene: solid background, optional image (logo / product) and text layers that fade and rise in.
 * layers: [{ text, size (fraction of the short side), color, y (fraction of height), box, delay, maxChars }]
 * image:  { file, height (fraction of h), y (fraction of h) }
 * bars:   [{ x, y, w, h (fractions of the frame), color }] solid shapes drawn under the text
 */
export function codeCard(out, { w, h, dur, bg = '#101418', layers = [], image = null, bars = [], work, logFile }) {
  const short = Math.min(w, h);
  const inputs = ['-f', 'lavfi', '-i', `color=c=${bg}:s=${w}x${h}:r=${FPS}:d=${dur.toFixed(3)}`];
  let chain = '[0:v]format=yuv420p';
  let pre = '';
  if (image?.file) {
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', dur.toFixed(3), '-i', image.file);
    const ih = Math.round(h * (image.height || 0.25) / 2) * 2;
    pre = `[1:v]scale=-2:${ih}:force_original_aspect_ratio=decrease,scale='min(iw,${Math.round(w * 0.8 / 2) * 2})':-2,format=rgba,fade=t=in:st=0.1:d=0.4:alpha=1[img];`;
    chain = `[0:v][img]overlay=x=(W-w)/2:y=${Math.round(h * (image.y ?? 0.3))}-h/2:shortest=1,format=yuv420p`;
  }
  for (const b of bars) chain += `,drawbox=x=${Math.round(w * b.x)}:y=${Math.round(h * b.y)}:w=${Math.max(2, Math.round(w * b.w))}:h=${Math.max(2, Math.round(h * b.h))}:color=${b.color}:t=fill`;
  for (const l of layers) {
    if (!l.text) continue;
    const size = short * (l.size || 0.06);
    const lines = wrap(l.text, l.maxChars || Math.max(8, Math.floor(w * 0.84 / (size * 0.58))));
    const blockH = lines.length * size * 1.22;
    const d = l.delay ?? 0.15;
    const y0 = Math.round(h * l.y - blockH / 2);
    chain += `,${drawLines(work, lines, { size, color: l.color || '#FFFFFF', top: `${y0}+${Math.round(size * 0.5)}*max(0,1-(t-${d})/0.45)`, alpha: `min(1,max(0,(t-${d})/0.45))`, box: l.box || null })}`;
  }
  ff([...inputs, '-filter_complex', `${pre}${chain},${TAG709},setsar=1[v]`, '-map', '[v]', ...enc(out, dur)], 'code card', { logFile });
  return out;
}

export const XFADE = { fade: 'fade', crossfade: 'fade', dissolve: 'dissolve', wipe: 'wipeleft', wipeleft: 'wipeleft', wiperight: 'wiperight', slide: 'slideleft', slideleft: 'slideleft', slideup: 'slideup', circle: 'circleopen', zoom: 'zoomin', fadeblack: 'fadeblack', cut: 'fade' };
export const XFADE_SEC = 0.4;
export const transitionSec = (t) => (t === 'cut' ? 1 / FPS : XFADE_SEC);

/**
 * Fit planned shot durations to a timeline of `total` s once the clips overlap by their transitions:
 * sum(d) - sum(transition overlaps) = total. Returns new durations (each >= 0.6 s + its overlaps).
 */
export function fitDurations(shots, total) {
  const ov = shots.map((s, i) => (i === 0 ? 0 : transitionSec(s.transition || 'fade')));
  const planned = shots.reduce((a, s) => a + (s.durationSec || 1), 0);
  const k = (total + ov.reduce((a, b) => a + b, 0)) / planned;
  return shots.map((s, i) => Math.max(0.6 + ov[i] + (ov[i + 1] || 0), (s.durationSec || 1) * k));
}

/**
 * Shots tied to voice lines (shot.voice = voice id): each line's shots span from that line's start (0 for the first)
 * to the next line's start, split by planned length; clip k is T(k+1) - T(k) + the next transition's overlap, so the
 * picture changes when the line does. Returns null when a shot has no matching segment.
 */
export function voiceDurations(shots, segments, total) {
  const byId = Object.fromEntries(segments.map((s) => [s.id, s]));
  if (!shots.every((s) => s.voice && byId[s.voice])) return null;
  const order = segments.map((s) => s.id);
  const starts = [];
  for (const id of order) {
    const group = shots.filter((s) => s.voice === id);
    if (!group.length) continue;
    const i = order.indexOf(id);
    const a = starts.length ? byId[id].start : 0;
    const nextId = order.slice(i + 1).find((n) => shots.some((s) => s.voice === n));
    const b = nextId ? byId[nextId].start : total;
    const sum = group.reduce((x, s) => x + s.durationSec, 0);
    let t = a;
    for (const g of group) { starts.push(t); t += (b - a) * g.durationSec / sum; }
  }
  return shots.map((s, k) => (k + 1 < shots.length ? starts[k + 1] - starts[k] + transitionSec(shots[k + 1].transition || 'fade') : total - starts[k]));
}

/** Timeline length of clips joined with their transitions. */
export const timelineSec = (durs, shots) => durs.reduce((a, d) => a + d, 0) - shots.reduce((a, s, i) => a + (i ? transitionSec(s.transition || 'fade') : 0), 0);

/**
 * Crossfade conformed clips into one video-only mp4 and burn `captions` ([{start,end,text,label?,labelColor?}]).
 * clips: [{ file, durationSec, transition }] (transition = how this clip enters; first is ignored).
 */
export function assembleVideo({ clips, w, h, out, work, captions = [], logFile, extraFilters = '' }) {
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  let graph = '', last = '[0:v]', acc = clips[0].durationSec;
  for (let i = 1; i < clips.length; i++) {
    const t = clips[i].transition || 'fade';
    const d = transitionSec(t);
    acc -= d;
    graph += `${last}[${i}:v]xfade=transition=${XFADE[t] || 'fade'}:duration=${d.toFixed(3)}:offset=${acc.toFixed(3)}[x${i}];`;
    last = `[x${i}]`; acc += clips[i].durationSec;
  }
  const total = acc;
  graph += `${last}format=yuv420p${extraFilters}${captionFilters(captions, { w, h, work })},${TAG709},setsar=1[v]`;
  ff([...inputs, '-filter_complex', graph, '-map', '[v]', ...ENC, '-r', String(FPS), '-t', total.toFixed(3), '-an', out], 'assemble', { logFile });
  return { file: out, durationSec: total };
}

/** drawtext filters for burned captions: boxed, lower third of the frame, optional speaker label above. */
export function captionFilters(captions, { w, h, work, color = '#FFFFFF' }) {
  if (!captions.length) return '';
  const short = Math.min(w, h);
  const size = Math.round(short * (w < h ? 0.052 : 0.045));
  const maxChars = Math.max(10, Math.floor(w * 0.82 / (size * 0.56)));
  const lineH = size * 1.5;
  const centre = h * (w < h ? 0.76 : 0.83);
  let f = '';
  for (const c of captions) {
    const lines = wrap(c.text, maxChars);
    const top = Math.round(centre - (lines.length * lineH) / 2);
    const en = `between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})`;
    if (c.label) f += `,${drawText(work, c.label, { size: size * 0.72, color: c.labelColor || '#FFD60A', y: `${Math.round(top - size * 1.5)}`, enable: en, box: 'black@0.55' })}`;
    f += `,${drawLines(work, lines, { size, lineH, color: c.color || color, top, enable: en, box: 'black@0.55' })}`;
  }
  return f;
}

/** Split known script segments into caption chunks (<= 6 words / ~32 chars), timed by character share. */
export function captionsFromSegments(segments, { maxWords = 6, maxChars = 32 } = {}) {
  const out = [];
  for (const s of segments) {
    const words = String(s.text).split(/\s+/).filter(Boolean);
    const chunks = []; let cur = [];
    for (const wd of words) {
      const len = [...cur, wd].join(' ').length;
      if (cur.length && (cur.length >= maxWords || len > maxChars)) { chunks.push(cur); cur = []; }
      cur.push(wd);
      if (/[.!?;:]$/.test(wd) && cur.length >= 3) { chunks.push(cur); cur = []; }
    }
    if (cur.length) chunks.push(cur);
    const totalChars = chunks.reduce((a, c) => a + c.join(' ').length, 0) || 1;
    let t = s.start;
    for (const c of chunks) {
      const d = (s.end - s.start) * c.join(' ').length / totalChars;
      out.push({ start: t, end: t + d, text: c.join(' '), label: s.label || null, labelColor: s.labelColor || null, speaker: s.speaker || null });
      t += d;
    }
  }
  return out;
}

const ts = (t, sep) => { const ms = Math.max(0, Math.round(t * 1000)); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`; };
const capText = (c) => (c.label ? `${c.label}: ${c.text}` : c.text);
export function writeSrt(captions, file) { fs.writeFileSync(file, captions.map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${capText(c)}\n`).join('\n')); return file; }
export function writeVtt(captions, file) { fs.writeFileSync(file, `WEBVTT\n\n${captions.map((c) => `${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${capText(c)}\n`).join('\n')}`); return file; }

/**
 * Lay TTS segments on a timeline: lead-in, `gap` s between lines of one speaker, `turnGap` s at a speaker change.
 * segs: [{ file, durationSec, text, speaker }] -> the same with start / end added, and the timeline end.
 */
export function voiceTimeline(segs, { lead = 0.35, gap = 0.18, turnGap = 0.45, tail = 0.6 } = {}) {
  let t = lead, prev = null;
  const out = segs.map((s) => {
    if (prev != null) t += s.speaker !== prev ? turnGap : gap;
    const seg = { ...s, start: t, end: t + s.durationSec };
    t = seg.end; prev = s.speaker;
    return seg;
  });
  return { segments: out, end: t + tail };
}

/** A code-synthesised music bed (soft chord pad with a slow pulse; no samples, no download). */
export function synthBed(out, { dur, logFile }) {
  const notes = [130.81, 196.0, 261.63, 329.63];
  const src = notes.map((f, i) => `sine=f=${f}:d=${dur.toFixed(3)}:sample_rate=48000[n${i}]`).join(';');
  const mix = `${notes.map((_, i) => `[n${i}]`).join('')}amix=inputs=${notes.length}:normalize=0,tremolo=f=2:d=0.35,lowpass=f=1800,volume=0.25,afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, dur - 1.2).toFixed(3)}:d=1.2,aformat=channel_layouts=stereo[a]`;
  ff(['-filter_complex', `${src};${mix}`, '-map', '[a]', '-ar', '48000', '-t', dur.toFixed(3), out], 'music bed', { logFile });
  return out;
}

/**
 * Premix to a 48 kHz stereo wav of exactly `total` s: voice segments at their start times, optional room tone
 * (pink noise, ~-60 dBFS) and an optional bed ({ file, db }, ducked under speech when there is voice).
 */
export function premix(out, { total, segments = [], roomTone = false, bed = null, logFile }) {
  const inputs = ['-f', 'lavfi', '-t', total.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'];
  const labels = ['[0:a]'];
  let g = '';
  segments.forEach((s, i) => {
    inputs.push('-i', s.file);
    const ms = Math.round(s.start * 1000);
    g += `[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[s${i}];`;
    labels.push(`[s${i}]`);
  });
  let n = segments.length + 1;
  if (roomTone) {
    inputs.push('-f', 'lavfi', '-t', total.toFixed(3), '-i', 'anoisesrc=color=pink:amplitude=0.0015:sample_rate=48000');
    g += `[${n}:a]lowpass=f=5000,aformat=channel_layouts=stereo[rt];`; labels.push('[rt]'); n++;
  }
  if (bed?.file) {
    inputs.push('-i', bed.file);
    g += `[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${bed.db ?? (segments.length ? -20 : 0)}dB[bed];`; labels.push('[bed]'); n++;
  }
  g += `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first[a]`;
  ff([...inputs, '-filter_complex', g, '-map', '[a]', '-c:a', 'pcm_s16le', '-t', total.toFixed(3), out], 'premix', { logFile });
  return out;
}

/** Mux the premix into the video-only mp4 and master it to the preset (in place). Returns the measured {I,TP}. */
export function muxAndMaster(video, pre, preset, duration, { silent = false } = {}) {
  if (silent) {
    const tmp = `${video}.mux.mp4`;
    ff(['-i', video, '-i', pre, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', duration.toFixed(3), '-movflags', '+faststart', tmp], 'mux');
    fs.renameSync(tmp, video);
    return null;
  }
  return masterVideoAudio(pre, video, preset, duration);
}

/** Black / frozen frame scan of a generated clip (ffmpeg blackdetect + freezedetect). */
export function clipFaults(file, dur) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.5:pic_th=0.98,freezedetect=n=0.001:d=1.5', '-an', '-f', 'null', '-'], { encoding: 'utf8' });
  const faults = [];
  const black = [...(r.stderr || '').matchAll(/black_duration:([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  const frozen = [...(r.stderr || '').matchAll(/freeze_duration: ([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  if (black > 0.5) faults.push(`${black.toFixed(1)} s of black frames`);
  if (frozen > Math.max(1.5, dur * 0.5)) faults.push(`${frozen.toFixed(1)} s of frozen frames`);
  return faults;
}

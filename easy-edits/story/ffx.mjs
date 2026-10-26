// Story / music-video ffmpeg helpers: run, probe, aspect parsing, BT.709 conform, colour tags, finishing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { masterTo, measure } from '../audio/master.mjs';

export const FPS = 30;
export const BT709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
/** Tag frames BT.709 (ffmpeg 7 encoders follow the frame's colour properties, so the -color_* flags alone are not enough). */
export const TAG709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709';
export const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', ...BT709];
export const r3 = (v) => Math.round(v * 1000) / 1000;
export const sha = (o) => crypto.createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex').slice(0, 12);

export function ff(args, { cwd, label = 'ffmpeg', allowFail = false } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8', cwd, maxBuffer: 1 << 28 });
  if (r.status !== 0 && !allowFail) throw new Error(`${label} failed (exit ${r.status}): ${(r.stderr || '').slice(-1200)}`);
  return r;
}

/** {duration, w, h, fps, hasAudio, color:{primaries, transfer, space}} of a media file. */
export function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate,color_primaries,color_transfer,color_space,duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${path.basename(file)}: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const [n, d] = String(v?.r_frame_rate || '0/1').split('/').map(Number);
  return {
    duration: Number(j.format?.duration || v?.duration || 0), w: v?.width || 0, h: v?.height || 0, fps: d ? n / d : 0,
    hasVideo: !!v, hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio'),
    color: { primaries: v?.color_primaries || null, transfer: v?.color_transfer || null, space: v?.color_space || null },
  };
}

const NAMED = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350], '4:3': [1440, 1080], '3:4': [1080, 1440], '21:9': [2560, 1080] };
const even = (v) => Math.max(2, Math.round(v / 2) * 2);
/**
 * Any aspect: 9:16, 16:9, 1:1, 4:5 (also 9x16 style), a free ratio "A:B" (long side 1920), or an exact size "WxH"
 * (e.g. 1080x1350). Returns {aspect, width, height}.
 */
export function parseAspect(a = '9:16') {
  const s = String(a).trim().toLowerCase().replace(/^(\d+)x(\d+)$/, (m, x, y) => (Number(x) <= 32 && Number(y) <= 32 ? `${x}:${y}` : m));
  if (NAMED[s]) return { aspect: s, width: NAMED[s][0], height: NAMED[s][1] };
  let m = s.match(/^(\d+)x(\d+)$/);
  if (m) { const w = even(Number(m[1])), h = even(Number(m[2])); return { aspect: ratioName(w, h), width: w, height: h }; }
  m = s.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (m) {
    const x = Number(m[1]), y = Number(m[2]);
    if (x > 0 && y > 0 && x / y <= 4 && y / x <= 4) { const k = 1920 / Math.max(x, y); return { aspect: s, width: even(x * k), height: even(y * k) }; }
  }
  throw new Error(`aspect "${a}" not understood: use 9:16, 16:9, 1:1, 4:5, another W:H ratio, or an exact size like 1080x1350`);
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
function ratioName(w, h) { const g = gcd(w, h); return w / g <= 32 && h / g <= 32 ? `${w / g}:${h / g}` : `${w}x${h}`; }

/** The closest aspect a backend lists (its capabilities.aspects) for a WxH output. */
export function nearestAspect(width, height, list = []) {
  if (!list.length) return null;
  const r = width / height;
  return list.map((a) => { const [x, y] = a.split(':').map(Number); return { a, d: Math.abs(Math.log((x / y) / r)) }; }).sort((p, q) => p.d - q.d)[0].a;
}

/** Scale-to-cover + crop to WxH, 30 fps, BT.709 yuv420p, square pixels. */
export const conformFilter = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=increase:out_color_matrix=bt709,crop=${w}:${h},setsar=1,fps=${FPS},format=yuv420p,${TAG709}`;

/** ffprobe colour tags of a file and whether all three are bt709. */
export function colorCheck(file) {
  const c = probe(file).color;
  return { ...c, pass: c.primaries === 'bt709' && c.transfer === 'bt709' && c.space === 'bt709' };
}

/**
 * Master `wav` into the (silent) `video` at `target` LUFS with true peak <= `truePeak` dBTP (audio/master.mjs),
 * tightening the limiter ceiling if the encoded AAC still peaks over the limit. Returns {I, TP, LRA, passes, pass}.
 */
export function finishAudio(wav, video, { duration, target = -14, truePeak = -1.5 }) {
  const keep = `${video}.v.mp4`;
  fs.copyFileSync(video, keep);
  let ceiling = truePeak, m = null;
  for (let i = 0; i < 4; i++) {
    if (i) fs.copyFileSync(keep, video);
    masterTo(wav, video, { duration, target, truePeak: ceiling });
    m = measure(video);
    if (m.TP <= truePeak && Math.abs(m.I - target) <= 0.5) break;
    if (m.TP > truePeak) ceiling -= Math.max(0.3, m.TP - truePeak + 0.1);
  }
  fs.rmSync(keep, { force: true });
  return { I: m.I, TP: m.TP, LRA: m.LRA, target, truePeak, pass: Math.abs(m.I - target) <= 1 && m.TP <= truePeak };
}

/** One frame per shot (its midpoint) in a labelled grid: the render's storyboard sheet. */
export function shotSheet(file, shots, out, { cols = 6 } = {}) {
  const tiles = shots.slice(0, 48);
  if (!tiles.length) return null;
  const p = probe(file), tw = p.w >= p.h ? 320 : 180, dir = path.dirname(out), frames = [];
  tiles.forEach((s, i) => {
    const f = path.join(dir, `.sheet-${i}.png`);
    const t = Math.min(Math.max(0, p.duration - 0.05), s.start + s.durationSec / 2);
    ff(['-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${tw}:-2,drawtext=font=Sans:text='${String(s.id).replace(/[^A-Za-z0-9_.-]/g, '')}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6`, f]);
    frames.push(f);
  });
  const c = Math.min(cols, frames.length);
  const sum = (n, u) => (n ? Array.from({ length: n }, () => u).join('+') : '0');
  if (frames.length === 1) fs.copyFileSync(frames[0], out);
  else ff(['-v', 'error', ...frames.flatMap((f) => ['-i', f]), '-filter_complex', `${frames.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=${frames.length}:layout=${frames.map((_, i) => `${sum(i % c, 'w0')}_${sum(Math.floor(i / c), 'h0')}`).join('|')}:fill=0x111111`, '-frames:v', '1', out]);
  for (const f of frames) fs.rmSync(f, { force: true });
  return out;
}

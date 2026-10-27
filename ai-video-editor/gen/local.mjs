// The `local` generation adapter: everything on this machine, no network, cost 0.
//   image  : an ffmpeg title-card still from the prompt (seeded gradient + wrapped drawtext; an image ref becomes the
//            dimmed background)
//   video  : a still (the image ref, else a generated title card) with a Ken Burns zoompan, H.264, BT.709-tagged
//   tts    : Kokoro-82M (HyperFrames, as explainer mode uses it; needs kokoro-onnx + soundfile), else Piper (on PATH + a voice model), else
//            eSpeak NG / eSpeak, else ffmpeg's flite filter, else a clear error. AI_VIDEO_EDITOR_LOCAL_TTS forces one.
//   avatar : host image + audio -> mp4 with a subtle zoom, labelled SYNTHETIC on screen and in meta, audio mastered
//            to -14 LUFS / -1.5 dBTP (audio/master.mjs), BT.709-tagged. Not lip-synced.
// llm / search are not local; they refuse like `none`.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withCache } from './config.mjs';
import { masterTo } from '../audio/master.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FPS = 30;
export const LOCAL_MAX_CLIP = 20;
export const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const SIZES = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };

function ff(args, opts = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
}
export const probeDuration = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
const has = (bin) => spawnSync('sh', ['-c', `command -v "${bin}"`], { encoding: 'utf8' }).status === 0;
let filterList = null;
const hasFilter = (name) => { filterList ??= spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout || ''; return new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(filterList); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-video-editor-gen-'));
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Output size from {width, height, aspect}: explicit size wins, else the aspect's 1080-wide default (9:16). */
export function frameSize(req = {}) {
  if (req.width && req.height) return [even(req.width), even(req.height)];
  const [w, h] = SIZES[req.aspect] || SIZES['9:16'];
  if (req.width) return [even(req.width), even(req.width * h / w)];
  if (req.height) return [even(req.height * w / h), even(req.height)];
  return [w, h];
}

/** Word-wrap `text` into at most `maxLines` lines of `width` characters (the last one ends in "..." when cut). */
export function wrap(text, width, maxLines = 6) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const word = w.length > width ? `${w.slice(0, width - 1)}-` : w;
    if (!cur) cur = word; else if (cur.length + 1 + word.length <= width) cur += ` ${word}`; else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, width - 3)}...`; }
  return lines;
}

// Two dark colours from the prompt + seed, so the same request always gives the same card.
function palette(prompt, seed = 0) {
  const b = crypto.createHash('sha256').update(`${prompt}|${seed}`).digest();
  const hsl = (h, s, l) => {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return `0x${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  };
  const h = (b[0] / 255) * 360;
  return [hsl(h, 0.55, 0.16), hsl((h + 40 + (b[1] % 60)) % 360, 0.6, 0.32)];
}

// One centred drawtext per line (text from files in cwd, so prompts need no filter escaping).
function titleFilters(dir, lines, w, h, fs_) {
  const gap = Math.round(fs_ * 0.35), block = lines.length * fs_ + (lines.length - 1) * gap;
  return lines.map((ln, i) => {
    fs.writeFileSync(path.join(dir, `l${i}.txt`), ln);
    const y = Math.round((h - block) / 2 + i * (fs_ + gap));
    return `drawtext=font=Sans:textfile=l${i}.txt:fontsize=${fs_}:fontcolor=white:borderw=${Math.max(2, Math.round(fs_ / 18))}:bordercolor=black@0.55:x=(w-text_w)/2:y=${y}`;
  });
}

/** A title-card still (png) for `prompt`, w x h; `bg` (an image) becomes a dimmed, cover-cropped background. */
export function titleCard(file, { prompt, width, height, seed = 0, bg }) {
  const dir = tmp();
  try {
    const fs_ = Math.round(Math.min(width, height) * 0.07);
    const lines = wrap(prompt || 'Untitled', Math.max(8, Math.floor((width * 0.84) / (fs_ * 0.56))));
    const text = titleFilters(dir, lines, width, height, fs_);
    const [c0, c1] = palette(prompt, seed);
    let input, pre;
    if (bg) { input = ['-i', path.resolve(bg)]; pre = [`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`, 'setsar=1', 'eq=brightness=-0.18:saturation=0.85']; }
    else if (hasFilter('gradients')) { input = ['-f', 'lavfi', '-i', `gradients=s=${width}x${height}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${width}:y1=${height}:nb_colors=2:d=1`]; pre = []; }
    else { input = ['-f', 'lavfi', '-i', `color=c=${c0}:s=${width}x${height}:d=1`]; pre = []; }
    ff([...input, '-vf', [...pre, ...text].join(','), '-frames:v', '1', '-update', '1', path.resolve(file)], { cwd: dir });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return file;
}

/** Ken Burns mp4 from a still: zoom in (even seed) or out (odd), d seconds at 30 fps, BT.709-tagged, no audio. */
export function kenBurns(still, file, { width, height, durationSec, seed = 0, maxZoom = 1.12, label }) {
  const n = Math.max(1, Math.round(durationSec * FPS));
  const z = seed % 2 ? `${maxZoom}-${(maxZoom - 1).toFixed(3)}*on/${n}` : `1+${(maxZoom - 1).toFixed(3)}*on/${n}`;
  const dir = tmp();
  try {
    const vf = [
      `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase`, `crop=${width * 2}:${height * 2}`, 'setsar=1',
      `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${width}x${height}:fps=${FPS}`,
    ];
    if (label) {
      fs.writeFileSync(path.join(dir, 'label.txt'), label);
      const ls = Math.max(14, Math.round(Math.min(width, height) * 0.03));
      vf.push(`drawtext=font=Sans:textfile=label.txt:fontsize=${ls}:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=${Math.round(ls / 3)}:x=${Math.round(ls)}:y=${Math.round(ls)}`);
    }
    vf.push('scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p', 'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709');
    ff(['-i', path.resolve(still), '-vf', vf.join(','), '-frames:v', String(n), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', ...BT709, '-movflags', '+faststart', path.resolve(file)], { cwd: dir });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return file;
}

// ---------------------------------------------------------------- TTS engines

const kokoroBin = () => path.join(REPO, 'node_modules', '.bin', 'hyperframes');
// AI_VIDEO_EDITOR_<X>, else the pre-rename EASY_EDITS_<X> (read at call time: env-compat only maps at import)
const envv = (k) => process.env[`AI_VIDEO_EDITOR_${k}`] || process.env[`EASY_EDITS_${k}`] || '';
const piperModel = (voice) => (voice && /\.onnx$/.test(voice) && fs.existsSync(voice) ? voice : envv('PIPER_MODEL'));
// HyperFrames TTS needs kokoro_onnx + soundfile in a python 3 and downloads kokoro-v1.0.onnx on first use.
const kokoroModel = () => path.join(os.homedir(), '.cache', 'hyperframes', 'tts', 'models', 'kokoro-v1.0.onnx');
const KOKORO_PROBE = 'import importlib.util,sys; sys.exit(0 if all(importlib.util.find_spec(m) for m in ["kokoro_onnx","soundfile"]) else 1)';
const kokoroPyCache = new Map();
/** The first python with the Kokoro deps (HYPERFRAMES_PYTHON, AI_VIDEO_EDITOR_PYTHON, python3), or ''. Local probe, no network. */
function kokoroPython() {
  const cands = [...new Set([process.env.HYPERFRAMES_PYTHON, envv('PYTHON'), 'python3'].filter(Boolean))], key = `${cands.join('|')}|${process.env.PATH}`;
  if (!kokoroPyCache.has(key)) kokoroPyCache.set(key, cands.find((py) => spawnSync(py, ['-c', KOKORO_PROBE], { stdio: 'ignore', timeout: 10000 }).status === 0) || '');
  return kokoroPyCache.get(key);
}
const TTS_ENGINES = {
  kokoro: {
    available: () => fs.existsSync(kokoroBin()) && !!kokoroPython(),
    voice: (req) => req.voice || (req.speaker === 'B' ? 'af_heart' : envv('TTS_VOICE') || 'am_michael'),
    run(textFile, raw, voice) { const r = spawnSync(kokoroBin(), ['tts', textFile, '-o', raw, '-v', voice], { encoding: 'utf8', env: { ...process.env, HYPERFRAMES_PYTHON: kokoroPython() } }); if (r.status !== 0) throw new Error(`kokoro TTS failed: ${`${r.stderr || ''}\n${r.stdout || ''}`.split('\n').map((l) => l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/^[^A-Za-z]+/, '').trim()).filter(Boolean).pop() || `exit ${r.status}`}`); },
  },
  piper: {
    available: (req = {}) => has('piper') && !!piperModel(req.voice),
    voice: (req) => piperModel(req.voice),
    run(textFile, raw, model) { const r = spawnSync('piper', ['-m', model, '-f', raw], { input: fs.readFileSync(textFile), encoding: 'utf8' }); if (r.status !== 0) throw new Error(`piper TTS failed: ${(r.stderr || '').trim().split('\n').pop()}`); },
  },
  'espeak-ng': {
    available: () => has('espeak-ng'),
    voice: (req) => req.voice || (req.speaker === 'B' ? 'en+f3' : 'en'),
    run(textFile, raw, voice) { execFileSync('espeak-ng', ['-v', voice, '-f', textFile, '-w', raw], { stdio: 'ignore' }); },
  },
  espeak: {
    available: () => has('espeak'),
    voice: (req) => req.voice || (req.speaker === 'B' ? 'en+f3' : 'en'),
    run(textFile, raw, voice) { execFileSync('espeak', ['-v', voice, '-f', textFile, '-w', raw], { stdio: 'ignore' }); },
  },
  flite: {
    available: () => hasFilter('flite'),
    voice: (req) => (['awb', 'kal', 'kal16', 'rms', 'slt'].includes(req.voice) ? req.voice : req.speaker === 'B' ? 'slt' : 'kal'),
    run(textFile, raw, voice) { ff(['-f', 'lavfi', '-i', `flite=textfile=${path.basename(textFile)}:voice=${voice}`, raw], { cwd: path.dirname(textFile) }); },
  },
};
export const TTS_ORDER = ['kokoro', 'piper', 'espeak-ng', 'espeak', 'flite'];

/** The TTS engine local would use for `req` (AI_VIDEO_EDITOR_LOCAL_TTS forces one), or null. */
export function pickTtsEngine(req = {}) {
  const forced = envv('LOCAL_TTS');
  if (forced) {
    if (!TTS_ENGINES[forced]) throw new Error(`AI_VIDEO_EDITOR_LOCAL_TTS=${forced}: use one of ${TTS_ORDER.join(', ')}`);
    return TTS_ENGINES[forced].available(req) ? forced : null;
  }
  return TTS_ORDER.find((e) => TTS_ENGINES[e].available(req)) || null;
}

/** The doctor's TTS text: the engine pickTtsEngine picks, plus why Kokoro / Piper are not used when half set up. */
export function ttsDoctorDetail(req = {}) {
  let engine = null;
  try { engine = pickTtsEngine(req); } catch (e) { return { engine: null, notes: [e.message], text: e.message }; }
  const notes = [];
  if (engine === 'kokoro' && !fs.existsSync(kokoroModel())) notes.push('kokoro model not cached yet (downloads on first use)');
  if (engine !== 'kokoro' && fs.existsSync(kokoroBin()) && !kokoroPython()) notes.push('kokoro: not ready (pip install kokoro-onnx soundfile; model downloads on first use)');
  if (engine !== 'piper' && has('piper') && !piperModel(req.voice)) notes.push('piper: on PATH, no model (set AI_VIDEO_EDITOR_PIPER_MODEL=/path/to/voice.onnx)');
  return { engine, notes, text: [engine || 'none', ...notes].join('; ') };
}

const NO_TTS = 'no local TTS engine found. Install one of: Kokoro (npm ci in the repo + pip install kokoro-onnx soundfile; HyperFrames TTS), Piper (piper on PATH + AI_VIDEO_EDITOR_PIPER_MODEL=<voice>.onnx), eSpeak NG (apt install espeak-ng), or an ffmpeg built with libflite';

/** The engines to try, in order: the forced one only, else every available one (a failing engine falls through). */
const ttsCandidates = (req) => (envv('LOCAL_TTS') ? [pickTtsEngine(req)].filter(Boolean) : TTS_ORDER.filter((e) => TTS_ENGINES[e].available(req)));

function synth(req, file) {
  const engines = ttsCandidates(req);
  if (!engines.length) throw new Error(envv('LOCAL_TTS') ? `AI_VIDEO_EDITOR_LOCAL_TTS=${envv('LOCAL_TTS')} is not available here; ${NO_TTS}` : NO_TTS);
  const text = String(req.text || '').trim();
  if (!text) throw new Error('tts: empty text');
  const dir = tmp();
  try {
    const tf = path.join(dir, 'text.txt'), raw = path.join(dir, 'raw.wav');
    fs.writeFileSync(tf, text);
    const failed = [];
    let engine = null, voice = null;
    for (const e of engines) {
      try { voice = TTS_ENGINES[e].voice(req); TTS_ENGINES[e].run(tf, raw, voice); engine = e; break; } catch (err) { failed.push(err.message); }
    }
    if (!engine) throw new Error(failed.join('; '));
    const rate = Number(req.rate) > 0 ? Math.min(2, Math.max(0.5, Number(req.rate))) : 1;
    ff(['-i', raw, '-af', `aresample=48000${rate !== 1 ? `,atempo=${rate}` : ''}`, '-ac', '1', '-c:a', 'pcm_s16le', path.resolve(file)]);
    return { engine, voice: engine === 'piper' ? path.basename(voice) : voice };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- adapter

const SUPPORTED = ['image', 'video', 'tts', 'avatar'];

export function localAdapter(kind) {
  const ok = SUPPORTED.includes(kind);
  const capabilities = {
    maxClipSeconds: kind === 'video' ? LOCAL_MAX_CLIP : kind === 'avatar' ? 600 : 0,
    aspects: ok && kind !== 'tts' ? Object.keys(SIZES) : [],
    references: kind === 'image' || kind === 'video',
    voiceClone: false, costPerCall: 0, network: false, supported: ok,
    secondsPerCall: { image: 1, video: 8, tts: 5, avatar: 20 }[kind] || 0,
    synthetic: kind === 'avatar',
  };
  const ext = { image: '.png', video: '.mp4', tts: '.wav', avatar: '.mp4' }[kind];
  return {
    name: 'local', kind, capabilities,
    async generate(req = {}, { outDir = '.', noCache = false } = {}) {
      if (!ok) throw new Error(`backend "local" has no ${kind} generator (local covers ${SUPPORTED.join(', ')}); configure an http-generic provider for ${kind}`);
      if (kind === 'avatar') {
        if (!req.audio || !fs.existsSync(req.audio)) throw new Error('avatar: needs { audio: <wav/mp3 file> }');
        if (req.likeness === 'self' && !req.consent) throw new Error('avatar: likeness "self" needs a consent record (refused)');
      }
      const model = kind === 'tts' ? `tts:${pickTtsEngine(req) || 'none'}` : `ffmpeg-${kind}-v1`;
      return withCache({ adapter: 'local', model, kind, req, outDir, noCache }, async (dir) => {
        const id = crypto.randomBytes(6).toString('hex');
        const file = path.join(dir, `local-${kind}-${id}${ext}`);
        const [w, h] = frameSize(req);
        if (kind === 'image') {
          titleCard(file, { prompt: req.prompt, width: w, height: h, seed: req.seed || 0, bg: (req.refs || []).find((f) => fs.existsSync(f)) });
          return { file, cost: 0, meta: { adapter: 'local', engine: 'ffmpeg title card', width: w, height: h } };
        }
        if (kind === 'video') {
          const d = Math.min(Math.max(0.5, Number(req.durationSec) || 4), LOCAL_MAX_CLIP);
          const ref = (req.refs || []).find((f) => fs.existsSync(f) && /\.(png|jpe?g|webp|bmp)$/i.test(f)) || (req.image && fs.existsSync(req.image) ? req.image : null);
          const still = ref || titleCard(path.join(dir, `local-still-${id}.png`), { prompt: req.prompt, width: w, height: h, seed: req.seed || 0 });
          kenBurns(still, file, { width: w, height: h, durationSec: d, seed: req.seed || 0 });
          if (!ref) fs.rmSync(still, { force: true });
          return { file, durationSec: d, cost: 0, meta: { adapter: 'local', engine: `ken burns over ${ref ? 'the image ref' : 'a title card'}`, width: w, height: h, clamped: Number(req.durationSec) > LOCAL_MAX_CLIP } };
        }
        if (kind === 'tts') {
          const { engine, voice } = synth(req, file);
          return { file, durationSec: probeDuration(file), cost: 0, meta: { adapter: 'local', engine, voice } };
        }
        // avatar
        const d = probeDuration(req.audio);
        const host = req.hostImage && fs.existsSync(req.hostImage) ? req.hostImage : titleCard(path.join(dir, `local-host-${id}.png`), { prompt: 'Synthetic host', width: w, height: h });
        kenBurns(host, file, { width: w, height: h, durationSec: d, maxZoom: 1.04, label: 'SYNTHETIC' });
        if (host !== req.hostImage) fs.rmSync(host, { force: true });
        const pre = path.join(dir, `local-pre-${id}.wav`);
        ff(['-i', path.resolve(req.audio), '-af', 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo', '-t', String(d), pre]);
        const loud = masterTo(pre, file, { duration: d, target: -14, truePeak: -1.5 });
        fs.rmSync(pre, { force: true });
        return { file, durationSec: d, cost: 0, meta: { adapter: 'local', engine: 'still + zoom (not lip-synced)', synthetic: true, likeness: req.likeness || 'fictional', loudness: { I: loud.I, TP: loud.TP }, width: w, height: h } };
      });
    },
  };
}

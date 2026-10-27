// AI Video Editor media helpers shared by every mode: source normalisation, SDR clip, ASR, face track, HyperFrames
// render, mux + master + delivery check, contact sheet, SRT / VTT.
import './env-compat.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probe } from './audio.mjs';
import { masterVideo, measure } from '../audio/master.mjs';
import { leadIn } from '../post/leadin.mjs';
import { captionGroups } from '../presets/captions-default.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const HOME = process.env.AI_VIDEO_EDITOR_HOME || path.join(process.env.HOME, '.ai-video-editor');
export const PY = process.env.AI_VIDEO_EDITOR_PYTHON || (fs.existsSync(path.join(HOME, 'venv/bin/python')) ? path.join(HOME, 'venv/bin/python') : 'python3');
const r3 = (v) => Math.round(v * 1000) / 1000;

export function log(...a) { process.stderr.write(`ai-video-editor: ${a.join(' ')}\n`); }
export function run(cmd, args, { label, logFile, env, cwd, allowFail = false } = {}) {
  const t = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env }, cwd, maxBuffer: 1 << 28 });
  if (logFile) fs.appendFileSync(logFile, `\n$ ${cmd} ${args.join(' ')}\n${r.stdout || ''}${r.stderr || ''}\nexit ${r.status} (${((Date.now() - t) / 1000).toFixed(1)} s)\n`);
  if (r.status !== 0 && !allowFail) throw new Error(`${label || cmd} failed (exit ${r.status})${logFile ? `; see ${logFile}` : ''}\n${(r.stderr || '').slice(-1500)}`);
  return r;
}

/** one video + one audio stream, display rotation baked in (phone footage: APAC / mebx streams, rotation -90). */
export function normalise(src, work) {
  const p = probe(src);
  if (p.streams <= 2 && !p.rotation) return { file: src, ...p };
  const out = path.join(work, 'source.mov');
  if (!fs.existsSync(out)) {
    const vc = p.rotation ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy'];
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', ...vc, '-c:a', 'copy', '-map_metadata', '-1', '-dn', out]);
  }
  return { file: out, ...probe(out) };
}

/** SDR BT.709 clip for compositing (HLG / PQ tone-mapped with hable, the clean-cut grade's light lift). */
export function sdrClip(src, out, { fps = 30, maxH = 1920 } = {}) {
  if (fs.existsSync(out)) return out;
  const p = probe(src);
  const hdr = /arib-std-b67|smpte2084/.test(p.transfer || '');
  const tm = hdr ? 'zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,eq=contrast=1.03:brightness=0.02:saturation=1.05' : 'format=yuv420p';
  const sc = Math.max(p.w, p.h) > maxH ? `,scale=${p.w >= p.h ? `${maxH}:-2` : `-2:${maxH}`}` : '';
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-vf', `${tm}${sc},fps=${fps}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-g', '15', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-an', out]);
  return out;
}

/** word transcript of a media file (faster-whisper via smoke/asr_words.py): [{text,start,end}] */
export function asr(media, out, { lang = 'auto', model = process.env.AI_VIDEO_EDITOR_ASR_MODEL || 'medium', logFile } = {}) {
  if (!fs.existsSync(out)) run(PY, ['-I', path.join(REPO, 'ai-video-editor/smoke/asr_words.py'), media, out, model, '--lang', lang], { label: 'ASR', logFile, env: { OMP_NUM_THREADS: process.env.AI_VIDEO_EDITOR_ASR_THREADS || '6' } });
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  return (j.words || []).filter((w) => (w.type || 'word') === 'word' && String(w.text).trim()).map((w) => ({ text: String(w.text).trim(), start: r3(w.start), end: r3(w.end) }));
}

export function faceTrack(media, out, { logFile, switch: sw = false } = {}) {
  // switch: speaker turns on multi-face shots (podcasts; facetrack.py --switch)
  if (!fs.existsSync(out)) run(PY, [path.join(REPO, 'ai-video-editor/engine/facetrack.py'), media, out, '--fps', '4', ...(sw ? ['--switch'] : [])], { label: 'face track', logFile });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

/** write a HyperFrames project (index.html + assets) and render it silent; returns the mp4 path. */
export function renderProject(projDir, html, clipFile, outMp4, { logFile, workers = process.env.AI_VIDEO_EDITOR_WORKERS || '3' } = {}) {
  const A = path.join(projDir, 'assets');
  fs.mkdirSync(A, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'node_modules/gsap/dist/gsap.min.js'), path.join(A, 'gsap.min.js'));
  if (clipFile) { const dst = path.join(A, 'clip.mp4'); fs.rmSync(dst, { force: true }); try { fs.linkSync(clipFile, dst); } catch { fs.copyFileSync(clipFile, dst); } }
  fs.writeFileSync(path.join(projDir, 'index.html'), html);
  if (!fs.existsSync(path.join(projDir, 'hyperframes.json'))) fs.writeFileSync(path.join(projDir, 'hyperframes.json'), JSON.stringify({ name: path.basename(projDir) }, null, 1));
  const t = Date.now();
  run(path.join(REPO, 'node_modules/.bin/hyperframes'), ['render', projDir, '-o', outMp4, '--quality', 'standard', '--workers', String(workers), '--sdr', '--quiet'], { label: 'HyperFrames render', logFile, cwd: projDir });
  log(`render ${path.basename(outMp4)} ${((Date.now() - t) / 1000).toFixed(0)} s`);
  return outMp4;
}

/** mux the soundtrack onto the silent render, master to -14 LUFS / -1.5 dBTP (inside -1), faststart. */
export function muxMaster(videoNoAudio, wav, out, { work, lead = 0 }) {
  const d = probe(videoNoAudio).duration;
  const tmp = path.join(work, `${path.basename(out, '.mp4')}.mux.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', videoNoAudio, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', String(d), '-movflags', '+faststart', tmp]);
  if (lead > 0) leadIn(tmp, tmp, lead); // the clean-cut lead-in: first frame held, audio delayed
  const m = masterVideo(tmp, { duration: d + lead, target: -14, truePeak: -1.5, work });
  fs.renameSync(tmp, out);
  return { ...m, measured: measure(out) };
}

export function deliveryCheck(file, { logFile, lang = 'auto', voice, words } = {}) {
  // the words we put on screen are the repeat check's reference: only a real lexical repeat fails (check/lib/repeats.mjs)
  let ref = null;
  if (words?.length) { ref = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ref-')), 'reference.json'); fs.writeFileSync(ref, JSON.stringify({ words: words.map((w) => ({ text: w.text })) })); }
  const r = run('node', [path.join(REPO, 'ai-video-editor/check/delivery.mjs'), file, ...(voice ? ['--voice', voice] : []), ...(ref ? ['--reference', ref] : [])], { label: 'delivery check', logFile, allowFail: true, env: { AI_VIDEO_EDITOR_LANG: lang } });
  if (ref) fs.rmSync(path.dirname(ref), { recursive: true, force: true });
  const out = (r.stdout || '').trim();
  const fails = [...out.matchAll(/^FAIL\s+(\S+)/gm)].map((m) => m[1]), notes = [...out.matchAll(/^NOTE\s+\S+\s+(.*)$/gm)].map((m) => m[1]);
  return { pass: r.status === 0, out, note: [fails.length ? `FAIL ${fails.join(', ')}` : '', ...notes].filter(Boolean).join('; ') };
}

export function contactSheet(file, out, { cols = 6, rows = 3 } = {}) {
  const p = probe(file), n = cols * rows;
  const tw = p.w >= p.h ? 320 : 200;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `fps=${n}/${p.duration.toFixed(3)},scale=${tw}:-2,drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6,tile=${cols}x${rows}:padding=4:color=0x111111`, '-frames:v', '1', out]);
  return out;
}

const ts = (t, sep) => { const ms = Math.round(Math.max(0, t) * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
/** SRT + VTT from words (sentence-case groups of <= 7 words / 42 chars), shifted by offset. */
export function writeSubtitles(words, base, { offset = 0, duration } = {}) {
  const p = JSON.parse(fs.readFileSync(path.join(REPO, 'ai-video-editor/styles/clean-cut/captions.json'), 'utf8'));
  const caps = captionGroups(words, { duration: duration ?? (words.at(-1)?.end || 0) + 1, p: { ...p, grouping: { ...p.grouping, maxChars: 42 } } });
  const line = (c) => c.words.map((w) => w.text).join(' ');
  fs.writeFileSync(`${base}.srt`, caps.map((c, i) => `${i + 1}\n${ts(c.start + offset, ',')} --> ${ts(c.end + offset, ',')}\n${line(c)}\n`).join('\n'));
  fs.writeFileSync(`${base}.vtt`, `WEBVTT\n\n${caps.map((c) => `${ts(c.start + offset, '.')} --> ${ts(c.end + offset, '.')}\n${line(c)}\n`).join('\n')}`);
  return [`${base}.srt`, `${base}.vtt`];
}

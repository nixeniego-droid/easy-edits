#!/usr/bin/env node
// Easy Edits post: the whole post stage as one plain script (no agent), each stage once.
//   node easy-edits/post.mjs <in.mp4> [out.mp4] [--captions [--transcript words.json] [--layout face] | --no-captions]
//                         [--lead-in 0.2 | --no-lead-in] [--no-check]
// out defaults to <in>.post.mp4; the input is never modified.
//   1. captions  (off by default: the Herk composition already burns the default preset in). --captions burns
//                easy-edits/presets/captions-default in via ffmpeg/libass (captions-ass.mjs), words from
//                --transcript ({words:[{text,start,end}]}) or a local faster-whisper pass on the input
//   2. lead-in   easy-edits/post/leadin.mjs (default 0.2 s; EASY_EDITS_LEADIN)
//   3. loudness  easy-edits/audio/master.mjs: one measure, one apply, one verify measure; a correction pass only
//                if the result is > 0.5 LU off -14 LUFS or over the -1.5 dBTP ceiling (maxPasses 2)
//   4. check     easy-edits/check/delivery.mjs (exit status kept)
// Prints per-stage wall-clock timings and a JSON report.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { leadIn, resolveLeadIn } from './post/leadin.mjs';
import { masterVideo } from './audio/master.mjs';
import { captionAss } from './presets/captions-ass.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const VALUED = ['--lead-in', '--transcript', '--layout'];
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
if (!pos[0]) { console.error('usage: node easy-edits/post.mjs <in.mp4> [out.mp4] [--captions [--transcript w.json] [--layout face] | --no-captions] [--lead-in 0.2 | --no-lead-in] [--no-check]'); process.exit(2); }
const input = resolve(pos[0]), out = resolve(pos[1] || input.replace(/\.mp4$/i, '') + '.post.mp4');
if (out === input) { console.error('post.mjs: out must differ from in (raw files are preserved)'); process.exit(2); }
const captions = argv.includes('--captions') && !argv.includes('--no-captions');
const leadSec = resolveLeadIn(argv);
const probeDuration = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f], { encoding: 'utf8' }).stdout.trim());

const timings = {}, report = { input, out };
const stage = (name, fn) => { const t = performance.now(); const r = fn(); timings[name] = Number(((performance.now() - t) / 1000).toFixed(2)); console.error(`[post] ${name.padEnd(8)} ${timings[name].toFixed(2)} s`); return r; };
const work = mkdtempSync(join(tmpdir(), 'easy-edits-post-'));
try {
  if (captions) {
    report.captions = stage('captions', () => {
      let tr = opt('--transcript');
      if (!tr) {
        tr = join(work, 'words.json');
        const py = process.env.EASY_EDITS_PYTHON || join(homedir(), '.easy-edits/venv/bin/python');
        const r = spawnSync(py, ['-I', join(HERE, 'smoke/asr_words.py'), input, tr, process.env.WHISPER_MODEL || 'small'], { encoding: 'utf8' });
        if (r.status) throw new Error(`transcription failed: ${r.stderr}`);
      }
      const words = JSON.parse(readFileSync(tr, 'utf8')).words.filter((w) => (w.type ?? 'word') === 'word');
      const ass = join(work, 'caps.ass');
      writeFileSync(ass, captionAss(words, { duration: probeDuration(input), layout: opt('--layout', 'face') }));
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', `ass=${ass}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
        '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out], { encoding: 'utf8' });
      if (r.status) throw new Error(`caption burn-in failed: ${r.stderr}`);
      return { words: words.length, transcript: opt('--transcript') || 'faster-whisper' };
    });
  } else copyFileSync(input, out);
  report.leadIn = stage('lead-in', () => leadIn(out, out, leadSec).leadIn);
  report.master = stage('master', () => masterVideo(out, { duration: probeDuration(out), work, maxPasses: 2, tolerance: 0.5 }));
} finally { rmSync(work, { recursive: true, force: true }); }
let status = 0;
if (!argv.includes('--no-check')) {
  status = stage('check', () => spawnSync(process.execPath, [join(HERE, 'check/delivery.mjs'), out], { stdio: ['ignore', 'inherit', 'inherit'] }).status ?? 1);
}
timings.total = Number(Object.values(timings).reduce((a, b) => a + b, 0).toFixed(2));
console.log(JSON.stringify({ ...report, timings }));
process.exitCode = status;

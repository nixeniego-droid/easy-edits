// Easy Edits delivery gates for a rendered short.
//   node easy-edits/tools/gates.mjs <video.mp4> <project-dir> [--sheet out.png] [--frames 16] [--model small]
// Reads <project>/assets/{plan.json,transcript.json} and <project>/index.html.
// Gates: contact sheet (look at it!), caption style + geometry, fresh faster-whisper
// transcript vs the edit (first/last word whole, no repeated line, word match),
// ebur128 integrated LUFS + true peak. Prints JSON; exit 1 if any gate fails.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { captionOverlaps } from '../presets/captions-layout.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [video, proj] = argv;
if (!video || !proj) { console.error('usage: gates.mjs <video.mp4> <project-dir> [--sheet out.png] [--frames 16] [--model small]'); process.exit(2); }
const SHEET = opt('--sheet', '/tmp/gc_sheet.png'), N = Number(opt('--frames', 16)), MODEL = opt('--model', 'small');
const LUFS = Number(opt('--lufs', -14)), TP = Number(opt('--tp', -1));
const plan = JSON.parse(fs.readFileSync(path.join(proj, 'assets/plan.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(proj, 'assets/transcript.json'), 'utf8')).words;
const html = fs.readFileSync(path.join(proj, 'index.html'), 'utf8');
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }));
const gates = {};

// 1. contact sheet: N evenly spaced frames, 4 columns, timestamps burned on the sheet only
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gcsheet-'));
  const times = Array.from({ length: N }, (_, i) => +((i + 0.5) * dur / N).toFixed(3));
  times.forEach((t, i) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf',
    `scale=270:480,drawtext=text='${t.toFixed(2)}s':x=6:y=6:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.6`, path.join(tmp, `f${String(i).padStart(2, '0')}.png`)]));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, 'f%02d.png'), '-vf', `tile=4x${Math.ceil(N / 4)}:padding=4`, '-frames:v', '1', SHEET]);
  const panels = plan.scenes.filter((s) => s.panel).length;
  gates.motionGraphics = { pass: panels > 0 && fs.existsSync(SHEET), sheet: SHEET, frameTimes: times, graphicScenes: panels, note: 'structural only - inspect the sheet visually' };
}

// 2. captions: one style (preset .cap only, no boxed captions) and never over graphics/face
{
  const capDivs = html.match(/class="cap clip"/g)?.length || 0;
  const capCss = (html.match(/\.cap[^{]*\{[^}]*\}/g) || []).join('');
  const boxed = /background/.test(capCss);
  const otherCaptionSystems = /class="(?:caption|subtitle|cap-box)[ "]/.test(html);
  const overlaps = captionOverlaps(plan.captions, plan.layouts.keepOut);
  const sizes = new Set((capCss.match(/font:[^;]+/g) || []));
  gates.captions = { pass: capDivs === plan.captions.length && !boxed && !otherCaptionSystems && sizes.size === 1 && !overlaps.length,
    count: capDivs, fontRules: [...sizes], boxed, overlaps };
}

// 3. fresh ASR on the delivered audio
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9']/g, '');
const asrFile = path.join(os.tmpdir(), `gc-asr-${process.pid}.json`);
{
  const py = process.env.EASY_EDITS_PYTHON || path.join(os.homedir(), '.easy-edits/venv/bin/python');
  const r = spawnSync(py, ['-I', path.join(HERE, '../smoke/asr_words.py'), video, asrFile, MODEL], { encoding: 'utf8' });
  if (r.status) throw new Error('ASR failed: ' + r.stderr);
}
// speech onset/offset from 1.5-5 kHz energy (ASR word times are imprecise at the edges; the
// band ignores low whoosh/thud SFX under a lead-in)
const BAND = 'highpass=f=1500,lowpass=f=5000';
const bandRms = Number(/RMS level dB:\s*(-?[\d.]+)/.exec(spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-af', `${BAND},pan=mono|c0=c0,astats=measure_perchannel=0`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr.split('Overall').pop())[1]);
const floorDb = Math.round(bandRms - 20); // speech = 30 ms window RMS within 20 dB of the clip's speech-band RMS
const win = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-af', `${BAND},pan=mono|c0=c0,aresample=48000,asetnsamples=1440,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`, '-f', 'null', '-'], { encoding: 'utf8' }).stdout;
const rms = [...win.matchAll(/RMS_level=(-?[\d.inf]+)/g)].map((m) => Number(m[1]) || -200);
const loud = rms.map((v, i) => (v > floorDb ? i : -1)).filter((i) => i >= 0);
const onset = +(loud[0] * 0.03).toFixed(3), offset = +((loud.at(-1) + 1) * 0.03).toFixed(3);
// Whisper hallucinates outro phrases ("thank you for watching") in trailing silence: drop words past the speech offset
const raw = JSON.parse(fs.readFileSync(asrFile, 'utf8')).words;
// (and in a trailing run of near-zero-confidence words whose timestamps bleed into the last word)
let keep = raw.length;
while (keep > 0 && (raw[keep - 1].start >= offset - 0.02 || raw[keep - 1].probability < 0.1)) keep--;
const heard = raw.slice(0, keep);
const dropped = raw.filter((w) => !heard.includes(w)).map((w) => w.text).join(' ');
const A = heard.map((w) => norm(w.text)).filter(Boolean), B = expected.map((w) => norm(w.text)).filter(Boolean);
{
  // LCS word match
  const dp = Array.from({ length: A.length + 1 }, () => new Int16Array(B.length + 1));
  for (let i = 1; i <= A.length; i++) for (let j = 1; j <= B.length; j++) dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const match = dp[A.length][B.length] / Math.max(A.length, B.length);
  const first = heard[0], last = heard.at(-1);
  gates.firstWord = { pass: norm(first.text) === B[0] && onset >= 0.15, heard: first.text, expected: expected[0].text, speechOnset: onset, silenceFloorDb: floorDb, probability: first.probability };
  gates.lastWord = { pass: norm(last.text) === B.at(-1) && dur - offset >= 0.15, heard: last.text, expected: expected.at(-1).text, speechOffset: offset, tail: +(dur - offset).toFixed(3), probability: last.probability, droppedTrailingHallucination: dropped };
  // repeated line: any 4-gram heard more often than it was said in the edit
  const grams = (W, n = 4) => { const m = new Map(); for (let i = 0; i + n <= W.length; i++) { const k = W.slice(i, i + n).join(' '); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const gA = grams(A), gB = grams(B);
  const repeats = [...gA].filter(([k, c]) => c > 1 && c > (gB.get(k) || 0)).map(([k, c]) => `${k} x${c}`);
  gates.noRepeatedLine = { pass: !repeats.length && A.length <= B.length + 2, repeats, heardWords: A.length, editWords: B.length };
  gates.transcriptMatch = { pass: match >= 0.9, match: +match.toFixed(3), heard: heard.map((w) => w.text).join(' ') };
}

// 4. loudness (stereo delivery, ebur128 true peak)
{
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const sum = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)[1]), tp = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)[1]);
  gates.loudness = { pass: Math.abs(I - LUFS) <= 1 && tp <= TP, integratedLUFS: I, truePeakDBTP: tp };
}

const ok = Object.values(gates).every((g) => g.pass);
console.log(JSON.stringify({ video, duration: +dur.toFixed(3), ok, gates }, null, 1));
process.exitCode = ok ? 0 : 1;

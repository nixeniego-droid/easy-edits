// AI Video Editor delivery check for a finished video (no project files needed).
//   node ai-video-editor/check/delivery.mjs <video.mp4> [--model small] [--lang auto] [--script narr.txt|words.json] [--lufs -14] [--tp -1] [--edge 0.15]
// First/last speech come from the audio, not from Whisper word times: ffmpeg silencedetect on the 1.5-5 kHz
// speech band (low whoosh/thud SFX under a lead-in are ignored) with the same level as ai-video-editor/tools/gates.mjs:
// noise = the clip's speech-band RMS - 20 dB, minimum silence 0.03 s (gates' 30 ms window).
//   first-word   speech starts at >= 0.15 s
//   last-word    speech ends >= 0.15 s before the end
//   dead-tail    ... and <= --tail-max (4 s) before it: talk_01 run #2 lost all audio after 23.6 s of 44.6 s (a
//                build filtergraph bug) and passed with "speech ends 21 s before the end"
//   dropout      no digital silence (50 ms RMS < -90 dBFS) lasting >= 0.5 s: real recordings and room tone never
//                reach it; a dropped / truncated audio stream does (the 0.2 s lead-in is shorter)
// Fresh faster-whisper transcript with the Silero VAD filter (ai-video-editor/smoke/asr_words.py --exact --vad:
// float32, temperature 0, reproducible; VAD keeps silent stretches from being decoded into an invented or
// looped outro like "Have a great week." x5). Language: --lang or AI_VIDEO_EDITOR_LANG, default auto (detected, so
// Taglish is transcribed as tl). Model: --model, default small for every language (asr_words.py's medium
// default for non-English is float32 here and was OOM-killed loading on ~6 GB free).
// Speech backing: a music bed keeps VAD from removing the tail, and Whisper's last decoding window can then be
// a ~1 s remainder decoded into an invented outro, e.g. "Thanks for watching, and I'll see you in the next video."
// with 9 of 11 words at zero duration (renders/gen_screen.mp4, gen_nasa2_v2.mp4). A word is backed when >= 20 ms
// of it lies outside the speech-band silences above. A segment with fewer than half its words backed is
// dropped and listed as "dropped". Measured: real segments 89-100% backed, phantom segments 0-9%.
// no_speech_prob does not separate them (real Taglish 0.43, phantom 0.41), and
// hallucination_silence_threshold missed the gen_screen tail. On the backed words:
//   transcript   at least one word heard
//   no-repeat    no repeated 4-gram (case and punctuation ignored); with --reference words.json (the words the
//                edit put on screen) only a REAL repeat fails: said twice in the reference, or extra audio the
//                reference lacks (a duplicated splice); a mishearing ("Misha" for mission and vision) is a NOTE.
//                A looped source (the same speech >= 3 times end to end, lib/repeats.mjs detectLoop) is a NOTE for
//                the repeats on the loop period; a repeat off the period still FAILs
//   outro        outro boilerplate ("thanks for watching", "see you in the next video", "subscribe", ...) heard
//                but not in --script (the composition's narration text or {words}/{text} JSON). Without --script
//                it is a WARN line only.
// plus ebur128 (ai-video-editor/audio/master.mjs measure):
//   loudness     integrated -14 +-1 LUFS; true peak FAILs only on a real overshoot (> 0.5 dB over the -1.5 dBTP
//                ceiling; --tp sets the limit)
// Prints PASS/FAIL per check; exit 1 on any FAIL, 2 on usage/tool errors.
import '../engine/env-compat.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { measure } from '../audio/master.mjs';
import { repeatFindings, detectLoop } from './lib/repeats.mjs';
import { joinHyphenWords, reusedPhraseNote } from '../engine/words.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const video = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

if (!video || !fs.existsSync(video)) { console.error('usage: delivery.mjs <video.mp4> [--model small] [--lang auto] [--script narr.txt|words.json] [--lufs -14] [--tp -1] [--edge 0.15] [--voice stem.wav] [--reference words.json]'); process.exit(2); }
const TAIL_MAX = Number(opt('--tail-max', 4)), MODEL = opt('--model', 'small'), LANG = opt('--lang', process.env.AI_VIDEO_EDITOR_LANG || 'auto'), LUFS = Number(opt('--lufs', -14)), TP = Number(opt('--tp', -1)), EDGE = Number(opt('--edge', 0.15));
const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout);

const py = process.env.AI_VIDEO_EDITOR_PYTHON || path.join(process.env.AI_VIDEO_EDITOR_HOME || path.join(os.homedir(), '.ai-video-editor'), 'venv/bin/python');
const out = path.join(os.tmpdir(), `gc-delivery-${process.pid}.json`);
const r = spawnSync(py, ['-I', path.join(HERE, '../smoke/asr_words.py'), video, out, MODEL, '--exact', '--vad', '--lang', LANG], { encoding: 'utf8' });
if (r.status !== 0) { console.error(`transcription failed (${r.signal || r.status}):\n` + r.stderr); process.exit(2); }
const asr = JSON.parse(fs.readFileSync(out, 'utf8'));
fs.rmSync(out, { force: true });

// speech onset/offset: silencedetect on the speech band, level relative to the clip's own speech-band RMS
const BAND = 'highpass=f=1500,lowpass=f=5000,pan=mono|c0=c0';
// --voice STEM: the voice stem on the final's timeline (a music bed under an intro / end card reads as speech in
// the speech band); speech edges and word backing are measured on it, everything else on the final
const EDGE_SRC = opt('--voice', video);
const ff = (af) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', EDGE_SRC, '-af', af, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const bandRms = Number(/RMS level dB:\s*(-?[\d.]+)/.exec(ff(`${BAND},astats=measure_perchannel=0`).split('Overall').pop())?.[1]);
const floorDb = Math.round(bandRms - 20);
const sd = ff(`${BAND},silencedetect=noise=${floorDb}dB:d=0.03`);
const starts = [...sd.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
const ends = [...sd.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
// the audio stream can end before the container (24.213 vs 24.233 s); a silence running to its end is trailing
const aEnd = Number(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', EDGE_SRC], { encoding: 'utf8' }).stdout) || dur; // the stem's own end with --voice
const silences = starts.map((s, i) => [s, ends[i] ?? aEnd]); // an open trailing silence has no silence_end
const lead = silences.find(([s]) => s <= 0.001), trail = silences.findLast(([, e]) => e >= Math.min(aEnd, dur) - 0.001);
const onset = lead ? lead[1] : 0, offset = trail && trail !== lead ? trail[0] : dur;

// drop segments that are not backed by speech-band activity (see the header)
const active = (a, b) => b - a - silences.reduce((t, [s, e]) => t + Math.max(0, Math.min(b, e) - Math.max(a, s)), 0);
const bySeg = Map.groupBy(asr.words, (w) => w.seg);
const unbacked = new Set([...bySeg].filter(([, ws]) => ws.filter((w) => active(w.start, w.end) >= 0.02).length * 2 < ws.length).map(([k]) => k));
const words = joinHyphenWords(asr.words.filter((w) => !unbacked.has(w.seg))), dropped = asr.words.filter((w) => unbacked.has(w.seg));

const checks = [];
const check = (name, pass, msg) => checks.push({ name, pass, msg });
const f3 = (x) => x.toFixed(3);
const speech = Number.isFinite(bandRms) && offset > onset;
check('first-word', speech && onset >= EDGE, speech ? `speech starts at ${f3(onset)} s (need >= ${EDGE} s; silencedetect ${floorDb} dB, first word "${words[0]?.text ?? '-'}")` : 'no speech detected');
check('last-word', speech && dur - offset >= EDGE, speech ? `speech ends at ${f3(offset)} s of ${f3(dur)} s, ${f3(dur - offset)} s before the end (need >= ${EDGE} s; last word "${words.at(-1)?.text ?? '-'}" ends ${words.length ? f3(words.at(-1).end) : '-'} s)` : 'no speech detected');
check('transcript', words.length > 0, `${words.length} words heard`);
check('dead-tail', speech && dur - offset <= TAIL_MAX, speech ? `${f3(dur - offset)} s after the last speech (need <= ${TAIL_MAX} s)` : 'no speech detected');
{
  const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 }).stdout;
  const x = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4)), runs = [];
  let run0 = -1;
  for (let i = 0; i + 800 <= x.length; i += 800) {
    let e = 0; for (let j = i; j < i + 800; j++) e += x[j] * x[j];
    const dead = 10 * Math.log10(e / 800 + 1e-20) < -90, t = i / 16000;
    if (dead && run0 < 0) run0 = t;
    if (!dead && run0 >= 0) { if (t - run0 >= 0.5) runs.push([run0, t]); run0 = -1; }
  }
  if (run0 >= 0 && x.length / 16000 - run0 >= 0.5) runs.push([run0, x.length / 16000]);
  check('dropout', runs.length === 0, runs.length ? `digital silence ${runs.map(([a, b]) => `${f3(a)}-${f3(b)} s`).join(', ')}` : 'no digital silence >= 0.5 s');
}
const normWord = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const norm = words.map((w) => normWord(w.text)).filter(Boolean);
// --reference: the words the edit put on screen (the source transcript's kept words); a heard repeat must be a
// real lexical one (lib/repeats.mjs), a mishearing ("mission" / "vision" both heard as "Misha") is a note
const refPath = opt('--reference');
const refWords = refPath ? (() => { const j = JSON.parse(fs.readFileSync(refPath, 'utf8')); return Array.isArray(j) ? j : j.words; })() : null;
const loop = detectLoop(words);
const reps = repeatFindings(words, refWords, { loop }), real = reps.filter((x) => x.real), misheard = reps.filter((x) => !x.real);
const repTxt = (x) => `"${x.key}" x${x.count}${x.verdict === 'unchecked' ? '' : ` (${x.verdict}${x.refs ? `: ${x.refs.map((t) => `"${t}"`).join(' / ')}` : ''})`}`;
check('no-repeat', !real.length, real.length ? `repeated 4-gram(s): ${real.map(repTxt).join(', ')}` : `${loop ? `no repeated 4-gram off the loop period (${loop.periodWords} words x${loop.copies})` : 'no repeated 4-gram'} in ${norm.length} words${refWords ? ` (checked against ${refWords.length} reference words)` : ''}`);
// outro boilerplate Whisper invents over tails; real only if the composition's script says it
const OUTRO = ['thanks for watching', 'thank you for watching', 'see you in the next video', 'see you next time',
  'thats it for today', 'dont forget to subscribe', 'like and subscribe', 'subscribe to'];
const scriptPath = opt('--script');
let script = scriptPath ? fs.readFileSync(scriptPath, 'utf8') : null;
if (script && scriptPath.endsWith('.json')) { const j = JSON.parse(script); script = j.words ? j.words.map((w) => w.text).join(' ') : j.text; }
const flat = (t) => ` ${t.split(/\s+/).map(normWord).filter(Boolean).join(' ')} `;
const outro = OUTRO.filter((p) => flat(norm.join(' ')).includes(` ${p} `) && !(script && flat(script).includes(` ${p} `)));
if (script) check('outro', !outro.length, outro.length ? `outro boilerplate heard but not in ${scriptPath}: ${outro.map((p) => `"${p}"`).join(', ')}` : 'no outro boilerplate outside the script');
const m = measure(video);
check('loudness', Number.isFinite(m.I) && Math.abs(m.I - LUFS) <= 1 && m.TP <= TP,
  `integrated ${m.I} LUFS (need ${LUFS}+-1), true peak ${m.TP} dBTP (need <= ${TP})`);

console.log(`delivery check: ${video} (${f3(dur)} s, faster-whisper ${asr.model} + VAD, language ${asr.language_code})`);
console.log(`heard: ${words.map((w) => w.text).join(' ')}`);
if (dropped.length) console.log(`dropped (no speech-band activity under ${dropped.length} words at ${f3(dropped[0].start)}-${f3(dropped.at(-1).end)} s): ${dropped.map((w) => w.text).join(' ')}`);
if (loop) console.log(`NOTE  no-repeat  this looks like a looped source (the same ${loop.periodSec != null ? `~${Math.round(loop.periodSec)} s` : `${loop.periodWords} words`} of speech repeated ${Math.round(loop.copies)} times); skipping the repeat check on the loop.`);
const misH = misheard.filter((x) => x.verdict === 'misheard'), reused = misheard.filter((x) => x.verdict === 'reused');
if (misH.length) console.log(`NOTE  no-repeat  heard repeat(s) the reference does not have (ASR mishearing, not a repeat): ${misH.map(repTxt).join(', ')}`);
if (reused.length) console.log(`NOTE  ${reused.map((x) => reusedPhraseNote(x.key, x.count)).join(' ')}`);
if (!script && outro.length) console.log(`WARN  outro      outro boilerplate heard, no --script to confirm it: ${outro.map((p) => `"${p}"`).join(', ')}`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name.padEnd(10)} ${c.msg}`);
const ok = checks.every((c) => c.pass);
console.log(ok ? 'DELIVERY PASS' : `DELIVERY FAIL (${checks.filter((c) => !c.pass).map((c) => c.name).join(', ')})`);
process.exitCode = ok ? 0 : 1;

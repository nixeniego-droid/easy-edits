// Final-output assertion shared by every mode and by `new` / `resume`: a run that "finishes" must leave its final
// file(s) in the output folder, non-empty and readable by ffprobe (a video stream for video, an audio stream for
// audio). Intermediates under <out>/.work don't count. A missing / empty / broken final file is exit EXIT_NO_OUTPUT
// with one line per file, never a silent exit 0.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const EXIT_NO_OUTPUT = 5;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i, AUDIO = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i;

export class FinalOutputError extends Error {
  constructor(problems, out) {
    super(`no usable final output in ${out}:\n${problems.map((p) => `  - ${p.file}: ${p.problem}`).join('\n')}`);
    this.problems = problems;
    this.out = out;
  }
}

function streams(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  try { const j = JSON.parse(r.stdout); return { types: (j.streams || []).map((s) => s.codec_type), duration: Number(j.format?.duration) || 0 }; } catch { return null; }
}

/** Problems with the final files of a run ([] = all good). files: paths (absolute or relative to out). */
export function finalOutputProblems(files, out, { expect = 1 } = {}) {
  const dir = path.resolve(out), problems = [];
  const list = (files || []).filter(Boolean).map((f) => path.resolve(dir, f));
  if (list.length < expect) problems.push({ file: dir, problem: `expected ${expect} final file(s), the run reported ${list.length}` });
  for (const f of list) {
    const rel = path.relative(dir, f);
    if (rel.startsWith('..') || path.isAbsolute(rel)) problems.push({ file: f, problem: 'is not inside the output folder' });
    else if (rel.split(path.sep)[0] === '.work') problems.push({ file: f, problem: 'is a work file (.work/), not a final export' });
    if (!fs.existsSync(f)) { problems.push({ file: f, problem: 'missing' }); continue; }
    const st = fs.statSync(f);
    if (!st.isFile()) { problems.push({ file: f, problem: 'not a file' }); continue; }
    if (st.size === 0) { problems.push({ file: f, problem: 'empty (0 bytes)' }); continue; }
    if (VIDEO.test(f) || AUDIO.test(f)) {
      const s = streams(f);
      if (!s) problems.push({ file: f, problem: 'ffprobe cannot read it' });
      else if (VIDEO.test(f) && !s.types.includes('video')) problems.push({ file: f, problem: 'no video stream' });
      else if (AUDIO.test(f) && !s.types.includes('audio')) problems.push({ file: f, problem: 'no audio stream' });
      else if (!(s.duration > 0)) problems.push({ file: f, problem: 'zero duration' });
    }
  }
  return problems;
}

/** Throws FinalOutputError when finalOutputProblems() finds anything. */
export function assertFinalOutputs(files, out, opts) {
  const problems = finalOutputProblems(files, out, opts);
  if (problems.length) throw new FinalOutputError(problems, path.resolve(out));
}

/**
 * The final files an edit mode run promises, from its options and result: the exports (at least one); with
 * --plan-only the plan file; shorts --propose the PROPOSALS.txt (its previews may be pinned from another folder).
 */
export function modeFinalFiles(o, res = {}) {
  if (o.planOnly && typeof res.plan === 'string') return { files: [res.plan], expect: 1 };
  if (o.mode === 'shorts' && o.propose) return { files: [path.join(o.out, 'PROPOSALS.txt')], expect: 1 };
  return { files: (res.exports || []).map((e) => e.file), expect: 1 };
}

/** No words came out of the transcript (a silent clip, music only, or the wrong audio track): refused before a render. */
export class NoSpeechError extends Error {
  constructor(input) {
    super(`no speech detected in ${input} (the transcript is empty); use a clip with clear speech (try samples/talk.mp4).\nIf it does have clear speech, re-run with its language, e.g. --lang en`);
    this.input = input;
  }
}

/** Throws NoSpeechError when a mode that captions or cuts speech got no words. Zero-length words only (Whisper
 * hallucinates one on pure silence, e.g. a stray foreign word at start = end) count as none. */
export function requireSpeech(words, input) {
  if (!words?.some((w) => !(w.end <= w.start))) throw new NoSpeechError(input);
  return words;
}

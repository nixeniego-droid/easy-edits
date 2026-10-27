#!/usr/bin/env node
// Caption verify (clean-cut review aid, not a gate): a SECOND, independent decode of the final audio checks the
// caption text. The captions come from the cut's whole-file disfluent decode; talk_01 shipped "help us at, at the
// preferred" for "helps us arrive at a preferred" and "Proverbs 29" for "Proverbs 30, 29". The built audio (mix.wav,
// same timeline as the captions) is re-decoded with faster-whisper medium, plain prompt, in WIN s windows every STEP s
// (each moment heard twice, with context; a per-caption excerpt of 1-2 s decoded to nothing or "snapchat"). A caption
// word is flagged when NO window covering its caption heard it within SLACK s of the caption: windows disagree on
// noise, a real mishearing in the captions is consistent. Two passes, plain and disfluent prompt: the plain decode
// drops self-corrections ("I mean, mission") and the disfluent one hears them. SLACK is wide on purpose (decoded word
// times drift ~0.5 s at caption edges): extra words around a caption can only hide a flag. Flags go to the review pass (clean-cut.sh:
// a short text-only claude pass, or the report only with --review-patch); they never fail the run.
//   node caption-verify.mjs <project-dir> [--audio <wav>] [--lang en] [--model medium] [--passes plain,disfluent] [--json]
// Prints one FLAG line per flagged caption (source indices of the caption words for the patch) and a summary;
// --json prints {captions:[{i,start,end,text,heard,words:[{i,text}],flags:[{i,text}]}], flagged}. Exit 0, 2 on usage.
import '../engine/env-compat.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WIN = 10, STEP = 5, SLACK = 1.0;
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "Thirty," -> "30", "Vision's" -> "visions", "re-do" -> "redo" */
export function tok(s) {
  const t = String(s).toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
  const k = ONES.indexOf(t);
  return k >= 0 ? String(k) : TENS[t] != null ? String(TENS[t]) : t;
}
/** text -> tokens; "twenty-nine" / "twenty nine" -> "29" */
export function toks(text) {
  const raw = String(text).split(/[\s\-–—]+/).map(tok).filter(Boolean), out = [];
  for (let i = 0; i < raw.length; i++) {
    const a = Number(raw[i]), b = Number(raw[i + 1]);
    if (a >= 20 && a % 10 === 0 && a < 100 && b > 0 && b < 10 && /^\d+$/.test(raw[i]) && /^\d$/.test(raw[i + 1])) { out.push(String(a + b)); i++; } else out.push(raw[i]);
  }
  return out;
}

/** caption groups + transcript words (sourceIndex, final-timeline times) -> per caption its words with indices */
export function captionWords(caps, words) {
  return caps.map((c, k) => {
    const next = caps[k + 1]?.start ?? Infinity;
    const ws = words.filter((w) => w.start >= c.start - 0.12 && w.start < Math.min(c.end, next) - 0.01 && String(w.text).trim());
    return { ...c, words: ws.map((w) => ({ i: w.sourceIndex ?? null, text: w.text })) };
  });
}

/** caption words (with indices) + per caption the heard text of each window (string or [string]) -> flags: the
 * caption words that no window heard (a repeated word must be heard as often within one window) */
export function verify(caps, heard) {
  return caps.map((c, k) => {
    const alts = [].concat(heard[k] ?? []), words = c.words?.length ? c.words : toks(c.text).map((t) => ({ i: null, text: t }));
    const missIn = (h) => {
      const pool = new Map();
      for (const t of toks(h)) pool.set(t, (pool.get(t) || 0) + 1);
      return new Set(words.flatMap((w, j) => (toks(w.text).filter((t) => { const n = pool.get(t) || 0; if (n) pool.set(t, n - 1); return !n; }).length ? [j] : [])));
    };
    const sets = (alts.length ? alts : ['']).map(missIn);
    const flags = words.filter((_, j) => sets.every((m) => m.has(j)));
    return { i: k, start: c.start, end: c.end, text: c.text, heard: alts.join(' | '), words, flags };
  });
}

/** windows covering [0, dur]: WIN long every STEP */
export function windows(dur, win = WIN, step = STEP) {
  const out = [];
  for (let a = 0; a < dur; a += step) { out.push([+a.toFixed(3), +Math.min(dur, a + win).toFixed(3)]); if (a + win >= dur) break; }
  return out;
}

/** per caption, the heard text of every window that covers it (fully if any does), words within SLACK of it */
export function heardFor(caps, spans, decoded, slack = SLACK) {
  return caps.map((c) => {
    const lo = c.start - slack, hi = c.end + slack;
    let ix = spans.map((s, j) => j).filter((j) => spans[j][0] <= Math.max(0, c.start - 0.3) && spans[j][1] >= c.end + 0.3);
    if (!ix.length) ix = spans.map((s, j) => j).filter((j) => spans[j][0] < c.end && spans[j][1] > c.start);
    return ix.map((j) => decoded[j].filter((w) => w.start >= lo && w.start < hi).map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim());
  });
}

export function report(rows) {
  const f = rows.filter((r) => r.flags.length), lines = [];
  for (const r of f) lines.push(`FLAG cap ${r.i} [${r.start.toFixed(2)}-${r.end.toFixed(2)}] "${r.text}" heard "${r.heard}" -> not heard: ${r.flags.map((w) => `${w.i ?? '?'}:${w.text}`).join(' ')}  (caption words: ${r.words.map((w) => `${w.i ?? '?'}:${w.text}`).join(' ')})`);
  lines.push(`caption-verify: ${f.length} of ${rows.length} captions flagged, ${f.reduce((n, r) => n + r.flags.length, 0)} words (second decode of the final audio; review aid, not a gate)`);
  return lines.join('\n');
}

function main(argv) {
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !['--audio', '--lang', '--model', '--passes'].includes(argv[i - 1]));
  if (pos.length !== 1) { console.error('usage: caption-verify.mjs <project-dir> [--audio wav] [--lang en] [--model medium] [--passes plain,disfluent] [--json]'); return 2; }
  const proj = pos[0], A = path.join(proj, 'assets');
  const audio = opt('--audio', path.join(A, 'mix.wav'));
  for (const f of [audio, path.join(A, 'captions.json'), path.join(A, 'transcript.json')]) if (!fs.existsSync(f)) { console.error(`caption-verify: missing ${f}`); return 2; }
  const caps = JSON.parse(fs.readFileSync(path.join(A, 'captions.json'), 'utf8'));
  const tr = JSON.parse(fs.readFileSync(path.join(A, 'transcript.json'), 'utf8'));
  const cw = captionWords(caps, tr.words || tr);
  const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio], { encoding: 'utf8' });
  const dur = Number(pr.stdout.trim());
  if (!(dur > 0)) { console.error(`caption-verify: no duration for ${audio}`); return 2; }
  const spans = windows(dur);
  const PY = process.env.AI_VIDEO_EDITOR_PYTHON || path.join(process.env.AI_VIDEO_EDITOR_HOME || path.join(os.homedir(), '.ai-video-editor'), 'venv/bin/python');
  const passes = opt('--passes', 'plain,disfluent').split(',').filter(Boolean), heard = caps.map(() => []);
  for (const pass of passes) {
    const args = ['-I', path.join(HERE, 'asr_excerpts.py'), audio, opt('--model', 'medium'), JSON.stringify(spans), '--lang', opt('--lang', 'auto')];
    if (pass === 'disfluent') args.push('--disfluent');
    const r = spawnSync(PY, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) { console.error(`caption-verify: ${pass} decode failed (${r.status}): ${(r.stderr || '').slice(-400)}`); return 2; }
    heardFor(caps, spans, JSON.parse(r.stdout)).forEach((h, k) => heard[k].push(...h));
  }
  const rows = verify(cw, heard);
  if (argv.includes('--json')) console.log(JSON.stringify({ captions: rows, flagged: rows.filter((x) => x.flags.length).length }, null, 1));
  else console.log(report(rows));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));

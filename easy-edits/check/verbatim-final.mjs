// Easy Edits verbatim check on the FINAL render: every word the video shows must be a word the final audio says,
// at that time. verbatim-guard.mjs compares overlays with the ASR transcript the edit was built from, so an ASR
// mishearing passes ("TRUSTED US" on gen_talk_v5 0:25, the audio says "trust in us").
//   node easy-edits/check/verbatim-final.mjs <project-dir> <final.mp4> [--swaps] [--confirmed "p1,p2"] [--heard "a=b,..."] [--lang auto|en|tl] [--json]
// Shown text: easy-edits/tools/dom-sample.mjs runs of the composition (captions, kinetic type, chips, SVG labels,
// everything visible; name cards skipped, name-guard.mjs checks names), shifted by the post lead-in
// (final duration - composition duration). Heard: a fresh faster-whisper medium transcript of the final's
// audio (check/final-asr.mjs; small when medium cannot load), words lowercased, punctuation dropped,
// numerals 0-20 as words (verbatim-guard norm). Long-form Whisper int8 drops words and is not deterministic on
// ambiguous audio (gen_talk_v5 25-28 s: one long-form run heard "trusted us", another "trust outside"), so each
// caption / kinetic run is judged by an excerpt holding it with 2 s either side (spans merged into <= 8 s chunks),
// decoded alone at temperature 0, else (empty decode) the long-form transcript
// (check/asr_excerpts.py; 23.4-28.5, 24.4-27.5 and 24.9-27.0 all hear "a greater trust in us"); labels by the
// long-form transcript. Per text run:
//   cap / kinetic  its words are a contiguous span of the words heard from 1.0 s before it appears to 1.0 s
//                  after it leaves. FAIL otherwise ("trusted us" vs heard "a greater trust in us to go").
//   chip / other   every content word is heard within 3 s of the run (labels may reorder or abbreviate).
// --swaps (the edit.sh gate): only captions / kinetic words, and a FAIL only for a MISHEARD word: the shown run
//   lines up with a heard window of the same length whose other words match in place, and each differing word
//   is an inflection of the shown one (one is a prefix of the other: "AND BE ABLE" vs heard "and being able",
//   gen_th_style2b 0:09) or a preposition swap ("FOR" vs heard "to"; before the reviewer's notes such a swap was only
//   a WARN). A heard token that is the shown word glued to >= 3 more letters that are not an inflection suffix
//   ("greatertalked" for GREATER, gen_th_style2d 0:18.5) is an ASR concatenation artifact and matches. Other misses (a word Whisper dropped, "A VERY LARGE" vs "very large") are WARN.
// --confirmed "p1,p2" exempts runs inside a confirmed phrase (look-bright verbatim.confirmed: "trust in us", which
//   the reviewer confirmed for talk_30s ~22 s even though Whisper hears "trusted us").
// --heard "for our group=to our group" (look-bright verbatim.heard): reviewer hearings that override the ASR, the
//   opposite of --confirmed. gen_th_style2c ~0:03 shows FOR; the reviewer hears "to our group", but the ElevenLabs source
//   transcript and faster-whisper medium on the final (long-form and excerpts, p 0.96-0.99) both say "for": the
//   cut at source 8.17-8.87 removed most of the word, and Whisper fills the fragment from context. No ASR
//   comparison can catch it, so the reviewer's hearing is input; with it the caption FAILs as misheard.
// Exit 1 on any FAIL, 2 on usage.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { projectSamples, runs, leadOffset } from '../tools/dom-sample.mjs';
import { norm } from '../tools/verbatim-guard.mjs';
import { finalAsr, excerptAsr, langArg } from './final-asr.mjs';

const FUNCTION = new Set('a an the and or but of in on at to for from by with as is are was be it its our your my we us you i'.split(' '));
const span = (T, W) => { for (let i = 0; i + W.length <= T.length; i++) if (W.every((w, k) => T[i + k] === w)) return true; return false; };
export const mmss = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** runs (composition time), heard words (final time), lead-in offset -> {fails, ok} */
export function verbatimFinal(textRuns, heard, offset = 0, { capPad = 1.0, labelPad = 3.0 } = {}) {
  const fails = [], ok = [];
  for (const r of textRuns) {
    if (r.kind === 'card') continue;
    const W = norm(r.text); if (!W.length) continue;
    const strict = r.kind === 'cap' || r.kind === 'kinetic', pad = strict ? capPad : labelPad;
    const a = r.start + offset - pad, b = r.end + offset + pad;
    const win = heard.filter((w) => w.end > a && w.start < b), T = win.flatMap((w) => norm(w.text));
    const pass = strict ? span(T, W) : W.filter((w) => !FUNCTION.has(w)).every((w) => T.includes(w));
    const row = { kind: r.kind, text: r.text, at: +(r.start + offset).toFixed(2), end: +(r.end + offset).toFixed(2), heard: T.join(' '), missing: W.filter((w) => !T.includes(w)) };
    (pass ? ok : fails).push(row);
  }
  return { fails, ok };
}

// prepositions only: a dropped article that shifts the window ("A VERY LARGE" vs "is very large") stays a WARN
const PREP = new Set('to for from of in on at by with into onto'.split(' '));
const fnSwap = (a, b) => a !== b && PREP.has(a) && PREP.has(b);
// an ASR concatenation artifact: the heard token is the shown word plus >= 3 extra letters that are not an
// inflection suffix ("greatertalked" for GREATER, gen_th_style2d 0:18.5; "being" for BE stays an inflection)
const SUFFIX = new Set('s es ed d er ers est ing ings ly n en ness ment'.split(' '));
export const glued = (w, h) => h !== w && w.length >= 2 && h.length - w.length >= 3 &&
  ((h.startsWith(w) && !SUFFIX.has(h.slice(w.length))) || h.endsWith(w));
const infl = (a, b) => a !== b && Math.min(a.length, b.length) >= 2 && (a.startsWith(b) || b.startsWith(a)) && !glued(a, b);
/** Shown words W vs heard T: the heard window where W was misheard as an inflection, else null. */
export function misheard(W, T) {
  for (let i = 0; i + W.length <= T.length; i++) {
    const win = T.slice(i, i + W.length), diff = W.map((w, k) => (win[k] === w || glued(w, win[k]) ? null : k)).filter((k) => k !== null);
    // some word differs, each difference is an inflection or a function-word swap ("for" vs "to"), and
    // (multi-word runs) at least one word matches in place
    if (diff.length && (W.length === 1 || diff.length < W.length) && diff.every((k) => infl(W[k], win[k]) || fnSwap(W[k], win[k]))) return win.join(' ');
  }
  return null;
}
/** Reviewer hearings ("for our group=to our group"): where the heard words contain the left phrase, they are
 *  replaced in place by the right one (same word count), before any comparison. Whisper cannot be argued out of
 *  a function word it predicts from context; a human who listened can. */
export function applyHeard(words, pairs = []) {
  const out = words.map((w) => ({ ...w }));
  for (const p of pairs) {
    const [from, to] = p.split('=').map((x) => norm(x || ''));
    if (!from.length || from.length !== to.length) continue;
    for (let i = 0; i + from.length <= out.length; i++) {
      if (from.every((f, k) => norm(out[i + k].text).join(' ') === f)) for (let k = 0; k < from.length; k++) out[i + k].text = to[k];
    }
  }
  return out;
}
/** Shown words W are heard in T when glued tokens ("greatertalked") count as their shown word. */
export const gluedSpan = (W, T) => { for (let i = 0; i + W.length <= T.length; i++) if (W.every((w, k) => T[i + k] === w || glued(w, T[i + k]))) return true; return false; };
/** --swaps: strict fails split into misheard FAILs and WARNs; runs inside a confirmed phrase pass. */
export function swapsOnly(fails, confirmed = []) {
  const C = confirmed.map((c) => norm(c)), out = { fails: [], warns: [] };
  for (const f of fails) {
    if (f.kind !== 'cap' && f.kind !== 'kinetic') continue;
    const W = norm(f.text);
    if (C.some((c) => span(c, W)) || gluedSpan(W, f.heard.split(' ').filter(Boolean))) continue;
    const m = misheard(W, f.heard.split(' ').filter(Boolean));
    if (m) out.fails.push({ ...f, misheard: m }); else out.warns.push(f);
  }
  return out;
}

const durOf = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2), [proj, video] = argv, lang = langArg(argv);
  if (!proj || !video || !fs.existsSync(video)) { console.error('usage: verbatim-final.mjs <project-dir> <final.mp4> [--swaps] [--confirmed "p1,p2"] [--heard "said=heard,..."] [--lang auto|en|tl] [--json]'); process.exit(2); }
  const hi = argv.indexOf('--heard'), heardFix = hi >= 0 ? (argv[hi + 1] || '').split(',').filter((x) => x.includes('=')) : [];
  const sample = await projectSamples(proj), asr0 = finalAsr(video, { lang }), off = leadOffset(durOf(video), sample.duration);
  const asr = { ...asr0, words: applyHeard(asr0.words, heardFix) };
  const rs = runs(sample).filter((r) => r.kind !== 'card' && norm(r.text).length);
  // strict runs: judged by their own excerpt (2 s either side, decoded alone); labels: by the long-form transcript
  const strict = rs.filter((r) => r.kind === 'cap' || r.kind === 'kinetic');
  // spans merged into chunks of at most 8 s (each run keeps its 2 s context), one decode per chunk
  const spans = strict.map((r) => [Math.max(0, r.start + off - 2), r.end + off + 2]), chunks = [];
  for (const [a, b] of spans) { const c = chunks.at(-1); if (c && a <= c[1] && b - c[0] <= 8) c[1] = Math.max(c[1], b); else chunks.push([a, b]); }
  const ex = excerptAsr(video, chunks.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]), { lang }).map((ws) => applyHeard(ws, heardFix));
  const heardFor = (i) => { const k = chunks.findIndex(([a, b]) => spans[i][0] >= a - 1e-6 && spans[i][1] <= b + 1e-6); return ex[k]?.length ? ex[k] : asr.words; };
  const parts = [verbatimFinal(rs.filter((r) => !strict.includes(r)), asr.words, off), ...strict.map((r, i) => verbatimFinal([r], heardFor(i), off))];
  const ok = parts.flatMap((p) => p.ok), all = parts.flatMap((p) => p.fails).sort((x, y) => x.at - y.at);
  const ci = argv.indexOf('--confirmed'), confirmed = ci >= 0 ? (argv[ci + 1] || '').split(',').filter((x) => x.trim()) : [];
  if (argv.includes('--swaps')) {
    const { fails, warns } = swapsOnly(all, confirmed);
    console.log(`verbatim-final: ${fails.length ? 'FAIL' : 'PASS'} --swaps (${fails.length} misheard caption / kinetic word(s), ${warns.length} WARN, faster-whisper ${asr.model}, lead-in ${off} s${confirmed.length ? `, confirmed: ${confirmed.join(' / ')}` : ''})`);
    for (const f of fails) console.log(`  FAIL MISHEARD ${mmss(f.at)}-${mmss(f.end)} ${f.kind} "${f.text}": the audio says "${f.misheard}" (the transcript has the wrong word; show the words as said)`);
    for (const f of warns) console.log(`  WARN ${mmss(f.at)}-${mmss(f.end)} ${f.kind} "${f.text}" not heard in order; heard "${f.heard}"`);
    process.exit(fails.length ? 1 : 0);
  }
  const fails = all;
  if (argv.includes('--json')) console.log(JSON.stringify({ pass: !fails.length, model: asr.model, offset: off, fails, ok }, null, 1));
  else {
    console.log(`verbatim-final: ${fails.length ? 'FAIL' : 'PASS'} (${ok.length + fails.length} shown texts vs faster-whisper ${asr.model} of ${video}, lead-in ${off} s)`);
    for (const f of fails) console.log(`  FAIL ${mmss(f.at)}-${mmss(f.end)} ${f.kind} "${f.text}" not heard${f.missing.length ? ` (${f.missing.join(', ')})` : ' in order'}; heard "${f.heard}"`);
    if (fails.length) console.log('  Every caption, kinetic word and label must be what the final audio says. Fix the text (or re-transcribe the source) and re-render.');
  }
  process.exit(fails.length ? 1 : 0);
}

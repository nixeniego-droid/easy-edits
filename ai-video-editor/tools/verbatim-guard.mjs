// AI Video Editor verbatim guard: words on screen that stand for speech must be the speaker's words, never a paraphrase.
//   node ai-video-editor/tools/verbatim-guard.mjs <project-dir> [--json]
// Overlay text comes from ai-video-editor/tools/overlay-text.mjs (index.html + mounted compositions, captions excluded).
// Transcript = assets/transcript.json (retimed, what the edit says), else assets/source-transcript.json. Words are
// compared lowercased with punctuation and apostrophes dropped, `&` read as `and`, numerals 0-20 read as words, and
// word for word ("TRUST" is not "trusted").
// Two tiers, from the ids and classes of the text's element and its ancestors:
//   strict  kinetic words, big type, quote cards and caption-like overlays: an ancestor id/class token is one of
//           paper kinetic kin quote stack stacked slam word words type huge giant punch headline caption
//           subtitle sub, and the text's own element is not label-like (below). It must be a contiguous span of
//           the transcript. FAIL otherwise.
//   label   chips, pills, tags, kickers, badges, panel labels, everything else (own id/class token chip pill tag
//           label kick kicker badge eyebrow, or no strict ancestor). A label may name a topic in its own words
//           ("GLOBAL PRECIPITATION MEASUREMENT"), but FAILs when it quotes speech with a word swapped: some
//           transcript window of the same length matches at least half its words in place, and every
//           transcript word it replaced is a content word ("TINY ONES" for "small ones"; "NASA GODDARD" for
//           "at Goddard" passes, since only the function word "at" was replaced). At least one in-place match must
//           be a content word that is not a name or a number ("WHY EUROPA?" vs "case Europa" is a label); an inflection of the
//           same word ("MA-COLLECT" / "ma -collection") is not a swap. Function words include Tagalog particles.
//   caption captions as SHOWN (tools/dom-sample.mjs runs of kind cap, outermost caption element; kinetic words stay
//           in the strict tier above, since a kinetic title such as "GPM" may sit over other speech;
//           needs the cached sample or a browser, else skipped with a note): each run's words must equal, token for
//           token and in order, a contiguous span of transcript words whose start times fall inside the run's
//           display window (+-0.6 s). A caption that reorders, swaps, drops or adds a word, or shows words the
//           transcript has at another time, FAILs. This tier reads the transcript, not the audio: when the
//           transcript itself is wrong ("be able" where the audio says "being able", gen_th_style2b 0:09) only
//           check/verbatim-final.mjs (fresh ASR of the final, wired into edit.sh) can see it.
// Name cards (overlay-text CARD) and single symbols are skipped; name-guard.mjs checks names.
// Exit 1 on any FAIL, 2 on usage / missing files, 0 otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectOverlays, read } from './overlay-text.mjs';
import { projectSamples, runs as domRuns } from './dom-sample.mjs';

const FUNCTION = new Set(`a an the and or but nor so yet of in on at to for from by with as into onto about over under up
down out off than then that this these those there here is are was were be been being am i im me my we our us you your he
him his she her it its they them their what which who whom whose when where why how not no do does did have has had will
would can could should shall may might must just very really also too only even ng sa na at ang mga si ni kay ay pa po
din rin lang nga ba naman mo ko ka kami tayo natin namin sila ito iyan yan yung ung kasi pag kung para sana`.split(/\s+/));
const STRICT = /^(paper|kinetic|kin|quote|stack|stacked|slam|word|words|type|huge|giant|punch|headline|caption|subtitle|sub)$/i;
const LABEL = /^(chip|chip-in|pill|tag|label|kick|kicker|badge|eyebrow)$/i;

const NUM = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');
export const norm = (s) => (s.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').match(/[\p{L}\p{N}]+/gu) || []).map((w) => NUM[+w] ?? w);
// same word, inflected ("collect" / "collection"): not a swap
const stem = (a, b) => a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a));

/** Classify one overlay entry: 'strict' | 'label' | null (skipped). */
export function tier(o) {
  if (o.card) return null;
  const own = o.own?.split(/\s+/) || [];
  if (own.some((t) => LABEL.test(t))) return 'label';
  const ctx = (o.ctx || '').split(/\s+/);
  return ctx.some((t) => STRICT.test(t)) ? 'strict' : 'label';
}

const spanAt = (T, W) => { for (let i = 0; i + W.length <= T.length; i++) if (W.every((w, k) => T[i + k] === w)) return i; return -1; };

/** Check overlay entries against transcript word texts; returns { fails, ok }. */
export function verbatim(overlays, words) {
  const T = words.flatMap((w) => norm(w.text));
  // name-like: every spoken occurrence is capitalised; an in-place match on a name alone is a topic label, not a quote
  const upper = new Map();
  for (const w of words) for (const t of norm(w.text)) upper.set(t, (upper.get(t) ?? true) && /^\p{Lu}/u.test(w.text.trim()));
  const fails = [], ok = [];
  for (const o of overlays) {
    const t = tier(o), W = norm(o.text);
    if (!t || !W.length || o.where === 'body' && /^<!doctype/i.test(o.text)) continue;
    const at = spanAt(T, W);
    if (at >= 0) { ok.push({ tier: t, text: o.text, where: o.where }); continue; }
    if (t === 'strict') {
      // nearest spoken window for the message: most in-place matches
      let best = -1, bestN = 0;
      for (let i = 0; i + W.length <= T.length; i++) { const n = W.filter((w, k) => T[i + k] === w).length; if (n > bestN) { bestN = n; best = i; } }
      fails.push({ tier: t, text: o.text, where: o.where, file: o.file, missing: W.filter((w) => !T.includes(w)), said: best >= 0 ? T.slice(best, best + W.length).join(' ') : null });
      continue;
    }
    if (W.length < 2) { ok.push({ tier: t, text: o.text, where: o.where }); continue; }
    let hit = null;
    for (let i = 0; i + W.length <= T.length && !hit; i++) {
      const win = T.slice(i, i + W.length), same = W.map((w, k) => win[k] === w || stem(win[k], w) ? k : -1).filter((k) => k >= 0);
      const replaced = win.filter((w, k) => W[k] !== w && !stem(w, W[k]));
      // a quote needs a matched content word that is not a name or a number
      const quoted = same.some((k) => !FUNCTION.has(win[k]) && !upper.get(win[k]) && !NUM.includes(win[k]));
      if (quoted && same.length * 2 >= W.length && replaced.length && replaced.every((w) => !FUNCTION.has(w))) hit = win.join(' ');
    }
    if (hit) fails.push({ tier: t, text: o.text, where: o.where, file: o.file, said: hit, paraphrase: true });
    else ok.push({ tier: t, text: o.text, where: o.where });
  }
  return { fails, ok };
}

export const CAP_SLACK = 0.6;
/** Shown speech runs [{id, kind, text, start, end}] (outermost cap / kinetic only) vs transcript words -> fails. */
export function captionVerbatim(shown, words, { slack = CAP_SLACK } = {}) {
  const T = words.flatMap((w) => norm(w.text).map((t) => ({ t, start: +w.start, end: +w.end })));
  const fails = [];
  let ok = 0;
  for (const r of shown) {
    const W = norm(r.text);
    if (!W.length) continue;
    const inWin = (i) => T[i].start >= r.start - slack && T[i].start <= r.end + slack;
    let hit = false;
    for (let i = 0; i + W.length <= T.length && !hit; i++) hit = W.every((w, k) => T[i + k].t === w && inWin(i + k));
    if (hit) { ok++; continue; }
    const near = T.filter((x) => x.start >= r.start - slack && x.start <= r.end + slack).map((x) => x.t);
    const elsewhere = spanAt(T.map((x) => x.t), W) >= 0;
    fails.push({ tier: 'caption', kind: r.kind, id: r.id, text: r.text, start: r.start, end: r.end, said: near.join(' '), elsewhere });
  }
  return { fails, ok };
}
/** Outermost caption runs of a dom-sample, by start time. */
export function shownSpeech(sample) {
  const el = sample.elements, sp = (id) => el[id] && el[id].kind === 'cap';
  return domRuns(sample).filter((r) => sp(r.id) && !sp(el[r.id].parent)).sort((a, b) => a.start - b.start);
}

export function transcriptFile(proj) {
  return ['assets/transcript.json', 'assets/source-transcript.json'].map((f) => path.join(proj, f)).find((f) => fs.existsSync(f));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2), proj = argv[0];
  if (!proj || proj.startsWith('--')) { console.error('usage: verbatim-guard.mjs <project-dir> [--json]'); process.exit(2); }
  const overlays = projectOverlays(proj), tr = transcriptFile(proj);
  if (!overlays || !tr) { console.error(`verbatim-guard: missing index.html or assets/transcript.json in ${proj}`); process.exit(2); }
  const words = JSON.parse(read(tr)).words.filter((w) => (w.type || 'word') === 'word');
  const { fails, ok } = verbatim(overlays, words);
  let cap = null, capNote = '';
  try { cap = captionVerbatim(shownSpeech(await projectSamples(proj)), words); fails.push(...cap.fails); }
  catch (e) { capNote = ` (caption tier skipped: ${String(e.message || e).split('\n')[0]})`; }
  const res = { pass: !fails.length, project: proj, transcript: path.relative(proj, tr), fails, ok, captions: cap && { ok: cap.ok, failed: cap.fails.length } };
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else {
    console.log(`verbatim-guard: ${res.pass ? 'PASS' : 'FAIL'} (${ok.length} verbatim/label texts ok, ${cap ? `${cap.ok} caption runs mapped, ` : ''}${fails.length} failed, transcript ${res.transcript})${capNote}`);
    for (const f of fails.filter((x) => x.tier === 'caption')) console.log(`  FAIL caption #${f.id} "${f.text}" ${f.start.toFixed(2)}-${f.end.toFixed(2)} s is not the transcript words at that time (transcript there: "${f.said}")${f.elsewhere ? '; those words are said at another time' : ''}`);
    for (const f of fails.filter((x) => x.tier !== 'caption')) console.log(`  FAIL ${f.tier} ${f.where} "${f.text}" ${f.paraphrase ? `paraphrases "${f.said}"` : `is not a transcript span${f.missing.length ? ` (not said: ${f.missing.join(', ')})` : ''}${f.said ? `; nearest "${f.said}"` : ''}`}`);
    if (!res.pass) console.log('  Kinetic words, quote cards and caption-like overlays must be a contiguous span of the transcript; a chip may be a topic label but must not quote speech with a word swapped. Use the spoken words.');
  }
  process.exit(res.pass ? 0 : 1);
}

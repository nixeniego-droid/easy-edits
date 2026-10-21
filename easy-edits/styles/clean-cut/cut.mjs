#!/usr/bin/env node
// Easy Edits CLEAN CUT: the deterministic cut list (no agent). Removes fillers, repeated words / phrases (the last take
// is kept), false starts and dead air from a disfluent word transcript; edit points sit in the quiet between words.
//   node easy-edits/styles/clean-cut/cut.mjs <source-transcript.json> <project-dir> --source <media>
//        [--candidates source.cut-candidates.json] [--patch review-patch.json] [--mode clean|light|strict] [--fps 30] [--json]
// --mode clean (default): fillers, dead air > 0.8 s, stutters / false starts / repeats (not across a sentence end);
// light: fillers + dead air > 0.8 s only (see LIGHT_GAP_MAX); strict: every rule below, pauses > 0.3 s.
// Writes <project>/assets/edit-decisions.json ({source, fps, keeps[{sourceStart, sourceEnd, start, end}],
// removed[{sourceStart, sourceEnd, text, reason}]}), assets/transcript.json (kept words retimed),
// assets/source-transcript.json (the source words, for cut-guard) and assets/cut-review.md (indexed words for the
// light review). Rules (cleanCut):
//   filler       uh / um / er / erm / ah / hmm / uhm / mm (tools/cut-candidates FILLERS)
//   repeat       a word said twice in a row ("I I"), or a 2-4 word phrase said twice in a row: the first take goes
//   false-start  a word Whisper ends with "-", or 1-2 words then "," / "-" and a restart on the same first word
//                ("a gigantic, a very large"), or a cut-candidates cut (window-confirmed stutters / restarts)
//   dead-air     a quiet run (10 ms speech-band windows under the clip's band RMS - 10 dB, the dead-air gate's
//                floor; word gaps without media) longer than GAP_MAX inside kept speech is trimmed to ~GAP_KEEP
//   head / tail  HEAD before the first kept word, TAIL after the last
// Every cut time is a frame time (video and audio cut on the same grid) at the speech-band energy minimum of its
// window, >= GUARD (30 ms, as cut-guard requires) clear of the kept word next to it. Pauses <= GAP_MAX (breaths
// included) are never touched.
// --patch (the light review, all optional): {"keep": [i], "remove": [i], "text": {"i": "Fixed"}} with word indices
// of the source transcript (cut-review.md): force-keep (intentional repetition, a punchline pause), force-remove,
// caption / transcript spelling fixes ("" = keep the audio, no caption word; text fixes never move a cut).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkCuts } from '../../tools/cut-guard.mjs';

export const SLIP_MAX = 0.02, SLIPS = Array.from({ length: 20 }, (_, i) => [(i + 1) * 0.001, -(i + 1) * 0.001]).flat().map((d) => Math.round(d * 10000) / 10000); // audio edge slips (s)
// clean (the approved default since 2026-10-18): fillers, dead air (pauses > LIGHT_GAP_MAX, breathing
// pauses stay) and clear slips: stutters, false starts and repeats ("a, a, a gigantic"), but never a repeat across a
// sentence end ("... with vision. Vision helps"). Self-corrections that are not repeats ("Proverbs 30, 29", "a
// statement ... I mean, mission") are the review's call (brief-clean.md: whole words only, never invent words).
// light (--mode light): only fillers (uh / um / ah ...) and dead air go; repeats,
// self-corrections ("Proverbs 30, 29", "Vision ... I mean, mission") and false starts stay as spoken, and a pause
// is only trimmed when it is longer than LIGHT_GAP_MAX (breathing pauses stay), down to ~LIGHT_GAP_KEEP.
// strict (--mode strict): the original rules (repeats / false starts / window-confirmed stutters cut, pauses > 0.3 s).
export const LIGHT_GAP_MAX = 0.8, LIGHT_GAP_KEEP = 0.45, MODES = ['clean', 'light', 'strict'];
export const GAP_MAX = 0.3, GAP_KEEP = 0.2, HEAD = 0.15, TAIL = 0.25, GUARD = 0.03, WIN = 0.01;
export const FILLERS = new Set(['uh', 'um', 'er', 'erm', 'ah', 'hmm', 'uhm', 'mm', 'umm', 'uhh']);
const tok = (s) => (s.toLowerCase().replace(/['’]/g, '').match(/[\p{L}\p{N}]+/gu) || []).join('');
const r3 = (v) => Math.round(v * 1000) / 1000;

/** words -> [{reason}|null] per word: which words a clean cut removes. */
export const fillerOnly = (c) => (c.because || []).length > 0 && c.because.every((b) => FILLERS.has(tok(b)));
export function markRemovals(words, { candidates = [], patch = {}, mode = 'clean' } = {}) {
  const t = words.map((w) => tok(w.text)), why = words.map(() => null);
  t.forEach((x, i) => { if (FILLERS.has(x) || !x) why[i] = 'filler'; });
  // a filler token just before a word with no duration is not trusted: Whisper misaligned there. talk_30s (fresh
  // user, 2026-10-19): "importance" 8.10-8.10 stacked on "for", its audio labelled a second "uh," (7.40-7.64), so
  // cutting that "uh" dropped "importance" (content FAIL). Such a filler goes only when a window-confirmed filler cut
  // (cut-candidates) covers it; otherwise its audio stays (a kept "uh" is better than a lost word).
  const confirmedFiller = (w) => candidates.some((c) => c.from === 'filler-windows' && fillerOnly(c) && w.start >= c.start - 0.05 && w.end <= c.end + 0.05);
  t.forEach((x, i) => {
    if (!x || !FILLERS.has(x)) return;
    let j = i + 1; while (j < words.length && FILLERS.has(t[j])) j++;
    if (words[j] && words[j].end - words[j].start < 0.05 && !confirmedFiller(words[i])) why[i] = null;
  });
  if (mode === 'light') {
    for (const c of candidates.filter(fillerOnly)) words.forEach((w, i) => { if (!why[i] && w.start >= c.start - 0.05 && w.end <= c.end + 0.05 && FILLERS.has(t[i])) why[i] = 'filler'; });
    for (const i of patch.remove || []) if (words[i]) why[i] = 'review';
    for (const i of patch.keep || []) if (words[i]) why[i] = null;
    return why;
  }
  const live = () => t.map((x, i) => i).filter((i) => !why[i]);
  // false starts: a cut-off word ("gi-"), or 1-2 words + "," / "-" then a restart on the same first word
  words.forEach((w, i) => { if (!why[i] && /[-–—]$/.test(w.text.trim())) why[i] = 'false-start'; });
  let L = live();
  for (let k = 0; k < L.length - 1; k++) {
    const j = L[k];
    if (!/[,\-–—]$/.test(words[j].text.trim())) continue;
    for (const back of [1, 0]) {
      const a = k - back;
      if (a < 0 || L[k + 1] == null || t[L[a]] !== t[L[k + 1]]) continue;
      if (back === 0) continue; // a lone word then itself is a repeat (below)
      const take = L.slice(a, k + 1), redo = L.slice(k + 1, k + 1 + take.length);
      if (take.every((x, m) => redo[m] != null && t[x] === t[redo[m]])) continue; // a full repeat, handled below
      take.forEach((x) => { why[x] = 'false-start'; });
      break;
    }
  }
  // repeats: the longest phrase (4..1 words) said twice in a row; the first take goes
  L = live();
  for (let k = 0; k < L.length; k++) {
    for (let n = 4; n >= 1; n--) {
      if (k + 2 * n > L.length) continue;
      let same = true;
      for (let m = 0; m < n && same; m++) same = t[L[k + m]] === t[L[k + n + m]];
      // clean: a first take that ends a sentence is not a slip ("the people with vision. Vision helps us")
      if (same && mode === 'clean' && /[.?!]["'”’)]*$/.test(words[L[k + n - 1]].text.trim())) same = false;
      if (!same) continue;
      for (let m = 0; m < n; m++) why[L[k + m]] = n === 1 ? 'repeat' : 'repeat-phrase';
      L = live(); k = Math.max(-1, k - 1); break;
    }
  }
  // cut-candidates cuts (window-confirmed): every word inside one goes
  for (const c of candidates) {
    words.forEach((w, i) => { if (!why[i] && w.start >= c.start - 0.05 && w.end <= c.end + 0.05) why[i] = `candidate: ${(c.because || []).join(' / ') || 'stutter'}`; });
  }
  for (const i of patch.remove || []) if (words[i]) why[i] = 'review';
  for (const i of patch.keep || []) if (words[i]) why[i] = null;
  return why;
}

/** quiet runs [[a, b]] (s) of 10 ms band windows under the dead-air floor (band RMS - rel dB). */
export function quietRuns(win, { rel = 10, min = GAP_MAX } = {}) {
  const mean = 10 * Math.log10(win.reduce((s, d) => s + 10 ** (d / 10), 0) / Math.max(1, win.length)), thr = mean - rel, out = [];
  let a = -1;
  for (let i = 0; i <= win.length; i++) {
    const q = i < win.length && win[i] < thr;
    if (q && a < 0) a = i;
    if (!q && a >= 0) { if ((i - a) * WIN > min) out.push([r3(a * WIN), r3(i * WIN)]); a = -1; }
  }
  return out;
}

/** cut-guard's quiet level: under max(speech - 25, noise + 6) dB (speech = median of active 10 ms windows, noise =
 * 10th percentile), so an edit point there is never "voiced" for tools/cut-guard.mjs. */
export function deepLevel(win) {
  const all = 10 * Math.log10(win.reduce((s, d) => s + 10 ** (d / 10), 0) / win.length);
  const act = win.filter((d) => d > all - 20).sort((a, b) => a - b), srt = [...win].sort((a, b) => a - b);
  return Math.max(act[act.length >> 1] - 25, srt[Math.floor(srt.length * 0.1)] + 6);
}

/** frame time in [lo, hi]: the one nearest pref whose 30 ms on the kept side is under the deep level, else the
 * quietest (no media: the frame nearest pref). */
function pick(lo, hi, pref, { win, fps, side, deep }) {
  const f0 = Math.ceil(lo * fps - 1e-6), f1 = Math.floor(hi * fps + 1e-6);
  if (f1 < f0) return Math.round(pref * fps) / fps;
  const energy = (t) => { const i0 = Math.max(0, Math.floor((side === 'end' ? t - 0.03 : t) / WIN) + 0); let m = -Infinity; for (let i = i0; i < i0 + 3; i++) m = Math.max(m, win[i] ?? -120); return m; };
  let best = null, bestK = Infinity;
  for (let f = f0; f <= f1; f++) {
    const t = f / fps, d = Math.abs(t - pref);
    const k = !win ? d : energy(t) < deep ? d : 1000 + energy(t);
    if (k < bestK) { bestK = k; best = t; }
  }
  return best;
}

/** a repeat the transcript merged into one word ("a" 30.04-30.76 s holding "a, a" on talk_30s), confirmed by a
 * cut-candidates cut that heard "x x" there: the word is split at the longest deep-quiet run (>= 0.1 s) inside it
 * and the SECOND fragment becomes a removed pseudo word (it starts after the quiet, so both its edges can sit in a
 * pause; the first is usually glued to the word before). -> words (the kept word shortened) + pseudo words. */
export function splitMerged(words, candidates, win, deep) {
  const out = words.map((w) => ({ ...w })), extra = [];
  for (const c of candidates) {
    const x = (c.because || []).map((b) => b.toLowerCase().match(/^([\p{L}\p{N}']+)[,]? \1$/u)?.[1]).find(Boolean);
    if (!x) continue;
    const k = out.findIndex((w, i) => tok(w.text) === tok(x) && w.end - w.start > 0.4 && w.start < c.end + 0.6 && w.end > c.start - 0.6 && tok(out[i + 1]?.text || '') !== tok(x) && tok(out[i - 1]?.text || '') !== tok(x));
    if (k < 0) continue;
    const w = out[k], i0 = Math.ceil(w.start / WIN), i1 = Math.floor(w.end / WIN);
    let best = null;
    for (let i = i0, a = -1; i <= i1; i++) {
      const q = i < i1 && (win[i] ?? -120) < deep;
      if (q && a < 0) a = i;
      if (!q && a >= 0) { if (i - a >= 10 && a > i0 && i < i1 && (!best || i - a > best[1] - best[0])) best = [a, i]; a = -1; }
    }
    if (!best) continue;
    extra.push({ text: w.text, start: r3(best[1] * WIN), end: w.end, ix: w.ix, pseudo: true, why: 'repeat (merged)' });
    w.end = r3(best[0] * WIN);
  }
  return { words: out, extra };
}

/** words + options -> {keeps, removed, words (kept, retimed)} */
export function cleanCut(words, { duration, win = null, fps = 30, candidates = [], patch = {}, mode = 'clean' } = {}) {
  if (!MODES.includes(mode)) throw new Error(`cut mode must be one of ${MODES.join(', ')}`);
  const relaxed = mode !== 'strict', gapMax = relaxed ? LIGHT_GAP_MAX : GAP_MAX, gapKeep = relaxed ? LIGHT_GAP_KEEP : GAP_KEEP;
  const light = mode === 'light';
  if (light) candidates = candidates.filter(fillerOnly);
  // patch.text fixes the caption text; an empty string keeps the word's audio but drops it from the captions
  // (e.g. a stray syllable). A blank never changes the cut: the decisions see the transcribed word.
  words = words.filter((w) => (w.type ?? 'word') === 'word').map((w, i) => ({ ...w, i, ix: i, text: patch.text?.[i] || w.text, ...(patch.text?.[i] === '' ? { blank: true } : {}) }));
  duration ??= win ? win.length * WIN : Math.max(...words.map((w) => w.end)) + 0.5;
  // a repeat merged into one ASR word: split first (the second take becomes its own word), then the rules; the split
  // pair is kept / removed as one decision (first kept, second removed) whatever the candidate rule says
  if (win && !light) {
    const sp = splitMerged(words, candidates, win, deepLevel(win));
    if (sp.extra.length) words = [...sp.words, ...sp.extra.map(({ pseudo, why: _w, ...x }) => ({ ...x, merged2: true }))].sort((x, y) => x.start - y.start).map((w, i) => ({ ...w, i }));
  }
  let why = markRemovals(words, { candidates, patch, mode });
  words.forEach((w, k) => { if (w.merged2) { why[k] = 'repeat (merged)'; if (words[k - 1]) why[k - 1] = patch.remove?.includes(words[k - 1].ix) ? 'review' : null; } });
  // a cut-candidates cut (window-confirmed stutter / restart / filler from the disfluent decode) also removes its
  // AUDIO when the plain transcript has no word there (Whisper's plain pass drops repeats and fillers): it joins the
  // word list as a removed pseudo word, clipped to the kept words either side
  {
    const keptW = words.filter((w, k) => !why[k]), pseudo = [];
    for (const c of candidates) {
      let a = c.start, b = c.end;
      for (const w of keptW) { if (w.end <= c.start + 0.05 && w.end > a - 0.2) a = Math.max(a, w.end + GUARD); if (w.start >= c.end - 0.05 && w.start < b + 0.2) b = Math.min(b, w.start - GUARD); }
      // a filler glued to a kept word's ASR span ("large" running on over the "uh" after it): the span gives way when
      // the word keeps >= 0.12 s outside the filler (cut-guard still checks the word's own voiced windows)
      if (fillerOnly(c)) for (const w of keptW) {
        if (w.start < a && w.end > a && a - w.start >= 0.12) w.end = r3(a - GUARD / 3);
        else if (w.end > b && w.start < b && w.end - b >= 0.12) w.start = r3(b + GUARD / 3);
      }
      if (keptW.some((w) => w.start < b && w.end > a) || b - a < 0.05) continue;
      pseudo.push({ text: `[${(c.because || []).join(' / ') || 'stutter'}]`, start: r3(a), end: r3(b), pseudo: true, why: (c.because || []).length && c.because.every((b) => FILLERS.has(tok(b))) ? 'filler' : `candidate: ${(c.because || []).join(' / ') || 'stutter'}` });
    }
    if (pseudo.length) {
      const all = [...words.map((w, k) => ({ ...w, why: why[k] })), ...pseudo].sort((x, y) => x.start - y.start);
      words = all.map((w, i) => ({ ...w, i })); why = all.map((w) => w.why);
    }
  }
  const kept = words.filter((w, k) => !why[k]);
  if (!kept.length) return { keeps: [], removed: [], words: [] };
  const quiet = win ? quietRuns(win, { min: gapMax }) : [];
  // segments of kept words: break at removed words and at long pauses
  const segs = [[kept[0]]];
  for (let k = 1; k < kept.length; k++) {
    const a = kept[k - 1], b = kept[k], between = words.some((w, m) => why[m] && w.start >= a.end - 0.02 && w.end <= b.start + 0.02 && w.i > a.i && w.i < b.i);
    if (between || b.i !== a.i + 1 || (!win && b.start - a.end > gapMax)) segs.push([b]); else segs.at(-1).push(b);
  }
  const prevWord = (w) => words.filter((x) => x.i < w.i).at(-1), nextWord = (w) => words.find((x) => x.i > w.i);
  const opt = { win, fps, deep: win ? deepLevel(win) : null };
  // loudest 10 ms window of the 30 ms on the kept side of an edit point
  const levelAt = (t, side) => { const i0 = Math.max(0, Math.floor((side === 'end' ? t - 0.03 : t) / WIN)); let m = -120; for (let i = i0; i < i0 + 3; i++) m = Math.max(m, win[i] ?? -120); return m; };
  const guardOk = (side, t) => !checkCuts([side === 'start' ? { sourceStart: t, sourceEnd: duration } : { sourceStart: 0, sourceEnd: t }], words, { win, sourceEnd: duration }).rows.some((r) => r.fail);
  const deepAt = (t, side) => { const i0 = Math.max(0, Math.floor((side === 'end' ? t - 0.03 : t) / WIN)); for (let i = i0; i < i0 + 3; i++) if ((win[i] ?? -120) >= opt.deep) return false; return true; };
  let keeps = segs.map((s, n) => {
    const a = s[0], z = s.at(-1), p = prevWord(a), q = nextWord(z);
    const lo = Math.max(n === 0 ? 0 : a.start - gapKeep / 2 - 0.05, p ? p.end + GUARD : 0, n === 0 ? a.start - HEAD - 0.05 : 0);
    const hi = Math.min(z.end + (n === segs.length - 1 ? TAIL + 0.05 : gapKeep / 2 + 0.05), q ? q.start - GUARD : duration, duration);
    const sPref = Math.max(lo, a.start - (n === 0 ? HEAD : gapKeep / 2)), ePref = Math.min(hi, z.end + (n === segs.length - 1 ? TAIL : gapKeep / 2));
    let ss = Math.max(0, Math.min(pick(Math.max(lo, sPref - 0.04), Math.min(a.start - GUARD, sPref + 0.04), sPref, { ...opt, side: 'start' }), a.start - GUARD));
    let se = Math.min(duration, Math.max(pick(Math.max(z.end + GUARD, ePref - 0.04), Math.min(hi, ePref + 0.04), ePref, { ...opt, side: 'end' }), z.end + GUARD));
    // a removed word glued to the kept one ("large, uh," with ASR "large" 6.42-6.86 s ending where "uh" starts):
    // the pause between them can sit inside the kept word's ASR span, so the end may move back into that word's
    // last 0.3 s: the latest frame cut-guard's own test (no voiced window of any word within 30 ms, not hot)
    // passes (tried before reaching forward into the removed audio, which would keep part of it)
    let backed = false;
    if (win && q && why[q.i] && !deepAt(se, 'end')) {
      const lo2 = Math.max(z.start + 0.1, z.end - 0.3);
      for (let f = Math.floor((z.end + GUARD) * fps); f / fps >= lo2; f--) {
        const t = r3(f / fps);
        if (!checkCuts([{ sourceStart: 0, sourceEnd: t }], words, { win, sourceEnd: duration }).rows.some((r) => r.fail)) { se = t; backed = true; break; }
      }
    }

    // next to REMOVED words (no pause: "really a, a, a gigantic") the edit point may sit anywhere in the removed
    // audio: the deep-quiet frame nearest the kept word, up to the next / previous KEPT word
    if (win && q && why[q.i] && !deepAt(se, 'end') && !backed) {
      // a review removal (a whole word the editor took out: "30," in "Proverbs 30, 29", a cut sentence) is never
      // played back: the edit point stays before that word's own span (talk_01 v2 kept "30," and "While")
      const nk = kept.find((w) => w.i > z.i), lim = why[q.i] === 'review' ? Math.max(z.end + GUARD, q.start) : nk ? nk.start - 2 * GUARD : duration;
      let e2 = pick(z.end + GUARD, lim, z.end + GUARD, { ...opt, side: 'end' });
      // a review removal in a loud room (no deep frame): the first frame cut-guard's own rule passes wins
      if (why[q.i] === 'review' && !deepAt(e2, 'end')) for (let f = Math.ceil((z.end + GUARD) * fps - 1e-6); f / fps <= lim + 1e-9; f++) if (guardOk('end', r3(f / fps))) { e2 = r3(f / fps); break; }
      if (deepAt(e2, 'end') || levelAt(e2, 'end') < levelAt(se, 'end') || (why[q.i] === 'review' && guardOk('end', e2) && !guardOk('end', se))) se = e2;
    }
    if (win && p && why[p.i] && !deepAt(ss, 'start')) {
      const pk = [...kept].reverse().find((w) => w.i < a.i), lim = why[p.i] === 'review' ? Math.min(a.start - GUARD, p.end) : pk ? pk.end + 2 * GUARD : 0;
      let s2 = pick(lim, a.start - GUARD, a.start - GUARD, { ...opt, side: 'start' });
      if (why[p.i] === 'review' && !deepAt(s2, 'start')) for (let f = Math.floor((a.start - GUARD) * fps + 1e-6); f / fps >= lim - 1e-9; f--) if (guardOk('start', r3(f / fps))) { s2 = r3(f / fps); break; }
      if (deepAt(s2, 'start') || levelAt(s2, 'start') < levelAt(ss, 'start') || (why[p.i] === 'review' && guardOk('start', s2) && !guardOk('start', ss))) ss = s2;
    }


    // head / tail from the audio too: ASR edge words often end early ("nation." 3.85 s, voice to 4.02 s), so the pad
    // is measured from the last / first voiced 10 ms window (above the deep level) within 1 s of the word
    let ss2 = ss, se2 = se;
    if (win && n === 0) { let i = Math.floor(a.start / WIN); const stop = Math.max(0, i - 100); while (i > stop && win[i - 1] >= opt.deep) i--; ss2 = Math.max(0, Math.min(ss, Math.floor((i * WIN - HEAD) * fps) / fps)); }
    if (win && n === segs.length - 1) { let i = Math.ceil(z.end / WIN); const stop = Math.min(win.length, i + 100); while (i < stop && win[i] >= opt.deep) i++; se2 = Math.min(duration, Math.max(se, Math.ceil((i * WIN + TAIL) * fps) / fps)); }
    return { sourceStart: r3(ss2), sourceEnd: r3(se2), words: s };
  }).flatMap((k) => {
    // dead air (media): a quiet run inside a keep is cut down to ~gapKeep, each edit point at the quietest frame
    // 0.06-0.14 s inside the run (ASR spans often absorb the pause, so the run, not the word times, decides)
    const out = [];
    let cur = k;
    for (const [qa, qb] of quiet) {
      if (qa < cur.sourceStart + 0.05 || qb > cur.sourceEnd - 0.05) continue;
      const e = pick(qa + 0.04, (qa + qb) / 2, qa + gapKeep / 2, { ...opt, side: 'end' });
      const st = pick((qa + qb) / 2, qb - 0.04, qb - gapKeep / 2, { ...opt, side: 'start' });
      if (st - e < 0.05) continue;
      out.push({ ...cur, sourceEnd: r3(e), words: cur.words.filter((w) => w.start < e) });
      cur = { sourceStart: r3(st), sourceEnd: cur.sourceEnd, words: cur.words.filter((w) => w.start >= e), split: true };
    }
    return [...out, cur];
  });
  // sub-frame audio edges: video edges stay on the frame grid (videoStart / videoEnd), but an audio edge cut-guard
  // calls voiced may slip by up to SLIP_MAX (20 ms; lip sync is detectable from ~45 ms audio lead, ITU-R BT.1359) into the quiet ("uh, importance": the 10 ms of quiet sit between two
  // frames). Edges slip independently; the running A/V offset (audio timeline - video timeline) stays within
  // SLIP_MAX, under lip-sync perception, and build.mjs pads / trims the mix to the video length at the end.
  if (win) {
    const ok = (side, t) => !checkCuts([side === 'start' ? { sourceStart: t, sourceEnd: duration } : { sourceStart: 0, sourceEnd: t }], words, { win, sourceEnd: duration }).rows.some((r) => r.fail);
    let D = 0;
    keeps = keeps.map((k) => {
      const vs = r3(Math.round(k.sourceStart * fps) / fps), ve = r3(Math.round(k.sourceEnd * fps) / fps);
      const dS = [0, ...SLIPS].filter((d) => Math.abs(D - d) <= SLIP_MAX + 1e-9).sort((a, b) => Math.abs(D - a) - Math.abs(D - b)).find((d) => ok('start', r3(Math.max(0, vs + d)))) ?? 0;
      const dE = [0, ...SLIPS].filter((d) => Math.abs(D + d - dS) <= SLIP_MAX + 1e-9).sort((a, b) => Math.abs(D + a - dS) - Math.abs(D + b - dS)).find((d) => ok('end', r3(Math.min(duration, ve + d)))) ?? 0;
      D = r3(D + dE - dS);
      return { ...k, videoStart: vs, videoEnd: ve, sourceStart: r3(Math.max(0, vs + dS)), sourceEnd: r3(Math.min(duration, ve + dE)) };
    });
  }
  // self-check with cut-guard's own rule: a dead-air split whose edit point it calls voiced is undone (the pause stays)
  for (let guard = 0; win && guard < 20; guard++) {
    const bad = checkCuts(keeps, words, { win, sourceEnd: duration }).rows.filter((r) => r.fail).map((r) => (r.side === 'start' ? r.keep : r.keep + 1));
    // a filler glued to its neighbours (no quiet frame to cut at: "large, uh, importance") is kept rather than
    // clipping a word; false starts and repeats are never put back (the disfluency gate would fail instead)
    const between = (k) => words.filter((w, m) => why[m] && w.i > keeps[k - 1].words.at(-1).i && w.i < keeps[k].words[0].i);
    const k = bad.find((k) => k > 0 && keeps[k] && (keeps[k].split || (between(k).length && between(k).every((w) => why[w.i] === 'filler'))));
    if (k == null) break;
    const back = keeps[k].split ? [] : between(k);
    for (const w of back) why[w.i] = null;
    keeps.splice(k - 1, 2, { ...keeps[k - 1], sourceEnd: keeps[k].sourceEnd, videoEnd: keeps[k].videoEnd, words: [...keeps[k - 1].words, ...back, ...keeps[k].words] });
  }
  for (let k = 1; k < keeps.length; k++) if (keeps[k].sourceStart < keeps[k - 1].sourceEnd) { // touching takes: one join
    const m = r3(Math.round(((keeps[k - 1].sourceEnd + keeps[k].sourceStart) / 2) * fps) / fps);
    keeps[k - 1].sourceEnd = m; keeps[k].sourceStart = m;
    if (keeps[k].videoStart != null) { keeps[k - 1].videoEnd = m; keeps[k].videoStart = m; }
  }
  let t = 0, ta = 0; // video / audio timeline
  const out = [];
  for (const k of keeps) {
    const vs = k.videoStart ?? k.sourceStart, ve = k.videoEnd ?? k.sourceEnd;
    k.start = r3(t); k.end = r3(t + ve - vs); t = k.end;
    for (const w of k.words.filter((x) => !x.pseudo && !x.blank)) out.push({ text: w.text, start: r3(ta + w.start - k.sourceStart), end: r3(ta + w.end - k.sourceStart), type: 'word', sourceIndex: w.ix });
    ta += k.sourceEnd - k.sourceStart;
  }
  const removed = words.flatMap((w, k) => (why[k] ? [{ index: w.ix ?? null, text: w.text, sourceStart: w.start, sourceEnd: w.end, reason: why[k] }] : []));
  for (let k = 1; k < keeps.length; k++) {
    const a = keeps[k - 1].sourceEnd, b = keeps[k].sourceStart;
    if (b - a > 0.05 && !removed.some((r) => r.sourceStart >= a - 0.05 && r.sourceEnd <= b + 0.05)) removed.push({ sourceStart: a, sourceEnd: b, text: '', reason: `dead-air ${(b - a).toFixed(2)} s` });
  }
  removed.sort((x, y) => x.sourceStart - y.sourceStart);
  return { keeps: keeps.map(({ sourceStart, sourceEnd, start, end, videoStart, videoEnd }) => ({ sourceStart, sourceEnd, start, end, ...(videoStart != null && (videoStart !== sourceStart || videoEnd !== sourceEnd) ? { videoStart, videoEnd } : {}) })), removed, words: out };
}

export function reviewTable(words, res) {
  const gone = new Map(res.removed.filter((r) => r.index != null).map((r) => [r.index, r.reason]));
  return ['| i | word | start | removed |', '|---|---|---|---|', ...words.map((w, i) => `| ${i} | ${w.text} | ${w.start.toFixed(2)} | ${gone.get(i) || ''} |`)].join('\n') + '\n';
}

async function main(argv) {
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !['--source', '--candidates', '--patch', '--fps', '--mode'].includes(argv[i - 1]));
  const mode = opt('--mode', 'clean');
  if (!MODES.includes(mode)) { console.error(`cut.mjs: --mode must be ${MODES.join(' or ')}`); return 2; }
  const src = opt('--source');
  if (pos.length !== 2 || !src) { console.error('usage: cut.mjs <source-transcript.json> <project-dir> --source <media> [--candidates c.json] [--patch p.json] [--fps 30] [--json]'); return 2; }
  const [trf, proj] = pos, A = path.join(proj, 'assets');
  fs.mkdirSync(A, { recursive: true });
  const tr = JSON.parse(fs.readFileSync(trf, 'utf8')), words = tr.words.filter((w) => (w.type ?? 'word') === 'word');
  const cf = opt('--candidates'), pf = opt('--patch');
  const candidates = cf && fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf8')).cuts || [] : [];
  const patch = pf && fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
  const { bandWindows } = await import('../../tools/cut-guard.mjs');
  const win = bandWindows(src);
  const res = cleanCut(words, { win, fps: Number(opt('--fps', 30)), candidates, patch, mode });
  const w2 = words.map((w, i) => ({ ...w, text: patch.text?.[i] ?? w.text }));
  fs.writeFileSync(path.join(A, 'source-transcript.json'), JSON.stringify({ ...tr, words: w2 }, null, 1));
  fs.writeFileSync(path.join(A, 'edit-decisions.json'), JSON.stringify({ tool: 'clean-cut', source: path.relative(proj, path.resolve(src)), fps: Number(opt('--fps', 30)), keeps: res.keeps, removed: res.removed }, null, 1));
  fs.writeFileSync(path.join(A, 'transcript.json'), JSON.stringify({ language_code: tr.language_code, words: res.words }, null, 1));
  fs.writeFileSync(path.join(A, 'cut-review.md'), reviewTable(w2, res));
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  const by = {}; for (const r of res.removed) by[r.reason.split(/[: ]/)[0]] = (by[r.reason.split(/[: ]/)[0]] || 0) + 1;
  console.error(`clean-cut: ${res.keeps.length} keeps, ${res.words.length}/${words.length} words kept, ${res.keeps.at(-1)?.end ?? 0} s; removed ${JSON.stringify(by)}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv.slice(2));

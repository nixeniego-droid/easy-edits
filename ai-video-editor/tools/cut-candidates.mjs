// AI Video Editor stutter / restart cut candidates from the SOURCE, written before the edit agent starts.
//   node ai-video-editor/tools/cut-candidates.mjs <source.mp4> <out-dir> [--json] [--no-cache] [--all-windows]
// Writes <out-dir>/source.cut-candidates.json and .md; source-prep.mjs runs it and copies them to the project assets/.
// Cached by source sha1 in ~/.cache/ai-video-editor/cut-candidates/<sha1>.json ($AI_VIDEO_EDITOR_CUTCAND_CACHE): a hit takes ~0 s.
// Speed: one whole-file decode (word timestamps + the disfluent prompt) only finds suspects (any repeat it hears);
// the 4 s windows are then decoded only around them (every grid window covering a suspect), not over the whole file.
// --all-windows decodes every window (the slow, exhaustive pass: ~800 s on a 30 s source).
// Heard by faster-whisper medium with the --disfluent prompt (check/asr_excerpts.py) over 4 s windows every 1 s:
// the plain transcript drops repeats ("really a very large importance"), and 6 s windows or a whole-file decode
// with the prompt collapse on test-media/talk_30s.mp4 (0-6 s heard as "I, I, I"); 4 s windows hear "really a, a,
// a gigantic, a very large". Per window, words in the 0.5 s lead pad (start < a - 0.3) and in the last 0.15 s
// (end-of-window loops: "a, a, a, ..." x30 stacked at b - 0.02) are dropped, and runs of 4+ equal tokens are
// cut to their first 3 (prompt loops). Kinds:
//   token        an immediately repeated word ("a a", "I I")
//   phrase       a 2-3 word phrase said twice in a row ("a very large, a very large")
//   false-start  1-3 words then a comma / dash, then a restart on the same first word that goes on differently
//                ("a gigantic, a very large")
//   filler       (whole-file decode) uh / um / er / ah / erm / hmm: cut from its start to the next word's start
//   restart      (whole-file decode) the article "a" then a word starting with "a" ("a another": the speaker
//                restarted on "another"; "a" before a vowel word is never grammatical): cut the "a"
// Filler / restart come from the one whole-file disfluent decode (fillers are dropped by the plain transcript and
// by Scribe: gen-th-style2b's source-transcript.json has no "uh", the whole-file decode hears "large, uh,
// importance" at 6.86 s); they also apply to a cached result (computed from its `whole` words).
// A window candidate counts when >= 2 windows hear it within 0.6 s (the prompt also makes Whisper invent repeats).
// Each candidate: cut = [start of the first instance, start of the later instance) in source s, so the later,
// complete instance is kept; overlapping / touching cuts (gap < 0.3 s) merge into one cut. The times are word
// starts from the decode (20-80 ms off): snap them to the silence between words before cutting.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { excerptAsr, norm } from '../check/final-asr.mjs';
import { bandWindows } from './cut-guard.mjs';
import { windows as fillerGrid, checkFillers, FILLER_WORDS, NEAR as FNEAR } from '../check/disfluency.mjs';

export const WIN = 4, STEP = 1, NEAR = 0.6, AGREE = 2, MERGE = 0.3;
const r2 = (v) => Math.round(v * 100) / 100;

export const windows = (dur) => { const s = []; for (let a = 0; a < dur - 0.5; a += STEP) s.push([a, r2(Math.min(dur, a + WIN))]); return s; };

/** one window's words -> tokens [{t, s, e, brk}] with pad / tail words and loops dropped. */
export function tokens(words, [a, b]) {
  const out = [];
  for (const w of words) {
    if (w.start < a - 0.3 || w.start >= b - 0.15) continue;
    const ts = norm(w.text);
    ts.forEach((t, i) => out.push({ t, s: w.start, e: w.end, brk: i === ts.length - 1 && /[,\-–—]\s*$/.test(w.text) }));
  }
  return out.filter((x, i) => !(i >= 3 && out.slice(i - 3, i).every((y) => y.t === x.t)));
}

/** tokens -> repeats [{kind, text, removed, cutStart, cutEnd}] (cutEnd = start of the kept instance). */
export function repeatsIn(tk) {
  const out = [];
  for (let i = 0; i + 1 < tk.length; i++) {
    if (tk[i].t === tk[i + 1].t) { out.push({ kind: 'token', text: `${tk[i].t} ${tk[i].t}`, removed: tk[i].t, cutStart: tk[i].s, cutEnd: tk[i + 1].s }); continue; }
    let hit = false;
    for (const n of [3, 2]) {
      if (i + 2 * n > tk.length) continue;
      const a = tk.slice(i, i + n).map((x) => x.t).join(' '), b = tk.slice(i + n, i + 2 * n).map((x) => x.t).join(' ');
      if (a === b) { out.push({ kind: 'phrase', text: `${a}, ${b}`, removed: a, cutStart: tk[i].s, cutEnd: tk[i + n].s }); hit = true; break; }
    }
    if (hit) continue;
    for (const n of [2, 3]) {
      const j = i + n;
      if (j + 1 >= tk.length || !tk[j - 1].brk || tk[j].t !== tk[i].t || tk[j + 1].t === tk[i + 1].t) continue;
      const frag = tk.slice(i, j).map((x) => x.t).join(' ');
      out.push({ kind: 'false-start', text: `${frag}, ${tk.slice(j, j + n).map((x) => x.t).join(' ')}`, removed: frag, cutStart: tk[i].s, cutEnd: tk[j].s });
      break;
    }
  }
  return out.filter((r) => r.cutEnd > r.cutStart);
}

/** spans + per-window words -> {candidates, cuts, unconfirmed} */
export function cutCandidates(spans, winWords) {
  const all = winWords.flatMap((ws, w) => repeatsIn(tokens(ws, spans[w])).map((r) => ({ ...r, w })));
  const groups = [];
  for (const r of all.sort((x, y) => x.cutStart - y.cutStart)) {
    const g = groups.find((g) => g.text === r.text && Math.abs(g.cutStart - r.cutStart) <= NEAR);
    if (g) { g.wins.add(r.w); g.all.push(r); } else groups.push({ ...r, wins: new Set([r.w]), all: [r] });
  }
  const med = (v) => { const s = [...v].sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };
  const out = groups.map((g) => ({ kind: g.kind, text: g.text, removed: g.removed, cutStart: r2(med(g.all.map((r) => r.cutStart))), cutEnd: r2(med(g.all.map((r) => r.cutEnd))), windows: g.wins.size }));
  const candidates = out.filter((c) => c.windows >= AGREE && c.cutEnd > c.cutStart);
  const cuts = [];
  for (const c of [...candidates].sort((x, y) => x.cutStart - y.cutStart)) {
    const last = cuts.at(-1);
    if (last && c.cutStart <= last.end + MERGE) { last.end = Math.max(last.end, c.cutEnd); last.because.push(c.text); }
    else cuts.push({ start: c.cutStart, end: c.cutEnd, because: [c.text] });
  }
  return { candidates, cuts, unconfirmed: out.filter((c) => c.windows < AGREE) };
}

export const FILLERS = new Set(['uh', 'um', 'er', 'erm', 'ah', 'hmm', 'uhm', 'mm']);
/** whole-file words -> filler / restart candidates [{kind, text, removed, cutStart, cutEnd, windows: 'whole'}]. */
export function wholeExtras(whole) {
  const w = (whole || []).map((x) => ({ ...x, t: norm(x.text)[0] })).filter((x) => x.t), out = [];
  for (let i = 0; i < w.length; i++) {
    const next = w[i + 1];
    // the first non-filler word after a filler has no duration (talk_30s: "importance" 8.10-8.10, its audio decoded as
    // a second "uh," 7.40-7.64): the decode's timing is broken there, so a cut "to the next word's start" would take
    // that word's audio. No whole-file filler cut then; the filler grid's window-confirmed cuts still apply.
    let j = i + 1; while (j < w.length && FILLERS.has(w[j].t)) j++;
    if (FILLERS.has(w[i].t) && w[j] && w[j].end - w[j].start < 0.05) continue;
    if (FILLERS.has(w[i].t)) out.push({ kind: 'filler', text: w[i].text.trim(), removed: w[i].t, cutStart: r2(w[i].start), cutEnd: r2(next ? next.start : w[i].end), windows: 'whole' });
    else if (w[i].t === 'a' && next && next.t.length > 1 && next.t.startsWith('a') && next.start - w[i].end < 0.6)
      out.push({ kind: 'restart', text: `${w[i].text.trim()} ${next.text.trim()}`, removed: 'a', cutStart: r2(w[i].start), cutEnd: r2(next.start), windows: 'whole' });
  }
  return out.filter((c) => c.cutEnd > c.cutStart);
}
/** add the whole-file filler / restart candidates to a result and re-merge its cuts. */
export function withExtras(r) {
  const extra = wholeExtras(r.whole).filter((e) => !(r.candidates || []).some((c) => Math.abs(c.cutStart - e.cutStart) < 0.05 && c.kind === e.kind));
  if (!extra.length) return r;
  const candidates = [...(r.candidates || []), ...extra].sort((x, y) => x.cutStart - y.cutStart), cuts = [];
  for (const c of candidates) {
    const last = cuts.at(-1);
    if (last && c.cutStart <= last.end + MERGE) { last.end = Math.max(last.end, c.cutEnd); last.because.push(c.text); }
    else cuts.push({ start: c.cutStart, end: c.cutEnd, because: [c.text] });
  }
  // the filler grid's window-confirmed cuts survive the re-merge (they are not candidates)
  for (const f of r.fillers || []) if (!cuts.some((c) => c.start <= f.start + 0.05 && c.end >= f.end - 0.05)) cuts.push(f);
  cuts.sort((x, y) => x.start - y.start);
  return { ...r, candidates, cuts };
}

export function markdown(r, src) {
  const L = [`# Stutter / restart cut candidates: ${src}`, '',
    'Heard on the source by the --disfluent ASR (ai-video-editor/tools/cut-candidates.mjs). Cut each one: remove the earlier,',
    'broken instance and keep the later, complete one; cut every filler (uh / um) and restart ("a another"). Times are source seconds (word starts, 20-80 ms off):',
    'snap each boundary to the silence between words.', '', '## Cuts (merged)', ''];
  if (!r.cuts.length) L.push('- none');
  for (const c of r.cuts) L.push(`- cut ${c.start.toFixed(2)}-${c.end.toFixed(2)} s (keep from ${c.end.toFixed(2)} s): ${c.because.map((b) => `"${b}"`).join(', ')}`);
  L.push('', '## Candidates', '', '| kind | heard | removed | cut (s) | windows |', '| --- | --- | --- | --- | --- |');
  for (const c of r.candidates) L.push(`| ${c.kind} | ${c.text} | ${c.removed} | ${c.cutStart.toFixed(2)}-${c.cutEnd.toFixed(2)} | ${c.windows} |`);
  return L.join('\n') + '\n';
}

export const cacheDir = () => process.env.AI_VIDEO_EDITOR_CUTCAND_CACHE || path.join(os.homedir(), '.cache/ai-video-editor/cut-candidates');
export const sha1File = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
// v2: merged-word suspects (windows around a short word with a long span) changed what a run decodes
// v9: whole+windows decode uses --exact --vad (float32, temp 0, Silero VAD)
// v3: the whole decode is chunked (chunkSpans / stitchChunks)
export const cachePath = (src) => path.join(cacheDir(), `${sha1File(src)}.v9.json`);

/** whole-file words whose short token (<= 3 letters, not a filler) spans > MERGED s AND holds two voiced islands
 * split by >= 0.1 s of deep quiet (speech-band 10 ms windows, cut-guard's quiet level): a repeat the whole decode
 * merged into one word ("only a, a greater" -> "a" 30.04-30.76 s on talk_30s). The windows around it decide.
 * Without band windows (win = null) no merged suspects (an absorbed pause alone is not a repeat). */
export const MERGED = 0.5;
export function mergedSuspects(wholeWords, dur, win = null) {
  if (!win?.length) return [];
  const all = 10 * Math.log10(win.reduce((t, d) => t + 10 ** (d / 10), 0) / win.length);
  const act = win.filter((d) => d > all - 20).sort((a, b) => a - b), srt = [...win].sort((a, b) => a - b);
  const deep = Math.max(act[act.length >> 1] - 25, srt[Math.floor(srt.length * 0.1)] + 6), loud = deep + 15;
  const islands = (a, b) => { // voiced, quiet >= 0.1 s, voiced inside [a, b]
    const seg = win.slice(Math.floor(a * 100), Math.ceil(b * 100));
    let seenLoud = false, q = 0, gap = false;
    for (const d of seg) { if (d >= loud) { if (gap) return true; seenLoud = true; q = 0; } else if (d < deep && seenLoud) { if (++q >= 10) gap = true; } else q = 0; }
    return false;
  };
  return (wholeWords || []).flatMap((w) => { const t = norm(w.text); return t.length === 1 && t[0].length <= 3 && !FILLERS.has(t[0]) && w.end - w.start > MERGED && w.end < dur - 0.3 && islands(w.start, w.end) ? [{ kind: 'merged', text: `${t[0]} ?`, removed: t[0], cutStart: w.start, cutEnd: w.end }] : []; });
}

/** whole-file words -> the grid windows (same grid as windows()) that cover each suspected repeat. */
export function suspectWindows(wholeWords, dur, win = null) {
  const sus = [...repeatsIn(tokens(wholeWords, [0, dur])), ...mergedSuspects(wholeWords, dur, win)];
  const grid = windows(dur), pick = new Set();
  for (const r of sus) grid.forEach(([a, b], i) => { if (a <= r.cutStart - 0.2 && b - 0.15 > r.cutEnd + 0.3) pick.add(i); });
  return { suspects: sus, spans: [...pick].sort((x, y) => x - y).map((i) => grid[i]) };
}

/** The "whole-file" disfluent decode is done in CHUNK s pieces with PAD s of context each side, stitched by word
 * start (each word from the chunk whose core holds its start). One 35 s decode with the disfluent prompt can
 * collapse into a prompt echo: talk_30s run #4 got "We were, uh, uh, uh ..." for 0-15 s and lost 27 words (thread
 * count alone changed the outcome); short pieces do not. */
export const CHUNK = 10, PAD = 1;
export function chunkSpans(dur) {
  const out = [];
  for (let a = 0; a < dur - 0.05; a += CHUNK) out.push({ span: [r2(Math.max(0, a - PAD)), r2(Math.min(dur, a + CHUNK + PAD))], core: [a, Math.min(dur, a + CHUNK)] });
  return out;
}
export function stitchChunks(chunks, words) {
  return chunks.flatMap((c, k) => (words[k] || []).filter((w) => (k === 0 || w.start >= c.core[0]) && (k === chunks.length - 1 || w.start < c.core[1])));
}

/** Second chunk grid shifted by half a chunk: the disfluent decode of the same audio flips between verbatim
 * ("really a, a, a gigantic, a very large, a very large, uh, uh, importance") and clean ("really a very large
 * importance") on tiny numeric differences (thread count, other load: talk_30s runs #8 and #9), so each 5 s cell
 * takes the grid whose decode holds more words there (the verbatim one; a clean decode only ever drops words). */
export function chunkSpansShifted(dur) {
  const out = [], h = CHUNK / 2;
  for (let a = -h; a < dur - 0.05; a += CHUNK) out.push({ span: [r2(Math.max(0, a - PAD)), r2(Math.min(dur, a + CHUNK + PAD))], core: [Math.max(0, a), Math.min(dur, a + CHUNK)] });
  return out;
}
export function pickDenser(a, b, dur, cell = CHUNK / 2) {
  const out = [], key = (w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  for (let t = 0; t < dur - 0.001; t += cell) {
    const inA = a.filter((w) => w.start >= t && w.start < t + cell), inB = b.filter((w) => w.start >= t && w.start < t + cell);
    const pick = inB.length > inA.length ? inB : inA, prev = out.at(-1);
    // a word at the cell edge can come from both grids (starts a few ms apart): keep one
    out.push(...(prev && pick[0] && key(pick[0]) === key(prev) && Math.abs(pick[0].start - prev.start) < 0.3 ? pick.slice(1) : pick));
  }
  return out;
}

/** Voiced stretches (10 ms band windows within 25 dB of the speech level and 6 dB over the noise floor, the
 * cut-guard "deep" rule) that no word covers (word span +-0.3 s), merged over gaps < 0.5 s; only stretches with
 * >= 0.8 s of voiced windows. A chunk decode can return almost nothing for voiced audio (talk_30s run #6: the
 * 0-11 s chunk gave one word, "MICHAEL", and the dead-air rule then cut 9 s of real speech), so these get a
 * second decode. */
export function uncovered(words, win, { minVoiced = 0.8, gap = 0.5, reach = 0.3 } = {}) {
  if (!win || !win.length) return [];
  const lin = win.map((d) => 10 ** (d / 10)), all = 10 * Math.log10(lin.reduce((a, b) => a + b, 0) / lin.length);
  const act = win.filter((d) => d > all - 20).sort((a, b) => a - b), speech = act[act.length >> 1];
  const noise = [...win].sort((a, b) => a - b)[Math.floor(win.length * 0.1)], deep = Math.max(speech - 25, noise + 6);
  const covered = (t) => words.some((w) => t >= w.start - reach && t <= w.end + reach);
  const runs = [];
  win.forEach((d, i) => {
    const t = i * 0.01;
    if (d <= deep || covered(t)) return;
    const last = runs.at(-1);
    if (last && t - last.b < gap) { last.b = t + 0.01; last.n++; } else runs.push({ a: t, b: t + 0.01, n: 1 });
  });
  return runs.filter((r) => r.n * 0.01 >= minVoiced).map((r) => [r2(r.a), r2(r.b)]);
}

/** Decode spans for uncovered stretches: 1 s of context each side, overlapping spans merged (two spans sharing
 * audio decode the same words twice). */
export function gapSpans(gaps, dur) {
  const out = [];
  for (const [a, b] of gaps) {
    const s = [r2(Math.max(0, a - 1)), r2(Math.min(dur, b + 1))], last = out.at(-1);
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else out.push(s);
  }
  return out;
}

/** Merge a re-decode of gapSpans: words inside their span that do not overlap a word already there are added
 * (start clamped to 0: a word heard in asr_excerpts' lead pad can come back slightly negative). */
export function fillUncovered(whole, spans, words) {
  const out = [...whole];
  spans.forEach(([a, b], k) => (words[k] || []).forEach((w0) => {
    const w = { ...w0, start: Math.max(0, w0.start) };
    if (w.start >= a && w.start < b && w.end > w.start && !out.some((x) => w.start < x.end - 0.02 && w.end > x.start + 0.02)) out.push(w);
  }));
  return out.sort((x, y) => x.start - y.start);
}

/** filler-grid window words -> filler cuts [{start, end, because: [filler], from: 'filler-windows'}]: each filler heard
 * by >= 2 windows (disfluency checkFillers), timed by the median start / end of the agreeing windows' words. */
export function fillerCuts(winWords) {
  const med = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
  return checkFillers(winWords).confirmed.map((g) => {
    const hits = winWords.flatMap((ws) => ws.filter((w) => Math.abs(w.start - g.t) <= FNEAR && norm(w.text).some((t) => FILLER_WORDS.has(t))));
    return { start: r2(med(hits.map((w) => w.start))), end: r2(med(hits.map((w) => w.end))), because: [g.text], from: 'filler-windows', windows: g.windows };
  });
}

/** compute (or read from the cache) the candidates JSON for a source. */
export function run(src, { cache = true, allWindows = false } = {}) {
  const cp = cachePath(src);
  if (cache && fs.existsSync(cp)) return withExtras({ ...JSON.parse(fs.readFileSync(cp, 'utf8')), cache: 'hit' });
  const dur = +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' }).stdout.trim();
  const t0 = Date.now();
  let whole = null, suspects = null, spans, gaps = [];
  if (allWindows) spans = windows(dur);
  else {
    const ch = chunkSpans(dur), win = bandWindows(src);
    const ch2 = chunkSpansShifted(dur), dec = excerptAsr(src, [...ch, ...ch2].map((c) => c.span), { disfluent: true });
    whole = pickDenser(stitchChunks(ch, dec.slice(0, ch.length)), stitchChunks(ch2, dec.slice(ch.length)), dur);
    gaps = uncovered(whole, win);
    // re-decode with the prompt first (a different span usually decodes), then without it for what is still bare
    for (const disfluent of [true, false]) {
      const g = uncovered(whole, win);
      if (!g.length) break;
      const n = whole.length;
      const sp = gapSpans(g, dur);
      whole = fillUncovered(whole, sp, excerptAsr(src, sp, { disfluent }));
      console.error(`cut-candidates: ${g.length} uncovered voiced stretch(es) ${g.map(([a, b]) => `${a}-${b}`).join(', ')} s re-decoded${disfluent ? '' : ' without the prompt'}: +${whole.length - n} word(s)`);
    }
    ({ suspects, spans } = suspectWindows(whole, dur, win));
  }
  // fillers: the disfluency gate's grid (6 s windows every 2 s, disfluent prompt) on the SOURCE, decoded in the same
  // model load as the suspect windows; a filler heard by >= 2 windows becomes a cut (because: the filler). The
  // whole-file decode can drop an "uh" that the final then still says (talk_30s run #10: "uh" 6.86 s kept, disfl FAIL).
  const fgrid = allWindows ? [] : fillerGrid(dur), all = excerptAsr(src, [...spans, ...fgrid], { disfluent: true });
  const words = all.slice(0, spans.length), r = cutCandidates(spans, words);
  const fillers = fillerCuts(all.slice(spans.length));
  for (const f of fillers) if (!r.cuts.some((c) => c.start <= f.start + 0.05 && c.end >= f.end - 0.05)) r.cuts.push(f);
  r.cuts.sort((a, b) => a.start - b.start);
  const json = { tool: 'ai-video-editor/tools/cut-candidates.mjs', source: src, mode: allWindows ? 'all-windows' : 'suspects', windows: spans.length, ...r,
    seconds: r2((Date.now() - t0) / 1000), suspects, spans, words, whole, uncovered: gaps, fillers };
  fs.mkdirSync(path.dirname(cp), { recursive: true });
  fs.writeFileSync(cp, JSON.stringify(json, null, 1));
  return withExtras({ ...json, cache: 'miss' });
}

function main(argv) {
  const [src, outDir] = argv.filter((a) => !a.startsWith('--'));
  if (!src || !outDir || !fs.existsSync(src)) { console.error('usage: cut-candidates.mjs <source.mp4> <out-dir> [--json] [--no-cache] [--all-windows]'); return 2; }
  const t0 = Date.now(), json = run(src, { cache: !argv.includes('--no-cache'), allWindows: argv.includes('--all-windows') });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'source.cut-candidates.json'), JSON.stringify(json, null, 1));
  fs.writeFileSync(path.join(outDir, 'source.cut-candidates.md'), markdown(json, src));
  if (argv.includes('--json')) console.log(JSON.stringify(json, null, 1));
  for (const c of json.cuts) console.log(`  CUT ${c.start.toFixed(2)}-${c.end.toFixed(2)} s ${c.because.join(' | ')}`);
  console.log(`cut-candidates: ${json.candidates.length} candidate(s), ${json.cuts.length} cut(s), cache ${json.cache}, ${r2((Date.now() - t0) / 1000)} s (decode ${json.seconds} s, ${json.windows} window(s)) -> ${path.join(outDir, 'source.cut-candidates.json')}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));

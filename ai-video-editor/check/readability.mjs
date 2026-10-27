// AI Video Editor readability check: every caption group and kinetic word group stays settled on screen long enough to
// read, and a kinetic run shows a contiguous phrase.
//   node ai-video-editor/check/readability.mjs <project-dir> [--min 0.3] [--groups] [--json]
// From tools/dom-sample.mjs runs (headless DOM sample, cached): `settled` = seconds at opacity >= 0.9 and scale
// within 8% of 1. FAIL when a `cap` or `kinetic` run is settled < --min (0.3 s). Kinetic runs that overlap in
// time form one phrase (a stack); its words, in on-screen order, must match consecutive words of the transcript
// (assets/transcript.json, fillers uh/um/erm ignored) near that time: FAIL (skip) when transcript words are
// missing between the first and last kinetic word. Phrases not found in the transcript are left to
// tools/verbatim-guard.mjs. Exit 1 on FAIL, 2 on usage.
// --groups (embedded brief, look-bright captions.words [2,3]): from index.html, every VISIBLE caption group
// (`.cap` clips without inline opacity:0) holds 2-3 words. FAIL when any group has > 3 words, or when > 20% of the
// groups are a single word not excused: a lone word is allowed only as the key-word hit (the word is a kinetic
// `.key` word) or as the lone remaining word of a sentence (it ends in . ? ! and the group before it has 3 words).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectSamples, runs } from '../tools/dom-sample.mjs';

export const MIN_SETTLED = 0.3;
const FILLER = new Set(['uh', 'um', 'umm', 'erm', 'hmm', 'ah']);
const toks = (s) => (s.toLowerCase().replace(/['’]/g, '').match(/[\p{L}\p{N}]+/gu) || []);

/** runs -> kinetic phrases [{start, end, runs}] (time-overlapping kinetic runs). */
export function kineticPhrases(rs) {
  const out = [];
  for (const r of rs.filter((r) => r.kind === 'kinetic').sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && r.start < last.end - 1e-6) { last.runs.push(r); last.end = Math.max(last.end, r.end); } else out.push({ start: r.start, end: r.end, runs: [r] });
  }
  return out;
}

/** phrase tokens vs transcript words [{text, start}] near [a, b] -> {found, skipped: [word]} (tightest in-order match). */
export function phraseSkips(tokens, words, a, b) {
  const near = words.filter((w) => w.start >= a - 2 && w.start <= b + 1).flatMap((w) => toks(w.text).map((t) => ({ t, w })))
    .filter((x) => !FILLER.has(x.t));
  let best = null;
  for (let i = 0; i < near.length; i++) {
    if (near[i].t !== tokens[0]) continue;
    let j = i, k = 1;
    for (; k < tokens.length && j < near.length - 1;) { j++; if (near[j].t === tokens[k]) k++; }
    if (k === tokens.length && (!best || j - i < best[1] - best[0])) best = [i, j];
  }
  if (!best) return { found: false, skipped: [] };
  const span = near.slice(best[0], best[1] + 1), skipped = [];
  let k = 0;
  for (const x of span) { if (x.t === tokens[k]) k++; else skipped.push(x.t); }
  return { found: true, skipped };
}

/** -> {short: [run], skips: [{text, start, skipped}], phrases} */
export function checkReadability(rs, words, { min = MIN_SETTLED } = {}) {
  const short = rs.filter((r) => (r.kind === 'cap' || r.kind === 'kinetic') && r.settled < min - 1e-6);
  const phrases = kineticPhrases(rs), skips = [];
  for (const p of phrases) {
    const order = [...p.runs].sort((x, y) => (x.box?.y0 ?? 0) - (y.box?.y0 ?? 0) || x.start - y.start);
    const text = order.map((r) => r.text).join(' '), tk = toks(text);
    if (tk.length < 2 || !words?.length) continue;
    const s = phraseSkips(tk, words, p.start, p.end);
    if (s.found && s.skipped.length) skips.push({ text, start: p.start, skipped: s.skipped });
  }
  return { short, skips, phrases };
}

export const GROUP_WORDS = [2, 3], MAX_SINGLE = 0.2;

/** index.html -> {groups: [{start, text, n, hidden}], keys: Set} (static parse of `.cap` clips and kinetic `.key`). */
export function captionGroupsFromHtml(html) {
  const groups = [], keys = new Set();
  for (const m of html.matchAll(/<div[^>]*class="cap clip"[^>]*>([\s\S]*?)<\/div>/g)) {
    const tag = m[0].slice(0, m[0].indexOf('>') + 1), text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    groups.push({ start: +(tag.match(/data-start="([^"]+)"/)?.[1] ?? NaN), text, n: toks(text).length, hidden: /opacity:\s*0(?![.\d])/.test(tag) });
  }
  for (const m of html.matchAll(/<span[^>]*class="[^"]*\bkey\b[^"]*"[^>]*>([^<]*)</g)) toks(m[1]).forEach((t) => keys.add(t));
  return { groups, keys };
}

/** -> {visible, singles, excused, long, frac, ok} */
export function checkCaptionGroups({ groups, keys }, { max = GROUP_WORDS[1], maxSingle = MAX_SINGLE } = {}) {
  const visible = groups.filter((g) => !g.hidden), singles = [], excused = [];
  visible.forEach((g, i) => {
    if (g.n !== 1) return;
    const key = keys.has(toks(g.text)[0]), lone = /[.?!]$/.test(g.text) && visible[i - 1]?.n >= max;
    (key || lone ? excused : singles).push({ ...g, why: key ? 'key word' : lone ? 'lone remaining word' : '' });
  });
  const long = visible.filter((g) => g.n > max), frac = visible.length ? singles.length / visible.length : 0;
  return { visible, singles, excused, long, frac, ok: !long.length && frac <= maxSingle + 1e-9 };
}

async function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i] === '--groups' ? (o.groups = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 1) { console.error('usage: readability.mjs <project-dir> [--min 0.3] [--groups] [--json]'); return 2; }
  const proj = pos[0], tf = ['assets/transcript.json', 'assets/source-transcript.json'].map((f) => path.join(proj, f)).find((f) => fs.existsSync(f));
  const tr = tf ? JSON.parse(fs.readFileSync(tf, 'utf8')) : null, words = (tr?.words || []).filter((w) => w.type !== 'spacing').map((w) => ({ text: w.text, start: +w.start }));
  const r = checkReadability(runs(await projectSamples(proj)), words, { min: +(o.min || MIN_SETTLED) });
  if (o.json) console.log(JSON.stringify({ short: r.short, skips: r.skips }, null, 1));
  for (const s of r.short) console.log(`  TOO SHORT ${String(s.start).padStart(6)} s ${s.kind} "${s.text}" settled ${s.settled.toFixed(2)} s`);
  for (const s of r.skips) console.log(`  SKIPS     ${String(s.start).padStart(6)} s kinetic "${s.text}" leaves out: ${s.skipped.join(' ')}`);
  let n = r.short.length + r.skips.length;
  if (o.groups) {
    const g = checkCaptionGroups(captionGroupsFromHtml(fs.readFileSync(path.join(proj, 'index.html'), 'utf8')));
    for (const x of g.singles) console.log(`  ONE WORD  ${String(x.start).padStart(6)} s caption "${x.text}"`);
    for (const x of g.long) console.log(`  > 3 WORDS ${String(x.start).padStart(6)} s caption "${x.text}" (${x.n})`);
    console.log(`caption groups: ${g.ok ? 'PASS' : 'FAIL'} ${g.singles.length}/${g.visible.length} visible groups one word (${(g.frac * 100).toFixed(0)}%, max 20%; ${g.excused.length} excused), ${g.long.length} over 3 words`);
    if (!g.ok) n++;
  }
  console.log(`readability: ${n ? 'FAIL' : 'PASS'} ${r.short.length} group(s) settled < ${o.min || MIN_SETTLED} s, ${r.skips.length} kinetic phrase(s) skipping words (${r.phrases.length} phrases)`);
  return n ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv.slice(2));

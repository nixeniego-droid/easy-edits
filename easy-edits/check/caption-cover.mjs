// Easy Edits caption coverage: captions are FULL verbatim. Every transcript word of the kept speech appears in exactly
// one caption chunk, in order; kinetic words are extra and may be keywords, so they never stand in for a caption.
//   node easy-edits/check/caption-cover.mjs <project-dir> [--json]
// Shown chunks: tools/dom-sample.mjs runs of kind cap (outermost caption element, as visible in the composition:
// a chunk hidden with opacity 0 is not shown). Words: assets/transcript.json (the edit's retimed words; type word).
// Alignment: transcript words and caption tokens (verbatim-guard norm) walked in order; a transcript word that the
// next caption tokens do not hold (looking ahead <= 3 tokens, in a chunk on screen within 0.6 s of the word)
// is MISSING; a caption token passed over is EXTRA
// (a duplicate or an invented word). FAIL any missing or extra word. Exit 1 on FAIL, 2 on usage.
// Labels: a spoken word left out of the captions counts as covered (LABEL) when an on-screen label / chip / card with
// that exact word (verbatim-guard norm, case-insensitive) is visible while it is spoken (overlaps the word's start..end).
// Labels come from the DOM sample (non-caption text runs: chips, pills, cards) and from assets/plan.json events or
// scenes that carry `text` plus a time span (time/start + end/duration). Kinetic words still never replace captions.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { norm, shownSpeech, transcriptFile } from '../tools/verbatim-guard.mjs';
import path from 'node:path';
import { projectSamples, runs as domRuns } from '../tools/dom-sample.mjs';

/** on-screen labels [{text, start, end, id}]: DOM non-caption, non-kinetic text runs + plan.json items with text and a span */
export function projectLabels(sample, plan = {}) {
  const el = sample.elements || {};
  const dom = domRuns(sample).filter((r) => el[r.id] && !['cap', 'kinetic'].includes(el[r.id].kind) && String(r.text || '').trim())
    .map((r) => ({ text: r.text, start: +r.start, end: +r.end, id: r.id }));
  const fromPlan = [...(plan.events || []), ...(plan.scenes || [])].filter((e) => e && typeof e.text === 'string' && e.text.trim()).map((e) => {
    const start = +(e.start ?? e.time), end = Number.isFinite(+e.end) ? +e.end : start + +(e.duration ?? NaN);
    return { text: e.text, start, end, id: e.id || e.type || 'plan' };
  }).filter((l) => Number.isFinite(l.start) && Number.isFinite(l.end) && l.end > l.start);
  return [...dom, ...fromPlan];
}

/** caption runs [{text, start, end}] + transcript words [{text, start, end}] -> {missing, extra, covered} */
export function captionCover(caps, words, { look = 3, slack = 0.6, labels = [] } = {}) {
  const L = labels.map((l) => ({ ...l, toks: new Set(norm(l.text)) }));
  const byLabel = (w) => L.find((l) => l.toks.has(w.t) && l.start <= w.end && l.end >= w.start);
  const labelled = [];
  const C = caps.flatMap((r, ri) => norm(r.text).map((t) => ({ t, run: ri })));
  const T = words.flatMap((w) => norm(w.text).map((t) => ({ t, start: +w.start, end: +w.end })));
  const near = (ri, w) => w.start >= caps[ri].start - slack && w.start <= caps[ri].end + slack;
  const missing = [], extra = [];
  let j = 0, covered = 0;
  for (const w of T) {
    let k = -1;
    for (let d = 0; d <= look && j + d < C.length; d++) if (C[j + d].t === w.t && near(C[j + d].run, w)) { k = j + d; break; }
    if (k < 0) { const l = byLabel(w); if (l) { labelled.push({ ...w, label: l.text, id: l.id }); covered++; } else missing.push(w); continue; }
    for (let x = j; x < k; x++) extra.push({ ...C[x], text: caps[C[x].run].text, start: caps[C[x].run].start });
    covered++; j = k + 1;
  }
  for (let x = j; x < C.length; x++) extra.push({ ...C[x], text: caps[C[x].run].text, start: caps[C[x].run].start });
  return { missing, extra, covered, labelled, words: T.length };
}

/** consecutive missing words grouped into spans for printing */
export function gaps(missing, join = 0.6) {
  const out = [];
  for (const w of missing) {
    const g = out.at(-1);
    if (g && w.start - g.end <= join) { g.words.push(w.t); g.end = w.end; } else out.push({ start: w.start, end: w.end, words: [w.t] });
  }
  return out;
}

async function main(argv) {
  const proj = argv.find((a) => !a.startsWith('--')), tr = proj && transcriptFile(proj);
  if (!proj || !tr) { console.error('usage: caption-cover.mjs <project-dir> [--json] (needs index.html + assets/transcript.json)'); return 2; }
  const words = JSON.parse(fs.readFileSync(tr, 'utf8')).words.filter((w) => (w.type || 'word') === 'word');
  const sample = await projectSamples(proj), caps = shownSpeech(sample);
  const pf = path.join(proj, 'assets/plan.json'), plan = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
  const r = captionCover(caps, words, { labels: projectLabels(sample, plan) }), g = gaps(r.missing);
  if (argv.includes('--json')) console.log(JSON.stringify({ ...r, gaps: g }, null, 1));
  const bad = r.missing.length + r.extra.length;
  console.log(`caption-cover: ${bad ? 'FAIL' : 'PASS'} ${r.covered}/${r.words} transcript words covered (${r.covered - r.labelled.length} by caption chunks, ${r.labelled.length} by an on-screen label), ${r.missing.length} missing, ${r.extra.length} extra (${caps.length} chunks)`);
  for (const w of r.labelled) console.log(`  LABEL ${w.start.toFixed(2)} s "${w.t}" shown by on-screen label "${w.label}" (${w.id}) while spoken`);
  for (const s of g) console.log(`  MISSING ${s.start.toFixed(2)}-${s.end.toFixed(2)} s: "${s.words.join(' ')}" (no caption chunk shows it; a kinetic word does not replace the caption)`);
  for (const e of r.extra) console.log(`  EXTRA ${e.start.toFixed(2)} s "${e.text}": "${e.t}" is not the next spoken word`);
  if (bad) console.log('  Captions are full verbatim in 2-3 word chunks covering every spoken word in order; kinetic words ride on top.');
  return bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv.slice(2));

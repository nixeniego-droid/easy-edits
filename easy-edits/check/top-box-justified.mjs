// Easy Edits top-box check (fault-only): the top box (top-square split illustration) is opt-in, never the default.
//   node easy-edits/check/top-box-justified.mjs <project-dir> [--json]
// Top-box beats = plan.json `scenes[]` whose layout is a split / top box (split, footage-split, top-box, topbox,
// top-square) plus DESIGN.md lines (beat-table rows or bullets) that choose one. Each needs a one-line
// justification that names the PROCESS, COMPARISON or SCENE it draws (keywords: process, steps, sequence, how it
// works, comparison, compare, versus, vs, before / after, scene, setting): from the scene's own `topBoxWhy`
// (or `justification` / `why`) field, or a DESIGN.md line that names the top box / split and the scene (its id,
// its start time to 0.1 s, or its anchor's first 3 words). FAIL when a top-box beat has none. No split at all
// passes. Missing DESIGN.md and plan.json FAIL (nothing to check against). Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const TOP_LAYOUT = /^(split|footage-split|top-?box|top-?square|split-top)$/i;
const TOP_WORDS = /\b(top[- ]?box|top[- ]?square|split)\b/i;
export const KIND = /\b(process|steps?|sequence|how it works|comparisons?|compar(e|es|ing)|versus|vs\.?|before\s*\/?\s*(and\s+)?after|scene|setting)\b/i;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9.: ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** a justification names a kind and says something besides it (>= 4 words) */
export const justified = (s) => KIND.test(s || '') && norm(s).split(' ').length >= 4;
const fmtTimes = (t) => { const s = (+t).toFixed(1); const m = Math.floor(t / 60), r = (t - m * 60).toFixed(1).padStart(4, '0'); return [s, `${m}:${r}`, `0:${String(Math.floor(t)).padStart(2, '0')}`]; };

/** plan {scenes}, DESIGN.md text -> {beats: [{id, start, end, why, ok}], bad: [...]} */
export function checkTopBox(plan, design) {
  const lines = String(design || '').split('\n'), beats = [];
  const designTop = lines.filter((l) => TOP_WORDS.test(l) && !/^\s*#/.test(l) && !/not (the )?default|what not to do|never .*(split|top)/i.test(l));
  for (const s of (plan?.scenes || []).filter((x) => TOP_LAYOUT.test(x.layout || ''))) {
    const own = s.topBoxWhy || s.justification || s.why || '';
    const keys = [s.id && new RegExp(`\\b${String(s.id).replace(/[^\w-]/g, '')}\\b`, 'i'), ...fmtTimes(s.start ?? 0), norm(s.anchor).split(' ').slice(0, 3).join(' ')].filter(Boolean);
    const line = designTop.find((l) => keys.some((k) => (k instanceof RegExp ? k.test(l) : k.length > 2 && norm(l).includes(norm(k)))) && justified(l));
    const why = justified(own) ? own : line?.trim() || '';
    beats.push({ id: s.id, start: s.start, end: s.end, src: 'plan', why, ok: !!why });
  }
  // DESIGN.md-only top-box rows (table rows / bullets that choose the top box without a plan scene)
  if (!(plan?.scenes || []).length) for (const l of designTop.filter((l) => /^\s*(\||[-*]\s)/.test(l))) beats.push({ id: null, src: 'design', line: l.trim(), why: justified(l) ? l.trim() : '', ok: justified(l) });
  return { beats, bad: beats.filter((b) => !b.ok) };
}

function main(argv) {
  const json = argv.includes('--json'), proj = argv.find((a) => !a.startsWith('--'));
  if (!proj || !fs.existsSync(proj)) { console.error('usage: top-box-justified.mjs <project-dir> [--json]'); return 2; }
  const pf = path.join(proj, 'assets/plan.json'), df = path.join(proj, 'DESIGN.md');
  if (!fs.existsSync(pf) && !fs.existsSync(df)) { console.log('top-box-justified: FAIL no DESIGN.md or assets/plan.json'); return 1; }
  const plan = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {}, design = fs.existsSync(df) ? fs.readFileSync(df, 'utf8') : '';
  const r = checkTopBox(plan, design);
  if (json) console.log(JSON.stringify(r, null, 1));
  for (const b of r.bad) console.log(`  FAIL TOP BOX ${b.id ? `${b.id} ${(+b.start).toFixed(2)}-${(+b.end).toFixed(2)} s` : `"${b.line}"`}: no one-line justification naming a process, comparison or scene (topBoxWhy in plan.json or a DESIGN.md line)`);
  console.log(`top-box-justified: ${r.bad.length ? 'FAIL' : 'PASS'} ${r.beats.length} top-box beat(s), ${r.beats.length - r.bad.length} justified`);
  return r.bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));

// Easy Edits duplicate kinetic text: each kinetic word shows ONCE.
//   node easy-edits/check/kinetic-dup.mjs <project-dir> [--json]
// From tools/dom-sample.mjs runs: kinetic runs grouped per kinetic block (element ids up to the last `-`, e.g.
// k1-a / k1-b -> k1). FAIL when a content word (function words skipped, lowercased, punctuation dropped) shows in
// two kinetic blocks, or while a caption run with the same word is on screen (the word doubles on screen).
// gen-th-style1: "RELATIONSHIP" in k1 and c, "IMPORTANCE" kinetic over the caption "importance" at ~0:03.
// Exit 1 on FAIL, 2 on usage.
import { pathToFileURL } from 'node:url';
import { projectSamples, runs } from '../tools/dom-sample.mjs';

const FUNCTION = new Set('a an the and or but of in on at to for from by with as is are was be it its our your my we us you i that this'.split(' '));
const words = (t) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w && !FUNCTION.has(w));
const block = (id) => id.replace(/-[^-]*$/, '');

/** runs [{id, text, kind, start, end}] -> {bad: [{word, why, a, b}]} */
export function checkKineticDup(rs) {
  const kin = rs.filter((r) => r.kind === 'kinetic'), caps = rs.filter((r) => r.kind === 'cap'), bad = [], seen = new Map();
  for (const r of [...kin].sort((a, b) => a.start - b.start)) for (const w of words(r.text)) {
    const prev = seen.get(w);
    if (prev && block(prev.id) !== block(r.id)) bad.push({ word: w, why: 'kinetic twice', a: prev, b: r });
    else if (!prev) seen.set(w, r);
    const c = caps.find((c) => c.start < r.end && r.start < c.end && words(c.text).includes(w));
    if (c) bad.push({ word: w, why: 'kinetic over the same caption', a: r, b: c });
  }
  return { bad };
}

async function main(argv) {
  const proj = argv.find((a) => !a.startsWith('--'));
  if (!proj) { console.error('usage: kinetic-dup.mjs <project-dir> [--json]'); return 2; }
  const r = checkKineticDup(runs(await projectSamples(proj)));
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  for (const b of r.bad) console.log(`  DUPLICATE "${b.word.toUpperCase()}" ${b.why}: ${b.a.kind} ${b.a.id} ${b.a.start.toFixed(2)} s, ${b.b.kind} ${b.b.id} ${b.b.start.toFixed(2)} s`);
  console.log(`kinetic-dup: ${r.bad.length ? 'FAIL' : 'PASS'} ${r.bad.length} duplicate kinetic word(s)`);
  return r.bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv.slice(2));

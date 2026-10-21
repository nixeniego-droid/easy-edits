#!/usr/bin/env node
// pin-plan: pin a reviewed plan for a source, so every re-run of that source reuses it (engine/plan-store.mjs).
//   node easy-edits/tools/pin-plan.mjs <mode> <source-media> <plan.json> [--words transcript.json] [--variant V] [--copy FILE]
// talking-head / explainer: <plan.json> is a motion plan (e.g. <out>/.work/<mode>_<clip>/plan.json of the reviewed
//   render); --words the edited transcript it was anchored on (<work>/proj/assets/transcript.json) so a changed cut
//   is detected. shorts: <plan.json> is a proposals file (<out>/<source-id>/proposals.json); --variant the --range.
// --copy FILE also writes the pinned plan there (a reusable --plan FILE). Prints the pin path.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceHash, wordsKey, savePin } from '../engine/plan-store.mjs';

export function pinPlan(mode, source, planFile, { words, variant, copy, notes } = {}) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  delete plan.pin;
  const key = sourceHash(source) + (variant ? `_${variant}` : '');
  const meta = { source: path.resolve(source), from: `pinned from ${path.resolve(planFile)}`, notes: notes || '' };
  if (words) {
    const ws = JSON.parse(fs.readFileSync(words, 'utf8')).words.filter((w) => (w.type || 'word') === 'word' && String(w.text).trim()).map((w) => ({ text: String(w.text).trim(), start: w.start, end: w.end }));
    meta.words = wordsKey(ws);
  }
  const file = savePin(mode, key, plan, meta);
  if (copy) fs.writeFileSync(copy, fs.readFileSync(file));
  return { file, key };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const words = opt('--words'), variant = opt('--variant'), copy = opt('--copy'), notes = opt('--notes');
  if (a.length !== 3) { console.error('usage: pin-plan.mjs <mode> <source-media> <plan.json> [--words transcript.json] [--variant V] [--copy FILE] [--notes "..."]'); process.exit(2); }
  const r = pinPlan(a[0], a[1], a[2], { words, variant, copy, notes });
  console.log(r.file);
}

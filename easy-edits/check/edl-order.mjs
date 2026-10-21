// Easy Edits EDL order check: the edit plays the source in source order unless the plan declares a deliberate hook.
//   node easy-edits/check/edl-order.mjs <project-dir> [--json]
// Keeps = <project>/assets/edit-decisions.json `keeps[]` in play order. FAIL when a keep starts before the
// previous keep's sourceStart (a later line moved ahead of the intro), unless assets/plan.json has
// `hook: {deliberate: true, reason: "<non-empty>"}`; then each out-of-order keep is listed as a WARN.
// Exit 1 on FAIL, 2 on usage / missing files.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** keeps in play order, plan -> {pass, moves:[{keep, sourceStart, after}], hook} */
export function edlOrder(keeps, plan = {}) {
  const moves = [];
  keeps.forEach((k, i) => { if (i && k.sourceStart < keeps[i - 1].sourceStart) moves.push({ keep: i, sourceStart: k.sourceStart, after: keeps[i - 1].sourceStart, note: k.note || '' }); });
  const hook = plan.hook && plan.hook.deliberate === true && String(plan.hook.reason || '').trim() ? plan.hook : null;
  return { pass: !moves.length || !!hook, moves, hook };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2), proj = argv[0];
  const ed = proj && path.join(proj, 'assets/edit-decisions.json');
  if (!ed || !fs.existsSync(ed)) { console.error('usage: edl-order.mjs <project-dir> [--json] (needs assets/edit-decisions.json)'); process.exit(2); }
  const pf = path.join(proj, 'assets/plan.json'), plan = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
  const keeps = JSON.parse(fs.readFileSync(ed, 'utf8')).keeps || [];
  const r = edlOrder(keeps, plan);
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`edl-order: ${r.pass ? 'PASS' : 'FAIL'} (${keeps.length} keeps, ${r.moves.length} out of source order${r.hook ? `, deliberate hook: ${r.hook.reason}` : ''})`);
    for (const m of r.moves) console.log(`  ${r.hook ? 'WARN' : 'FAIL'} keep ${m.keep} (source ${m.sourceStart} s) plays after source ${m.after} s ${m.note}`);
    if (!r.pass) console.log('  Play the source in order, or declare the reorder in plan.json: "hook": {"deliberate": true, "reason": "..."}.');
  }
  process.exit(r.pass ? 0 : 1);
}

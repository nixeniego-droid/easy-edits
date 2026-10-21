// Easy Edits card type size on the FINAL video frames (embedded brief, presets/look-bright.json `cards`).
//   node easy-edits/check/card-text.mjs <project-dir> <final.mp4> [--lead s] [--body 34] [--head 44] [--json]
// card-final.mjs: each UI card's settled frame (DOM settled time + lead-in), the card segmented on the frame, each
// DOM text run's cap height measured on the pixels (ink vs the run's median luma, minus 1 px anti-aliasing) and
// turned into font px at 1080 wide (cap / 0.70, Montserrat). Headline = the first text line (tallest run on it),
// body = every other run (labels, pills, checklist rows). FAIL when the headline < --head px (44) or any body run
// < --body px (34). gen_th_style2c: "TEAM" / "PH" pills 22 px, checklist rows 32 px -> FAIL.
// Exit 1 on FAIL, 2 on usage / no browser.
import { pathToFileURL } from 'node:url';
import { finalCards, judgeText, BODY_MIN, HEAD_MIN } from './card-final.mjs';

async function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 2) { console.error('usage: card-text.mjs <project-dir> <final.mp4> [--lead s] [--body 34] [--head 44] [--json]'); return 2; }
  const body = +(o.body || BODY_MIN), head = +(o.head || HEAD_MIN);
  let r;
  try { r = await finalCards(pos[0], pos[1], { lead: o.lead != null ? +o.lead : undefined }); } catch (e) { console.error(String(e.message || e)); return 2; }
  let bad = 0, n = 0;
  for (const c of r.cards) {
    if (!c.box) { console.log(`  skip CARD TEXT ${c.tf.toFixed(2)} s #${c.id} (card not found on the frame)`); continue; }
    const j = judgeText(c, { body, head }); n++;
    if (o.json) console.log(JSON.stringify({ id: c.id, tf: c.tf, ...j }));
    if (!j.bad.length) console.log(`  ok   CARD TEXT ${c.tf.toFixed(2)} s #${c.id} "${c.text}" headline ${j.head} px, body ${j.body.map((b) => b.px).join(' / ') || '-'} px`);
    for (const b of j.bad) { bad++; console.log(`  FAIL CARD TEXT ${c.tf.toFixed(2)} s #${c.id} ${b.role} "${b.text}" ${b.px} px < ${b.min} px (measured on the frame at 1080 wide)`); }
  }
  console.log(`card-text: ${bad ? 'FAIL' : 'PASS'} ${bad} text run(s) under size on ${n} card(s) (body >= ${body} px, headline >= ${head} px, lead ${r.lead} s)`);
  return bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2)).then((c) => { process.exitCode = c; }); // not awaited: card-final <-> card-fill <-> look-check import each other

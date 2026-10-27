// card-final / card-fill --final / look-check --final (C1) and card-text (C2) on REAL gen_th_style2c final frames
// (fixtures/style2c, final = composition + 0.21 s post lead-in). The card is segmented on the pixels, not read
// from the DOM. Finding: the style2c cards ARE ~60% of 1080 on the final (c1 648 px); the reviewer's ~40% is the 720 x 1280
// `_mobile` / `_phone` derivative measured in px against 1080 (432 / 1080). C1 therefore PASSes style2c; a card
// shrunk to 40% FAILs. C2 FAILs style2c: "TEAM" / "PH" pills 22 px and the checklist rows 32 px (< 34 px body).
//   node --test ai-video-editor/check/test/card-final.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { framePng, whiteCard, inFrame } from '../frame-measure.mjs';
import { measureCards, judgeWidth, judgeText, cardBoxesAt } from '../card-final.mjs';

const fx = (f) => path.resolve(import.meta.dirname, 'fixtures/style2c', f);
const NOFRAMES = !fs.existsSync(fx('card-c1-3.68.png')) && 'frame fixture not shipped (crops of test footage not licensed for redistribution)';
const cards = JSON.parse(fs.readFileSync(fx('cards.json'), 'utf8'));

test('C1: card c1 segmented on the 1080 final frame is 648 px = 60% (ok); the 720 derivative is 432 px = 40% of 1080', { skip: NOFRAMES }, () => {
  const f = inFrame(fx('card-c1-3.68.png'), 180, 1030), b = whiteCard(f, [176, 1040, 728, 382]);
  assert.equal(b.w, 648); assert.equal(b.x, 216);
  assert.deepEqual(judgeWidth({ box: b }), { pct: 60, ok: true });
  const m = framePng(fx('card-c1-3.69-mobile720.png')), mb = whiteCard(m, [0, 0, m.w, m.h]);
  assert.ok(Math.abs(mb.w - 432) <= 3, `mobile card ${mb.w} px`);
  assert.ok(Math.abs(100 * mb.w / 1080 - 40) < 0.5, 'px of the 720 derivative over 1080 = the reported ~40%');
  assert.ok(Math.abs(100 * mb.w / 720 - 60) < 0.5, 'same card on its own frame width = 60%');
});

test('C1: a card at 40% of the frame FAILs card width', () => {
  assert.deepEqual(judgeWidth({ box: { w: 432 } }), { pct: 40, ok: false });
});

test('C2: style2c c4 checklist rows measure 32.9 px on the final (< 34) -> FAIL; headline 52.9 px ok', { skip: NOFRAMES }, () => {
  const f = inFrame(fx('card-c4-22.81.png'), 180, 1020);
  const c = cards.find((k) => k.id === 'c4c');
  const [m] = measureCards([{ ...c, ...c.dom, texts: c.domTexts }], () => f, 0.21);
  assert.equal(m.box.w, 648);
  const j = judgeText(m);
  assert.ok(j.head >= 44, `headline ${j.head}`);
  assert.deepEqual(j.bad.map((b) => [b.role, b.text, b.px]), [['body', 'TEAM BONDS', 32.9], ['body', 'SHARED CULTURE', 32.9], ['body', 'READY ABROAD', 32.9]]);
});

test('C2: style2c c1 "TEAM" pill 21.4 px -> FAIL (headline TOP PRIORITY #1 ok)', { skip: NOFRAMES }, () => {
  const f = inFrame(fx('card-c1-3.68.png'), 180, 1030);
  const c = cards.find((k) => k.id === 'c1c');
  const j = judgeText(measureCards([{ ...c, ...c.dom, texts: c.domTexts }], () => f, 0.21)[0]);
  assert.deepEqual(j.bad.map((b) => [b.role, b.text]), [['body', 'TEAM']]);
  assert.ok(j.bad[0].px < 34);
});

test('C3 input: measured cards are on screen only settled (entry done, up to the settled sample)', () => {
  const at = cardBoxesAt([{ id: 'c3c', text: 'x', s: 11.8, t: 13.0, box: { x: 400, y: 861, w: 661, h: 299 } }]);
  assert.equal(at(11.9).length, 0); assert.equal(at(12.4)[0].box.y0, 861); assert.equal(at(13.05).length, 0);
});

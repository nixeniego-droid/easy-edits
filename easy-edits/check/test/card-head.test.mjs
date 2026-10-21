// caption-face-final cards (C3) on REAL gen_th_style2c final frames: the "BEEN HERE BEFORE?" card is segmented on
// the 12.40 s final frame (fixtures/style2c/card-c3-12.40.png, crop at 380,830) and checked against the head zone
// from the Haar faces of the final 11.9-13.4 s (fixtures/style2c/faces-11.9-13.4.json): its top (y 861) is above
// the chin line -> FAIL OVER HEAD ZONE. The same card moved below the chin line passes.
//   node --test easy-edits/check/test/card-head.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { whiteCard, inFrame } from '../frame-measure.mjs';
import { cardBoxesAt } from '../card-final.mjs';
import { checkFinalFaces } from '../caption-face-final.mjs';

const fx = (f) => path.resolve(import.meta.dirname, 'fixtures/style2c', f);
const NOFRAMES = !fs.existsSync(fx('card-c3-12.40.png')) && 'frame fixture not shipped (crops of test footage not licensed for redistribution)';
const frames = JSON.parse(fs.readFileSync(fx('faces-11.9-13.4.json'), 'utf8'));
const box = NOFRAMES ? null : whiteCard(inFrame(fx('card-c3-12.40.png'), 380, 830), [360, 818, 728, 384]);
const run = (b) => checkFinalFaces({ textAt: cardBoxesAt([{ id: 'c3c', text: 'BEEN HERE BEFORE?', s: 11.8, t: 13.0, box: b }]), frames, lead: 0.21, from: 11.9, W: 1080, H: 1920, punch: () => ({ s: 1, ox: 540, oy: 960 }) });

test('C3: style2c "BEEN HERE BEFORE?" measured on the final (y ~861) sits over the chin / mouth -> FAIL', { skip: NOFRAMES }, () => {
  assert.ok(Math.abs(box.y - 861) <= 3 && box.w > 640, JSON.stringify(box));
  const r = run(box);
  assert.equal(r.bad.length, 1, JSON.stringify(r.bad));
  assert.equal(r.bad[0].zone, true); assert.equal(r.bad[0].kind, 'card');
  assert.ok(r.bad[0].rect.y1 > box.y, 'chin line below the card top');
});

test('C3: the same card below the chin line passes', { skip: NOFRAMES }, () => {
  const r = run({ ...box, y: 1080 });
  assert.equal(r.bad.length, 0, JSON.stringify(r.bad));
});

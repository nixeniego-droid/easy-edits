// panel-through (C4) on REAL frames: the gen_th_style2c final ink panel (#p2 at 14.61 s, crop 240,1220 600x360)
// shows no footage texture -> FAIL. Calibration renders (1 s hyperframes renders of style2c footage, compositions
// panel-test-a.html / panel-test-b.html, 4 columns of 270 px each, crop y 160-480):
//   a: .85 + backdrop blur(24px) | .85 no blur (sharp) | .85 over a blur(24px) brightness(.6) copy | same
//   b: .70 + backdrop blur(8px)  | flat #0E1116       | .72 over a blur(8px) brightness(.8) copy  | .62 over it
//   node --test easy-edits/check/test/panel-through.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { framePng } from '../frame-measure.mjs';
import { panelStats, judgePanel } from '../panel-through.mjs';

const fx = (f) => path.resolve(import.meta.dirname, 'fixtures/style2c', f);
const NOFRAMES = !fs.existsSync(fx('panel-p2-14.61.png')) && 'frame fixture not shipped (crops of test footage not licensed for redistribution)';
const col = (f, i) => judgePanel(panelStats(f, [270 * i, 0, 270, 320]));

test('C4: style2c final panel (opaque-looking) -> FAIL on std and edge', { skip: NOFRAMES }, () => {
  const f = framePng(fx('panel-p2-14.61.png')), s = panelStats(f, [0, 0, f.w, f.h]), j = judgePanel(s);
  assert.equal(j.ok, false, JSON.stringify(s));
  assert.ok(s.std < 3 && s.edge < 0.35, JSON.stringify(s));
});

test('C4 calibration: .85 + blur(24) and the dimmed blur-copy recipe FAIL; flat ink FAILs; .70-.72 over blur(8) passes', { skip: NOFRAMES }, () => {
  const a = framePng(fx('panel-test-a.png')), b = framePng(fx('panel-test-b.png'));
  assert.deepEqual([0, 1, 2, 3].map((i) => col(a, i).ok), [false, true, false, false]);
  assert.deepEqual([0, 1, 2, 3].map((i) => col(b, i).ok), [true, false, true, true]);
  assert.match(col(b, 1).why.join(' '), /within 10 of #0E1116/);
});

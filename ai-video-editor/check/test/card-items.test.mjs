// card-items on the REAL gen_th_style2c index.html (frozen copy, fixtures/style2c/index.html): 4 card clips, one at
// a time; the ~0:23 MISSION READY card (c4, 20.32-22.80 s) has 3 checklist rows -> PASS at the limit. A 4th row or
// a second overlapping card (a notification stack) FAILs.
//   node --test ai-video-editor/check/test/card-items.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cardClips, checkCardItems } from '../card-items.mjs';

const html = fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures/style2c/index.html'), 'utf8');

test('style2c: 4 cards, one at a time; c4 (~0:23) 3 checklist rows -> PASS', () => {
  const clips = cardClips(html), r = checkCardItems(clips);
  assert.deepEqual(clips.map((c) => [c.id, c.cards.length, c.cards[0].items]), [['c1', 1, 0], ['c2', 1, 0], ['c3', 1, 0], ['c4', 1, 3]]);
  assert.equal(r.ok, true);
});

test('a 4th checklist row on c4 -> FAIL; a second card overlapping c4 -> FAIL (stack)', () => {
  const row = '<div class="chk"><div class="box"></div><span>X</span></div>';
  const four = html.replace('<span>TEAM BONDS</span></div>', `<span>TEAM BONDS</span></div>${row}`);
  const r4 = checkCardItems(cardClips(four));
  assert.equal(r4.ok, false); assert.deepEqual(r4.crowded.map((k) => [k.clip, k.items]), [['c4', 4]]);
  const two = html.replace('<div id="caps">', '<div id="n2" class="clip slot" data-start="21" data-duration="1" data-track-index="7"><div class="card"><div class="notif">A</div></div></div>\n<div id="caps">');
  const r2 = checkCardItems(cardClips(two));
  assert.equal(r2.ok, false); assert.deepEqual(r2.stacks.map((s) => s.ids), [['c4', 'n2']]);
});

// gap-cuts: pad on both sides, plus the real gen-th-style2b source (its word pauses become gap cuts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { padCuts, gapCuts } from '../gap-cuts.mjs';

test('40 ms kept on both sides, tiny cuts dropped', () => {
  assert.deepEqual(padCuts([{ start: 1.33, end: 1.65 }, { start: 2, end: 2.085 }]), [{ start: 1.37, end: 1.61, dur: 0.24 }]);
});

const src = path.resolve(import.meta.dirname, '../../../video-projects/gen-th-style2b/raw/talk_30s.mp4');
test('gen-th-style2b source: pauses -> gap cuts', { skip: !fs.existsSync(src) }, () => {
  const r = gapCuts(src);
  assert.ok(r.cuts.length >= 3, JSON.stringify(r));
  for (const c of r.cuts) assert.ok(c.dur >= 0.07);
});

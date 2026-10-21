// disfluency on the real windowed --disfluent decodes of the finals (fixtures/*.disfluent.json: 6 s windows every
// 2 s; *.disfluent.run1.json: an earlier run of the same renders, 6 s windows every 4 s). medium int8 with the
// prompt is not deterministic, so one run alone may hear a repeat in a single window only (talk_v5 run 2: "a very
// large, a very large" in the 4-10 window only); the two runs together confirm it. Clean: the v5 line without
// the restart.
//   node --test easy-edits/check/test/disfluency.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDisfluency, repeatsIn, windows } from '../disfluency.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', n), 'utf8')).words;
const both = (n) => [...fx(`${n}.disfluent.json`), ...fx(`${n}.disfluent.run1.json`)];
const near = (list, text, t, tol = 0.7) => list.find((r) => r.text === text && Math.abs(r.t - t) <= tol);

test('repeatsIn finds token stutters and 2-3 word restarts', () => {
  const w = (s, t0 = 0) => s.split(' ').map((text, i) => ({ text, start: t0 + i * 0.3 }));
  assert.deepEqual(repeatsIn(w('really a a gigantic')).map((r) => [r.text, r.kind]), [['a a', 'token']]);
  assert.deepEqual(repeatsIn(w('a very large, a very large importance')).map((r) => r.text), ['a very large, a very large']);
  assert.deepEqual(repeatsIn(w('I, I help')).map((r) => r.text), ['i i']);
  assert.deepEqual(repeatsIn(w('the building is really of great importance')), []);
});
test('windows cover the file every 2 s', () => assert.deepEqual(windows(9), [[0, 6], [2, 8], [4, 9], [6, 9], [8, 9]]));
test('gen_talk_v5 final FAILS: "a very large" restart at ~3.5 s', () => {
  const r = checkDisfluency(both('talk_v5'));
  assert.ok(r.confirmed.length > 0);
  assert.ok(near(r.confirmed, 'a very large, a very large', 3.5), JSON.stringify(r.confirmed));
});
test('gen_nasa2_v3 final FAILS: "I I" at ~13.2 s', () => {
  const r = checkDisfluency(both('nasa2_v3'));
  assert.ok(near(r.confirmed, 'i i', 13.3), JSON.stringify(r.confirmed));
});
test('one run alone can miss a restart (single-window repeats are reported, not gated)', () => {
  const r = checkDisfluency(fx('talk_v5.disfluent.json'));
  assert.ok(near(r.unconfirmed, 'a very large, a very large', 3.5));
});
test('clean decode PASSES', () => {
  // the delivered v5 line without the restart, heard by 3 overlapping windows
  const line = 'the relationship building is really a very large importance for our group'.split(' ').map((text, i) => ({ text, start: 0.6 + i * 0.45 }));
  const r = checkDisfluency([line, line.filter((w) => w.start >= 2), line.filter((w) => w.start >= 4)]);
  assert.equal(r.confirmed.length, 0, JSON.stringify(r.confirmed));
});

test('--fillers-only: a filler heard by 2 windows FAILs, repeats do not count', async () => {
  const { checkFillers } = await import('../disfluency.mjs');
  const w1 = [{ text: 'a', start: 1 }, { text: 'a', start: 1.2 }, { text: 'uh,', start: 3.0 }], w2 = [{ text: 'Uh', start: 3.2 }], w3 = [{ text: 'um', start: 8 }];
  const r = checkFillers([w1, w2, w3]);
  assert.deepEqual(r.confirmed.map((c) => [c.t, c.windows]), [[3, 2]]);
  assert.equal(r.unconfirmed.length, 1);
});

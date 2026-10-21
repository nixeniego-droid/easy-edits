// readability: real dom-sample runs + transcripts of gen-talk-v5 and gen-nasa2-v3 (fixtures/readability.runs.json).
// v5 flashes "WE'RE FROM" for 0.07 s (and 12 more caption groups < 0.3 s) -> FAIL; its kinetic stacks are
// contiguous phrases, and dropping "LARGE" from "VERY LARGE IMPORTANCE FOR OUR GROUP" is a skip -> FAIL.
//   node --test easy-edits/check/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkReadability } from '../readability.mjs';

const fx = JSON.parse(fs.readFileSync(new URL('fixtures/readability.runs.json', import.meta.url), 'utf8'));

test('gen-talk-v5: WE\'RE FROM settles 0.07 s -> FAIL', () => {
  const { runs, words } = fx['gen-talk-v5'], r = checkReadability(runs, words);
  const wf = r.short.find((s) => s.text === "WE'RE FROM");
  assert.ok(wf && wf.settled < 0.1, JSON.stringify(wf));
  assert.equal(r.short.length, 13);
  assert.deepEqual(r.skips, []);
  assert.deepEqual(r.phrases.map((p) => p.runs.length), [4, 1, 2]);
});

test('gen-nasa2-v3: 11 short caption groups -> FAIL, kinetic phrases contiguous', () => {
  const { runs, words } = fx['gen-nasa2-v3'], r = checkReadability(runs, words);
  assert.equal(r.short.length, 11);
  assert.deepEqual(r.skips, []);
});

test('a kinetic stack missing a mid-phrase word fails; holding every group 0.3 s passes', () => {
  const { runs, words } = fx['gen-talk-v5'];
  const r = checkReadability(runs.filter((x) => x.text !== 'LARGE'), words);
  assert.deepEqual(r.skips.map((s) => [s.text, s.skipped]), [['VERY IMPORTANCE FOR OUR GROUP', ['large']]]);
  assert.deepEqual(checkReadability(runs.map((x) => ({ ...x, settled: Math.max(x.settled, 0.3) })), words).short, []);
});

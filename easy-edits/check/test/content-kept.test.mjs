// content-kept: pure verdicts on hand-made transcripts (no ASR).   node --test easy-edits/check/test/content-kept.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeRemoved, bareRemovedSpeech, missingKept, contentTokens, lcs } from '../content-kept.mjs';

const W = (s, t0 = 0, d = 0.3) => s.split(' ').map((text, i) => ({ text, start: +(t0 + i * d).toFixed(2), end: +(t0 + i * d + d * 0.9).toFixed(2) }));
// "relationship building is really a a a gigantic a very large a very large uh importance for our group"
const src = W('relationship building is really a a a gigantic a very large a very large uh importance for our group');
const at = (i) => src[i].start;

test('a clean retake cut passes: only "gigantic" is unrepeated', () => {
  // keep 0-3 ("relationship building is really"), drop 4-10 (a a a gigantic a very large), keep 11-18
  const keeps = [{ sourceStart: 0, sourceEnd: src[3].end + 0.01 }, { sourceStart: at(11) - 0.01, sourceEnd: 99 }];
  const r = judgeRemoved(src, keeps);
  assert.equal(r.fail, false);
  assert.deepEqual(r.unrepeated.map((x) => x.t), ['gigantic']);
  assert.ok(r.removed.filter((x) => x.kind === 'repeat').length >= 5);
});

test('run #6 class: the opening sentence cut as "dead air" FAILs', () => {
  const keeps = [{ sourceStart: at(16) - 0.01, sourceEnd: 99 }];
  const r = judgeRemoved(src, keeps);
  assert.equal(r.fail, true);
  assert.ok(r.longRuns[0].map((x) => x.t).join(' ').startsWith('relationship building is really'));
});

test('fillers never count; budget is max(2, 4 %)', () => {
  assert.deepEqual(contentTokens(W('uh um hmm so')).map((x) => x.t), ['so']);
  const r = judgeRemoved(W('one two three four five six'), [{ sourceStart: 0.55, sourceEnd: 99 }]);
  assert.equal(r.budget, 2); assert.equal(r.fail, false); // "one two" removed, 2 <= budget, run of 2
});

test('VAD speech cut with no word anywhere is reported; covered or kept speech is not', () => {
  const keeps = [{ sourceStart: 0, sourceEnd: 1 }, { sourceStart: 4, sourceEnd: 9 }];
  const words = [{ text: 'x', start: 1.2, end: 1.5 }];
  assert.deepEqual(bareRemovedSpeech([[0.5, 2], [2.2, 3.5], [5, 6]], keeps, words), [[2.2, 3.5]]);
});

test('kept words missing from the final are grouped in runs', () => {
  const tk = judgeRemoved(W('we get to come to the philippines'), [{ sourceStart: 0, sourceEnd: 99 }]).tokens;
  const m = missingKept(tk, W('we get the philippines'));
  assert.deepEqual(m.runs.map((r) => r.map((x) => x.t).join(' ')), ['to come to']);
  assert.deepEqual(lcs(['a', 'b', 'c'], ['a', 'c']), [[0, 0], [2, 1]]);
});

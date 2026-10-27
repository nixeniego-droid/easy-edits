import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinHyphenWords, reusedPhraseNote } from '../words.mjs';

test('joins long + -term into long-term', () => {
  const w = [
    { text: 'the', start: 0, end: 0.1 },
    { text: 'long', start: 0.1, end: 0.3 },
    { text: '-term', start: 0.3, end: 0.5 },
    { text: 'trends', start: 0.5, end: 0.7 },
  ];
  const j = joinHyphenWords(w);
  assert.deepEqual(j.map((x) => x.text), ['the', 'long-term', 'trends']);
  assert.equal(j[1].start, 0.1);
  assert.equal(j[1].end, 0.5);
});

test('joins foo + - + bar', () => {
  const j = joinHyphenWords([
    { text: 'foo', start: 0, end: 0.1 },
    { text: '-', start: 0.1, end: 0.12 },
    { text: 'bar', start: 0.12, end: 0.2 },
  ]);
  assert.deepEqual(j.map((x) => x.text), ['foo-bar']);
});

test('plain reused note', () => {
  assert.equal(reusedPhraseNote('warmest year on record', 2),
    'The phrase "warmest year on record" is said 2 times; that is fine.');
});

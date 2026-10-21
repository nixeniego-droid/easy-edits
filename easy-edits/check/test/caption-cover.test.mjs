// caption-cover on the REAL gen-th-style2c: shown caption chunks (dom-sample of the frozen index.html) and the
// edit transcript words, frozen in fixtures/style2c/cover.json. Captions hidden while a kinetic word is up leave
// "from another nation", "our guys", "americans", "filipinos", "builds" and "trust in us" uncaptioned -> FAIL.
// "been to the" (12.67-13.00 s) IS captioned. A chunk with a duplicated word is EXTRA.
//   node --test easy-edits/check/test/caption-cover.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { captionCover, gaps } from '../caption-cover.mjs';

const { caps, words } = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures/style2c/cover.json'), 'utf8'));

test('style2c: 11 of 76 spoken words in no caption chunk -> FAIL', () => {
  const r = captionCover(caps, words);
  assert.equal(r.words, 76); assert.equal(r.extra.length, 0);
  assert.deepEqual(gaps(r.missing).map((g) => g.words.join(' ')), ['from another nation', 'our guys', 'americans', 'filipinos', 'builds', 'trust in us']);
  assert.ok(caps.some((c) => c.text === 'BEEN TO THE'));
});

test('captions restored over the kinetic words -> PASS; a doubled word -> EXTRA', () => {
  const add = [['FROM ANOTHER', 4.35, 4.69], ['NATION.', 4.69, 5.12], ['OUR GUYS.', 11.08, 11.8], ['AMERICANS', 14.22, 14.67], ['FILIPINOS', 15.58, 16.28], ['BUILDS', 18.48, 18.93], ['TRUST IN US', 19.57, 20.32]];
  const full = [...caps, ...add.map(([text, start, end]) => ({ text, start, end }))].sort((a, b) => a.start - b.start);
  const r = captionCover(full, words);
  assert.deepEqual([r.missing.length, r.extra.length], [0, 0]);
  const dup = full.map((c) => (c.text === 'BEEN TO THE' ? { ...c, text: 'BEEN TO TO THE' } : c));
  assert.deepEqual(captionCover(dup, words).extra.map((e) => e.t), ['to']);
});

// style2j (reviewer note 4): AMERICANS / FILIPINOS are dropped from the captions while their group label shows the word.
const J = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures/style2j/cover.json'), 'utf8'));

test('style2j: a word dropped from the captions is covered by the on-screen label that shows it', () => {
  const r = captionCover(J.caps, J.words, { labels: J.labels });
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.extra, []);
  assert.deepEqual(r.labelled.map((w) => [w.t, w.label]), [['americans', 'AMERICANS'], ['filipinos', 'FILIPINOS']]);
  assert.equal(r.covered, r.words);
});

test('style2j: without labels the dropped words FAIL as missing', () => {
  assert.deepEqual(captionCover(J.caps, J.words).missing.map((w) => w.t), ['americans', 'filipinos']);
});

test('a dropped word with no matching label still FAILs (wrong word, or label not on screen while spoken)', () => {
  const noAm = J.labels.filter((l) => !/americans/i.test(l.text));
  assert.deepEqual(captionCover(J.caps, J.words, { labels: noAm }).missing.map((w) => w.t), ['americans']);
  const late = J.labels.map((l) => /americans/i.test(l.text) ? { ...l, start: l.end + 2, end: l.end + 3 } : l);
  assert.deepEqual(captionCover(J.caps, J.words, { labels: late }).missing.map((w) => w.t), ['americans']);
  const other = J.labels.map((l) => /americans/i.test(l.text) ? { ...l, text: 'AMERICA' } : l);
  assert.deepEqual(captionCover(J.caps, J.words, { labels: other }).missing.map((w) => w.t), ['americans']);
});

test('a label never hides a missing caption word it does not show', () => {
  const words = [{ text: 'trust', start: 1, end: 1.3 }, { text: 'in', start: 1.3, end: 1.4 }, { text: 'us', start: 1.4, end: 1.6 }];
  const r = captionCover([{ text: 'TRUST', start: 0.9, end: 1.7 }], words, { labels: [{ text: 'TRUST IN', start: 0, end: 5 }] });
  assert.deepEqual(r.missing.map((w) => w.t), ['us']);
  assert.deepEqual(r.labelled.map((w) => w.t), ['in']);
});

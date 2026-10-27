// caption-verify on frozen caption groups + heard text (no ASR).
//   node --test ai-video-editor/check/test/caption-verify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tok, toks, captionWords, verify, report, windows, heardFor } from '../caption-verify.mjs';

test('tokens: case, punctuation, number words', () => {
  assert.equal(tok('Thirty,'), '30');
  assert.deepEqual(toks('Proverbs twenty-nine, verse 18.'), ['proverbs', '29', 'verse', '18']);
  assert.deepEqual(toks('30, 29'), ['30', '29']);
});

// talk_01 run #3: the cut's decode gave "help us at" / "at the preferred" / "Proverbs 29"
const words = [['Vision', 5.5], ['help', 6.6], ['us', 6.9], ['at,', 7.2], ['at', 7.8], ['the', 8.0], ['preferred,', 8.2], ['Proverbs', 15.0], ['29', 15.5]]
  .map(([text, start], i) => ({ text, start, end: start + 0.3, sourceIndex: 13 + i }));
const caps = [{ text: 'Vision', start: 5.5, end: 6.6 }, { text: 'help us at', start: 6.6, end: 7.8 }, { text: 'at the preferred', start: 7.8, end: 8.6 }, { text: 'Proverbs 29', start: 15, end: 16 }];

test('caption words not heard by the second decode are flagged with their source indices', () => {
  const cw = captionWords(caps, words);
  assert.deepEqual(cw[1].words.map((w) => w.i), [14, 15, 16]);
  const rows = verify(cw, ['vision vision helps', 'Vision helps us arrive at a', 'arrive at a preferred future', 'In Proverbs 30, 29 verse']);
  assert.deepEqual(rows.map((r) => r.flags.map((w) => w.text)), [[], ['help'], ['the'], []]);
  assert.equal(rows[1].flags[0].i, 14);
  assert.match(report(rows), /2 of 4 captions flagged, 2 words/);
  assert.match(report(rows), /FLAG cap 1 .*not heard: 14:help/);
});

test('a repeated caption word needs to be heard as often; agreeing captions give no flags', () => {
  const c = [{ text: 'we we ship it', start: 0, end: 2, words: [{ i: 0, text: 'we' }, { i: 1, text: 'we' }, { i: 2, text: 'ship' }, { i: 3, text: 'it.' }] }];
  assert.deepEqual(verify(c, ['we ship it'])[0].flags, [{ i: 1, text: 'we' }]);
  assert.deepEqual(verify(c, ['So we, we ship it.'])[0].flags, []);
});

test('windows: every moment in two windows; a word is flagged only when no covering window heard it', () => {
  assert.deepEqual(windows(23), [[0, 10], [5, 15], [10, 20], [15, 23]]);
  const spans = [[0, 10], [5, 15]], w = (text, start) => ({ text, start, end: start + 0.3 });
  const decoded = [[w('helps', 6.7), w('us', 7.0), w('arrive', 7.3), w('at', 7.6), w('snapchat', 9.0)], [w('help', 6.7), w('us', 7.0), w('arrive', 7.3), w('at', 7.6), w('snapshot', 9.0)]];
  const cs = [{ text: 'help us at', start: 6.6, end: 7.8, words: [{ i: 14, text: 'help' }, { i: 15, text: 'us' }, { i: 16, text: 'at' }] },
    { text: 'snapshot', start: 8.9, end: 9.6, words: [{ i: 66, text: 'snapshot' }] }, { text: 'the end', start: 6.6, end: 7.8, words: [{ i: 1, text: 'the' }, { i: 2, text: 'end' }] }];
  const h = heardFor(cs, spans, decoded);
  assert.deepEqual(h[0], ['helps us arrive at', 'help us arrive at']);
  const rows = verify(cs, h);
  assert.deepEqual(rows.map((r) => r.flags.map((x) => x.i)), [[], [], [1, 2]]);
});

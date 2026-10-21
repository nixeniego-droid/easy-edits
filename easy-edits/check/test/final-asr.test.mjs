// final-asr helpers without decoding: norm(), the transcript cache key (a cached file is returned without running
// Whisper; -disfluent decodes cache separately) and excerptAsr([]).
//   node --test easy-edits/check/test/final-asr.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { excerptAsr, finalAsr, norm } from '../final-asr.mjs';

test('norm lowercases, drops punctuation and apostrophes, splits &', () => {
  assert.deepEqual(norm("I, I'm  Q&A — GPM's"), ['i', 'im', 'q', 'and', 'a', 'gpms']);
  assert.deepEqual(norm('...'), []);
});
test('finalAsr returns the cached transcript (plain and --disfluent keyed apart)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-final-asr-')), v = path.join(dir, 'final.mp4');
  fs.writeFileSync(v, 'not a video');
  const st = fs.statSync(v), key = `final-${st.size}-${Math.round(st.mtimeMs)}.medium`;
  fs.mkdirSync(path.join(dir, 'asr'));
  fs.writeFileSync(path.join(dir, 'asr', `${key}.json`), JSON.stringify({ model: 'medium', words: [{ text: 'plain' }] }));
  fs.writeFileSync(path.join(dir, 'asr', `${key}-disfluent.json`), JSON.stringify({ model: 'medium', words: [{ text: 'I' }, { text: 'I' }] }));
  const prev = process.env.EASY_EDITS_CACHE; process.env.EASY_EDITS_CACHE = dir;
  try {
    assert.equal(finalAsr(v, { model: 'medium', lang: 'en' }).words[0].text, 'plain');
    assert.equal(finalAsr(v, { model: 'medium', disfluent: true, lang: 'en' }).words.length, 2);
  } finally { if (prev === undefined) delete process.env.EASY_EDITS_CACHE; else process.env.EASY_EDITS_CACHE = prev; }
});
test('excerptAsr of no spans decodes nothing', () => assert.deepEqual(excerptAsr('/nonexistent.mp4', []), []));

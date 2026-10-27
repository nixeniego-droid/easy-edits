// final-asr language plumbing: --lang / AI_VIDEO_EDITOR_LANG / profile.json language / "auto" (no hard-coded en), the
// language keys the transcript cache, and excerptAsr passes --lang to asr_excerpts.py (a fake interpreter echoes argv).
//   node --test ai-video-editor/check/test/final-asr-lang.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AI_VIDEO_EDITOR_PYTHON = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures/fake-py/python');
const { excerptAsr, finalAsr, langArg, resolveLang } = await import('../final-asr.mjs');

test('resolveLang: explicit > AI_VIDEO_EDITOR_LANG > profile.json > auto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-lang-')), profile = path.join(dir, 'profile.json');
  assert.equal(resolveLang(undefined, { env: {}, profile }), 'auto');
  fs.writeFileSync(profile, JSON.stringify({ language: 'tl' }));
  assert.equal(resolveLang(undefined, { env: {}, profile }), 'tl');
  assert.equal(resolveLang(undefined, { env: { AI_VIDEO_EDITOR_LANG: 'en' }, profile }), 'en');
  assert.equal(resolveLang('es', { env: { AI_VIDEO_EDITOR_LANG: 'en' }, profile }), 'es');
});
test('langArg reads --lang', () => {
  assert.equal(langArg(['x.mp4', '--lang', 'tl']), 'tl');
  assert.equal(langArg(['x.mp4']), undefined);
});
test('excerptAsr passes the language (auto by default, never a fixed en)', () => {
  const prev = process.env.AI_VIDEO_EDITOR_LANG; delete process.env.AI_VIDEO_EDITOR_LANG;
  const home = process.env.AI_VIDEO_EDITOR_HOME; process.env.AI_VIDEO_EDITOR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-home-'));
  try {
    assert.match(excerptAsr('/x.mp4', [[0, 1]])[0][0].text, /--lang auto/);
    assert.match(excerptAsr('/x.mp4', [[0, 1]], { lang: 'tl' })[0][0].text, /--lang tl/);
  } finally {
    if (prev !== undefined) process.env.AI_VIDEO_EDITOR_LANG = prev;
    if (home === undefined) delete process.env.AI_VIDEO_EDITOR_HOME; else process.env.AI_VIDEO_EDITOR_HOME = home;
  }
});
test('finalAsr cache is keyed by language (en keeps the old key)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-final-asr-')), v = path.join(dir, 'final.mp4');
  fs.writeFileSync(v, 'not a video');
  const st = fs.statSync(v), key = `final-${st.size}-${Math.round(st.mtimeMs)}.small`;
  fs.mkdirSync(path.join(dir, 'asr'));
  fs.writeFileSync(path.join(dir, 'asr', `${key}.json`), JSON.stringify({ words: [{ text: 'english' }] }));
  fs.writeFileSync(path.join(dir, 'asr', `${key}-tl.json`), JSON.stringify({ words: [{ text: 'tagalog' }] }));
  fs.writeFileSync(path.join(dir, 'asr', `${key}-auto.json`), JSON.stringify({ words: [{ text: 'detected' }] }));
  const prev = process.env.AI_VIDEO_EDITOR_CACHE; process.env.AI_VIDEO_EDITOR_CACHE = dir;
  try {
    assert.equal(finalAsr(v, { model: 'small', lang: 'en' }).words[0].text, 'english');
    assert.equal(finalAsr(v, { model: 'small', lang: 'tl' }).words[0].text, 'tagalog');
    assert.equal(finalAsr(v, { model: 'small', lang: 'auto' }).words[0].text, 'detected');
  } finally { if (prev === undefined) delete process.env.AI_VIDEO_EDITOR_CACHE; else process.env.AI_VIDEO_EDITOR_CACHE = prev; }
});

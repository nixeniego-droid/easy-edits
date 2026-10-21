// caption-size: preset size, overrides, settle scale and overflow on synthetic compositions, plus the preset's own
// grouping (no 2-word group overflows the box at the preset size).
//   node --test easy-edits/check/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCaptionSize, EM } from '../caption-size.mjs';
import { preset, captionCss, captionHtml, captionTweens, captionGroups } from '../../presets/captions-default.mjs';

const words = 'the Philippines and relationship building is really important'.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.3 }));
const build = (caps, extra = '') => `<style>${captionCss()}${extra}</style>${captionHtml(caps)}<script>${captionTweens(caps)}</script>`;

test('preset composition passes; preset size is phone-readable', () => {
  assert.ok(preset.font.size >= 96 && preset.font.size <= 110);
  const caps = captionGroups(words, { duration: 4 });
  const r = checkCaptionSize(build(caps));
  assert.deepEqual(r.bad, []);
  for (const c of caps) assert.ok(c.text.length * preset.font.size * EM <= preset.box.width, c.text);
});

test('smaller font, per-caption override, unsettled scale and per-layout shrink all fail', () => {
  const caps = captionGroups(words, { duration: 4 });
  const kinds = (html) => checkCaptionSize(html).bad.map((b) => b.kind);
  assert.deepEqual(kinds(build(caps).replace(`${preset.font.size}px/`, '84px/')), ['size']);
  assert.deepEqual(kinds(build(caps, '#cap1 span{font-size:70px}')), ['override']);
  assert.deepEqual(kinds(build(caps) + "<script>tl.to('#cap0 span',{scale:0.8,duration:0.1},9);</script>"), ['settle']);
  assert.deepEqual(kinds(build(caps) + "<script>tl.set('#caps',{scale:0.85},5);</script>"), ['settle']);
});

test('a long caption overflows', () => {
  const caps = [{ text: 'INTERNATIONALIZATION NOW', start: 0, end: 1 }];
  assert.deepEqual(checkCaptionSize(build(caps)).bad.map((b) => b.kind), ['overflow']);
});

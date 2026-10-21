// readability --groups on the REAL gen_th_style2c index.html (frozen copy, fixtures/style2c/index.html):
// 30 visible caption groups, 9 single words (30% > 20%) -> FAIL; none over 3 words. Synthetic cases pin the
// key-word and lone-remaining-word excuses and the > 3 words rule.
//   node --test easy-edits/check/test/caption-groups.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { captionGroupsFromHtml, checkCaptionGroups } from '../readability.mjs';

const html = fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures/style2c/index.html'), 'utf8');

test('style2c captions: 9/30 visible groups are one word -> FAIL', () => {
  const p = captionGroupsFromHtml(html), g = checkCaptionGroups(p);
  assert.equal(p.groups.length, 37);
  assert.equal(g.visible.length, 30);
  assert.deepEqual(g.singles.map((x) => x.text), ['Relationship', 'importance', 'for', 'the', 'Philippines', 'Philippines', 'and', 'relationship', 'greater']);
  assert.equal(g.long.length, 0);
  assert.equal(g.ok, false);
});

test('key-word hit and lone remaining word are excused; > 3 words FAILs', () => {
  const cap = (t) => ({ start: 0, text: t, n: t.split(' ').length, hidden: false });
  const keys = new Set(['trust']);
  assert.equal(checkCaptionGroups({ groups: [cap('we get to'), cap('go.'), cap('Trust'), cap('in us')], keys }).ok, true);
  assert.equal(checkCaptionGroups({ groups: [cap('we get'), cap('go.'), cap('in us')], keys }).singles.length, 1);
  assert.equal(checkCaptionGroups({ groups: [cap('to go outside of')], keys }).ok, false);
});

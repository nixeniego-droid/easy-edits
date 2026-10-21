// The watchdog's default idle limit is 300 s (style2f: 60 s killed a healthy run 4 times between turns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../claude-watchdog.mjs'), 'utf8');
test('default --idle is 300 s', () => {
  assert.match(src, /EASY_EDITS_WATCHDOG_IDLE \|\| 300\)/);
  assert.doesNotMatch(src, /--idle 60\]/);
});

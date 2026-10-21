// dead-air: silence parsing / lead-in + tail exclusion, plus the real gen_th_style2b final (word gaps left in -> FAIL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseSilences, internalGaps } from '../dead-air.mjs';
// renders that some tests read (skipped when absent): <repo>/../renders, or EASY_EDITS_TEST_RENDERS
const RENDERS = process.env.EASY_EDITS_TEST_RENDERS || new URL('../../../renders', import.meta.url).pathname;

test('lead-in and tail excluded, internal gaps over max kept', () => {
  const sd = 'silence_start: 0\nsilence_end: 0.2\nsilence_start: 1.33\nsilence_end: 1.65\nsilence_start: 3.0\nsilence_end: 3.12\nsilence_start: 9.7\n';
  const sil = parseSilences(sd, 10);
  assert.deepEqual(sil, [[0, 0.2], [1.33, 1.65], [3, 3.12], [9.7, 10]]);
  assert.deepEqual(internalGaps(sil, 10, 0.15), [{ start: 1.33, end: 1.65, dur: 0.32 }]);
});

const final = RENDERS + '/gen_th_style2b.mp4';
test('gen_th_style2b final: internal gaps -> FAIL', { skip: !fs.existsSync(final) }, () => {
  const r = spawnSync('node', [path.resolve(import.meta.dirname, '../dead-air.mjs'), final], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL DEAD AIR 1\.3\d-1\.6\d s/);
  assert.ok((r.stdout.match(/FAIL DEAD AIR/g) || []).length >= 3, r.stdout);
});

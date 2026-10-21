// cut-guard: checkCuts on synthetic keeps / words / band windows (always), and the CLI on gen-nasa2-v2 /
// gen-talk-v3 / confirm-30s (each skipped when its gitignored project dir or source media is absent).
//   node --test easy-edits/tools/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCuts, sourceMedia } from '../cut-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '../cut-guard.mjs');
const VP = path.join(HERE, '../../../video-projects');

// 3 s of 10 ms windows: speech -20 dB on the voiced spans, -70 dB elsewhere
const voiced = [[0.2, 0.5], [0.9, 1.2], [1.6, 2.0]];
const win = Array.from({ length: 300 }, (_, i) => (voiced.some(([a, b]) => i * 0.01 >= a && i * 0.01 < b) ? -20 : -70));
// ASR spans absorb the pause after each word
const words = [{ text: 'one', start: 0.2, end: 0.9 }, { text: 'two', start: 0.9, end: 1.6 }, { text: 'three', start: 1.6, end: 2.0 }];

test('synthetic: a cut in the pause passes even inside an ASR span, a cut through voice fails', () => {
  let r = checkCuts([{ sourceStart: 0, sourceEnd: 0.7 }, { sourceStart: 1.4, sourceEnd: 3 }], words, { win, sourceEnd: 3 });
  assert.deepEqual(r.rows.map((x) => x.fail), [false, false]);
  r = checkCuts([{ sourceStart: 0, sourceEnd: 1.0 }, { sourceStart: 1.62, sourceEnd: 3 }], words, { win, sourceEnd: 3 });
  assert.deepEqual(r.rows.map((x) => [x.fail, x.word?.split(' ')[0], x.hot]), [[true, 'two', true], [true, 'three', true]]);
});

test('synthetic: without audio the padded ASR span decides', () => {
  const r = checkCuts([{ sourceStart: 0, sourceEnd: 0.88 }, { sourceStart: 1.58, sourceEnd: 2 }], words, { sourceEnd: 2 });
  assert.deepEqual(r.rows.map((x) => x.fail), [true, true]);
});

const cli = (p) => { const r = spawnSync('node', [TOOL, path.join(VP, p), '--json'], { encoding: 'utf8' }); assert.ok([0, 1].includes(r.status), r.stderr); return { code: r.status, ...JSON.parse(r.stdout) }; };
const real = (p) => ({ skip: !(fs.existsSync(path.join(VP, p, 'assets/edit-decisions.json')) && sourceMedia(path.join(VP, p))) && `${p} absent` });
test('gen-nasa2-v2: flags the "that|I" and "very|Small" joins', real('gen-nasa2-v2'), () => {
  const r = cli('gen-nasa2-v2');
  assert.equal(r.code, 1);
  const bad = r.boundaries.filter((b) => b.fail).map((b) => b.at);
  for (const t of [15.233, 15.5, 32.667, 33.033]) assert.ok(bad.includes(t), `${t} not flagged: ${bad}`);
});
test('gen-talk-v3: pause cuts inside pause-absorbing ASR spans pass', real('gen-talk-v3'), () => assert.equal(cli('gen-talk-v3').code, 0));
test('confirm-30s: passes', real('confirm-30s'), () => assert.equal(cli('confirm-30s').code, 0));

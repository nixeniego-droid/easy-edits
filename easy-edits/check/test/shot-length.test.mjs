// shot-length on the FINAL frames. Always: a real style2c frame (fixtures/style2c/card-c1-3.68.png) scaled 115%
// about its centre measures as a >= 13% zoom step; a 104% push does not. With the real final
// (renders/gen_th_style2c.mp4, 0.21 s lead-in; skipped when absent): style2c FAILs with holds
// 8.80-11.29 s (p1 panel up, no punch from 8.98 to 11.01) and 16.49-18.69 s; its 115% punches count as shots.
//   node --test easy-edits/check/test/shot-length.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { zoomStep, shotChanges, decode, overlayClips } from '../shot-length.mjs';
// renders that some tests read (skipped when absent): <repo>/../renders, or EASY_EDITS_TEST_RENDERS
const RENDERS = process.env.EASY_EDITS_TEST_RENDERS || new URL('../../../renders', import.meta.url).pathname;

const FIX = path.resolve(import.meta.dirname, 'fixtures/style2c'), FINAL = RENDERS + '/gen_th_style2c.mp4';
const NOFRAMES = !fs.existsSync(path.join(FIX, 'card-c1-3.68.png')) && 'frame fixture not shipped (crops of test footage not licensed for redistribution)';
const gray = (vf) => spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(FIX, 'card-c1-3.68.png'), '-vf', `${vf}scale=108:192,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 }).stdout;

test('style2c frame: a 115% punch is a zoom step, a 104% push is the same shot', { skip: NOFRAMES }, () => {
  const a = gray(''), p115 = gray('crop=iw/1.15:ih/1.15,'), p104 = gray('crop=iw/1.04:ih/1.04,');
  const z = zoomStep(a, p115);
  assert.ok(z.scale >= 1.13 && z.ratio <= 0.55, JSON.stringify(z));
  const r = shotChanges([a, a, a, p115, p115], [], { max: 1.5 });
  assert.deepEqual(r.events.map((e) => e.kind), ['zoom']);
  assert.equal(shotChanges([a, a, a, p104, p104]).events.length, 0);
});

test('style2c final: FAIL, holds 8.80-11.29 and 16.49-18.69 s', { skip: !fs.existsSync(FINAL) }, () => {
  const clips = overlayClips(fs.readFileSync(path.join(FIX, 'index.html'), 'utf8'));
  assert.equal(clips.length, 14);
  const r = shotChanges(decode(FINAL), clips, { lead: 0.21, max: 1.5 });
  assert.deepEqual(r.bad.map((s) => [s.start, s.end]), [[8.8, 11.29], [16.49, 18.69]]);
  for (const t of [1.4, 1.9, 2.7, 3.5]) assert.ok(r.events.some((e) => e.kind !== 'overlay' && Math.abs(e.t - t) < 0.06), `115% punch at ${t} (zoom, or cut when a caption swap hides the scale)`);
});

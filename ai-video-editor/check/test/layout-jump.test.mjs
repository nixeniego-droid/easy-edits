// layout-jump: solid vs live-under-panel frames, single-frame swaps vs punch-in cuts, plus the real gen_th_style2b
// final (hard cuts to solid ink at ~0:04, ~0:15, ~0:24 -> FAIL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { frameStats, judge, renderOffset } from '../layout-jump.mjs';
// renders that some tests read (skipped when absent): <repo>/../renders, or AI_VIDEO_EDITOR_TEST_RENDERS
const RENDERS = process.env.AI_VIDEO_EDITOR_TEST_RENDERS || new URL('../../../renders', import.meta.url).pathname;

const W = 108, H = 192;
const footage = (k) => Uint8Array.from({ length: W * H }, (_, i) => ((i * 37 + k * 11) % 200) + 20);
const solid = () => new Uint8Array(W * H).fill(22);
// 80% ink over the blurred (smooth), dimmed footage, still moving underneath
const panel = (k) => Uint8Array.from({ length: W * H }, (_, i) => Math.round(17.6 + 0.2 * 0.5 * (120 + 100 * Math.sin(((i % W) + 8 * k) / 6))));

test('footage -> solid slate is a SOLID JUMP; footage -> 80% panel over live footage is not', () => {
  const fs1 = [footage(0), footage(1), solid(), solid(), solid()];
  assert.deepEqual(judge(frameStats(fs1), 30).jumps, [{ t: 0.07, frames: 1 }]);
  const fs2 = [footage(0), footage(1), panel(2), panel(3), panel(4)];
  assert.deepEqual(judge(frameStats(fs2), 30).jumps, []);
});

test('single-frame layout change is a HARD SWAP unless it is a punch-in cut', () => {
  const a = footage(0), b = Uint8Array.from(a, (v) => 255 - v);
  const st = frameStats([a, a, b, b]);
  assert.deepEqual(judge(st, 30).swaps.map((s) => s.t), [0.07]);
  assert.deepEqual(judge(st, 30, [2 / 30]).swaps, []);
  assert.equal(renderOffset([1.533, 2.167], [1.333, 1.967], 30), 0.2);
});

// frozen copy of video-projects/gen-th-style2b at the gen_th_style2b final (the live project is resumed by later runs)
const proj = path.resolve(import.meta.dirname, 'fixtures/style2b'), final = RENDERS + '/gen_th_style2b.mp4';
test('gen_th_style2b final: 3 hard cuts to solid ink -> FAIL', { skip: !fs.existsSync(final) }, () => {
  const r = spawnSync('node', [path.resolve(import.meta.dirname, '../layout-jump.mjs'), proj, final], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const t = [...r.stdout.matchAll(/FAIL SOLID JUMP (\d+\.\d+) s/g)].map((m) => +m[1]);
  assert.equal(t.length, 3, r.stdout);
  for (const [i, want] of [4, 15, 24.5].entries()) assert.ok(Math.abs(t[i] - want) < 1, r.stdout);
});

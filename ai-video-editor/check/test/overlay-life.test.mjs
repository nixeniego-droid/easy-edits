// overlay-life: per-window card-pixel life on synthetic crops, plus the real gen_th_style2b final (static CULTURE /
// GUYS cards -> FAIL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { windowLife } from '../overlay-life.mjs';
// renders that some tests read (skipped when absent): <repo>/../renders, or AI_VIDEO_EDITOR_TEST_RENDERS
const RENDERS = process.env.AI_VIDEO_EDITOR_TEST_RENDERS || new URL('../../../renders', import.meta.url).pathname;

const card = (k) => Uint8Array.from({ length: 40 * 30 }, (_, i) => ((i % 40) + k < 20 ? 14 : 255)); // a bar edge drifting k px

test('frozen card -> life 0; a drifting bar keeps life in every window', () => {
  const still = Array.from({ length: 30 }, () => card(0)), moving = Array.from({ length: 30 }, (_, f) => card(Math.round(f / 5)));
  assert.ok(windowLife(still, 30).every((w) => w.life === 0));
  const m = windowLife(moving, 30);
  assert.equal(m.length, 2);
  assert.ok(m.every((w) => w.life >= 1), JSON.stringify(m));
});

// frozen copy of video-projects/gen-th-style2b at the gen_th_style2b final (the live project is resumed by later runs)
const proj = path.resolve(import.meta.dirname, 'fixtures/style2b'), final = RENDERS + '/gen_th_style2b.mp4';
test('gen_th_style2b final: static cards -> FAIL', { skip: !fs.existsSync(final) || !fs.existsSync(path.join(proj, 'index.html')) }, () => {
  const r = spawnSync('node', [path.resolve(import.meta.dirname, '../overlay-life.mjs'), proj, final], { encoding: 'utf8' });
  if (r.status === 2) return; // no browser on this machine
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL OVERLAY LIFE #c4-f "CULTURE"/);
  assert.match(r.stdout, /ok {3}OVERLAY LIFE #c6-f "STRONGER TIES"/);
});

// card-fill: tile coverage on synthetic RGBA, plus the real gen-th-style2b draft when present
// (FAR FROM HOME's thin dashed route -> FAIL, the gauge card RELATIONSHIPS / TOP PRIORITY -> ok).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tileShare, judgeFill } from '../card-fill.mjs';

const img = (w, h, paint) => { const d = new Uint8ClampedArray(w * h * 4).fill(255); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (paint(x, y)) { const i = 4 * (y * w + x); d[i] = d[i + 1] = d[i + 2] = 14; } return d; };

test('blank card 0, solid half 50%, thin line under the bar', () => {
  assert.equal(tileShare(img(128, 128, () => false), 128, 128, [255, 255, 255]), 0);
  assert.equal(tileShare(img(128, 128, (x, y) => y < 64), 128, 128, [255, 255, 255]), 0.5);
  assert.ok(tileShare(img(128, 128, (x, y) => y % 32 === 5 && x % 20 < 10), 128, 128, [255, 255, 255]) < 0.3);
});

test('judgeFill flags under the minimum', () => {
  const r = judgeFill([{ id: 'a', t: 1, fill: 0.19 }, { id: 'b', t: 2, fill: 0.38 }], 30);
  assert.deepEqual(r.map((c) => [c.pct, c.ok]), [[19, false], [38, true]]);
});

// frozen copy of video-projects/gen-th-style2b at the gen_th_style2b final (the live project is resumed by later runs)
const proj = path.resolve(import.meta.dirname, 'fixtures/style2b');
test('gen-th-style2b: FAR FROM HOME fails, gauge card passes', { skip: !fs.existsSync(path.join(proj, 'index.html')) }, () => {
  const r = spawnSync('node', [path.resolve(import.meta.dirname, '../card-fill.mjs'), proj], { encoding: 'utf8' });
  if (r.status === 2) return;
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL CARD FILL .*"FAR FROM HOME"/);
  assert.match(r.stdout, /ok {3}CARD FILL .*"RELATIONSHIPS"/);
});

// panel-contrast: WCAG ratio of white / yellow panel text vs its local background ring. Synthetic frames (72% ink
// over dark vs bright footage); the real gen_th_style2d final (skipped when absent): 22 panel texts, all >= 4.5:1.
//   node --test easy-edits/check/test/panel-contrast.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ratio, textContrast } from '../panel-contrast.mjs';

// w x h frame of bg with a text-coloured glyph block at [40, 40, 40, 20]
const frame = (bg, fg, w = 120, h = 100) => {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = x >= 40 && x < 80 && y >= 40 && y < 60 && (x % 4 < 2) ? fg : bg; data.set(c, 3 * (y * w + x)); }
  return { w, h, data };
};
const mix = (a, f, o) => f.map((v, k) => Math.round(v * o + a[k] * (1 - o)));
const INK = [14, 17, 22], WHITE = [255, 255, 255], YEL = [255, 214, 10];

test('WCAG ratio: white/black 21, white/yellow 1.41', () => {
  assert.equal(+ratio(WHITE, [0, 0, 0]).toFixed(1), 21);
  assert.equal(+ratio(WHITE, YEL).toFixed(2), 1.41);
});

// a flat white sky under 72% ink still measures 5.5:1 for yellow; a FAIL needs less ink where the text sits (the
// panel's soft top edge / slide-in, 50% here). The fix is the local 85% gradient, not a heavier panel.
test('72% ink over dark footage passes; yellow over a white sky at 50% ink FAILs; a local 85% gradient fixes it', () => {
  const dark = mix([90, 80, 70], INK, 0.72), sky = mix([250, 250, 250], INK, 0.5), fix = mix([250, 250, 250], INK, 0.85);
  assert.ok(textContrast(frame(dark, WHITE), [40, 40, 40, 20], WHITE).ratio >= 4.5);
  assert.ok(textContrast(frame(mix([250, 250, 250], INK, 0.72), YEL), [40, 40, 40, 20], YEL).ratio >= 4.5);
  const bad = textContrast(frame(sky, YEL), [40, 40, 40, 20], YEL);
  assert.ok(bad.ratio < 4.5, `sky ${bad.ratio}`);
  assert.ok(textContrast(frame(fix, YEL), [40, 40, 40, 20], YEL).ratio >= 4.5);
});

test('a neighbouring white word is text, not background', () => {
  const f = frame(mix([90, 80, 70], INK, 0.72), YEL);
  for (let y = 40; y < 60; y++) for (let x = 82; x < 100; x++) f.data.set(WHITE, 3 * (y * f.w + x));
  assert.ok(textContrast(f, [40, 40, 40, 20], YEL).ratio >= 4.5);
});

test('gen_th_style2d final: every panel text >= 4.5:1', { timeout: 300000 }, (t) => {
  const repo = path.resolve(import.meta.dirname, '../../..'), proj = path.join(repo, 'video-projects/gen-th-style2c'), final = path.resolve(repo, '../renders/gen_th_style2d.mp4');
  if (!fs.existsSync(final) || !fs.existsSync(path.join(proj, 'index.html'))) return t.skip('style2d final not present');
  const r = spawnSync('node', [path.resolve(import.meta.dirname, '../panel-contrast.mjs'), proj, final], { encoding: 'utf8' });
  if (r.status === 2) return t.skip(r.stderr);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /panel-contrast: PASS 0 of \d+ panel text/);
});

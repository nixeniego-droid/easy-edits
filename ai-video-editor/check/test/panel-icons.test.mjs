// panel-icons: icon glyphs inside an ink panel are >= 100 px, their row centred (<= 5% of the panel width) and above
// the word. Synthetic frames, a real gen_th_style2d frame (14.61 s, "we've got / AMERICANS": three 82-92 px pins at
// the panel's left, row 26% off centre) and the CLI on the real final (skipped when absent).
//   node --test ai-video-editor/check/test/panel-icons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { panelIcons, iconFaults } from '../panel-icons.mjs';
import { frameAt } from '../frame-measure.mjs';

const INK = [40, 42, 46], WHITE = [255, 255, 255];
const frame = (w = 1080, h = 1000) => { const data = new Uint8Array(w * h * 3); for (let i = 0; i < w * h; i++) data.set(INK, 3 * i); return { w, h, data }; };
const box = (f, [x, y, w, h], c = WHITE) => { for (let v = y; v < y + h; v++) for (let u = x; u < x + w; u++) f.data.set(c, 3 * (v * f.w + u)); };
const PANEL = [0, 0, 1080, 1000];

test('a centred 120 px icon above the word passes; head + body merge into one icon', () => {
  const f = frame(); box(f, [480, 100, 120, 50]); box(f, [480, 160, 120, 70]);
  const icons = panelIcons(f, PANEL);
  assert.equal(icons.length, 1); assert.ok(icons[0].size >= 120, JSON.stringify(icons));
  assert.deepEqual(iconFaults(icons, PANEL, [[300, 400, 480, 120]]), []);
});

test('a tiny icon in the top-left corner FAILs on size and centring; masked text is not an icon', () => {
  const f = frame(); box(f, [60, 60, 40, 40]); box(f, [300, 400, 480, 120]);
  const icons = panelIcons(f, PANEL, [[300, 400, 480, 120]]);
  assert.equal(icons.length, 1);
  const faults = iconFaults(icons, PANEL, [[300, 400, 480, 120]]);
  assert.ok(faults.some((x) => /< 100/.test(x)) && faults.some((x) => /off its centre/.test(x)), faults.join('\n'));
});

test('an icon below the word FAILs', () => {
  const f = frame(); box(f, [480, 600, 120, 120]);
  assert.ok(iconFaults(panelIcons(f, PANEL), PANEL, [[300, 400, 480, 120]]).some((x) => /below the panel word/.test(x)));
});

const repo = path.resolve(import.meta.dirname, '../../..'), proj = path.join(repo, 'video-projects/gen-th-style2c'), final = path.resolve(repo, '../renders/gen_th_style2d.mp4');

test('real style2d frame 14.61 s: the AMERICANS panel pins are tiny and off-centre', (t) => {
  if (!fs.existsSync(final)) return t.skip('style2d final not present');
  // #p2 box (DOM, 1080 x 1920): x 0, y 900, 1080 x 1020; caption / kinetic line (y 1338-1432) masked
  const icons = panelIcons(frameAt(final, 14.61), [0, 900, 1080, 1020], [[100, 1330, 880, 110]]);
  assert.ok(icons.length >= 1 && icons.every((i) => i.size < 100 && i.x + i.w < 540), JSON.stringify(icons));
  const faults = iconFaults(icons, [0, 900, 1080, 1020]);
  assert.ok(faults.some((x) => /off its centre/.test(x)), faults.join('\n'));
});

test('gen_th_style2d final: panel-icons FAILs #p2', { timeout: 300000 }, (t) => {
  if (!fs.existsSync(final) || !fs.existsSync(path.join(proj, 'index.html'))) return t.skip('style2d final not present');
  const r = spawnSync('node', [path.resolve(import.meta.dirname, '../panel-icons.mjs'), proj, final, '--lead', '0.21'], { encoding: 'utf8' });
  if (r.status === 2) return t.skip(r.stderr);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL PANEL ICONS #p2 at 14\.\d+ s: icon row centre \d+ px is -2\d\.\d% /);
  assert.match(r.stdout, /panel-icons: FAIL/);
});

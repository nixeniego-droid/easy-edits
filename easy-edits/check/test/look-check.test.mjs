// look-check: light full frames, white flashes, settled UI card width / corner, caption on its own color (pure
// checkLook on gen-th-style2b-shaped samples), plus the real gen-th-style2b draft when present (bright idea cards and
// 390 px cards = 36% -> FAIL under the reviewer's ink scenes + 55-65% cards).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkLook, fillLum } from '../look-check.mjs';

const it = (id, cls, x, y, w, h, color, image = '', lw = w, extra = {}) => ({ id, cls, x, y, w, h, lw, op: 1, sw: 1, color, image, text: '', ...extra });
const none = { light: [], opaque: [], flash: [], cards: [], corner: [], capbg: [] };

test('luminance: ink is dark, white / #F2F4F7 bright, low-alpha gradients fall back to the color', () => {
  assert.ok(fillLum('rgb(14, 17, 22)') < 0.01);
  assert.ok(fillLum('rgb(242, 244, 247)') > 0.85);
  assert.equal(fillLum('rgba(14, 17, 22, 0.3)'), null);
  assert.ok(fillLum('rgb(14, 17, 22)', 'linear-gradient(rgba(255, 255, 255, 0.06) 2px, rgba(0, 0, 0, 0) 2px)') < 0.01);
});

test('light full frame, 36% card and top-corner card fail; 80% ink panel and settled 60% lower-middle card pass', () => {
  const bad = checkLook([{ t: 6, videoFull: true, bg: 'rgb(14, 17, 22)', items: [it('i1', ['clip', 'idea'], 0, 0, 1080, 1920, 'rgb(242, 244, 247)'),
    it('c2', ['card'], 345, 1000, 390, 300, 'rgb(255, 255, 255)'), it('c3', ['card'], 400, 100, 650, 300, 'rgb(255, 255, 255)')] }]);
  assert.deepEqual(bad.light.map((d) => d.id), ['i1']);
  assert.deepEqual(bad.cards.map((c) => c.id), ['c2']);
  assert.deepEqual(bad.corner.map((c) => c.id), ['c3']);
  const ok = checkLook([{ t: 6, videoFull: true, bg: 'rgb(14, 17, 22)', items: [it('i1', ['clip', 'scene'], 0, 0, 1080, 1920, 'rgba(14, 17, 22, 0.8)'),
    it('c1', ['card'], 210, 1000, 648, 360, 'rgb(255, 255, 255)'), it('back', ['card-back'], 222, 1012, 300, 100, 'rgb(255, 255, 255)'),
    it('dim', ['scrim'], 0, 1500, 1080, 420, 'rgb(0, 0, 0)')] }]);
  assert.deepEqual(ok, none);
});

test('card width is measured settled only: mid-tween (scale 0.6 / opacity 0.5) is skipped', () => {
  const r = checkLook([{ t: 1, videoFull: true, bg: 'rgb(14, 17, 22)', items: [it('c1', ['card'], 300, 1000, 389, 216, 'rgb(255, 255, 255)', '', 648, { sw: 0.6 }),
    it('c2', ['card'], 210, 1000, 300, 360, 'rgb(255, 255, 255)', '', 300, { op: 0.5 })] }]);
  assert.deepEqual(r, none);
});

test('fully opaque full frame fails in any color; an 80% ink panel over the footage passes', () => {
  const ink = (id, color, op = 1) => ({ ...it(id, ['clip', 'scene'], 0, 0, 1080, 1920, color), op });
  assert.deepEqual(checkLook([{ t: 4, videoFull: true, bg: 'rgb(14, 17, 22)', items: [ink('s', 'rgb(14, 17, 22)')] }]).opaque.map((d) => d.id), ['s']);
  assert.deepEqual(checkLook([{ t: 4, videoFull: true, bg: 'rgb(14, 17, 22)', items: [ink('p', 'rgba(14, 17, 22, 0.8)'), ink('q', 'rgb(14, 17, 22)', 0.8)] }]).opaque, []);
});

test('white flash: no full video or scene over a light page background, one hit per run', () => {
  const gap = (t) => ({ t, videoFull: false, bg: 'rgb(255, 255, 255)', items: [] });
  const r = checkLook([gap(1), gap(1.25), { t: 1.5, videoFull: true, bg: 'rgb(255, 255, 255)', items: [] }, gap(2)]);
  assert.deepEqual(r.flash.map((f) => f.t), [1, 2]);
  assert.deepEqual(checkLook([{ t: 1, videoFull: false, bg: 'rgb(14, 17, 22)', items: [] }]).flash, []);
});

test('caption whose text color equals its local background fails (white on white); on ink or footage passes', () => {
  const cap = (id, x, y) => it(id, ['cap', 'clip'], x, y, 400, 110, 'rgba(0, 0, 0, 0)', '', 400, { text: 'rgb(255, 255, 255)' });
  const r = checkLook([{ t: 3, videoFull: true, bg: 'rgb(14, 17, 22)', items: [it('pill', ['pill'], 300, 1480, 500, 150, 'rgb(250, 250, 250)'), cap('k1', 340, 1500),
    it('ink', ['scene'], 0, 0, 1080, 1000, 'rgb(14, 17, 22)'), cap('k2', 340, 200), cap('k3', 340, 1700)] }]);
  assert.deepEqual(r.capbg.map((c) => c.id), ['k1']);
});

// frozen copy of video-projects/gen-th-style2b (index.html, plan, dom-sample cache) at the gen_th_style2b final
const S2 = path.resolve(import.meta.dirname, 'fixtures/style2b');
test('gen-th-style2b FAILS: 3 fully opaque ink slates (i1 / i2 / i3)', { skip: !fs.existsSync(path.join(S2, 'index.html')) && 'gen-th-style2b absent' }, () => {
  const r = spawnSync('node', [new URL('../look-check.mjs', import.meta.url).pathname, S2, '--step', '0.5'], { encoding: 'utf8' });
  if (r.status === 2) return; // no browser on this machine
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /OPAQUE FRAME 3\.50 s #i1 /);
  assert.match(r.stdout, /3 opaque full frame\(s\)/);
});

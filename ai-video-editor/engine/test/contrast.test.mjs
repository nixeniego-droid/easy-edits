// node --test ai-video-editor/engine/test/contrast.test.mjs: caption auto contrast (engine/contrast.mjs) and its use in compose
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { hexRgb, relLum, contrastRatio, rgba, pickInk, regionStats, blendBackdrop, isBusy, lumaGrid, INK } from '../contrast.mjs';
import { compose } from '../compose.mjs';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** a synthetic grid: top half grey `top`, bottom half grey `bottom`, n frames at 2 fps of 1080x1920 */
const grid = (top, bottom, { n = 20, w = 16, h = 28 } = {}) => {
  const data = Buffer.alloc(n * w * h);
  for (let f = 0; f < n; f++) for (let y = 0; y < h; y++) data.fill(y < h / 2 ? top : bottom, f * w * h + y * w, f * w * h + (y + 1) * w);
  return { fps: 2, w, h, n, srcW: 1080, srcH: 1920, data };
};

test('colour maths: hex parsing, WCAG luminance and contrast ratios', () => {
  assert.deepEqual(hexRgb('#FF8000'), [255, 128, 0]);
  assert.throws(() => hexRgb('red'), /not a #RRGGBB colour/);
  assert.equal(relLum('#000000'), 0);
  assert.equal(relLum('#FFFFFF'), 1);
  assert.equal(Math.round(contrastRatio('#FFFFFF', '#000000')), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.equal(contrastRatio(1, 0), contrastRatio('#FFFFFF', '#000000')); // luminances work too
  assert.equal(rgba('#00E5FF', 0.5), 'rgba(0,229,255,0.5)');
});

test('pickInk: white on dark and mid footage, dark text only on clearly bright footage, null keeps the previous ink', () => {
  const L = (g) => relLum([g, g, g]);
  assert.equal(pickInk(L(10)), 'light');
  assert.equal(pickInk(L(120)), 'light'); // mid grey: white stays (the house look)
  assert.equal(pickInk(L(235)), 'dark'); // a white wall / sky
  assert.equal(pickInk(L(255)), 'dark');
  assert.equal(pickInk(null), 'light');
  assert.equal(pickInk(null, { prev: 'dark' }), 'dark');
  // the switch point sits between grey 140 and 200
  const sw = Array.from({ length: 256 }, (_, g) => pickInk(L(g))).indexOf('dark');
  assert.ok(sw > 140 && sw < 200, `switch at grey ${sw}`);
});

test('pickInk: hysteresis keeps neighbouring captions on one ink near the threshold', () => {
  const L = (g) => relLum([g, g, g]);
  const sw = Array.from({ length: 256 }, (_, g) => pickInk(L(g))).indexOf('dark');
  // just past the switch: a fresh caption goes dark, but one after a light caption stays light
  assert.equal(pickInk(L(sw + 1)), 'dark');
  assert.equal(pickInk(L(sw + 1), { prev: 'light' }), 'light');
  // just under it: a fresh caption is light, one after a dark caption stays dark
  assert.equal(pickInk(L(sw - 2)), 'light');
  assert.equal(pickInk(L(sw - 2), { prev: 'dark' }), 'dark');
  // far from the threshold the previous ink doesn't matter
  assert.equal(pickInk(L(250), { prev: 'light' }), 'dark');
  assert.equal(pickInk(L(30), { prev: 'dark' }), 'light');
});

test('regionStats: mean luminance and spread under a source rect over a time window', () => {
  const g = grid(250, 10);
  const top = regionStats(g, 0, 2, { x: 0, y: 0, w: 1080, h: 900 });
  const bot = regionStats(g, 0, 2, { x: 0, y: 1100, w: 1080, h: 700 });
  assert.ok(top.lum > 0.9 && top.std === 0, JSON.stringify(top));
  assert.ok(bot.lum < 0.01, JSON.stringify(bot));
  const both = regionStats(g, 0, 2, { x: 0, y: 0, w: 1080, h: 1920 });
  assert.ok(both.std > 100 && isBusy(both), JSON.stringify(both));
  assert.equal(isBusy(top), false);
  assert.equal(regionStats(g, 0, 1, { x: 2000, y: 0, w: 100, h: 100 }), null); // outside the frame
  assert.equal(regionStats(null, 0, 1, { x: 0, y: 0, w: 10, h: 10 }), null);
  // a window past the end reads the last frame instead of failing
  assert.ok(regionStats(g, 50, 60, { x: 0, y: 0, w: 1080, h: 900 }).lum > 0.9);
});

test('blendBackdrop: the part of a caption off the picture counts as the backdrop colour', () => {
  const st = { lum: 1, mean: 255, std: 40, cover: 1 };
  assert.equal(blendBackdrop(st, '#000000', 0.25).lum, 0.25);
  assert.equal(blendBackdrop(st, '#000000', 0.25).std, 10);
  assert.equal(blendBackdrop(null, '#FFFFFF', 0).lum, 1);
});

const W = (s, t0 = 0, step = 0.4) => s.split(' ').map((text, i) => ({ text, start: +(t0 + i * step).toFixed(3), end: +(t0 + i * step + step * 0.9).toFixed(3) }));
const words = W('We tested this on a bright white wall and the captions still read well every time we tried it again and again');
const track = { samples: Array.from({ length: 40 }, (_, i) => ({ t: i * 0.25, cx: 540, cy: 500, box: [440, 400, 200, 200], seen: true })) };
const clip = { src: 'assets/clip.mp4', w: 1080, h: 1920, duration: 10 };

test('compose: auto contrast flips the caption ink on bright footage and keeps white on dark footage', () => {
  const bright = compose({ fmt: '9x16', clip, track, words, plan: { beats: [] }, captions: 'minimal', luma: grid(245, 245) });
  assert.ok(bright.captions.length > 3);
  assert.ok(bright.captions.every((c) => c.ink === 'dark'), JSON.stringify(bright.captions.map((c) => c.ink)));
  assert.ok(bright.ink.dark > 0 && bright.ink.light === 0);
  assert.match(bright.html, /class="cap clip min ink-dark/);
  const dark = compose({ fmt: '9x16', clip, track, words, plan: { beats: [] }, captions: 'minimal', luma: grid(20, 20) });
  assert.ok(dark.captions.every((c) => c.ink === 'light'));
  assert.ok(dark.captions.every((c) => c.bgLum < 0.05));
  // bright top, dark bottom: the lower-band captions sit on the dark half
  const split = compose({ fmt: '9x16', clip, track, words, plan: { beats: [] }, captions: 'minimal', luma: grid(250, 15) });
  assert.ok(split.captions.every((c) => c.ink === 'light'));
  // no luma grid: unknown background, white (the old behaviour)
  const none = compose({ fmt: '9x16', clip, track, words, plan: { beats: [] }, captions: 'minimal' });
  assert.ok(none.captions.every((c) => c.ink === 'light' && c.bgLum === null));
});

test('compose: --caption-color fixes the ink (white / black / #RRGGBB) whatever the footage', () => {
  const g = grid(245, 245);
  const w = compose({ fmt: '9x16', clip, track, words, plan: { beats: [] }, captions: 'minimal', luma: g, ink: 'light' });
  assert.ok(w.captions.every((c) => c.ink === 'light'));
  const b = compose({ fmt: '9x16', clip, track, words, plan: { beats: [] }, captions: 'minimal', luma: grid(10, 10), ink: 'dark' });
  assert.ok(b.captions.every((c) => c.ink === 'dark'));
  const hex = compose({ fmt: '9x16', clip, track, words, plan: { beats: [] }, captions: 'kinetic', luma: g, ink: '#FFD400' });
  assert.ok(hex.captions.every((c) => c.fill === '#FFD400' && c.ink === 'light'));
  assert.match(hex.html, /color:#FFD400/);
});

test('compose: a busy background gets the heavier edge', () => {
  const c = compose({ fmt: '9x16', clip, track, words, plan: { beats: [] }, captions: 'minimal', luma: (() => {
    const g = grid(0, 0); for (let i = 0; i < g.data.length; i++) g.data[i] = (i * 7919) % 2 ? 250 : 5; return g; })() });
  assert.ok(c.captions.some((x) => x.busy));
  assert.match(c.html, /ink-(light|dark) busy/);
});

test('lumaGrid: decodes a real clip to a cached greyscale grid (white top, black bottom)', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-luma-'));
  try {
    const f = path.join(dir, 'c.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=360x640:d=2:r=10', '-vf', 'drawbox=x=0:y=320:w=360:h=320:color=black:t=fill', '-pix_fmt', 'yuv420p', f]);
    const g = lumaGrid(f, path.join(dir, 'c.luma'));
    assert.equal(g.w, 64); assert.equal(g.srcW, 360); assert.equal(g.srcH, 640);
    assert.ok(g.n >= 3 && g.n <= 5, `frames ${g.n}`);
    assert.ok(regionStats(g, 0, 1.5, { x: 0, y: 0, w: 360, h: 280 }).lum > 0.85);
    assert.ok(regionStats(g, 0, 1.5, { x: 0, y: 360, w: 360, h: 280 }).lum < 0.02);
    const m = fs.statSync(path.join(dir, 'c.luma')).mtimeMs;
    lumaGrid(f, path.join(dir, 'c.luma')); // cached: not rewritten
    assert.equal(fs.statSync(path.join(dir, 'c.luma')).mtimeMs, m);
    assert.equal(pickInk(regionStats(g, 0, 1, { x: 0, y: 0, w: 360, h: 280 }).lum), 'dark');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('INK: the two text colours are far apart', () => {
  assert.ok(contrastRatio(INK.light, INK.dark) > 15);
});

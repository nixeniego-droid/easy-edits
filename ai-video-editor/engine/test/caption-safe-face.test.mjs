// node --test ai-video-editor/engine/test/caption-safe-face.test.mjs: captions sit in a stable safe zone clear of the face
import test from 'node:test';
import assert from 'node:assert/strict';
import { compose, geometry, pickCaptionY, captionKeepOut } from '../compose.mjs';

const W = (s, t0 = 0, step = 0.4) => s.split(' ').map((text, i) => ({ text, start: +(t0 + i * step).toFixed(3), end: +(t0 + i * step + step * 0.9).toFixed(3) }));
const words = W('Last year was the sixth warmest year on record which is slightly down from the warmest year on record that we had the year before and the trend keeps going up every single decade');
const clip = { src: 'assets/clip.mp4', w: 1080, h: 1920, duration: 16 };
// a tight crop: the face fills most of the frame width and wobbles a few px
const tight = (fw = 640, wob = 6) => ({ samples: Array.from({ length: 70 }, (_, i) => {
  const cx = 540 + wob * Math.sin(i), cy = 700 + wob * Math.cos(i * 0.7);
  return { t: i * 0.25, cx, cy, box: [cx - fw / 2, cy - fw / 2, fw, fw], seen: true };
}) });
const hit = (a, b) => a.x < b.x1 && b.x0 < a.x + a.w && a.y < b.y1 && b.y0 < a.y + a.h;

test('compose: on a tight 9:16 face no caption touches the face keep-out (forehead to chin)', () => {
  for (const captions of ['minimal', 'kinetic']) for (const fw of [520, 640, 760, 900]) {
    const c = compose({ fmt: '9x16', clip, track: tight(fw), words, plan: { beats: [] }, captions });
    assert.ok(c.captions.length > 3);
    assert.deepEqual(c.overlaps.filter((x) => x.with === 'face'), [], `${captions} fw ${fw}`);
    for (const cap of c.captions) {
      assert.ok(cap.face, 'the face is reported');
      // the report's face rect, grown by the chin and a margin: still clear
      const f = cap.face, ko = { x0: f.x, x1: f.x + f.w, y0: f.y - 20, y1: f.y + f.h + f.w * 0.1 + 20 };
      assert.ok(!hit(cap.rect, ko), `${captions} fw ${fw} "${cap.text}" y ${cap.y} rect ${JSON.stringify(cap.rect)} face ${JSON.stringify(f)}`);
      assert.ok(cap.rect.y >= 0 && cap.rect.y + cap.rect.h <= geometry('9x16').h);
    }
  }
});

test('compose: captions keep one side and one height while the face moves a little', () => {
  const c = compose({ fmt: '9x16', clip, track: tight(640, 10), words, plan: { beats: [] }, captions: 'kinetic' });
  const sides = new Set(c.captions.map((x) => (x.y > x.face.y + x.face.h ? 'below' : 'above')));
  assert.equal(sides.size, 1, JSON.stringify(c.captions.map((x) => x.y)));
  const ys = c.captions.map((x) => x.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) <= 2, `jitter: ${ys}`);
});

test('pickCaptionY: picks the clear side, stays there, flips only when it must', () => {
  const G = geometry('9x16'), ch = 100, base = { want: G.capY, ch, top: G.safeTop, bottom: G.capBottom, floor: G.capFloor, lo: G.capMinY, hi: G.capMaxY };
  // no face: the default band, as before
  assert.deepEqual(pickCaptionY({ ...base, ko: null }), { y: G.capY, side: null });
  // a large face low in the frame: the default y would sit on the chin, so the caption drops just under it
  const ko = captionKeepOut([{ cx: 540, cy: 760, fw: 600 }], G.w);
  const a = pickCaptionY({ ...base, ko });
  assert.equal(a.side, 'below');
  assert.ok(a.y - ch / 2 >= ko.y1 && a.y + ch / 2 <= G.capBottom, JSON.stringify({ a, ko }));
  // no room under the chin: above the forehead, under the top bar
  const hiFace = captionKeepOut([{ cx: 540, cy: 1150, fw: 600 }], G.w);
  const b = pickCaptionY({ ...base, ko: hiFace });
  assert.equal(b.side, 'above');
  assert.ok(b.y + ch / 2 <= hiFace.y0 && b.y - ch / 2 >= G.safeTop);
  // sticky: once above, a face where both sides fit keeps the caption above (fresh, it would go below)
  const both = captionKeepOut([{ cx: 540, cy: 900, fw: 560 }], G.w);
  assert.equal(pickCaptionY({ ...base, ko: both }).side, 'below');
  const c = pickCaptionY({ ...base, ko: both, prev: b });
  assert.equal(c.side, 'above');
  assert.ok(c.y + ch / 2 <= both.y0);
  // a face that drifts 8 px keeps the exact y on either side (no per-caption jitter)
  const up = captionKeepOut([{ cx: 540, cy: 1142, fw: 600 }], G.w);
  assert.deepEqual(pickCaptionY({ ...base, ko: up, prev: b }), b);
  // ... and a small wobble on the below side keeps the exact y (no per-caption jitter)
  const wob = captionKeepOut([{ cx: 540, cy: 752, fw: 600 }], G.w);
  assert.deepEqual(pickCaptionY({ ...base, ko: wob, prev: a }), a);
  // the held side no longer fits: it flips
  const d = pickCaptionY({ ...base, ko: hiFace, prev: a });
  assert.equal(d.side, 'above');
  // a face filling the frame (chin past the platform-safe bottom): under the chin, down to the floor
  const huge = captionKeepOut([{ cx: 540, cy: 840, fw: 916 }], G.w);
  const e = pickCaptionY({ ...base, ch: 156, ko: huge });
  assert.equal(e.side, 'below');
  assert.ok(e.y - 78 >= huge.y1 && e.y + 78 <= G.capFloor, JSON.stringify({ e, huge }));
  // a sequence of wobbling faces: one side all the way
  let prev = null; const seen = new Set();
  for (let i = 0; i < 30; i++) { prev = pickCaptionY({ ...base, ko: captionKeepOut([{ cx: 540, cy: 900 + 8 * Math.sin(i), fw: 560 }], G.w), prev }); seen.add(prev.side); }
  assert.equal(seen.size, 1);
});

test('captionKeepOut: the union of the samples, with forehead, chin and margin; null without a face', () => {
  assert.equal(captionKeepOut([null, { cx: 1 }], 1080), null);
  const k = captionKeepOut([{ cx: 500, cy: 700, fw: 400 }, { cx: 520, cy: 720, fw: 400 }], 1080);
  assert.ok(k.x0 < 300 && k.x1 > 720 && k.y0 < 700 - 300 && k.y1 > 720 + 340, JSON.stringify(k));
});

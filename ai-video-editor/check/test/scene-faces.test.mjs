// caption-face-final per scene: the speaker face is re-found at every scene / layout change (plan.json scene starts +
// #spkwrap punch sets); a held box never crosses the boundary and each scene has its own median head zone.
// Faces: gen_th_style2g final (renders/gen_th_style2g.raw.mp4, lead 0), Haar `both` at 15 fps, final 2.4-7.0 s frozen
// in fixtures/style2g-layout.faces.json: punch s02 (face ~530 px at y ~350) -> top-box s03 3.876 s (scale 0.8 about
// 540 4048: face ~400 px at y ~1100-1500, the seam caption y 758-871 above his head) -> idea s04 5.784 s.
//   node --test ai-video-editor/check/test/scene-faces.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkFinalFaces, punchAt } from '../caption-face-final.mjs';
import { planBounds } from '../lib/cutaways.mjs';

const fx = JSON.parse(fs.readFileSync(new URL('fixtures/style2g-layout.faces.json', import.meta.url), 'utf8'));
const from = 2.4, frames = fx.frames.map((f) => ({ ...f, t: +(f.t - from).toFixed(3) }));
const punch = punchAt(`tl.set('#spkwrap',{x:0,y:0,scale:1,transformOrigin:'540px 640px'},1.077);
tl.set('#spkwrap',{x:0,y:0,scale:1.2,transformOrigin:'540px 640px'},3.043);
tl.set('#spkwrap',{x:0,y:0,scale:0.8,transformOrigin:'540px 4048px'},3.876);
tl.set('#spkwrap',{x:0,y:0,scale:1,transformOrigin:'540px 640px'},5.784);`);
const bounds = [...planBounds({ scenes: [{ start: 3.043 }, { start: 3.876 }, { start: 5.784 }, { start: 3.043 }] }), ...punch.times];
const cap = (a, b, text, y0, y1, x0 = 86, x1 = 994) => (t) => (t >= a && t < b ? [{ id: text, text, kind: 'cap', box: { x0, y0, x1, y1 } }] : []);
const run = (textAt, opt = {}) => checkFinalFaces({ textAt, frames, from, H: 1920, punch, bounds, ...opt });

test('plan bounds: unique sorted scene starts; punch exposes its set times', () => {
  assert.deepEqual(planBounds({ scenes: [{ start: 2 }, { start: 1 }, { start: 2 }, { start: 'x' }] }), [1, 2]);
  assert.deepEqual(punch.times, [1.077, 3.043, 3.876, 5.784]);
});

test('(a) seam caption above the head after the top-box change PASSes; the held pre-split face no longer flags it', () => {
  const seam = cap(3.9, 5.75, 'TO OUR GROUP', 758, 871);
  assert.deepEqual(run(seam).bad, []);
  // without the boundary the punch-s02 face (y ~350-960) is held into s03 and the seam caption reads as on the face
  assert.ok(run(seam, { bounds: [] }).bad.some((b) => b.held), 'old behaviour: held face carried across');
});

test('(a) caption over the speaker\'s face right after the layout change (the new scene\'s face) FAILs', () => {
  const r = run(cap(3.95, 4.6, 'ON HIS FACE', 1200, 1310));
  assert.ok(r.bad.length && r.bad.every((b) => b.cap === 'ON HIS FACE'), JSON.stringify(r.bad));
  assert.ok(r.bad.some((b) => !b.zone && b.t < 4.1), 'first detection inside s03 is used at once');
  // the s03 head zone is the top-box face, not the full-frame one: just above his cap (y ~1000) fails as head zone
  assert.ok(run(cap(4.0, 5.7, 'ON HIS CAP', 960, 1040)).bad.some((b) => b.zone));
});

test('(b) no-detection stretch inside a speaker scene keeps the scene head zone: a caption there FAILs', () => {
  // s03 4.67-4.93 s: Haar finds nothing; caption only over that stretch, on the last known (s03 median) head zone
  const r = run(cap(4.6, 5.0, 'NO HAAR', 1150, 1250));
  assert.ok(r.bad.some((b) => b.zone && b.t >= 4.6 && !b.cutaway), JSON.stringify(r.bad));
  // no face-derived cutaway: the idea scene s04 (no detections 5.87-6.27 s) stays a speaker scene
  assert.deepEqual(run(cap(5.8, 6.3, 'X', 0, 10)).cutaways, []);
});

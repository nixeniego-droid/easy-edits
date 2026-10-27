// caption-face-final: Haar faces from the real final frames of gen_talk_v5 (0:01-0:14) and gen_nasa2_v3
// (0:03-0:07) against their dom-sample caption boxes (fixtures/*.faces.json). Both renders put captions
// inside face + 35% chin + 4% margin, so both FAIL; the same captions moved to the bottom of the frame pass.
//   node --test ai-video-editor/check/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkFinalFaces, keepOut } from '../caption-face-final.mjs';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`fixtures/${n}.faces.json`, import.meta.url), 'utf8'));

test('keep-out adds 35% chin and a 4% frame margin', () => {
  assert.deepEqual(keepOut([100, 200, 400, 400], 1000), { x0: 60, x1: 540, y0: 160, y1: 780 });
});

for (const [name, want] of [['talk_v5', ['REALLY A', 'TO THE', 'PART OF']], ['nasa2_v3', ['RESEARCHER IN', 'THE HYDROLOGY', 'LAB AT', 'HERE AT', 'GODDARD SPACE', 'LIGHT CENTER', 'AND']]]) {
  test(`${name} final: captions over face+chin fail`, () => {
    const f = fx(name), r = checkFinalFaces(f);
    assert.ok(r.faced > 0.5 * r.frames, `${r.faced}/${r.frames} frames with a face`);
    assert.deepEqual(r.bad.map((b) => b.cap), want);
  });
  test(`${name} final: same captions at the bottom of the frame pass`, () => {
    const f = fx(name), caps = f.caps.map((c) => ({ ...c, box: { ...c.box, y0: 1700, y1: 1810 } }));
    assert.deepEqual(checkFinalFaces({ ...f, caps }).bad, []);
  });
}

// gen-th-style1 final (renders/gen_th_style1.mp4, lead 0.207 s): Haar frontal + profile on every frame at 15 fps
// (fixtures/style1.faces.json) and the dom-sample cap + kinetic boxes (fixtures/style1.textboxes.json). The old
// logic (cap runs only, settled union box, frames without a stable face skipped) caught only "IS REALLY"; Haar
// misses the face on 62/397 frames, all in the punch-ins (5.3-5.8, 19.1-20.7, 22.2-22.9 s).
test('gen-th-style1 final: kinetic words + held faces over the punch-ins fail', async () => {
  const { textBoxesAt } = await import('../caption-face-final.mjs');
  const frames = fx('style1'), sample = JSON.parse(fs.readFileSync(new URL('fixtures/style1.textboxes.json', import.meta.url), 'utf8'));
  const caps = [];
  assert.deepEqual(checkFinalFaces({ caps, frames, lead: 0.207, hold: false }).bad, []);
  const r = checkFinalFaces({ textAt: textBoxesAt(sample), frames, lead: 0.207 });
  const got = r.bad.map((b) => `${b.kind} ${b.cap}${b.held ? ' held' : ''}`);
  for (const w of ['kinetic BUILDING', 'kinetic IMPORTANCE', 'cap IS REALLY', 'kinetic RELATIONSHIP held', 'kinetic GREATER held']) assert.ok(got.includes(w), `${w} in ${got}`);
  // "BECAUSE WE'RE" (y 1398-1503, on the chest at 5.4 s) was only hit by a hold interpolated from the lower-left
  // hand boxes (5.13-5.27 s, 88 px, bottom 25%), which the size / bottom filter now rejects.
  assert.ok(!got.includes("cap BECAUSE WE'RE held"), got.join());
  assert.equal(r.held, 71);
  const side = (s) => textBoxesAt(sample)(s).map((b) => ({ ...b, box: { x0: 0, x1: 40, y0: 0, y1: 40 } }));
  assert.deepEqual(checkFinalFaces({ textAt: side, frames, lead: 0.207 }).bad, []);
});

// gen-th-style2 final (renders/gen_th_style2.raw.mp4): Haar at 15 fps from 0 s, as the check runs it
// (fixtures/style2.faces.json). Both flags of that build were held faces pulled toward lower-left / bottom boxes:
//   7.73 s "AND WE GET" (y 1449-1549): held from a 178 px box at x 90 y 1568 on the uniform chest
//     (fixtures/style2-chest-7.93.png);
//   2.20 s "REALLY A" (y 1450-1551): interpolated between the real 660 px face (keep-out ends y 1200) and a 92 px
//     box at x 162 y 1790; the real frame shows the caption on the chest, ~250 px below the chin.
// Both are rejected (size < 0.5 x prep face 188 x 2.673 = 503 px, centre in the bottom 25%). A caption moved up
// into the real chin zone still fails.
const s2 = JSON.parse(fs.readFileSync(new URL('fixtures/style2.faces.json', import.meta.url), 'utf8'));
const span = (a, b, text, y0, y1, x0, x1) => (t) => (t >= a && t < b ? [{ id: text, text, kind: 'cap', box: { x0, y0, x1, y1 } }] : []);

test('gen-th-style2 final: chest / bottom boxes rejected; a caption in the real chin zone still fails', async () => {
  const { prepFaceW } = await import('../caption-face-final.mjs');
  const refW = prepFaceW({ scenes: [{ face: { box: [712, 145, 188, 188] }, cover1080x1920: { scale: 2.673 } }] });
  assert.ok(Math.abs(refW - 502.5) < 1);
  for (const opt of [{ refW }, {}]) {
    const tag = JSON.stringify(opt);
    assert.deepEqual(checkFinalFaces({ textAt: span(1.9, 2.6, 'REALLY A', 1450, 1551, 287, 793), frames: s2.graze.frames, H: 1920, ...opt }).bad, [], tag);
    assert.deepEqual(checkFinalFaces({ textAt: span(7.4, 8.0, 'AND WE GET', 1449, 1549, 205, 875), frames: s2.chest.frames, H: 1920, ...opt }).bad, [], tag);
    const up = checkFinalFaces({ textAt: span(1.9, 2.6, 'REALLY A', 1150, 1250, 287, 793), frames: s2.graze.frames, H: 1920, ...opt });
    assert.deepEqual(up.bad.map((b) => b.cap), ['REALLY A'], tag);
  }
});

test('filter rules: small, bottom-25% and jumping boxes are not faces; a normal face is', async () => {
  const { trackedFaces } = await import('../caption-face-final.mjs');
  const fr = (boxes) => boxes.map((b, i) => ({ t: i / 15, faces: [b] }));
  const face = [300, 400, 480, 480];
  assert.ok(trackedFaces(fr([face, face, face]), 1080, { refW: 500 }).every(Boolean));
  assert.ok(trackedFaces(fr([[300, 400, 200, 200], [300, 400, 200, 200]]), 1080, { refW: 500 }).every((b) => !b), 'small');
  assert.ok(trackedFaces(fr([[300, 1500, 480, 480], [300, 1500, 480, 480]]), 1080, { refW: 500 }).every((b) => !b), 'bottom');
  const j = trackedFaces(fr([face, face, [620, 400, 480, 480], [620, 400, 480, 480]]), 1080, { refW: 500 });
  assert.ok(j[1] && !j[2], 'jump > 0.6 face width');
});

const hasCv = spawnSync('python3', ['-c', 'import cv2']).status === 0;
test('real frame png: Haar finds the chest box, the filter drops it', { skip: (!hasCv && 'no OpenCV') || (!fs.existsSync(new URL('fixtures/style2-chest-7.93.png', import.meta.url).pathname) && 'frame fixture not shipped (crops of test footage not licensed for redistribution)') }, async () => {
  const { haarFrames, trackedFaces } = await import('../caption-face-final.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-cff-')), v = path.join(dir, 'f.mp4');
  // fixtures/style2-chest-7.93.png = crop 540x540+0+1380 of the style2 final at 7.93 s, padded back in place
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', new URL('fixtures/style2-chest-7.93.png', import.meta.url).pathname,
    '-t', '0.4', '-r', '15', '-vf', 'pad=1080:1920:0:1380:black,format=yuv420p', '-c:v', 'libx264', v], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const frames = haarFrames(v, 0, 0, 15);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(frames.some((f) => f.faces.some((b) => b[0] < 300 && b[1] > 1440)), JSON.stringify(frames[0]));
  assert.ok(trackedFaces(frames, 1080, { H: 1920, refW: 503 }).every((b) => !b));
});

// Fixed head zone on the gen_th_style2b final (fixtures/style2b.final-faces.json: Haar faces of
// renders/gen_th_style2b.mp4 at 15 fps; the frozen style2b dom-sample + index.html punch transform). The per-frame
// keep-out starts at the brows, so "WITH OUR GUYS" (11.4-12.2 s, y 200-305) and "NOT" / "ONLY" (20.6-21.2 s,
// y 85-215) on the cap passed; the median head zone FAILs them. Without the punch transform the zone is off.
import { punchAt, textBoxesAt } from '../caption-face-final.mjs';
import { fileURLToPath } from 'node:url';
import { projectSamples } from '../../tools/dom-sample.mjs';
test('gen_th_style2b final: captions / kinetic on the cap at 11-13 s and 20-22 s FAIL the fixed head zone', async () => {
  const P = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/style2b');
  const { frames } = JSON.parse(fs.readFileSync(path.join(P, '../style2b.final-faces.json'), 'utf8'));
  const punch = punchAt(fs.readFileSync(path.join(P, 'index.html'), 'utf8'));
  assert.equal(punch(12).s, 1.12); assert.equal(punch(9.5).s < 1.03, true);
  const textAt = textBoxesAt(await projectSamples(P));
  const without = checkFinalFaces({ textAt, frames, lead: 0.218, W: 1080, H: 1920 });
  assert.ok(!without.bad.some((b) => b.t > 11 && b.t < 13.4 || b.t > 20 && b.t < 22.4), 'the per-frame boxes alone missed them');
  const r = checkFinalFaces({ textAt, frames, lead: 0.218, W: 1080, H: 1920, punch });
  const zone = r.bad.filter((b) => b.zone);
  for (const b of zone) console.log(`  FAIL OVER HEAD ZONE ${b.t.toFixed(2)} s ${b.kind} "${b.cap}" y ${b.box.y0}-${b.box.y1}`);
  for (const [text, a, b] of [['WITH OUR GUYS', 11, 13], ['NOT', 20, 22], ['ONLY', 20, 22]]) assert.ok(zone.some((z) => z.cap === text && z.t >= a && z.t <= b), text);
  // lower captions (chest band y 1440-1560) stay clear of the head zone
  assert.ok(!zone.some((z) => z.box.y0 > 1400), JSON.stringify(zone.filter((z) => z.box.y0 > 1400)));
});

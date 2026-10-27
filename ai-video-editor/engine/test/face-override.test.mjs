// node --test ai-video-editor/engine/test/face-override.test.mjs: --face (engine/face-override.mjs) and its CLI wiring
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFace, applyFaceTrack, applyFacePrep, FACE_PRESETS } from '../face-override.mjs';
import { compose } from '../compose.mjs';
import { parseArgs } from '../../cli/main.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '../face-override.mjs');

test('parseFace: presets, X,Y fractions, clear errors', () => {
  assert.deepEqual(parseFace('top'), { ...FACE_PRESETS.top, label: 'top' });
  assert.deepEqual(parseFace('CENTER'), { x: 0.5, y: 0.42, label: 'center' });
  assert.deepEqual(parseFace('centre'), { x: 0.5, y: 0.42, label: 'center' });
  assert.deepEqual(parseFace('bottom'), { x: 0.5, y: 0.62, label: 'bottom' });
  assert.deepEqual(parseFace('0.3,0.4'), { x: 0.3, y: 0.4, label: '0.3,0.4' });
  assert.deepEqual(parseFace(' 0.25 , 0.6 '), { x: 0.25, y: 0.6, label: '0.25,0.6' });
  assert.ok(FACE_PRESETS.top.y < FACE_PRESETS.center.y && FACE_PRESETS.center.y < FACE_PRESETS.bottom.y);
  assert.throws(() => parseFace('left'), /--face "left" not understood: --face takes top, center, bottom or X,Y/);
  assert.throws(() => parseFace('540,300'), /between 0 and 1 \(fractions of the frame width and height, not pixels\)/);
  assert.throws(() => parseFace('-0.1,0.5'), /between 0 and 1/);
  assert.throws(() => parseFace(''), /--face takes/);
  assert.throws(() => parseFace(true), /--face takes/);
});

test('applyFaceTrack: every sample on the point, detected face size kept, an empty track filled', () => {
  const track = { width: 1920, height: 1080, duration: 3, samples: [
    { t: 0, cx: 1500, cy: 200, box: [1450, 150, 100, 100], seen: true }, { t: 1, cx: 1500, cy: 200, box: [1440, 140, 120, 120], seen: true },
    { t: 2, seen: false }] };
  const f = applyFaceTrack(track, parseFace('0.25,0.5'));
  assert.equal(f.samples.length, 3);
  for (const s of f.samples) { assert.equal(s.cx, 480); assert.equal(s.cy, 540); assert.equal(s.seen, true); assert.equal(s.override, true); assert.equal(s.box[2], 120); }
  assert.equal(f.coverage, 1); assert.equal(f.faceOverride, '0.25,0.5');
  assert.equal(track.samples[0].cx, 1500); // input untouched
  const e = applyFaceTrack({ samples: [], duration: 4.2 }, parseFace('top'), { width: 1000, height: 1000 });
  assert.equal(e.samples.length, 5);
  assert.equal(e.samples[0].box[2], 180); // 18% of the short side
  assert.equal(applyFaceTrack(track, null), track);
  assert.throws(() => applyFaceTrack({ samples: [] }, parseFace('top')), /no frame size/);
});

const prep = () => ({ source: { width: 1920, height: 1080 }, scenes: [
  { i: 0, start: 0, end: 5, kind: 'speaker', face: { box: [1600, 100, 160, 160] }, crop: { x: 1312, y: 0, w: 608, h: 1080 } },
  { i: 1, start: 5, end: 9, kind: 'speaker', face: { box: [100, 100, 150, 150] }, crop: { x: 0, y: 0, w: 608, h: 1080 } }] });

test('applyFacePrep: every scene crop and cover transform centre on the point (clean-cut 9:16)', () => {
  const p = applyFacePrep(prep(), parseFace('0.5,0.4'));
  assert.equal(p.faceOverride, '0.5,0.4');
  for (const s of p.scenes) {
    assert.deepEqual(s.crop, { x: 656, y: 0, w: 608, h: 1080 });
    assert.equal(s.cover1080x1920.scale, Math.round((1080 / 608) * 1000) / 1000);
    assert.equal(s.cover1080x1920.x, Math.round(-656 * (1080 / 608) * 100) / 100);
    assert.equal(s.face.pick, 'override');
    assert.equal(s.face.box[0] + s.face.box[2] / 2, 960);
  }
  // near the edge: the crop is clamped inside the frame
  assert.equal(applyFacePrep(prep(), parseFace('0.99,0.5')).scenes[0].crop.x, 1920 - 608);
  assert.equal(applyFacePrep(prep(), parseFace('0,0.5')).scenes[0].crop.x, 0);
  assert.throws(() => applyFacePrep({ scenes: [] }, parseFace('top')), /no width \/ height/);
});

test('face-override.mjs prep CLI (clean-cut.sh): writes the overridden prep, exit 2 on a bad spec', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-face-'));
  try {
    const i = path.join(dir, 'p.json'), o = path.join(dir, 'p.face.json');
    fs.writeFileSync(i, JSON.stringify(prep()));
    const r = spawnSync(process.execPath, [CLI, 'prep', i, o, 'top'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /2 scene\(s\) on --face top/);
    assert.equal(JSON.parse(fs.readFileSync(o, 'utf8')).faceOverride, 'top');
    const bad = spawnSync(process.execPath, [CLI, 'prep', i, o, '3,4'], { encoding: 'utf8' });
    assert.equal(bad.status, 2); assert.match(bad.stderr, /between 0 and 1/);
    assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('clean-cut.sh passes the overridden prep to the build and the face gates', () => {
  const sh = fs.readFileSync(path.join(HERE, '../../bin/clean-cut.sh'), 'utf8');
  assert.match(sh, /PREPJ="\$PREP\/source-prep\.face\.json"/);
  assert.match(sh, /face-override\.mjs" prep "\$PREP\/source-prep\.json" "\$PREPJ" "\$AI_VIDEO_EDITOR_FACE"/);
  for (const re of [/build\.mjs" "\$PROJ" --source "\$SRC" --prep "\$PREPJ"/, /caption-face\.mjs" "\$PROJ" --prep "\$PREPJ"/, /finalface-split\.sh.*--prep "\$PREPJ"/]) assert.match(sh, re);
});

test('compose: the framing follows an overridden face (top vs bottom of a landscape clip in 9:16)', () => {
  const words = 'one two three four five six seven eight'.split(' ').map((text, k) => ({ text, start: k * 0.5, end: k * 0.5 + 0.4 }));
  const base = { samples: Array.from({ length: 20 }, (_, i) => ({ t: i * 0.25, cx: 960, cy: 540, box: [880, 460, 160, 160], seen: true })) };
  const clip = { src: 'assets/clip.mp4', w: 1920, h: 1080, duration: 5 };
  const x = (face) => {
    const c = compose({ fmt: '9x16', clip, track: applyFaceTrack(base, parseFace(face), { width: 1920, height: 1080 }), words, plan: { beats: [] }, captions: 'minimal' });
    return Number(/tl\.set\('#spk',\{x:(-?[\d.]+)/.exec(c.html)[1]);
  };
  // face on the left of the frame: the 9:16 window moves left (less negative x) than for a face on the right
  assert.ok(x('0.2,0.4') > x('0.8,0.4'), `${x('0.2,0.4')} vs ${x('0.8,0.4')}`);
});

test('CLI: --face and --caption-color parse, with clear errors', () => {
  const a = parseArgs(['captions', 'x.mp4', '-o', 'o', '--face', 'top', '--caption-color', 'black']);
  assert.deepEqual(a.face, { x: 0.5, y: 0.28, label: 'top' });
  assert.equal(a.ink, 'dark');
  assert.equal(parseArgs(['captions', 'x.mp4', '-o', 'o', '--caption-color', 'white']).ink, 'light');
  assert.equal(parseArgs(['captions', 'x.mp4', '-o', 'o', '--caption-color', 'auto']).ink, 'auto');
  assert.equal(parseArgs(['captions', 'x.mp4', '-o', 'o', '--caption-color', '#ffd400']).ink, '#FFD400');
  assert.equal(parseArgs(['captions', 'x.mp4', '-o', 'o', '--face', '0.3,0.4']).face.label, '0.3,0.4');
  assert.throws(() => parseArgs(['captions', 'x.mp4', '-o', 'o', '--face', 'up']), /not understood/);
  assert.throws(() => parseArgs(['captions', 'x.mp4', '-o', 'o', '--caption-color', 'pink']), /use auto, white, black or a #RRGGBB/);
  assert.throws(() => parseArgs(['x.mp4', '-o', 'o', '--caption-color', 'black']), /clean-cut 9:16 keeps the approved white captions/);
  assert.equal(parseArgs(['x.mp4', '-o', 'o', '--face', 'bottom']).face.label, 'bottom'); // clean-cut takes --face
});

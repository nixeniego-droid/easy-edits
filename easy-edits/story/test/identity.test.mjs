// node --test easy-edits/story/test/identity.test.mjs: story identity drift ignores the reference's backdrop.
// Fixtures are drawn with ffmpeg (no photos of people): a "character" (dark cap, skin-tone face, yellow coat) on a grey
// studio backdrop as the reference; the same figure, smaller and relit, in a dark warm scene; the same scene with the
// figure in a blue coat; and an unrelated test pattern.
// EASY_EDITS_DRIFT_SAMPLE=<dir> also scores a real story output folder (assets/*.mp4 of the character shots, the
// reference image as ref.jpg/ref.png in that folder): every character shot must stay under the face limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.EASY_EDITS_BACKEND = 'mock';
const { identityDrift, imageDistance, colourHist, colourMissing, qaShot, QA_LIMITS } = await import('../qa.mjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-identity-test-'));
const ffmpeg = (args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
// the figure at scale s (a medium shot in the scene: the character fills about a third of the frame), top-left (x, y): cap, face, coat
const figure = (x, y, s, coat) => [
  `drawbox=x=${x + 30 * s}:y=${y}:w=${60 * s}:h=${22 * s}:color=0x2A2A2E:t=fill`,
  `drawbox=x=${x + 32 * s}:y=${y + 22 * s}:w=${56 * s}:h=${60 * s}:color=0xC89878:t=fill`,
  `drawbox=x=${x + 38 * s}:y=${y + 60 * s}:w=${44 * s}:h=${22 * s}:color=0xE8E8E0:t=fill`,
  `drawbox=x=${x}:y=${y + 82 * s}:w=${120 * s}:h=${130 * s}:color=${coat}:t=fill`,
].join(',');
const REF = path.join(TMP, 'ref.png');
ffmpeg(['-f', 'lavfi', '-i', 'color=c=0xA9A9A9:s=640x360', '-vf', figure(260, 40, 1.5, '0xE0B020'), '-frames:v', '1', REF]);
const scene = (coat, out, extra = '') => ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x3A2A1E:s=270x480:r=10',
  '-vf', `drawbox=x=0:y=0:w=270:h=150:color=0x6A4A2A:t=fill,drawbox=x=20:y=300:w=230:h=12:color=0x1A1A1A:t=fill,${figure(39, 120, 1.6, coat)}${extra},format=yuv420p`, '-t', '2', out]);
const SAME = path.join(TMP, 'same.mp4'), BLUE = path.join(TMP, 'blue.mp4'), OTHER = path.join(TMP, 'other.mp4');
scene('0xE0B020', SAME, ',hue=h=8');            // the character, warmer light, a dark scene behind
scene('0x2050C0', BLUE);                         // same scene and figure, a blue coat
ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=270x480:r=10', '-t', '2', '-pix_fmt', 'yuv420p', OTHER]);

test('identity drift: same figure on a new background passes, a recoloured figure and an unrelated clip fail', () => {
  process.env.EASY_EDITS_IDENTITY = 'colour';
  try {
    const same = identityDrift(SAME, 2, [REF]), blue = identityDrift(BLUE, 2, [REF]), other = identityDrift(OTHER, 2, [REF]);
    assert.equal(same.method, 'colour');
    assert.ok(same.score < QA_LIMITS.driftColour, `same ${JSON.stringify(same)}`);
    assert.ok(blue.score > QA_LIMITS.driftColour, `blue ${JSON.stringify(blue)}`);
    assert.ok(other.score > QA_LIMITS.driftColour, `other ${JSON.stringify(other)}`);
    assert.ok(blue.score - same.score > 0.3, 'a clear margin between the same and the recoloured figure');
  } finally { delete process.env.EASY_EDITS_IDENTITY; }
});

test('identity drift: the old whole-frame score could not tell these apart (the backdrop dominated it)', () => {
  const px = (file, t) => spawnSync('ffmpeg', ['-v', 'error', ...(t != null ? ['-ss', String(t)] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=32:32:force_original_aspect_ratio=increase,crop=32:32,format=rgb24', '-f', 'rawvideo', '-']).stdout;
  const old = (f) => { const d = imageDistance(px(f, 1), px(REF)); return 0.7 * d.hist + 0.3 * d.hash; };
  assert.ok(old(SAME) > QA_LIMITS.drift, `the right character scored ${old(SAME).toFixed(3)} on the whole frame`);
  assert.ok(Math.abs(old(SAME) - old(BLUE)) < 0.15, 'whole-frame scores barely move with the coat colour');
});

test('colourMissing: the frame background costs nothing, missing character colours do', () => {
  const img = (cols) => { const w = 64, h = 64, px = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) px.set(cols(i % w, Math.floor(i / w)), i * 3); return { px, w, h }; };
  const ref = colourHist(img((x, y) => (x > 20 && x < 44 && y > 16 && y < 56 ? [224, 176, 32] : [169, 169, 169])), { foreground: true });
  assert.ok(ref[ref.findIndex((v) => v > 0.9)] > 0.9, 'the grey backdrop is left out of the reference');
  const inScene = colourHist(img((x, y) => (x >= 12 && x < 52 && y >= 8 && y < 56 ? [224, 176, 32] : [40, 60, 160])));
  const without = colourHist(img(() => [40, 60, 160]));
  assert.ok(colourMissing(ref, inScene) < 0.1);
  assert.equal(colourMissing(ref, without), 1);
});

test('qaShot: the drift reason names the method and its limit', () => {
  process.env.EASY_EDITS_IDENTITY = 'colour';
  try {
    const raw = { source: 'video', requestedSec: 2, rawDuration: 2, fallbacks: [] };
    const ok = qaShot({ shot: { id: 'a', characters: ['Keeper'], durationSec: 2 }, raw, file: SAME, len: 2, start: 0, refs: [REF] });
    assert.ok(!ok.weak.some((w) => w.check === 'drift'), JSON.stringify(ok.weak));
    assert.equal(ok.metrics.identity.method, 'colour');
    const bad = qaShot({ shot: { id: 'b', characters: ['Keeper'], durationSec: 2 }, raw, file: BLUE, len: 2, start: 2, refs: [REF] });
    const w = bad.weak.find((x) => x.check === 'drift');
    assert.ok(w, JSON.stringify(bad.weak));
    assert.match(w.reason, /identity drift .* of Keeper \(limit 0\.5, colour only, no face found\)/);
  } finally { delete process.env.EASY_EDITS_IDENTITY; }
});

test('identity drift: with OpenCV installed, frames without a face fall back to colour (and say so)', (t) => {
  const d = identityDrift(SAME, 2, [REF]);
  assert.equal(d.method, 'colour');   // drawn boxes have no face, so never "face"
  if (!d.note) return t.skip('OpenCV / the YuNet model is not installed: the face path did not run');
  assert.match(d.note, /no face in the reference/);
});

const SAMPLE = process.env.EASY_EDITS_DRIFT_SAMPLE;
test('identity drift on a real story sample (EASY_EDITS_DRIFT_SAMPLE)', { skip: !SAMPLE && 'EASY_EDITS_DRIFT_SAMPLE not set' }, () => {
  const ref = ['ref.jpg', 'ref.png'].map((f) => path.join(SAMPLE, f)).find((f) => fs.existsSync(f));
  assert.ok(ref, 'put the reference image in the sample folder as ref.jpg or ref.png');
  const rep = JSON.parse(fs.readFileSync(path.join(SAMPLE, fs.readdirSync(SAMPLE).find((f) => /^easy-edits_story_.*\.report\.json$/.test(f))), 'utf8'));
  const assets = fs.readdirSync(path.join(SAMPLE, 'assets'));
  for (const s of rep.shots.filter((x) => x.characters.length)) {
    const clip = assets.find((f) => f.startsWith(`${s.id}-`) && f.endsWith('.mp4'));
    const d = identityDrift(path.join(SAMPLE, 'assets', clip), s.durationSec, [ref]);
    assert.equal(d.method, 'face', `${s.id}: ${JSON.stringify(d)}`);
    assert.ok(d.score < QA_LIMITS.drift, `${s.id}: ${JSON.stringify(d)}`);
  }
});

// source-prep on a synthetic landscape clip (always) and on raw-media/porter_30s.mp4 (skipped when absent).
//   node --test ai-video-editor/tools/test/*.test.mjs   (needs ffmpeg; OpenCV in python3 or $AI_VIDEO_EDITOR_PYTHON for the porter case)
// synthetic: 2 s card (white box on black), hard cut to 4 s of moving testsrc2 on the right half
//   -> 2 scenes, a 9:16 crop inside the frame, saliency focus on the moving right half (faces forced off)
// porter: 1080x1920 speaker -> head slate 0-0.133 s, one speaker scene, crop = whole frame, face box present
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '../source-prep.mjs');
const PORTER = path.join(HERE, '../../../raw-media/porter_30s.mp4');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-source-prep-test-'));

function prep(src, out, env = {}) {
  const r = spawnSync('node', [TOOL, src, out], { encoding: 'utf8', env: { ...process.env, AI_VIDEO_EDITOR_CUTCAND: '0', AI_VIDEO_EDITOR_CUTCAND_CACHE: path.join(tmp, 'cutcand-cache'), ...env } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(fs.readFileSync(path.join(out, 'source-prep.json'), 'utf8'));
}

test('synthetic cut: two scenes, saliency crop on the moving half', () => {
  const src = path.join(tmp, 'synth.mp4');
  const fc = 'color=black:s=1280x720:r=30:d=2,drawbox=x=440:y=300:w=400:h=120:color=white:t=fill[a];'
    + 'color=gray:s=1280x720:r=30:d=4[bg];testsrc2=s=640x720:r=30:d=4[m];[bg][m]overlay=x=640[b];[a][b]concat=n=2:v=1:a=0[v]';
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-filter_complex', fc, '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', src], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = prep(src, path.join(tmp, 'synth'), { AI_VIDEO_EDITOR_PREP_FACES: '0' });
  assert.equal(j.source.width, 1280); assert.equal(j.source.orientation, 'landscape');
  assert.equal(j.scenes.length, 2, JSON.stringify(j.scenes.map((s) => [s.start, s.end])));
  assert.ok(Math.abs(j.scenes[1].start - 2) < 0.1, `cut at ${j.scenes[1].start}`);
  assert.match(j.faceDetector, /^none/);
  const c = j.scenes[1].crop;
  assert.equal(c.w, 404); assert.ok(c.x >= 640 - 60 && c.x + c.w <= 1280, `crop x ${c.x}`);
  assert.equal(j.scenes[1].cover1080x1920.x, Math.round(-c.x * 1080 / 404 * 100) / 100);
  assert.ok(fs.statSync(j.sheet).size > 1000);
});

test('porter: head slate, one speaker scene, full-frame crop', { skip: !fs.existsSync(PORTER) && 'raw-media/porter_30s.mp4 absent' }, () => {
  const j = prep(PORTER, path.join(tmp, 'porter'));
  if (j.faceDetector.startsWith('none')) return; // no OpenCV on this machine: the kind checks below need faces
  assert.deepEqual(j.head.titleCard?.map((t) => Math.round(t * 10) / 10), [0, 0.1]);
  const sp = j.scenes.filter((s) => s.kind === 'speaker');
  assert.equal(sp.length, 1); assert.ok(sp[0].dur > 29);
  assert.deepEqual([sp[0].crop.x, sp[0].crop.w], [0, 1080]);
  assert.ok(sp[0].face.box[2] > 300);
  assert.ok(j.seconds < 15, `${j.seconds} s`);
});

test('cut candidates run by default (tmp cache, never ~/.cache), AI_VIDEO_EDITOR_CUTCAND=0 skips', async () => {
  const src = path.join(tmp, 'synth.mp4'), cache = path.join(tmp, 'cutcand-hit');
  const { cachePath } = await import('../cut-candidates.mjs');
  process.env.AI_VIDEO_EDITOR_CUTCAND_CACHE = cache;
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(cachePath(src), JSON.stringify({ candidates: [], cuts: [{ start: 1, end: 1.2, because: ['a a'] }] }));
  const j = prep(src, path.join(tmp, 'cc-on'), { AI_VIDEO_EDITOR_PREP_FACES: '0', AI_VIDEO_EDITOR_CUTCAND: '', AI_VIDEO_EDITOR_CUTCAND_CACHE: cache });
  assert.equal(j.cutCandidates.status, 'ok'); assert.equal(j.cutCandidates.cache, 'hit');
  const k = prep(src, path.join(tmp, 'cc-off'), { AI_VIDEO_EDITOR_PREP_FACES: '0', AI_VIDEO_EDITOR_CUTCAND_CACHE: cache });
  assert.equal(k.cutCandidates.status, 'skipped');
});

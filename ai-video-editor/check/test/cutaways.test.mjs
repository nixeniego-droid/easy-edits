// cutaway-aware fault checks (lib/cutaways.mjs): caption-face-final checks every face detected in a cutaway frame
// instead of the speaker head zone; grade-continuity skips cutaway in / out boundaries.
// Faces: gen_th_style2f final (renders/gen_th_style2f.raw.mp4), Haar `both` at 15 fps, frames 12.6-18.6 s, frozen in
// fixtures/style2f-cutaway.faces.json (b-roll s09 14.176-17.343 s: the uniformed man ~110 px at y ~645-780, the kids
// at y ~1155-1300; fixtures/style2f-cutaway-15.20.png is the frame at 15.20 s, 540x960). Speaker face ~530 px at y ~400.
//   node --test ai-video-editor/check/test/cutaways.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkFinalFaces } from '../caption-face-final.mjs';
import { planCutaways, sideOf } from '../lib/cutaways.mjs';
import { frames as gframes, sideStats, judge, markCutaways } from '../grade-continuity.mjs';

const fx = JSON.parse(fs.readFileSync(new URL('fixtures/style2f-cutaway.faces.json', import.meta.url), 'utf8'));
const lead = 0.033, from = 12.6, frames = fx.frames.map((f) => ({ ...f, t: +(f.t - from).toFixed(3) }));
const plan = { scenes: [{ id: 's08', start: 12.356, end: 14.176, layout: 'face' }, { id: 's09', start: 14.176, end: 17.343, layout: 'broll' }, { id: 's10', start: 17.343, end: 19.03, layout: 'face' }] };
const cutaways = planCutaways(plan), punch = () => ({ s: 1, ox: 540, oy: 960 });
const cap = (a, b, text, y0, y1, x0 = 100, x1 = 980) => (t) => (t >= a && t < b ? [{ id: text, text, kind: 'cap', box: { x0, y0, x1, y1 } }] : []);
const run = (textAt) => checkFinalFaces({ textAt, frames, lead, from, H: 1920, punch, cutaways });

test('plan cutaways: broll / cutaway / footage layouts, type or kind', () => {
  assert.deepEqual(cutaways.map((s) => [s.start, s.end]), [[14.176, 17.343]]);
  assert.equal(planCutaways({ scenes: [{ start: 1, end: 2, type: 'Cutaway' }, { start: 2, end: 3, kind: 'footage' }, { start: 4, end: 5, layout: 'face' }] }).length, 1);
  assert.deepEqual(sideOf(cutaways, 14.176), { before: false, after: true });
});

test('(a) cutaway caption over a detected face (the man, y ~650) FAILs', () => {
  const r = run(cap(15.0, 15.6, 'OVER THE MAN', 640, 740, 380, 900));
  assert.deepEqual(r.bad.map((b) => [b.cap, !!b.cutaway]), [['OVER THE MAN', true]]);
  assert.ok(r.cut > 40, `${r.cut} cutaway frames`);
  assert.ok(run(cap(15.0, 15.6, 'OVER THE KIDS', 1200, 1300, 300, 900)).bad.length === 1);
});

test('(b) cutaway caption clear of the faces, over the speaker\'s old head zone (trees, y 250-345), PASSes', () => {
  const t = cap(14.2, 17.3, "AND WE'VE GOT", 250, 345, 50, 1030);
  assert.deepEqual(run(t).bad, []);
  // the same caption on the speaker frames after the cut is over his head zone and fails
  assert.ok(run(cap(17.6, 18.5, "AND WE'VE GOT", 250, 345, 50, 1030)).bad.some((b) => b.zone));
});

test('(c) speaker scene caption over the face still FAILs; a held speaker box is not carried into the cutaway', () => {
  const r = run(cap(12.7, 14.0, 'ON HIS FACE', 600, 700));
  assert.ok(r.bad.length && r.bad.every((b) => b.cap === 'ON HIS FACE' && !b.cutaway), JSON.stringify(r.bad));
  assert.ok(r.bad.some((b) => !b.zone), 'per-frame speaker face hit');
  const head = run(cap(17.6, 18.5, 'ON HIS CAP', 250, 330));
  assert.ok(head.bad.some((b) => b.zone), JSON.stringify(head.bad));
  // over the speaker's face position but in the cutaway, where no face is there (y 450-560 between trees and man)
  assert.deepEqual(run(cap(14.5, 17.0, 'MID', 520, 600, 600, 1000)).bad, []);
});

// grade: synthetic 3-clip videos (testsrc2 speaker; testsrc2 hue-rotated, flipped and darkened as the b-roll), joins at 1 s and 2 s
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-cut-'));
const clip = (name, parts) => {
  const f = path.join(tmp, name), ins = parts.flatMap((p) => ['-f', 'lavfi', '-i', `${p.src}=s=216x384:r=30:d=1`]);
  const fc = parts.map((p, i) => `[${i}:v]${[p.base, p.vf].filter(Boolean).join(',') || 'null'},setsar=1[v${i}]`).join(';') + ';' + parts.map((_, i) => `[v${i}]`).join('') + `concat=n=${parts.length}:v=1[v]`;
  spawnSync('ffmpeg', ['-v', 'error', '-y', ...ins, '-filter_complex', fc, '-map', '[v]', '-pix_fmt', 'yuv420p', f]);
  return f;
};
const regrade = 'eq=contrast=0.7:saturation=0.5:brightness=0.1,colorbalance=bs=0.15:rs=-0.08';
const at = (f, t) => judge(sideStats(gframes(f, t - 0.27, t - 0.07), gframes(f, t + 0.07, t + 0.27)));

test('(d) grade: regrade at speaker->speaker and cutaway->cutaway joins FAILs; cutaway in/out is skipped', () => {
  const spk = { src: 'testsrc2' }, bro = { src: 'testsrc2', base: 'hue=h=150:s=1.6,vflip,eq=brightness=-0.15' };
  const v = clip('v.mp4', [spk, { ...spk, vf: regrade }, bro]);
  const w = clip('w.mp4', [bro, { ...bro, vf: regrade }, spk]);
  const pv = planCutaways({ scenes: [{ id: 'b', start: 2, end: 3, layout: 'broll' }] }), pw = planCutaways({ scenes: [{ id: 'b', start: 0, end: 2, layout: 'cutaway' }] });
  const rows = (spans) => markCutaways([{ t: 1, why: 'keep' }, { t: 2, why: 'keep' }], spans);
  assert.deepEqual(rows(pv).map((r) => r.skip || 'judge'), ['judge', 'cutaway in/out']);
  assert.deepEqual(rows(pw).map((r) => r.skip || 'judge'), ['judge', 'cutaway in/out']);
  assert.equal(at(v, 1).verdict, 'FAIL', 'speaker -> speaker regrade');
  assert.equal(at(w, 1).verdict, 'FAIL', 'cutaway -> cutaway regrade');
  // the content change at the cutaway join would read as a jump if judged; it is skipped instead
  assert.notEqual(at(v, 2).verdict, 'ok');
});

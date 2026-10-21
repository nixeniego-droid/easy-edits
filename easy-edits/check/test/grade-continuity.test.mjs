// grade-continuity: a clip graded a second time (flat / hazy / cool: eq contrast down, saturation down, blue up)
// FAILs at its boundary; one grade over the whole clip passes. gen_th_style2b: the ~12.5 s change is not a grade
// jump. Its clip is graded once (scripts/build-edl.mjs: concat -> look grade in one pass; clip.mp4 luma steady
// 0.35-0.36 over 10.6-14.2 s). The final's change at 12.29 s is the #push punch-out plus the CULTURE card exit,
// -3.7% luma on the footage pixels, so style2b PASSes.
//   node --test easy-edits/check/test/grade-continuity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { frames, sideStats, judge, cameraAt, cardBoxes, alignCamera } from '../grade-continuity.mjs';
// renders that some tests read (skipped when absent): <repo>/../renders, or EASY_EDITS_TEST_RENDERS
const RENDERS = process.env.EASY_EDITS_TEST_RENDERS || new URL('../../../renders', import.meta.url).pathname;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-grade-'));
const make = (name, vf2) => {
  const f = path.join(tmp, name);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=216x384:r=30:d=2', '-filter_complex', `[0:v]split[a][b];[a]trim=0:1[x];[b]trim=1:2,setpts=PTS-STARTPTS,${vf2}[y];[x][y]concat=n=2:v=1[v]`, '-map', '[v]', '-pix_fmt', 'yuv420p', f]);
  return f;
};
const at = (f, t) => judge(sideStats(frames(f, t - 0.27, t - 0.07), frames(f, t + 0.07, t + 0.27)));
test('a second grade on the next clip (flat, desaturated, cool) FAILs; the same grade passes', () => {
  const twice = make('twice.mp4', 'eq=contrast=0.8:saturation=0.7:brightness=0.06,colorbalance=bs=0.12:rs=-0.06');
  const once = make('once.mp4', 'null');
  const r = at(twice, 1);
  assert.equal(r.verdict, 'FAIL', JSON.stringify(r));
  assert.ok(r.moved.includes('sat') && r.moved.includes('R-B'));
  assert.equal(at(once, 1).verdict, 'ok', JSON.stringify(at(once, 1)));
});
const proj = path.resolve(import.meta.dirname, 'fixtures/style2b'), final = RENDERS + '/gen_th_style2b.mp4';
test('gen_th_style2b final: no grade jump at the keep / camera boundaries (12.29 s push: -3.7% luma)', { skip: !fs.existsSync(final) }, () => {
  const r = spawnSync('node', [path.resolve(import.meta.dirname, '../grade-continuity.mjs'), proj, final], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok {3}12\.29 s \(camera #push,#push2\): luma -3\.7%/);
});
// gen_th_style2c 13.10 s (+0.21 s lead-in = final 13.31 s; 108x192 fixtures at the window centres, final 13.14 s /
// 13.48 s): the .push punch-out (camera 1.19 -> 1.17 from index.html) plus the #c3 card exit and the dark lower panel
// read raw as -28.3% luma, R-B -0.031 on the SAME grade (FAIL). Aligned to the tighter view with the card box masked
// only luma moves (-22.6%, content: WARN), so it is not a grade jump.
const png = (f) => spawnSync('ffmpeg', ['-v', 'error', '-i', path.resolve(import.meta.dirname, 'fixtures', f), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 }).stdout;
const NOFRAMES = !fs.existsSync(path.resolve(import.meta.dirname, 'fixtures', 'style2c-push-13.14.png')) && 'frame fixture not shipped (crops of test footage not licensed for redistribution)';
test('gen_th_style2c 13.10 s punch + card exit: content change, not a grade jump', { skip: NOFRAMES }, () => {
  const b = [png('style2c-push-13.14.png')], a = [png('style2c-push-13.48.png')];
  const raw = judge(sideStats(b, a));
  assert.equal(raw.verdict, 'FAIL', JSON.stringify(raw));
  const html = `<style>.push,.spkw{position:absolute;transform-origin:540px 1000px}</style><div id="c3" class="clip slot" data-start="11.8" data-duration="1.3" style="top:860px;left:400px"></div>
<script>tl.set('.spkw',{scale:1.15},11.8);tl.fromTo('.push',{scale:1},{scale:1.04,duration:1.3,ease:'power1.out',immediateRender:false},11.8);tl.to('.push',{scale:1,duration:.3,ease:'power1.inOut'},13.1);</script>`;
  const cam = cameraAt(html), { before, after, masks } = alignCamera(b, a, cam(12.93), cam(13.27), cardBoxes(html, 12.83, 13.37));
  const r = judge(sideStats(before, after, masks));
  assert.notEqual(r.verdict, 'FAIL', JSON.stringify(r));
  assert.deepEqual(r.moved, ['luma'], JSON.stringify(r));
});

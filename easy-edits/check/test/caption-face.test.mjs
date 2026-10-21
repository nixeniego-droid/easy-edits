// caption-face: speaker transform math and overlap on a synthetic composition (always), and the CLI on
// gen-talk-v3 (skipped when its gitignored project dir or prep is absent).
//   node --test easy-edits/check/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCaptions, readSpeaker, wrapAt, mediaToOut, checkCaptionFaces } from '../caption-face.mjs';
// renders that some tests read (skipped when absent): <repo>/../renders, or EASY_EDITS_TEST_RENDERS
const RENDERS = process.env.EASY_EDITS_TEST_RENDERS || new URL('../../../renders', import.meta.url).pathname;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VP = path.join(HERE, '../../../video-projects');

const html = (capTop) => `<style>#spkwrap{position:absolute;left:0;top:0;width:1080px;height:1920px}
#spk{position:absolute;left:-1612px;top:0px;width:3421.44px;height:1924.56px}
#caps{position:absolute;left:0;top:${capTop}px;width:1080px;height:0}
.cap{position:absolute;left:90px;width:900px;top:0}
.cap span{display:inline-block;font:900 100px/1.05 'Montserrat',sans-serif}</style>
<div id="spkwrap"><video id="spk" src="assets/clip.mp4" muted></video></div>
<div id="caps"><div id="cap0" class="cap clip" style="top:0px" data-start="1" data-duration="1" data-track-index="4"><span>HELLO</span></div>
<div id="cap1" class="cap clip" style="top:0px" data-start="5" data-duration="1" data-track-index="4"><span>THERE</span></div></div>
<script>tl.set('#spkwrap',{y:0,scale:1,transformOrigin:'540px 640px'},0);tl.set('#spkwrap',{y:0,scale:1.2,transformOrigin:'540px 640px'},4);tl.to('#spkwrap',{scale:1.3,duration:2,ease:'none'},4);</script>`;
// gen-talk-v3 source face (1280x720) and its cover transform
const face = { at: () => [712, 145, 188, 188] }, size = { w: 1280, h: 720 };

test('wrapAt: set then linear to', () => {
  const sp = readSpeaker(html(1290));
  assert.equal(wrapAt(sp, 1).scale, 1);
  assert.ok(Math.abs(wrapAt(sp, 5).scale - 1.25) < 1e-9);
  assert.deepEqual(wrapAt(sp, 5).origin, [540, 640]);
});

test('mediaToOut: cover crop puts the source face where the composition shows it', () => {
  const sp = readSpeaker(html(1290));
  const [x, y, w, h] = mediaToOut([712, 145, 188, 188], 1280, 720, sp, wrapAt(sp, 0));
  assert.ok(Math.abs(x - (-1612 + 712 * 2.673)) < 1 && Math.abs(y - 145 * 2.673) < 1 && Math.abs(w - 188 * 2.673) < 1 && h > 0);
});

test('captions on the chest pass, the same captions over the face fail', () => {
  let sp = readSpeaker(html(1290)), geo = readCaptions(html(1290));
  assert.equal(geo.font, 100);
  let r = checkCaptionFaces({ geo, sp, plan: null, face, size });
  assert.equal(r.bad.length, 0);
  geo = readCaptions(html(700));
  r = checkCaptionFaces({ geo, sp, plan: null, face, size });
  assert.deepEqual(r.bad.map((b) => b.cap), ['HELLO', 'THERE']);
  // a paper scene covers the speaker: not checked
  r = checkCaptionFaces({ geo, sp, plan: { scenes: [{ start: 0, end: 10, layout: 'paper' }] }, face, size });
  assert.equal(r.bad.length, 0);
});

const prep = RENDERS + '/gen_talk_v3.raw.run/prep/source-prep.json';
test('gen-talk-v3: PASS (captions on the jacket)', { skip: !(fs.existsSync(path.join(VP, 'gen-talk-v3/index.html')) && fs.existsSync(prep)) }, () => {
  const r = spawnSync('node', [path.join(HERE, '../caption-face.mjs'), path.join(VP, 'gen-talk-v3'), '--prep', prep], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS 41\/41/);
});

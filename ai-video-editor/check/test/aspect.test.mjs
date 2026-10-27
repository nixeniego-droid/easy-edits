// aspect: footage is scaled uniformly. Composition: GSAP scaleX != scaleY on the footage wrapper, a CSS scale(a,b) /
// skew, a mismatched video box (object-fit unset / fill) and a stretched prep clip FAIL; uniform scale, a matching
// box and object-fit cover PASS; the frozen style2i #spk / #spkwrap markup PASSes. Pixels (ffmpeg synthetic, frozen
// lavfi testsrc2): a 0.85 x 1.0 squeeze FAILs, a uniform 1.6 scale + crop PASSes, alone and through the CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseHtml, analyzeComposition, transformScales, pixelFits, judgeFit, toSource } from '../aspect.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname), CLI = path.join(HERE, '../aspect.mjs');
const A = 16 / 9, ASPECTS = { 'assets/clip.mp4': A };
const page = (css, js, video = '<video id="spk" src="assets/clip.mp4" muted data-start="0" data-duration="2" data-track-index="0"></video>') =>
  `<html><head><style>#spkwrap{position:absolute;width:1080px;height:1920px}${css}</style></head><body><div id="root"><div id="spkwrap">${video}</div></div>` +
  `<script>const tl=gsap.timeline({paused:true});${js}</script></body></html>`;
const issues = (html, src = A) => analyzeComposition(parseHtml(html), ASPECTS, src).elements.flatMap((e) => e.issues);

test('composition: frozen style2i markup (3422x1925 box, uniform #spkwrap scales) PASSes', () => {
  const html = page('#spk{position:absolute;left:-1612px;top:0;width:3422px;height:1925px}',
    "tl.set('#spkwrap',{x:0,y:0,scale:1.18,transformOrigin:'540px 640px'},0);tl.set('#spkwrap',{x:0,y:0,scale:0.8,transformOrigin:'540px 4048px'},3.876);" +
    "tl.set('#spkwrap',{x:1612,y:0,scale:1,transformOrigin:'540px 960px'},14.176);tl.to('#spkwrap',{scale:1.04,duration:3.167,ease:'none'},14.176);" +
    "tl.fromTo('#rails',{opacity:0,scaleX:0,transformOrigin:'0% 50%'},{opacity:1,scaleX:1,duration:0.3},18.867);");
  assert.deepEqual(issues(html), []);
});

test('composition: GSAP scaleX != scaleY, lone scaleX, CSS scale(a,b) and skew on footage FAIL', () => {
  const css = '#spk{width:3422px;height:1925px}';
  assert.match(issues(page(css, "tl.set('#spkwrap',{scaleX:0.85,scaleY:1},3.876);")).join(), /sx\/sy 0\.850/);
  assert.match(issues(page(css, "tl.fromTo('#spk',{scaleX:0.9},{scaleX:1,duration:1},2);")).join(), /scaleX 0\.9/);
  assert.match(issues(page(css + '#spkwrap{transform:scale(0.9,1)}', '')).join(), /scale\(0\.9,1\)/);
  assert.match(issues(page(css, "tl.set('#spk',{skewX:5},0);")).join(), /skew/);
  assert.deepEqual(issues(page(css, "tl.to('#spkwrap',{scale:1.2,duration:1},0);")), []);
  assert.deepEqual(transformScales('matrix(0.8,0,0,0.8,10,0)').map((s) => +(s.sx / s.sy).toFixed(3)), [1]);
});

test('composition: mismatched video box FAILs unless object-fit cover / contain; stretched prep clip FAILs', () => {
  assert.match(issues(page('#spk{width:2900px;height:1925px}', '')).join(), /stretched to the box/);
  assert.match(issues(page('#spk{width:2900px;height:1925px;object-fit:fill}', '')).join(), /object-fit fill/);
  assert.deepEqual(issues(page('#spk{width:2900px;height:1925px;object-fit:cover}', '')), []);
  assert.match(issues(page('#spk{width:3422px;height:1925px}', "tl.to('#spk',{width:3000,duration:1},2);")).join(), /GSAP width/);
  assert.match(issues(page('#spk{width:3422px;height:1925px}', ''), 4 / 3).join(), /prep stretched/);
});

test('toSource: keeps map edited time to source time', () => {
  const k = [{ sourceStart: 0.4, sourceEnd: 1.467, start: 0, end: 1.067 }, { sourceStart: 6, sourceEnd: 8.2, start: 1.067, end: 3.267 }];
  assert.equal(+toSource(k, 2).toFixed(3), 6.933); assert.equal(+toSource(k, 0.5).toFixed(3), 0.9);
});

const hasCv = spawnSync('python3', ['-P', '-c', 'import cv2']).status === 0;
test('pixels: 0.85 x 1.0 squeeze FAILs, uniform scale + crop PASSes (synthetic ffmpeg clips)', { skip: !hasCv && 'python3 opencv missing' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-aspect-'));
  const ff = (args) => assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]).status, 0);
  const src = path.join(dir, 'raw/src.mp4'), bad = path.join(dir, 'bad.mp4'), ok = path.join(dir, 'ok.mp4');
  fs.mkdirSync(path.join(dir, 'raw')); fs.mkdirSync(path.join(dir, 'assets'));
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', src]);
  ff(['-i', src, '-vf', 'scale=870:576,pad=1080:720:105:72', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', bad]);
  ff(['-i', src, '-vf', 'scale=1024:576,crop=900:540,pad=1080:720:90:90', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', ok]);
  const [fb] = pixelFits(bad, src, [{ t: 0.5, srcT: 0.5 }]), [fo] = pixelFits(ok, src, [{ t: 0.5, srcT: 0.5 }]);
  const jb = judgeFit(fb), jo = judgeFit(fo);
  assert.ok(jb.squeeze && Math.abs(jb.ratio - 0.85) < 0.02, JSON.stringify(fb));
  assert.ok(jo.measured && !jo.squeeze && Math.abs(jo.ratio - 1) < 0.01, JSON.stringify(fo));
  assert.ok(Math.abs(fo.orb.sx - 1.6) < 0.02, JSON.stringify(fo));
  // CLI on a temp project: matching box, identity keeps
  fs.copyFileSync(src, path.join(dir, 'assets/clip.mp4'));
  fs.writeFileSync(path.join(dir, 'index.html'), page('#spk{width:1080px;height:607.5px}', "tl.set('#spkwrap',{scale:1},0);"));
  fs.writeFileSync(path.join(dir, 'assets/edit-decisions.json'), JSON.stringify({ source: 'raw/src.mp4', duration: 1, keeps: [{ sourceStart: 0, sourceEnd: 1, start: 0, end: 1 }] }));
  const rb = spawnSync('node', [CLI, dir, bad], { encoding: 'utf8' }), ro = spawnSync('node', [CLI, dir, ok], { encoding: 'utf8' });
  assert.equal(rb.status, 1, rb.stdout + rb.stderr); assert.match(rb.stdout, /FAIL SQUEEZE w0 /); assert.match(rb.stdout, /aspect: FAIL 0 composition issue\(s\), 2 squeezed/);
  assert.equal(ro.status, 0, ro.stdout + ro.stderr); assert.match(ro.stdout, /aspect: PASS/);
  fs.rmSync(dir, { recursive: true, force: true });
});

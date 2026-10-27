// name-guard on small synthetic projects (always) and on the gen-taglish / gen-talk(-v3..v5) / gen-nasa2-v3 / confirm-30s projects (each
// skipped when its gitignored project dir is absent).
//   node --test ai-video-editor/tools/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '../name-guard.mjs');
const VP = path.join(HERE, '../../../video-projects');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-name-guard-test-'));
const LENI = path.join(tmp, 'names-leni.txt');
fs.writeFileSync(LENI, 'Leni Robredo\n');

function guard(proj, ...args) {
  const r = spawnSync('node', [TOOL, proj, '--json', ...args], { encoding: 'utf8' });
  assert.ok([0, 1].includes(r.status), r.stderr);
  return { code: r.status, ...JSON.parse(r.stdout) };
}
// project with a transcript and overlay html; caption divs use the preset's `cap clip` class
function project(name, said, overlay, captions = '') {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const words = said.split(' ').map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25, type: 'word' }));
  fs.writeFileSync(path.join(dir, 'assets/transcript.json'), JSON.stringify({ words }));
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><head><title>${said}</title></head><body><div id="root">${overlay}${captions}</div>
<script>const tl = gsap.timeline({ paused: true }); window.__timelines = { root: tl };</script></body></html>`);
  return dir;
}

test('synthetic: ASR person name in a chip fails, captions and trusted spellings pass', () => {
  const said = 'Again, as Mayor Lenny was explaining, the Bicol River floods.';
  const caps = '<div id="cap1" class="cap clip"><span>Mayor Lenny</span></div>';
  const chip = project('chip', said, '<div id="c4" class="tagcard">MAYOR LENNY</div><div id="c1">BICOL RIVER</div>', caps);
  let r = guard(chip);
  assert.equal(r.code, 1); assert.deepEqual(r.flagged.map((f) => f.token), ['LENNY']);
  assert.deepEqual(r.warned.map((f) => f.token), ['BICOL']);
  r = guard(chip, '--names', LENI);
  assert.equal(r.code, 1); assert.equal(r.flagged[0].closestTrusted, 'Leni Robredo');
  assert.equal(guard(project('caps-only', said, '<div id="c1">FLOODS</div>', caps)).code, 0);
  assert.equal(guard(project('fixed', said, '<div id="c4">MAYOR LENI ROBREDO</div>'), '--names', LENI).code, 0);
  // name card + "my name is" cue; accepted once recorded from the source's own on-screen text
  const nm = project('verified', 'Hi. My name is Dalia Kirschbaum and I study rain.', '<div id="name" class="lt">DALIA KIRSCHBAUM</div>');
  assert.deepEqual(guard(nm).flagged.map((f) => f.token), ['DALIA', 'KIRSCHBAUM']);
  fs.writeFileSync(path.join(nm, 'assets/names-verified.txt'), 'Dalia Kirschbaum | source title card 0.2 s\nDahlia\n');
  r = guard(nm);
  assert.equal(r.code, 0); assert.deepEqual(r.verified, [{ name: 'Dalia Kirschbaum', evidence: 'source title card 0.2 s' }]);
  // script-set text counts as overlay
  const js = project('js', said, '<div id="k1" class="kin"></div><script>document.querySelector("#k1").textContent = "LENNY";</script>');
  assert.deepEqual(guard(js).flagged.map((f) => f.where), ['script']);
});

// the real caption line of gen-nasa2-v3/index.html (ASR "Dahlia" for the verified "Dalia Kirschbaum")
const NASA2_CAP = '<div id="cap1" class="cap clip" style="top:40px" data-start="0.853" data-duration="0.46" data-track-index="4"><span>is Dahlia</span></div>';
test('near-miss: caption "is Dahlia" vs verified Dalia Kirschbaum fails; exact spelling and plain words pass', () => {
  const said = 'My name is Dahlia Kirschbaum and I study rain from space.';
  const verify = (dir) => { fs.writeFileSync(path.join(dir, 'assets/names-verified.txt'), 'Dalia Kirschbaum | source title card 0.2 s\nGPM | source title card 0.2 s\n'); return dir; };
  let r = guard(verify(project('near-cap', said, '', NASA2_CAP)));
  assert.equal(r.code, 1);
  assert.deepEqual(r.nearMiss.map((f) => [f.token, f.where, f.caption, f.trusted]), [['Dahlia', '#cap1', true, 'Dalia Kirschbaum']]);
  // kinetic text, case-insensitive; phonetic match (Kershbaum ~ Kirschbaum, Soundex K615)
  r = guard(verify(project('near-kin', said, '<div id="k1" class="kin">KERSHBAUM</div>')));
  assert.deepEqual(r.nearMiss.map((f) => f.token), ['KERSHBAUM']);
  // fixed caption, and "I'm" / "is" are not near-misses of GPM
  r = guard(verify(project('near-ok', said, '', NASA2_CAP.replace('Dahlia', 'Dalia') + '<div id="cap3" class="cap clip"><span>I\'m a</span></div>')));
  assert.equal(r.code, 0, JSON.stringify(r.nearMiss));
});

const real = (name) => ({ skip: !fs.existsSync(path.join(VP, name, 'index.html')) && `video-projects/${name} absent` });
test('gen-taglish: MAYOR LENNY fails, also against a Leni Robredo names file', real('gen-taglish'), () => {
  for (const args of [[], ['--names', LENI]]) {
    const r = guard(path.join(VP, 'gen-taglish'), ...args);
    assert.equal(r.code, 1); assert.deepEqual(r.flagged.map((f) => f.token), ['LENNY']);
  }
});
test('gen-nasa2-v3: caption "is Dahlia" fails against names-verified.txt', real('gen-nasa2-v3'), () => {
  const r = guard(path.join(VP, 'gen-nasa2-v3'));
  assert.equal(r.code, 1); assert.deepEqual(r.nearMiss.map((f) => [f.token, f.text]), [['Dahlia', 'is Dahlia']]);
});
for (const name of ['gen-talk', 'gen-talk-v3', 'gen-talk-v4', 'gen-talk-v5', 'confirm-30s']) {
  test(`${name}: passes (place / mission names are warnings only)`, real(name), () => {
    const r = guard(path.join(VP, name));
    assert.equal(r.code, 0, JSON.stringify(r.flagged));
  });
}

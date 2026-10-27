// verbatim-guard on synthetic projects (always) and on gen-talk-v3 / gen-nasa2-v2 / confirm-30s (each skipped when
// its gitignored project dir is absent).
//   node --test ai-video-editor/tools/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '../verbatim-guard.mjs');
const VP = path.join(HERE, '../../../video-projects');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-verbatim-test-'));

function guard(proj) {
  const r = spawnSync('node', [TOOL, proj, '--json'], { encoding: 'utf8' });
  assert.ok([0, 1].includes(r.status), r.stderr);
  return { code: r.status, ...JSON.parse(r.stdout) };
}
function project(name, said, overlay) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const words = said.split(' ').map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25, type: 'word' }));
  fs.writeFileSync(path.join(dir, 'assets/transcript.json'), JSON.stringify({ words }));
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><body><div id="root">${overlay}<div class="cap clip">greater trust</div></div></body></html>`);
  return dir;
}
const said = 'It builds not only a greater trusted us. There are very Small ones at that, in Minnesota.';

test('synthetic: kinetic word not in the transcript fails, verbatim kinetic passes', () => {
  let r = guard(project('kin-bad', said, '<div class="clip paper"><div id="k1">GREATER TRUST</div></div>'));
  assert.equal(r.code, 1); assert.deepEqual(r.fails.map((f) => f.text), ['GREATER TRUST']);
  r = guard(project('kin-ok', said, '<div class="clip paper"><div id="k1">GREATER TRUSTED US</div><div id="k2">Not only a</div></div>'));
  assert.equal(r.code, 0, JSON.stringify(r.fails));
});

test('synthetic: chip paraphrasing speech fails; topic labels and name chips pass', () => {
  let r = guard(project('chip-bad', said, '<div class="clip"><div id="c1" class="pill">TINY ONES</div></div>'));
  assert.equal(r.code, 1); assert.equal(r.fails[0].said, 'small ones');
  r = guard(project('chip-ok', said, '<div class="clip"><div class="pill">MIDWEST WEATHER</div><div class="tag">STATE · MINNESOTA</div><div class="pill">SMALL ONES</div><div class="pill">3 STATES</div></div>'));
  assert.equal(r.code, 0, JSON.stringify(r.fails));
});

const real = (name) => ({ skip: !fs.existsSync(path.join(VP, name, 'index.html')) && `${name} absent` });
test('gen-talk-v3: flags TRUST (transcript "trusted us") and HAVE EVER BEEN HERE', real('gen-talk-v3'), () => {
  const r = guard(path.join(VP, 'gen-talk-v3'));
  assert.equal(r.code, 1);
  assert.ok(r.fails.some((f) => f.text === 'TRUST' && f.tier === 'strict'));
  assert.ok(r.fails.some((f) => f.text === 'HAVE EVER BEEN HERE'));
  assert.ok(r.ok.some((o) => o.text === 'GREATER'));
});
test('gen-nasa2-v2: flags chip TINY ONES (said "small ones") and nothing else', real('gen-nasa2-v2'), () => {
  const r = guard(path.join(VP, 'gen-nasa2-v2'));
  assert.equal(r.code, 1);
  assert.deepEqual(r.fails.map((f) => [f.text, f.said]), [['TINY ONES', 'small ones']]);
});
test('confirm-30s: passes', real('confirm-30s'), () => assert.equal(guard(path.join(VP, 'confirm-30s')).code, 0));

// Caption tier on the frozen gen-th-style2b fixture (check/test/fixtures/style2b: dom-sample caption runs + its retimed
// transcript). Its captions map token for token (the 0:09 "AND BE ABLE" is what the transcript says: Scribe wrote
// "be" for "being", so only verbatim-final hears it); a swapped, reordered or mistimed caption FAILs.
import { captionVerbatim, shownSpeech } from '../verbatim-guard.mjs';
const S2 = path.join(HERE, '../../check/test/fixtures/style2b');
test('caption tier: gen-th-style2b captions map token for token; swaps, reorders and mistimed captions FAIL', async () => {
  const { projectSamples } = await import('../dom-sample.mjs');
  const shown = shownSpeech(await projectSamples(S2)), words = JSON.parse(fs.readFileSync(path.join(S2, 'assets/transcript.json'), 'utf8')).words.filter((w) => (w.type || 'word') === 'word');
  const r = captionVerbatim(shown, words);
  assert.equal(r.fails.length, 0, JSON.stringify(r.fails));
  assert.ok(r.ok >= 20);
  const be = shown.find((x) => x.text === 'AND BE ABLE');
  assert.ok(be && Math.abs(be.start - 8.93) < 0.05);
  const bad = (text, dt = 0) => captionVerbatim([{ ...be, text, start: be.start + dt, end: be.end + dt }], words).fails;
  assert.equal(bad('AND BEING ABLE').length, 1); // not the transcript's words
  assert.equal(bad('BE AND ABLE').length, 1);   // reordered
  assert.equal(bad('AND ABLE').length, 1);      // a word dropped
  assert.equal(bad('AND BE ABLE', 6).length, 1); // right words, wrong time
  assert.match(bad('AND BE ABLE', 6)[0].elsewhere ? 'elsewhere' : '', /elsewhere/);
  assert.equal(bad('AND BE ABLE').length, 0);
});

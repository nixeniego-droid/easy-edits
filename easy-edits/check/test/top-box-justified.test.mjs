// top-box-justified: a split / top-box scene needs a one-line reason naming a process, comparison or scene, from its
// plan.json topBoxWhy or a DESIGN.md line naming it; face / punch scenes need none; the real Europa v2 project
// (easy-edits-full-30s, split hook without a reason) FAILs; the CLI on a temp project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkTopBox, justified } from '../top-box-justified.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname), CLI = path.join(HERE, '../top-box-justified.mjs');
const plan = (extra = {}) => ({ scenes: [
  { id: 's1', start: 0, end: 2.7, layout: 'split', anchor: 'Europa Clipper is a massive spacecraft', ...extra },
  { id: 's2', start: 2.7, end: 4.4, layout: 'face' }, { id: 's3', start: 4.4, end: 5.8, layout: 'punch' }] });

test('justified: needs a kind keyword and a real sentence', () => {
  assert.ok(justified('the craft unfolds its arrays step by step: a process'));
  assert.ok(justified('before / after of the shield closing'));
  assert.ok(!justified('process'));
  assert.ok(!justified('looks cool here, big graphic'));
});

test('plan: split without a reason FAILs; topBoxWhy or a DESIGN.md line passes; face / punch need none', () => {
  assert.deepEqual(checkTopBox(plan(), '').bad.map((b) => b.id), ['s1']);
  assert.deepEqual(checkTopBox(plan({ topBoxWhy: 'scene: the whole craft next to Jupiter, its scale' }), '').bad, []);
  const md = '| 0.0-2.7 | Europa Clipper is massive | top box | arrays unfold | a process: the craft unfolds in three steps |';
  assert.deepEqual(checkTopBox(plan(), md).bad, []);
  assert.deepEqual(checkTopBox(plan(), '- s1 split: it looks great').bad.map((b) => b.id), ['s1']);
  assert.deepEqual(checkTopBox({ scenes: [{ id: 'a', start: 0, end: 3, layout: 'face' }] }, '').beats, []);
});

test('DESIGN.md only: top-box rows need a reason; "what not to do" mentions are ignored', () => {
  const md = ['| 3.1 | wrapped in copper | top box | bands wrap | comparison of bare vs wrapped harness |',
    '| 9.0 | necklaces | top box | pendant | funny |', '- What not to do: no split as the default'].join('\n');
  const r = checkTopBox({}, md);
  assert.equal(r.beats.length, 2); assert.equal(r.bad.length, 1); assert.match(r.bad[0].line, /necklaces/);
});

test('CLI: real Europa v2 project FAILs (split hook, no reason); temp project with a reason PASSes', () => {
  const real = path.join(HERE, '../../../video-projects/easy-edits-full-30s');
  if (fs.existsSync(path.join(real, 'assets/plan.json'))) {
    const r = spawnSync('node', [CLI, real], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /FAIL TOP BOX s1/);
  }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-topbox-'));
  try {
    fs.mkdirSync(path.join(d, 'assets'));
    fs.writeFileSync(path.join(d, 'assets/plan.json'), JSON.stringify(plan({ topBoxWhy: 'a process: radiation hits, charge builds, the shield closes' })));
    const ok = spawnSync('node', [CLI, d], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout); assert.match(ok.stdout, /PASS 1 top-box beat\(s\), 1 justified/);
    fs.rmSync(path.join(d, 'assets/plan.json'));
    const none = spawnSync('node', [CLI, d], { encoding: 'utf8' });
    assert.equal(none.status, 1); assert.match(none.stdout, /no DESIGN\.md or assets\/plan\.json/);
    assert.equal(spawnSync('node', [CLI], { encoding: 'utf8' }).status, 2);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

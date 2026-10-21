// edit.sh hides sibling projects made from the same source during the edit, against a fake claude (no paid calls).
//   node --test easy-edits/bin/test/edit-siblings.test.mjs   (needs ffmpeg; ~2 s)
// Each case builds video-projects/ in a temp dir ($EASY_EDITS_VIDEO_PROJECTS) with: sib (same bytes, other name),
// sibname (same basename), other (unrelated), easy-edits-full-30s (same bytes, exempt). The fake lists the dir mid-run.
//   copy:   result, Bash `cp -r video-projects/sib ...` -> WARN copied-from + fresh FAIL; siblings restored
//   fail:   fake exits 3 (every attempt) -> nonzero exit, siblings restored
//   term:   fake hangs, edit.sh gets SIGTERM -> exit 143, sib restored, sibname recreated meanwhile -> not clobbered
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDIT = path.join(HERE, '../edit.sh');
const FAKE = path.join(HERE, 'fake-claude.mjs');
const ALL = ['easy-edits-full-30s', 'other', 'sib', 'sibname'];

function setup(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gc-edit-siblings-${name}-`));
  const src = path.join(dir, 'src', 'clip.mp4'), tr = path.join(dir, 'src', 'clip.words.json');
  fs.mkdirSync(path.dirname(src));
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=2', '-c:v', 'libx264',
    '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', src], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  fs.writeFileSync(tr, JSON.stringify({ words: [{ text: 'hello', start: 0.2, end: 0.6, type: 'word' }, { text: 'there', start: 0.7, end: 1.1, type: 'word' }] }));
  const vp = path.join(dir, 'video-projects');
  const put = (p, f, data) => { fs.mkdirSync(path.join(vp, p, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(vp, p, f), data); };
  put('sib', 'raw/renamed.mp4', fs.readFileSync(src));
  put('sibname', 'raw/clip.mp4', 'not the same bytes');
  put('other', 'raw/other.mp4', 'unrelated');
  put('easy-edits-full-30s', 'raw/porter.mp4', fs.readFileSync(src));
  return { dir, src, tr, vp, home: path.join(dir, 'home'), ls: path.join(dir, 'ls.jsonl'), out: path.join(dir, 'out', 'edit.mp4') };
}

function run(c, env, onSpawn) {
  return new Promise((resolve) => {
    const p = spawn('bash', [EDIT, c.src, c.tr, path.join(c.vp, 'target'), c.out, '--claude', FAKE], {
      env: { ...process.env, EASY_EDITS_CUTCAND: '0', EASY_EDITS_CUTCAND_CACHE: path.join(c.dir, 'cutcand-cache'), EASY_EDITS_HOME: c.home, EASY_EDITS_VIDEO_PROJECTS: c.vp, FAKE_MODE: 'edit', FAKE_PROJECTS: c.vp, FAKE_LS: c.ls, ...env },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    onSpawn?.(p);
    p.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}
const listings = (c) => fs.readFileSync(c.ls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const projects = (c) => fs.readdirSync(c.vp).filter((d) => d !== 'target').sort();
const hiddenDuring = (c) => { for (const l of listings(c)) assert.deepEqual(l, ['easy-edits-full-30s', 'other']); };

test('edit.sh sibling hiding', { concurrency: true }, async (t) => {
  await Promise.all([
    t.test('hidden during a run that copies, restored after, copy flagged', { timeout: 60_000 }, async () => {
      const c = setup('copy');
      const r = await run(c, { FAKE_BASH: `cp -r video-projects/sib video-projects/target && sed -n 1p video-projects/easy-edits-full-30s/DESIGN.md` });
      assert.match(r.stderr, /edit\.sh: hid 2 sibling project\(s\): sib sibname/);
      hiddenDuring(c);
      assert.deepEqual(projects(c), ALL);
      assert.equal(fs.readFileSync(path.join(c.vp, 'other/raw/other.mp4'), 'utf8'), 'unrelated');
      assert.match(r.stdout, /edit\.sh: WARN copied-from: sib: cp -r/);
      assert.doesNotMatch(r.stdout, /copied-from: easy-edits-full-30s/);
      assert.match(r.stdout, /fresh FAIL/);
      assert.notEqual(r.code, 0);
      assert.ok(!fs.existsSync(path.join(c.home, 'hidden')) || fs.readdirSync(path.join(c.home, 'hidden')).length === 0);
    }),
    t.test('restored when the fake claude exits non-zero', { timeout: 60_000 }, async () => {
      const c = setup('fail');
      const r = await run(c, { FAKE_EXIT: '3' });
      assert.match(r.stderr, /edit failed \(watchdog exit 1/);
      assert.equal(r.code, 1);
      assert.ok(listings(c).length >= 1);
      hiddenDuring(c);
      assert.deepEqual(projects(c), ALL);
      assert.match(r.stdout, /fresh PASS/);
    }),
    t.test('restored on SIGTERM without clobbering a recreated project', { timeout: 60_000 }, async () => {
      const c = setup('term');
      const r = await run(c, { FAKE_HANG: '1' }, (p) => {
        const iv = setInterval(() => {
          if (!fs.existsSync(c.ls)) return;
          clearInterval(iv);
          fs.mkdirSync(path.join(c.vp, 'sibname'));
          p.kill('SIGTERM');
        }, 100);
      });
      assert.equal(r.code, 143, r.stderr);
      hiddenDuring(c);
      assert.deepEqual(projects(c), ALL);
      assert.ok(fs.existsSync(path.join(c.vp, 'sib/raw/renamed.mp4')));
      assert.deepEqual(fs.readdirSync(path.join(c.vp, 'sibname')), []);
      assert.match(r.stderr, /not restoring sibname/);
      const [stash] = fs.readdirSync(path.join(c.home, 'hidden'));
      assert.ok(fs.existsSync(path.join(c.home, 'hidden', stash, 'sibname/raw/clip.mp4')));
    }),
  ]);
});

// edit.sh --draft-only / --resume-notes against the fake claude (no paid calls).
//   draft:  brief gets the DRAFT-ONLY section with the sheet path; the fake writes the sheet -> exit 0, "draft
//           ready", no final, no post; without the sheet -> draft failed
//   resume: no prep, the same project kept (marker survives, never hidden), brief.resume.md quotes the notes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EDIT = path.join(HERE, '../edit.sh'), FAKE = path.join(HERE, 'fake-claude.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-edit-draft-'));
const src = path.join(dir, 'clip.mp4'), tr = path.join(dir, 'clip.words.json'), vp = path.join(dir, 'video-projects');
const proj = path.join(vp, 'target'), out = path.join(dir, 'out', 'edit.mp4'), sheet = path.join(dir, 'sheet.png');
const env = { ...process.env, AI_VIDEO_EDITOR_CUTCAND: '0', AI_VIDEO_EDITOR_CUTCAND_CACHE: path.join(dir, 'cc'), AI_VIDEO_EDITOR_HOME: path.join(dir, 'home'),
  AI_VIDEO_EDITOR_VIDEO_PROJECTS: vp, AI_VIDEO_EDITOR_PREP_FACES: '0', FAKE_MODE: 'edit', FAKE_PROJECTS: vp, FAKE_LS: path.join(dir, 'ls.jsonl') };
const run = (args, extra = {}) => spawnSync('bash', [EDIT, src, tr, proj, out, '--claude', FAKE, ...args], { encoding: 'utf8', env: { ...env, ...extra } });

test.before(() => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', src], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  fs.writeFileSync(tr, JSON.stringify({ words: [{ text: 'hello', start: 0.2, end: 0.6, type: 'word' }] }));
  fs.mkdirSync(proj, { recursive: true }); fs.writeFileSync(path.join(proj, 'MARKER'), 'draft work');
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('--draft-only: brief section, sheet -> draft ready, no post', () => {
  const miss = run(['--draft-only', '--draft-sheet', sheet]);
  assert.equal(miss.status, 1, miss.stderr);
  assert.match(miss.stderr, /draft failed \(watchdog exit 0, sheet missing\)/);
  const r = run(['--draft-only', '--draft-sheet', sheet], { FAKE_TOUCH: sheet });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /edit\.sh: draft ready: .*sheet\.png \(no final, no post\)/);
  assert.doesNotMatch(r.stderr + r.stdout, /edit\.sh: post|caption-face-final|sfx-mix|delivery/);
  const brief = fs.readFileSync(path.join(dir, 'out/edit.run/brief.md'), 'utf8');
  assert.match(brief, /## DRAFT-ONLY/);
  assert.ok(brief.includes(`tile=6x2" -frames:v 1 ${sheet}`));
  assert.match(brief, /render\.sh draft \. renders\/draft1\.mp4/);
  assert.ok(!fs.existsSync(out));
});

test('--resume-notes: same project, no prep, notes in the brief', () => {
  const notes = path.join(dir, 'notes.md'); fs.writeFileSync(notes, 'Move the 7.7 s caption up.\nBrighter idea card.');
  const r = run(['--resume-notes', notes]);
  assert.match(r.stderr, /resume: reusing prep/);
  assert.doesNotMatch(r.stderr, /edit\.sh: prep \d+ s/);
  assert.equal(fs.readFileSync(path.join(proj, 'MARKER'), 'utf8'), 'draft work');
  for (const l of fs.readFileSync(env.FAKE_LS, 'utf8').trim().split('\n')) assert.ok(JSON.parse(l).includes('target'));
  const brief = fs.readFileSync(path.join(dir, 'out/edit.run/brief.resume.md'), 'utf8');
  assert.match(brief, /## RESUME/); assert.match(brief, /Move the 7\.7 s caption up\.\nBrighter idea card\./);
  assert.doesNotMatch(brief, /DRAFT-ONLY/);
  assert.ok(fs.existsSync(path.join(dir, 'out/edit.run/stream.resume.jsonl')));
  const bad = spawnSync('bash', [EDIT, src, tr, path.join(vp, 'nope'), path.join(dir, 'other.mp4'), '--claude', FAKE, '--resume-notes', notes], { encoding: 'utf8', env });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /needs the earlier run's prep/);
});

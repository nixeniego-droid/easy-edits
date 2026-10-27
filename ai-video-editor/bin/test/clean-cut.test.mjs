// edit.sh --style clean-cut: flag parsing and the dry run (no media decode, no ASR, no claude).
//   dispatch to bin/clean-cut.sh, 3 positionals, the gate list = styles/clean-cut/style.json gates, every skipped
//   gate printed with its reason, the caption preset passed to caption-size, language auto by default / --lang /
//   profile.json, --no-review, unknown style rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EDIT = path.join(HERE, '../edit.sh');
const style = JSON.parse(fs.readFileSync(path.join(HERE, '../../styles/clean-cut/style.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-clean-cut-')), src = path.join(dir, 'clip.mp4');
fs.writeFileSync(src, 'not decoded in a dry run');
const env = { ...process.env, AI_VIDEO_EDITOR_HOME: path.join(dir, 'home') };
delete env.AI_VIDEO_EDITOR_LANG;
const run = (args, extra = {}) => spawnSync('bash', [EDIT, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
const base = ['--style', 'clean-cut', src, path.join(dir, 'proj'), path.join(dir, 'out.mp4'), '--dry-run'];
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('dry run: phases, gates = style.json gates, skipped gates with reasons, preset to caption-size', () => {
  const r = run(base);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /style clean-cut, mode clean, language auto, review on/);
  for (const p of ['prep', 'asr', 'cut', 'review', 'build', 'render', 'post']) assert.match(r.stdout, new RegExp(`^${p}:`, 'm'));
  assert.match(r.stdout, /^asr: prep's cut-candidates whole-file disfluent decode/m);
  assert.match(r.stdout, /^asr fallback: .*asr_words\.py .* medium --disfluent --lang auto$/m);
  assert.match(r.stdout, /--max-turns 3/);
  const labels = [...new Set([...r.stdout.matchAll(/^ {2}(\w+):\s+\[(?:pre|final)\] /gm)].map((m) => m[1]))];
  assert.match(r.stdout, /disfl:\s+\[pre\] env OMP_NUM_THREADS=4 node \S+disfluency\.mjs \S+assets\/mix\.wav --lang auto *$/m);
  assert.match(r.stdout, /cut\.mjs .* --mode clean/);
  assert.match(r.stdout, /^caption verify: .*caption-verify\.mjs /m);
  const light = run([...base, '--mode', 'light']);
  assert.match(light.stdout, /disfl:\s+\[pre\] .*disfluency\.mjs \S+ --lang auto --fillers-only/);
  assert.match(light.stdout, /cut\.mjs .* --mode light/);
  assert.match(light.stdout, /dead-air\.mjs \S+ --max 0\.9/);
  assert.match(r.stdout, /^prep: AI_VIDEO_EDITOR_CUTCAND=0 node \S+source-prep\.mjs .* \|\| +env OMP_NUM_THREADS=4 node \S+cut-candidates\.mjs /m);
  assert.match(r.stdout, /content:\s+\[final\] env OMP_NUM_THREADS=3 node \S+content-kept\.mjs \S+ \S+ --source \S+/);
  assert.match(r.stdout, /^post: env AI_VIDEO_EDITOR_LEADIN_PRESET=veryfast node /m);
  assert.match(r.stdout, /mixmatch:\s+\[final\] node \S+mix-match\.mjs \S+assets\/mix\.wav /);
  assert.match(r.stdout, /finalface:\s+\[final\] \S+bin\/lib\/finalface-split\.sh 3 /);
  assert.deepEqual(labels, style.gates);
  for (const [k, why] of Object.entries(style.skipped)) assert.ok(r.stdout.includes(`skip ${k}: ${why}`), k);
  assert.match(r.stdout, /caption-size\.mjs \S+ --preset \S+styles\/clean-cut\/captions\.json/);
  assert.match(r.stdout, /dead-air\.mjs \S+ --max 0\.9/);
  assert.match(r.stdout, /text-style\.mjs \S+ --one-caption --no-kinetic-size/);
  for (const g of ['panel-contrast', 'top-box-justified', 'kinetic-dup', 'sfx-audible', 'layout-jump', 'grade-continuity']) assert.doesNotMatch(r.stdout, new RegExp(`${g}\\.mjs`));
});

test('--no-review, --lang, profile language', () => {
  assert.match(run([...base, '--no-review']).stdout, /review off/);
  assert.match(run([...base, '--lang', 'tl']).stdout, /language tl[\s\S]*--disfluent --lang tl[\s\S]*disfluency\.mjs \S+ --lang tl/);
  fs.mkdirSync(env.AI_VIDEO_EDITOR_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.AI_VIDEO_EDITOR_HOME, 'profile.json'), JSON.stringify({ language: 'es' }));
  assert.match(run(base).stdout, /language es/);
  fs.rmSync(path.join(env.AI_VIDEO_EDITOR_HOME, 'profile.json'));
});

test('usage errors: transcript positional, unknown style', () => {
  assert.equal(run(['--style', 'clean-cut', src, 'x.json', path.join(dir, 'proj'), path.join(dir, 'out.mp4'), '--dry-run']).status, 2);
  const u = run(['--style', 'vlog', src, path.join(dir, 'proj'), path.join(dir, 'out.mp4')]);
  assert.equal(u.status, 2); assert.match(u.stderr, /unknown style 'vlog'/);
});

test('status flags: Clean cut APPROVED, every other style EXPERIMENTAL (help, style.json files, full-edit warning)', () => {
  const h = run(['--help']);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /APPROVED\s+ai-video-editor\/bin\/edit\.sh --style clean-cut/);
  assert.match(h.stdout, /EXPERIMENTAL/);
  assert.match(run(['--style', 'clean-cut', '--help']).stdout, /CLEAN CUT, the APPROVED style/);
  assert.match(style.status, /^APPROVED/);
  const lib = path.join(HERE, '../../../style-library');
  for (const d of fs.readdirSync(lib).filter((x) => fs.existsSync(path.join(lib, x, 'style.json')))) {
    assert.match(JSON.parse(fs.readFileSync(path.join(lib, d, 'style.json'), 'utf8')).aiVideoEditorStatus, /^EXPERIMENTAL/, d);
  }
  assert.match(run(['a', 'b']).stderr, /EXPERIMENTAL: the full creative edit is not approved/);
});

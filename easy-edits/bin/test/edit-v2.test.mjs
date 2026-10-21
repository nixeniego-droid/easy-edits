// edit.sh v2 defaults against the fake claude (no paid calls):
//   default brief = briefs/edit-30s-v2.md (kit-led, top box opt-in); --brief keeps the embedded brief selectable
//   dry run: fault-only gates by default; --strict-look adds the creative-steering gates and drops the fault flags
//   --plan-only: PLAN-ONLY section, plan copied to --plan-out -> "plan ready", no guards, no post; missing -> failed
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EDIT = path.join(HERE, '../edit.sh'), FAKE = path.join(HERE, 'fake-claude.mjs'), BRIEFS = path.join(HERE, '../../briefs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-edit-v2-'));
const src = path.join(dir, 'clip.mp4'), tr = path.join(dir, 'clip.words.json'), vp = path.join(dir, 'video-projects');
const proj = path.join(vp, 'target'), out = path.join(dir, 'out', 'edit.mp4');
const env = { ...process.env, EASY_EDITS_CUTCAND: '0', EASY_EDITS_CUTCAND_CACHE: path.join(dir, 'cc'), EASY_EDITS_HOME: path.join(dir, 'home'),
  EASY_EDITS_VIDEO_PROJECTS: vp, EASY_EDITS_PREP_FACES: '0', FAKE_MODE: 'edit', FAKE_PROJECTS: vp, FAKE_LS: path.join(dir, 'ls.jsonl') };
const run = (args, extra = {}) => spawnSync('bash', [EDIT, src, tr, proj, out, '--claude', FAKE, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
const gates = (stdout) => stdout.split('\n').filter((l) => /^  (fault|strict) /.test(l)).map((l) => l.trim().split(/\s+/).slice(0, 3).join(' '));
const FAULT = ['stale', 'names', 'verbatim', 'cuts', 'disfl', 'air', 'face', 'finalface', 'style', 'capsize', 'read', 'contrast', 'jump', 'grade', 'order', 'kdup', 'sfx', 'room', 'topbox', 'aspect'];
const STRICT = ['motion', 'shot', 'life', 'look', 'fill', 'cardtext', 'items', 'panel', 'icons', 'sfxmix'];
const labels = (g, tier) => [...new Set(g.filter((x) => x.startsWith(tier)).map((x) => x.split(' ')[2].replace(/:$/, '')))];

test.before(() => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', src], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  fs.writeFileSync(tr, JSON.stringify({ words: [{ text: 'hello', start: 0.2, end: 0.6, type: 'word' }] }));
  fs.mkdirSync(proj, { recursive: true });
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('default brief is edit-30s-v2.md (<= 60 lines, kit-led, top box opt-in); --brief still selects the embedded one', () => {
  const v2 = fs.readFileSync(path.join(BRIEFS, 'edit-30s-v2.md'), 'utf8');
  assert.ok(v2.trimEnd().split('\n').length <= 60);
  const r = run(['--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  const brief = fs.readFileSync(path.join(dir, 'out/edit.run/brief.md'), 'utf8');
  assert.match(brief, /<!-- easy-edits: v2/);
  for (const k of ['CLAUDE.md', 'short-form-edit/SKILL.md', 'EDITING-PLAYBOOK.md', 'SHORT-FORM.md', 'cut-silences', 'cut-mistakes', 'motion-showreel'])
    assert.ok(brief.includes(k), k);
  assert.match(brief, /ONLY for a process, a comparison or a scene/);
  assert.match(brief, /a suggestion; your DESIGN\.md decides/);
  assert.doesNotMatch(brief, /\{\{[A-Z_]+\}\}|Do not read the other kit docs|follow .*EXACTLY/i);
  assert.ok(brief.includes(proj.startsWith(path.resolve(HERE, '../../..')) ? 'video-projects/target' : proj));
  const emb = run(['--dry-run', '--brief', path.join(BRIEFS, 'edit-30s-embedded.md')]);
  assert.equal(emb.status, 0, emb.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'out/edit.run/brief.md'), 'utf8'), /<!-- easy-edits: embedded -->/);
});

test('dry run: fault-only gates by default, --strict-look adds the creative-steering gates', () => {
  const g = gates(run(['--dry-run']).stdout), s = run(['--dry-run', '--strict-look']);
  assert.deepEqual(labels(g, 'fault'), FAULT);
  assert.deepEqual(labels(g, 'strict'), []);
  assert.match(run(['--dry-run']).stdout, /gates \(fault-only, 22\)/);
  const style = g.length && run(['--dry-run']).stdout.split('\n').find((l) => / style: /.test(l));
  assert.match(style, /--one-caption --no-kinetic-size/);
  assert.match(run(['--dry-run']).stdout.split('\n').find((l) => / jump: /.test(l)), /--flash-only/);
  assert.doesNotMatch(run(['--dry-run']).stdout, /readability\.mjs \S+ --groups/);
  const gs = gates(s.stdout);
  assert.deepEqual(labels(gs, 'fault'), FAULT);
  assert.deepEqual(labels(gs, 'strict'), STRICT);
  const line = (k) => s.stdout.split('\n').find((l) => new RegExp(` ${k}: `).test(l));
  assert.doesNotMatch(line('style'), /--no-kinetic-size/); assert.doesNotMatch(line('jump'), /--flash-only/);
  assert.match(line('read'), /--groups/); assert.match(s.stdout, /gates \(strict-look, 33\)/);
  const se = run(['--dry-run', '--strict-look', '--brief', path.join(BRIEFS, 'edit-30s-embedded.md')]);
  assert.match(se.stdout.split('\n').find((l) => / style: /.test(l)), /--kinetic-free/);
  assert.match(se.stdout.split('\n').find((l) => / motion: /.test(l)), /--max 2\.0/);
});

test('--plan-only: PLAN-ONLY section, plan copied -> plan ready, no guards, no post', () => {
  const plan = path.join(dir, 'plan', 'DESIGN.md');
  const dry = run(['--dry-run', '--plan-only', '--plan-out', plan]);
  assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, /gates: none \(plan-only/);
  assert.equal(gates(dry.stdout).length, 0);
  const miss = run(['--plan-only', '--plan-out', plan]);
  assert.equal(miss.status, 1, miss.stderr); assert.match(miss.stderr, /plan failed \(watchdog exit 0, plan missing\)/);
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  const r = run(['--plan-only', '--plan-out', plan], { FAKE_TOUCH: plan });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /edit\.sh: plan ready: .*plan\/DESIGN\.md \(no build, no render, no guards, no post\)/);
  assert.doesNotMatch(r.stdout + r.stderr, /edit\.sh: post|name-guard|top-box-justified|gates fault-only/);
  const brief = fs.readFileSync(path.join(dir, 'out/edit.run/brief.md'), 'utf8');
  assert.match(brief, /## PLAN-ONLY/);
  for (const k of ['one-line mood / story', 'story arc', '2-3 key moments', 'where to hold back', 'line | time | format | idea | reason', 'caption and pacing approach', 'the one thing that would make a top editor post this'])
    assert.ok(brief.includes(k), k);
  assert.ok(brief.includes(`Copy it to \`${plan}\`. Then STOP`));
  assert.ok(!fs.existsSync(out));
  assert.equal(run(['--plan-out', plan, '--dry-run']).status, 2);
  assert.equal(run(['--plan-only', '--draft-only', '--dry-run']).status, 2);
});

// node --test easy-edits/tools/test/install-skill.test.mjs: ./install.sh registers the repo skill as a personal Claude
// Code skill (so a session started outside the checkout can load it), and the docs tell an assistant how to install.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const run = (env) => spawnSync('bash', [path.join(REPO, 'install.sh'), '--skill-only'], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

test('install.sh --skill-only: a copy of the skill that names this checkout, frontmatter first, idempotent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-skill-'));
  try {
    const env = { HOME: home, EASY_EDITS_HOME: path.join(home, '.easy-edits') };
    const r = run(env);
    assert.equal(r.status, 0, r.stderr);
    const f = path.join(home, '.claude/skills/easy-edits/SKILL.md');
    const s = fs.readFileSync(f, 'utf8');
    assert.match(s, /^---\nname: easy-edits\ndescription: .*install Easy Edits/);
    assert.ok(s.includes(`Easy Edits is already cloned at \`${REPO}\``));
    assert.ok(s.includes(`${path.join(home, '.easy-edits')}/env.sh`));
    assert.ok(s.includes(fs.readFileSync(path.join(REPO, '.claude/skills/easy-edits/SKILL.md'), 'utf8').split('\n---\n').slice(1).join('\n---\n').trim().slice(0, 200)));
    assert.equal(run(env).status, 0);
    assert.equal(fs.readFileSync(f, 'utf8'), s, 're-running gives the same file');
    // CLAUDE_CONFIG_DIR wins over ~/.claude
    assert.equal(run({ ...env, CLAUDE_CONFIG_DIR: path.join(home, 'cfg') }).status, 0);
    assert.ok(fs.existsSync(path.join(home, 'cfg/skills/easy-edits/SKILL.md')));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('install.sh --skill-only: leaves a user\'s own easy-edits skill alone; EASY_EDITS_NO_SKILL=1 skips', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-skill-'));
  try {
    const f = path.join(home, '.claude/skills/easy-edits/SKILL.md');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '---\nname: easy-edits\ndescription: mine\n---\nmy notes\n');
    const r = run({ HOME: home });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /not ours; left alone/);
    assert.match(fs.readFileSync(f, 'utf8'), /my notes/);
    const h2 = path.join(home, 'h2');
    assert.match(run({ HOME: h2, EASY_EDITS_NO_SKILL: '1' }).stdout, /skipped/);
    assert.ok(!fs.existsSync(path.join(h2, '.claude')));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('docs: README opens with the assistant install steps; CLAUDE.md / AGENTS.md point at them; doctor checks the skill', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.ok(readme.indexOf('## For AI assistants: install steps') < readme.indexOf('## Quickstart'));
  assert.match(readme, /\.claude\/skills\/easy-edits\/SKILL\.md/);
  assert.match(readme, /~\/\.claude\/skills\/easy-edits/);
  for (const f of ['CLAUDE.md', 'AGENTS.md']) assert.match(fs.readFileSync(path.join(REPO, f), 'utf8'), /For AI assistants: install steps/);
  assert.match(fs.readFileSync(path.join(REPO, 'install.sh'), 'utf8'), /check claude-skill c_skill/);
});

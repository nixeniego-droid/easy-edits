// node --test ai-video-editor/tools/test/install-home.test.mjs: the install home is always ~/.ai-video-editor; a
// pre-rename ~/.easy-edits is moved there and left as a symlink, so `. ~/.easy-edits/env.sh` keeps working.
// Runs install.sh's home functions (sourced: no install step) against a temp HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const INSTALL_SH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../install.sh');
const env = (home) => {
  const e = { PATH: process.env.PATH, HOME: home };
  for (const k of Object.keys(process.env)) if (/^(AI_VIDEO_EDITOR|EASY_EDITS)_/.test(k)) e[k] = '';
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v !== ''));
};
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ave-home-'));
const install = (h, script = 'migrate_home; write_env; link_legacy_home; echo "home=$AI_VIDEO_EDITOR_HOME models=$AI_VIDEO_EDITOR_MODELS"') =>
  spawnSync('bash', ['-c', `set -euo pipefail\n. "$1"\n${script}`, 'bash', INSTALL_SH], { encoding: 'utf8', env: env(h) });
const realEnv = (h, d) => fs.realpathSync(path.join(h, d, 'env.sh'));

test('install home: a fresh HOME gets ~/.ai-video-editor/env.sh and a ~/.easy-edits symlink to it', () => {
  const h = home();
  const r = install(h);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`home=${h}/\\.ai-video-editor `));
  assert.ok(fs.lstatSync(path.join(h, '.ai-video-editor')).isDirectory());
  assert.equal(fs.readlinkSync(path.join(h, '.easy-edits')), '.ai-video-editor');
  assert.equal(realEnv(h, '.easy-edits'), realEnv(h, '.ai-video-editor'));
  assert.equal(install(h).status, 0);   // idempotent: the symlink is left as is
  assert.equal(fs.readlinkSync(path.join(h, '.easy-edits')), '.ai-video-editor');
  fs.rmSync(h, { recursive: true, force: true });
});

test('install home: a pre-rename ~/.easy-edits is moved (models path follows) and left as a symlink', () => {
  const h = home(), old = path.join(h, '.easy-edits');
  fs.mkdirSync(path.join(old, 'models'), { recursive: true });
  fs.writeFileSync(path.join(old, 'models', 'keep'), 'x');
  fs.writeFileSync(path.join(old, 'env.sh'), `export EASY_EDITS_MODELS="${old}/models"\n`);
  const r = install(h);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /moved .*\.easy-edits to .*\.ai-video-editor/);
  assert.match(r.stdout, new RegExp(`models=${h}/\\.ai-video-editor/models`));
  assert.equal(fs.readFileSync(path.join(h, '.ai-video-editor', 'models', 'keep'), 'utf8'), 'x');
  assert.ok(fs.lstatSync(old).isSymbolicLink());
  assert.equal(realEnv(h, '.easy-edits'), realEnv(h, '.ai-video-editor'));
  assert.match(fs.readFileSync(path.join(old, 'env.sh'), 'utf8'), /export AI_VIDEO_EDITOR_HOME=.*\.ai-video-editor"/);
  fs.rmSync(h, { recursive: true, force: true });
});

test('install home: an old ~/.easy-edits with files next to ~/.ai-video-editor is left alone', () => {
  const h = home(), old = path.join(h, '.easy-edits');
  fs.mkdirSync(old); fs.mkdirSync(path.join(h, '.ai-video-editor'));
  fs.writeFileSync(path.join(old, 'env.sh'), '# old\n');
  const r = install(h);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /legacy home/);
  assert.equal(fs.readFileSync(path.join(old, 'env.sh'), 'utf8'), '# old\n');
  assert.ok(fs.existsSync(path.join(h, '.ai-video-editor', 'env.sh')));
  fs.rmSync(h, { recursive: true, force: true });
});

test('install home: a custom AI_VIDEO_EDITOR_HOME never touches ~/.easy-edits', () => {
  const h = home(), old = path.join(h, '.easy-edits');
  fs.mkdirSync(old);
  const r = spawnSync('bash', ['-c', 'set -euo pipefail\n. "$1"\nmigrate_home; write_env; link_legacy_home', 'bash', INSTALL_SH],
    { encoding: 'utf8', env: { ...env(h), AI_VIDEO_EDITOR_HOME: path.join(h, 'custom') } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(h, 'custom', 'env.sh')));
  assert.ok(!fs.lstatSync(old).isSymbolicLink() && !fs.existsSync(path.join(h, '.ai-video-editor')));
  fs.rmSync(h, { recursive: true, force: true });
});

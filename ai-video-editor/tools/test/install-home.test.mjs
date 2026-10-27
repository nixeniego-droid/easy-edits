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

// A stale shell (or an old env.sh) still exporting the pre-rename home: the move to ~/.ai-video-editor still happens.
for (const name of ['EASY_EDITS_HOME', 'AI_VIDEO_EDITOR_HOME']) {
  test(`install home: ${name}=~/.easy-edits is moved to ~/.ai-video-editor like the default home`, () => {
    const h = home(), old = path.join(h, '.easy-edits');
    fs.mkdirSync(path.join(old, 'models'), { recursive: true });
    fs.writeFileSync(path.join(old, 'models', 'keep'), 'x');
    fs.writeFileSync(path.join(old, 'env.sh'), `export EASY_EDITS_MODELS="${old}/models"\n`);
    const r = spawnSync('bash', ['-c', 'set -euo pipefail\n. "$1"\nmigrate_home; write_env; link_legacy_home; echo "home=$AI_VIDEO_EDITOR_HOME models=$AI_VIDEO_EDITOR_MODELS"', 'bash', INSTALL_SH],
      { encoding: 'utf8', env: { ...env(h), [name]: `${old}/` } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /moved .*\.easy-edits to .*\.ai-video-editor/);
    assert.match(r.stdout, new RegExp(`home=${h}/\\.ai-video-editor models=${h}/\\.ai-video-editor/models`));
    assert.equal(fs.readFileSync(path.join(h, '.ai-video-editor', 'models', 'keep'), 'utf8'), 'x');
    assert.ok(fs.lstatSync(path.join(h, '.ai-video-editor')).isDirectory());
    assert.equal(fs.readlinkSync(old), '.ai-video-editor');
    assert.equal(realEnv(h, '.easy-edits'), realEnv(h, '.ai-video-editor'));
    const e = fs.readFileSync(path.join(h, '.ai-video-editor', 'env.sh'), 'utf8');
    assert.match(e, new RegExp(`export AI_VIDEO_EDITOR_HOME="${h}/\\.ai-video-editor"`));
    assert.match(e, new RegExp(`export AI_VIDEO_EDITOR_PIPER_MODEL="${h}/\\.ai-video-editor/models/piper/en_US-amy-low\\.onnx"`));
    assert.match(e, /export EASY_EDITS_PIPER_MODEL=/);
    fs.rmSync(h, { recursive: true, force: true });
  });
}

// The piper voice comes from AI_VIDEO_EDITOR_PIPER_CACHE when it holds the pinned files (no network); a bad copy is refused.
test('install piper: the voice is copied from AI_VIDEO_EDITOR_PIPER_CACHE and checked against its sha256', () => {
  const h = home(), cache = path.join(h, 'cache'), bin = path.join(h, 'fakebin');
  fs.mkdirSync(cache); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'piper'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });   // a piper on PATH: no pip install
  fs.writeFileSync(path.join(cache, 'en_US-amy-low.onnx'), 'x'); fs.writeFileSync(path.join(cache, 'en_US-amy-low.onnx.json'), '{}');
  // hashes of the stand-in files replace the real pins, so the test needs neither the 60 MB voice nor the network
  const script = `PIPER_ONNX_SHA=$(sha256sum "${cache}/en_US-amy-low.onnx" | cut -d' ' -f1); PIPER_JSON_SHA=$(sha256sum "${cache}/en_US-amy-low.onnx.json" | cut -d' ' -f1)
    install_piper; write_env; echo "model=$PIPER_MODEL"`;
  const run = (extra = {}) => spawnSync('bash', ['-c', `set -euo pipefail\n. "$1"\n${script}`, 'bash', INSTALL_SH],
    { encoding: 'utf8', env: { ...env(h), PATH: `${bin}:${process.env.PATH}`, AI_VIDEO_EDITOR_PIPER_CACHE: cache, ...extra } });
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  const model = path.join(h, '.ai-video-editor', 'models', 'piper', 'en_US-amy-low.onnx');
  assert.match(r.stdout, /piper voice: copying/);
  assert.equal(fs.readFileSync(model, 'utf8'), 'x');
  assert.ok(fs.existsSync(`${model}.json`));
  assert.match(fs.readFileSync(path.join(h, '.ai-video-editor', 'env.sh'), 'utf8'), new RegExp(`AI_VIDEO_EDITOR_PIPER_MODEL="${model}"`));
  r = run(); assert.equal(r.status, 0, r.stderr); assert.doesNotMatch(r.stdout, /copying/);   // present and valid: kept
  fs.rmSync(model); fs.writeFileSync(path.join(cache, 'en_US-amy-low.onnx'), 'tampered');
  r = spawnSync('bash', ['-c', `set -euo pipefail\n. "$1"\nPIPER_ONNX_SHA=${'0'.repeat(64)}; PIPER_VOICE_URL=file:///nonexistent; install_piper`, 'bash', INSTALL_SH],
    { encoding: 'utf8', env: { ...env(h), PATH: `${bin}:${process.env.PATH}`, AI_VIDEO_EDITOR_PIPER_CACHE: cache } });
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(model));
  fs.rmSync(h, { recursive: true, force: true });
});

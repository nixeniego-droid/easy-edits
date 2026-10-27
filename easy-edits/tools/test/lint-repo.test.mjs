// lint-repo: the repo itself passes; planted key-like strings, home paths and the forbidden name FAIL; the one README
// "Use with ... Bot" line is allowed once. Fixture strings are built at run time so this file passes the lint too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintRepo } from '../lint-repo.mjs';

const LINT = fileURLToPath(new URL('../lint-repo.mjs', import.meta.url));
const REPO = path.resolve(path.dirname(LINT), '../..');
const NAME = String.fromCharCode(71, 114, 111, 107);   // capitalised, as in the README line
const tree = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-edits-lint-'));
  for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), s); }
  return d;
};

test('the repo passes its own lint', () => {
  const r = spawnSync(process.execPath, [LINT, '--root', REPO], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /lint-repo: PASS/);
});

test('the README "Use with ... Bot" line is allowed once; anything else fails', () => {
  const ok = tree({ 'README.md': `# X\n\n**Use with ${NAME} Bot**\n`, 'a.mjs': 'export const x = 1;\n' });
  assert.deepEqual(lintRepo(ok), []);
  const alt = tree({ 'README.md': `Use with ${NAME} Bot (template coming soon)\n` });
  assert.deepEqual(lintRepo(alt), []);
  const twice = tree({ 'README.md': `Use with ${NAME} Bot\nUse with ${NAME} Bot\n` });
  assert.equal(lintRepo(twice).length, 1);
  const elsewhere = tree({ 'docs/x.md': `Use with ${NAME} Bot\n`, 'CHANGELOG.md': `- ${NAME.toLowerCase()} adapter\n`, [`easy-edits/gen/${NAME.toLowerCase()}.mjs`]: '\n' });
  const p = lintRepo(elsewhere);
  assert.equal(p.length, 3, JSON.stringify(p));
  assert.ok(p.some((x) => x.line === 0 && /file path/.test(x.what)));
});

test('key-like strings and home paths fail; the key text is never printed', () => {
  const fakeKey = ['s', 'k-'].join('') + 'Q'.repeat(30);
  const aws = ['AK', 'IA'].join('') + 'ABCDEFGHIJKLMNOP';
  const hard = `const api_key = "${'x'.repeat(20)}";`;
  const home = ['', 'home', 'someone', 'clip.mp4'].join('/');
  const mac = ['', 'Users', 'someone', 'x'].join('/');
  const ws = ['', 'workspace', 'proj', 'a'].join('/');
  const d = tree({ 'k.mjs': `const k = '${fakeKey}';\nconst a = '${aws}';\n${hard}\n`, 'p.md': `${home}\n${mac}\n${ws}\n`, 'ok.md': `${home} lint-repo: allow\n~/.easy-edits/cache\n` });
  const p = lintRepo(d);
  assert.equal(p.filter((x) => x.file === 'k.mjs').length, 3, JSON.stringify(p));
  assert.equal(p.filter((x) => x.file === 'p.md').length, 3, JSON.stringify(p));
  assert.equal(p.filter((x) => x.file === 'ok.md').length, 0);
  const r = spawnSync(process.execPath, [LINT, '--root', d], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes(fakeKey) && !r.stdout.includes(aws), r.stdout);
  assert.match(r.stdout, /6 problem\(s\)/);
});

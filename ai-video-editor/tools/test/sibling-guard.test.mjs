// sibling-guard find on a synthetic video-projects/ tree: symlinks, link loops, meta.json / hyperframes.json mentions.
//   node --test ai-video-editor/tools/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '../sibling-guard.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-sibling-guard-test-'));
const SRC = path.join(tmp, 'media', 'talk_30s.mp4');
fs.mkdirSync(path.dirname(SRC));
fs.writeFileSync(SRC, 'source bytes');
const VP = path.join(tmp, 'video-projects');
const put = (p, f, data) => { fs.mkdirSync(path.join(VP, p, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(VP, p, f), data); };
const link = (p, f, to) => { fs.mkdirSync(path.join(VP, p, path.dirname(f)), { recursive: true }); fs.symlinkSync(to, path.join(VP, p, f)); };

link('symlinked', 'raw/talk_30s.mp4', SRC); // gen-talk-v3's layout
link('renamedlink', 'raw/input.mp4', SRC);
link('dirlink', 'assets/media', path.dirname(SRC));
link('loop', 'raw/self', '.');
link('loop', 'raw/up', '..');
link('loop', 'raw/dangling.mp4', path.join(tmp, 'missing.mp4'));
put('loop', 'raw/other.mp4', 'unrelated');
put('meta', 'meta.json', JSON.stringify({ source: SRC, fps: 30 }));
put('hf', 'hyperframes.json', JSON.stringify({ media: [{ src: 'raw/talk_30s.mp4' }] }));
put('hfother', 'hyperframes.json', JSON.stringify({ media: [{ src: 'raw/other.mp4' }] }));
put('other', 'raw/other.mp4', 'unrelated');
put('excluded', 'raw/talk_30s.mp4', 'x');

function find(src, ...args) {
  const r = spawnSync('node', [TOOL, 'find', VP, src, ...args], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  return { found: r.stdout.trim().split('\n').filter(Boolean).sort(), stderr: r.stderr };
}

test('symlinks to the source count (same name, other name, linked dir); loops and dangling links are harmless', () => {
  const { found } = find(SRC, '--exclude', 'excluded');
  assert.deepEqual(found, ['dirlink', 'hf', 'meta', 'renamedlink', 'symlinked']);
});

test('meta.json / hyperframes.json mentioning the source path or basename count; other mentions do not', () => {
  const { found } = find(SRC, '--exclude', 'excluded');
  assert.ok(found.includes('meta') && found.includes('hf'));
  assert.ok(!found.includes('hfother') && !found.includes('other') && !found.includes('loop'));
});

test('a project that really holds the source is skipped; one that only links to it is not', () => {
  put('holder', 'raw/clip.mp4', 'holder bytes');
  put('holdercopy', 'raw/copy.mp4', 'holder bytes');
  const own = path.join(VP, 'holder/raw/clip.mp4');
  const r = find(own);
  assert.match(r.stderr, /holder holds the source itself/);
  assert.deepEqual(r.found, ['holdercopy']);
  // the source passed as the symlink inside `symlinked` resolves outside it: still a sibling
  const viaLink = find(path.join(VP, 'symlinked/raw/talk_30s.mp4'), '--exclude', 'excluded');
  assert.doesNotMatch(viaLink.stderr, /symlinked holds the source/);
  assert.ok(viaLink.found.includes('symlinked'));
  fs.rmSync(path.join(VP, 'holder'), { recursive: true });
  fs.rmSync(path.join(VP, 'holdercopy'), { recursive: true });
});

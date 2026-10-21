// final-fresh: a composition file edited after the final render FAILs. gen_th_style2b (real mtimes:
// index.html 14:30:22, assets <= 14:30:22, raw render 14:31:08, final 14:37:39) is fresh: its final matches
// index.html, so s2e's card-fill timing mismatch is not a stale render.
//   node --test easy-edits/check/test/final-fresh.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { staleFiles } from '../final-fresh.mjs';
// renders that some tests read (skipped when absent): <repo>/../renders, or EASY_EDITS_TEST_RENDERS
const RENDERS = process.env.EASY_EDITS_TEST_RENDERS || new URL('../../../renders', import.meta.url).pathname;

test('synthetic: index.html or an asset edited after the final FAILs', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-fresh-')), fin = path.join(d, 'final.mp4');
  fs.mkdirSync(path.join(d, 'assets')); fs.writeFileSync(path.join(d, 'index.html'), 'x'); fs.writeFileSync(path.join(d, 'assets/plan.json'), '{}'); fs.writeFileSync(fin, 'v');
  const at = (f, s) => fs.utimesSync(path.join(d, f), s, s), now = Date.now() / 1000;
  at('final.mp4', now); at('index.html', now - 60); at('assets/plan.json', now - 60);
  assert.deepEqual(staleFiles(d, fin), []);
  at('index.html', now + 30);
  assert.deepEqual(staleFiles(d, fin).map((b) => b.file), ['index.html']);
  at('assets/plan.json', now + 1); // inside the 2 s tolerance
  assert.deepEqual(staleFiles(d, fin).map((b) => b.file), ['index.html']);
});
const proj = path.resolve(import.meta.dirname, '../../../video-projects/gen-th-style2b'), final = RENDERS + '/gen_th_style2b.mp4';
test('gen_th_style2b: the final is newer than index.html and assets (not stale)', { skip: !fs.existsSync(final) || !fs.existsSync(path.join(proj, 'index.html')) }, () => {
  // read-only mtime comparison of the live project (the frozen fixture has checkout mtimes)
  const idx = fs.statSync(path.join(proj, 'index.html')).mtimeMs, fin = fs.statSync(final).mtimeMs;
  if (idx > fin) return; // the project was resumed after this final; nothing to assert
  assert.deepEqual(staleFiles(proj, final), []);
});

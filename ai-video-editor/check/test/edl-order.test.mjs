// edl-order on the real gen_nasa2_v3 keeps (fixtures/nasa2_v3.keeps.json): as rendered (source order, PASS) and
// with "and my focus is landslide modeling" (source 6.86-8.4) moved ahead of the intro (FAIL unless plan.json
// declares a deliberate hook).
//   node --test ai-video-editor/check/test/edl-order.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { edlOrder } from '../edl-order.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { keeps } = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/nasa2_v3.keeps.json'), 'utf8'));
// hook-first variant: 6.86-8.4 first, then 0-6.86, then the rest
const hooked = [{ sourceStart: 6.86, sourceEnd: 8.4 }, { sourceStart: 0, sourceEnd: 6.86 }, ...keeps.slice(1)];

test('gen_nasa2_v3 keeps as rendered are in source order', () => assert.equal(edlOrder(keeps).pass, true));
test('focus-first reorder fails without a deliberate hook', () => {
  const r = edlOrder(hooked);
  assert.equal(r.pass, false); assert.equal(r.moves[0].keep, 1);
  assert.equal(edlOrder(hooked, { hook: { deliberate: true } }).pass, false, 'a hook needs a reason');
  assert.equal(edlOrder(hooked, { hook: { deliberate: true, reason: 'open on the payoff' } }).pass, true);
});
test('CLI prints the FAIL line and exits 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-edl-order-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets/edit-decisions.json'), JSON.stringify({ keeps: hooked }));
  const r = spawnSync('node', [path.join(HERE, '../edl-order.mjs'), dir], { encoding: 'utf8' });
  console.log(r.stdout.trim());
  assert.equal(r.status, 1); assert.match(r.stdout, /FAIL keep 1 \(source 0 s\) plays after source 6\.86 s/);
});

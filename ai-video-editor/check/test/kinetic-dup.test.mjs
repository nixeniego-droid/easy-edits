// kinetic-dup: the real gen-th-style1 dom-sample runs (fixtures/style1.runs.json, kinetic + caption runs).
//   node --test ai-video-editor/check/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkKineticDup } from '../kinetic-dup.mjs';

const rs = JSON.parse(fs.readFileSync(new URL('fixtures/style1.runs.json', import.meta.url), 'utf8'));

test('gen-th-style1: RELATIONSHIP kinetic twice, IMPORTANCE kinetic over its caption at ~0:03', () => {
  const bad = checkKineticDup(rs).bad;
  assert.ok(bad.some((b) => b.word === 'relationship' && b.why === 'kinetic twice' && b.b.id === 'c-c'));
  assert.ok(bad.some((b) => b.word === 'importance' && b.why === 'kinetic over the same caption' && Math.abs(b.a.start - 3.2) < 0.1));
});

test('gen-th-style1 with the second RELATIONSHIP dropped and captions hidden under kinetic words passes', () => {
  const kin = rs.filter((r) => r.kind === 'kinetic' && r.id !== 'c-c');
  const caps = rs.filter((r) => r.kind === 'cap' && !kin.some((k) => k.start < r.end && r.start < k.end));
  assert.deepEqual(checkKineticDup([...kin, ...caps]).bad, []);
});

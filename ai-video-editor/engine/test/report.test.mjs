import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicReport } from '../report.mjs';

test('delivery PASS moves gate FAILs under diagnostics as info', () => {
  const r = publicReport({
    mode: 'clean-cut',
    exports: [{ format: '9x16', pass: true, check: 'PASS  loudness\nDELIVERY PASS', note: 'phrase(s) the speaker uses in two different places (not a retake): "warmest year on record" x2 (reused: "warmest year on record" / "warmest year on record")', gates: 'clean-cut: gate seconds: cuts=1' }],
    cleanCut: [
      'clean-cut: gate cuts FAIL (1): boundary',
      'clean-cut: gate room FAIL (1): join',
      'clean-cut: gate seconds: cuts=1',
    ],
  });
  assert.equal(r.cleanCut, undefined);
  assert.ok(r.diagnostics?.gates?.length);
  assert.ok(r.diagnostics.gates.every((g) => !/\bFAIL\b/.test(g)));
  assert.ok(r.diagnostics.gates.some((g) => /gate cuts info/.test(g)));
  assert.equal(r.exports[0].gates, undefined);
  assert.match(r.exports[0].note, /The phrase "warmest year on record" is said 2 times; that is fine/);
  assert.doesNotMatch(r.exports[0].check, /\bFAIL\b/);
});

test('delivery FAIL keeps gate FAIL detail', () => {
  const r = publicReport({
    exports: [{ pass: false, check: 'FAIL  loudness\nDELIVERY FAIL' }],
    cleanCut: ['clean-cut: gate cuts FAIL (1): x'],
  });
  assert.deepEqual(r.cleanCut, ['clean-cut: gate cuts FAIL (1): x']);
});

test('plain misheard note on delivery PASS', () => {
  const r = publicReport({
    mode: 'clean-cut',
    exports: [{
      format: '9x16', pass: true,
      note: 'heard repeat(s) the reference does not have (ASR mishearing, not a repeat): "warmest year on record" x2',
      check: 'NOTE  no-repeat  heard repeat(s) the reference does not have (ASR mishearing, not a repeat): "warmest year on record" x2\nDELIVERY PASS',
    }],
  });
  assert.match(r.exports[0].note, /delivery check heard "warmest year on record"/);
  assert.doesNotMatch(r.exports[0].note, /ASR mishearing/);
  assert.match(r.exports[0].check, /NOTE  The delivery check heard "warmest year on record"/);
});

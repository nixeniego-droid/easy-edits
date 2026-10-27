import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicReport } from '../report.mjs';

test('delivery PASS hides cleanCut gate FAILs under diagnostics', () => {
  const raw = {
    mode: 'clean-cut',
    exports: [{ format: '9x16', file: 'x.mp4', pass: true, note: 'ok', check: 'PASS  loudness\nDELIVERY PASS', gates: 'clean-cut: gate face FAIL (1): OVER FACE' }],
    cleanCut: [
      'clean-cut: gate cuts FAIL (1): …',
      'clean-cut: gate face FAIL (1): OVER FACE',
      'clean-cut: gate seconds: stale=0',
    ],
  };
  const r = publicReport(raw);
  assert.equal(r.cleanCut, undefined);
  assert.ok(r.diagnostics.gates.some((l) => /face FAIL/.test(l)));
  assert.equal(r.exports[0].gates, undefined);
  assert.ok(r.exports[0].diagnostics.gates.includes('OVER FACE'));
  const user = { ...r, diagnostics: undefined, exports: r.exports.map(({ diagnostics, ...e }) => e) };
  assert.doesNotMatch(JSON.stringify(user), /gate \w+ FAIL/);
  assert.doesNotMatch(JSON.stringify(user), /OVER FACE/);
});

test('delivery FAIL keeps checks visible', () => {
  const raw = {
    exports: [{ pass: false, note: 'FAIL loudness', check: 'FAIL  loudness\nDELIVERY FAIL' }],
    cleanCut: ['clean-cut: gate face FAIL (1): x'],
  };
  const r = publicReport(raw);
  assert.ok(r.cleanCut);
  assert.match(r.exports[0].check, /FAIL  loudness/);
});

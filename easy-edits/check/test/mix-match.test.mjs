// mix-match on synthetic envelopes (no media).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareMix } from '../mix-match.mjs';

const env = Array.from({ length: 1000 }, (_, i) => (Math.sin(i / 7) > 0 ? -20 - 5 * Math.sin(i / 3) : -70));
test('the same mix (with a lead-in) passes; another mix, a shifted or truncated one fails', () => {
  const lead = [...Array(20).fill(-90), ...env];
  assert.equal(compareMix(env, env, 10, 10).pass, true);
  assert.equal(compareMix(env, lead, 10, 10.2).pass, true);
  const other = env.map((v, i) => (Math.sin(i / 11) > 0 ? -22 : -70));
  assert.equal(compareMix(env, other, 10, 10).pass, false);
  assert.equal(compareMix(env, [...Array(13).fill(-90), ...env], 10, 10.13).pass, true, 'lag from the duration difference');
  assert.equal(compareMix(env, [...Array(5).fill(-90), ...env.slice(0, 995)], 10, 10).pass, false, 'shifted 50 ms with no lead-in');
  assert.equal(compareMix(env, env.slice(0, 900), 10, 9).pass, false, 'truncated');
  assert.equal(compareMix(env, [...env, -90, -90, -90], 10, 10.033).pass, true, 'video frame rounding: a longer final, same audio at lag 0');
});

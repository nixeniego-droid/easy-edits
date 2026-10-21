import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomTone, joinsFromKeeps, SR } from '../room-tone.mjs';

let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const noise = (s, amp) => Float32Array.from({ length: Math.round(s * SR) }, () => amp * rnd());
const cat = (...a) => { const o = new Float32Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const fade = (x, ms, dir) => { const n = Math.round(ms * SR / 1000); for (let i = 0; i < n; i++) { const g = i / n; if (dir === 'out') x[x.length - 1 - i] *= g; else x[i] *= g; } return x; };

test('joins from keeps (end or cumulative)', () => {
  assert.deepEqual(joinsFromKeeps([{ start: 0, end: 1.2 }, { start: 1.2, end: 2 }, { start: 2, end: 3 }]), [1.2, 2]);
  assert.deepEqual(joinsFromKeeps([{ sourceStart: 1, sourceEnd: 2 }, { sourceStart: 3, sourceEnd: 3.5 }]), [1]);
});

test('continuous ambience across a crossfaded join passes', () => {
  const a = noise(1, 0.01), b = noise(1, 0.012), n = Math.round(0.03 * SR), x = new Float32Array(a.length + b.length - n);
  x.set(a.subarray(0, a.length - n)); for (let i = 0; i < n; i++) x[a.length - n + i] = a[a.length - n + i] * (1 - i / n) + b[i] * (i / n); x.set(b.subarray(n), a.length);
  const r = roomTone(x, [1 - 0.015]); assert.equal(r.pass, true, JSON.stringify(r));
});

test('a drop to silence at the join fails', () => {
  const x = cat(fade(noise(1, 0.01), 20, 'out'), new Float32Array(Math.round(0.04 * SR)), fade(noise(1, 0.01), 20, 'in'));
  const r = roomTone(x, [1.02]); assert.equal(r.pass, false); assert.ok(r.joins[0].drop && r.silences.length);
});

test('an unfaded splice (DC step) clicks', () => {
  const a = noise(1, 0.005).map((v) => v + 0.2), b = noise(1, 0.005).map((v) => v - 0.2);
  const r = roomTone(cat(a, b), [1]); assert.equal(r.pass, false); assert.ok(r.joins[0].click);
});

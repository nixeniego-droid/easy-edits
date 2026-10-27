// The delivery check's repeat gate on intentionally looped sources (check/lib/repeats.mjs detectLoop): a test clip
// made by looping one stretch of speech (/tmp/ave-polish big.avi, captions mode heard the same 27 words x3) is a
// NOTE, not a no-repeat FAIL; a spliced duplicate (2 copies) or a repeat off the loop period still FAILs.
//   node --test ai-video-editor/check/test/delivery-loop.test.mjs
// The last test runs delivery.mjs on samples/talk.mp4 looped x4 (needs ffmpeg and the ~/.ai-video-editor venv;
// skipped without them).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectLoop, repeatFindings } from '../lib/repeats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const toks = (s) => s.split(/\s+/).filter(Boolean);
// one period of big.avi's speech as the delivery check heard it (27 words)
const PERIOD = 'Last year was the sixth warmest year on record, which is slightly down from the warmest tier on record that we had last year. But it\'s just,';
const timed = (ws, step = 0.3) => ws.map((text, i) => ({ text, start: i * step, end: i * step + 0.25 }));

test('looped source (one period x3): loop detected, every repeat is a loop note', () => {
  const heard = timed(toks(`${PERIOD} ${PERIOD} ${PERIOD}`));
  const loop = detectLoop(heard);
  assert.ok(loop, 'loop not detected');
  assert.equal(loop.periodWords, 27);
  assert.equal(loop.copies, 3);
  assert.ok(Math.abs(loop.periodSec - 8.1) < 0.01, `periodSec ${loop.periodSec}`);
  const reps = repeatFindings(heard, null, { loop });
  assert.ok(reps.length > 0);
  assert.ok(reps.every((x) => x.verdict === 'loop' && !x.real), JSON.stringify(reps.filter((x) => x.real)));
  // without the loop it is the old FAIL
  assert.ok(repeatFindings(heard, null).some((x) => x.real));
});

test('looped source with ASR drift at the seams (a word dropped / changed per copy) is still a loop', () => {
  const p = toks(PERIOD);
  const heard = [...p, ...p.slice(1), ...p.map((w) => (w === 'tier' ? 'tear' : w)), ...p.slice(0, 20)];
  const loop = detectLoop(heard);
  assert.ok(loop, 'loop not detected');
  assert.ok(Math.abs(loop.periodWords - 27) <= 1);
  assert.ok(repeatFindings(heard, null, { loop }).every((x) => !x.real));
});

test('spliced duplicate (2 copies of a phrase) is not a loop and still FAILs', () => {
  for (const heard of [
    toks('Europa Clipper is a massive spacecraft. Europa Clipper is a massive spacecraft.'),
    toks(`${PERIOD} ${PERIOD}`), // the whole clip twice: indistinguishable from a doubled splice
    toks(`So today we talk about orbits. ${PERIOD} ${PERIOD} And that is why the data matters so much to us.`),
  ]) {
    assert.equal(detectLoop(heard), null, heard.join(' '));
    assert.ok(repeatFindings(heard, null, { loop: detectLoop(heard) }).some((x) => x.real));
  }
});

test('a retake off the loop period inside a looped clip still FAILs', () => {
  const p = toks(PERIOD), retake = toks('the data shows us clearly the data shows us clearly');
  const heard = [...p, ...p, ...retake, ...p, ...p];
  const loop = detectLoop(heard);
  assert.ok(loop, 'loop not detected');
  const real = repeatFindings(heard, null, { loop }).filter((x) => x.real);
  assert.ok(real.some((x) => x.key === 'the data shows us'), JSON.stringify(real));
});

// samples/talk.mp4 says "warmest year on record" twice in one period: looped x4 that is 8 occurrences, 2 loop chains
const TALK = fs.readFileSync(path.join(HERE, '../../../samples/script.txt'), 'utf8');
test('a phrase repeated within one loop period is judged once per chain (x2, not x8)', () => {
  const heard = toks(`${TALK} ${TALK} ${TALK} ${TALK}`);
  const loop = detectLoop(heard);
  assert.ok(loop, 'loop not detected');
  const real = repeatFindings(heard, null, { loop }).filter((x) => x.real);
  assert.deepEqual(real.map((x) => [x.key, x.count]), [['warmest year on record', 2]]); // no reference: unchecked, as unlooped
  const withRef = repeatFindings(heard, toks(TALK), { loop });
  assert.ok(withRef.every((x) => !x.real), JSON.stringify(withRef.filter((x) => x.real)));
  assert.ok(withRef.some((x) => x.key === 'warmest year on record' && x.verdict === 'reused'));
});

test('clean speech: no loop, no repeat', () => {
  const heard = toks('Few people end up somewhere on purpose. And these are the people with vision. Vision helps us arrive at a preferred future destination. So the principle of vision is, it gives us direction.');
  assert.equal(detectLoop(heard), null);
  assert.deepEqual(repeatFindings(heard, null, { loop: null }), []);
});

test('a phrase reused far apart in natural speech is not a loop', () => {
  const heard = toks('the sixth warmest year on record is what we saw and then the coldest winter came and went and after a long and quiet spring the sixth warmest year on record was over');
  assert.equal(detectLoop(heard), null);
});

// integration: samples/talk.mp4 looped x4 (-stream_loop 3 -c copy) through the real delivery check
const SAMPLE = path.join(HERE, '../../../samples/talk.mp4');
const PY = process.env.AI_VIDEO_EDITOR_PYTHON || path.join(process.env.AI_VIDEO_EDITOR_HOME || path.join(os.homedir(), '.ai-video-editor'), 'venv/bin/python');
const skip = !fs.existsSync(SAMPLE) ? `missing ${SAMPLE}` : !fs.existsSync(PY) ? `missing ${PY}` : spawnSync('ffmpeg', ['-version']).status !== 0 ? 'no ffmpeg' : false;
test('delivery.mjs on samples/talk.mp4 looped x4 (--reference: its script): no-repeat PASS with a loop NOTE', { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-delivery-loop-'));
  try {
    const looped = path.join(tmp, 'talk-x4.mp4');
    const f = spawnSync('ffmpeg', ['-v', 'error', '-y', '-stream_loop', '3', '-i', SAMPLE, '-c', 'copy', looped], { encoding: 'utf8' });
    assert.equal(f.status, 0, f.stderr);
    // the reference is the sample's script once (talk.mp4 itself says "warmest year on record" twice, a reused note)
    const ref = path.join(tmp, 'ref.json');
    fs.writeFileSync(ref, JSON.stringify({ words: toks(TALK).map((text) => ({ text })) }));
    const r = spawnSync(process.execPath, [path.join(HERE, '../delivery.mjs'), looped, '--reference', ref], { encoding: 'utf8' });
    assert.ok(r.status === 0 || r.status === 1, `delivery.mjs errored (${r.status}): ${r.stderr}`);
    assert.match(r.stdout, /^PASS {2}no-repeat /m, r.stdout);
    assert.match(r.stdout, /^NOTE {2}no-repeat {2}this looks like a looped source .* repeated 4 times/m, r.stdout);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

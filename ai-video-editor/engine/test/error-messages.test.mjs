// node --test ai-video-editor/engine/test/error-messages.test.mjs: stranger-facing errors name the problem and the next
// command; exit 1 (delivery FAIL) says the video is written and which check failed; no speech is refused (exit 2)
// before a render. No render, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireSpeech, NoSpeechError } from '../final-output.mjs';
import { deliveryFailText } from '../../cli/main.mjs';
import { deliveryFailText as newDeliveryFailText } from '../../new/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(HERE, '../../cli/main.mjs');
const cli = (args, cwd) => spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8', cwd, env: { ...process.env, AI_VIDEO_EDITOR_AGENT: 'none' } });

test('requireSpeech: no words (or only zero-length ones) is a NoSpeechError naming the input and the sample', () => {
  assert.throws(() => requireSpeech([], '/x/silent.mp4'), (e) => e instanceof NoSpeechError && /no speech detected in \/x\/silent\.mp4 \(the transcript is empty\); use a clip with clear speech \(try samples\/talk\.mp4\)\.\n.*--lang en/.test(e.message));
  // Whisper on pure silence: one hallucinated zero-length word (seen: "ychwanegwch." at 0.18-0.18 s) is no speech
  assert.throws(() => requireSpeech([{ text: 'ychwanegwch.', start: 0.18, end: 0.18 }], 's.mp4'), NoSpeechError);
  const w = [{ text: 'hi', start: 0, end: 0.3 }];
  assert.equal(requireSpeech(w, 'a.mp4'), w);
});

test('delivery FAIL text: not a crash, the video is written, each failing check, what to open next', () => {
  const out = '/tmp/o';
  const t = deliveryFailText([{ file: '/tmp/o/ai-video-editor_captions_x.mp4', pass: false, note: 'FAIL loudness', check: 'PASS  duration   4.6 s\nFAIL  loudness   -30.1 LUFS (want -14 +-1)\nDELIVERY FAIL (loudness)' }], out, '/tmp/o/ai-video-editor_captions_x.report.json');
  assert.match(t, /final check flagged something \(exit 1\)\. This is not a crash: the video is written/);
  assert.match(t, /ai-video-editor_captions_x\.mp4: FAIL loudness/);
  assert.match(t, /FAIL {2}loudness {3}-30\.1 LUFS/);
  assert.doesNotMatch(t, /PASS {2}duration/);
  assert.match(t, /_sheet\.png.*ai-video-editor_captions_x\.report\.json/s);
  assert.match(t, /KNOWN_ISSUES\.txt/);
});

test('delivery FAIL text: "0 words heard" adds a plain no-speech line', () => {
  const e = { file: '/o/a.mp4', pass: false, note: 'FAIL transcript', check: 'FAIL  first-word no speech detected\nFAIL  transcript 0 words heard' };
  assert.match(deliveryFailText([e], '/o', '/o/a.report.json'), /No speech was heard in the video: use a clip with clear speech \(try samples\/talk\.mp4\)/);
  assert.doesNotMatch(deliveryFailText([{ ...e, check: 'FAIL  loudness   -30 LUFS' }], '/o', '/o/a.report.json'), /No speech/);
});

test('new / resume delivery FAIL text: the failing checks and the repin -> approve route', () => {
  const t = newDeliveryFailText('new', { out: '/tmp/n', report: { outputs: [{ file: 'final.mp4', pass: false, checks: ['loudness: -14.2 LUFS OK', 'length: 9.0 s (target 1 s) FAIL'] }] } });
  assert.match(t, /^ai-video-editor new: delivery FAIL \(exit 1\)\. This is not a crash: the video is written under \/tmp\/n/);
  assert.match(t, /final\.mp4:\n {4}length: 9\.0 s \(target 1 s\) FAIL/);
  assert.doesNotMatch(t, /loudness/);
  assert.match(t, /REVIEW\.txt.*new repin/s);
});

test('CLI: a missing -o, a missing input or no input each print the next command (exit 2)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ave-err-'));
  try {
    fs.writeFileSync(path.join(d, 'a.mp4'), 'x');
    let r = cli(['captions', 'a.mp4'], d);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /-o <out-dir> is required.*\n {2}ai-video-editor captions a\.mp4 -o out\//);
    r = cli(['nope.mp4', '-o', 'out'], d);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /input not found: .*nope\.mp4\n.*\n {2}ai-video-editor clean-cut \S*samples\/talk\.mp4 -o out\//);
    r = cli(['talking-head', '-o', 'out'], d);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /needs a video .*\n {2}ai-video-editor talking-head \S*samples\/talk\.mp4 -o out\//);
    r = cli(['a.mp4', '-o', 'out', '--plan', 'p.json'], d);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--plan file not found: .*p\.json\nMake one with: ai-video-editor clean-cut a\.mp4 -o out\/ --plan-only/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('CLI new: missing --brand / -o / plan say what to run next (exit 2), no doubled "new: new" prefix', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ave-err-'));
  try {
    let r = cli(['new', 'promo', '-o', 'out/p'], d);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^ai-video-editor new promo: needs --brand brand\.json .*ai-video-editor new promo --init-brand brand\//m);
    r = cli(['new', 'presenter', '--brief', 'hi'], d);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /-o <out-dir> is required.*ai-video-editor new presenter -o out\/presenter/);
    r = cli(['resume', 'out/never'], d);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no plan at .*out\/never\/plan\.json; plan first: ai-video-editor new <type> -o /);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

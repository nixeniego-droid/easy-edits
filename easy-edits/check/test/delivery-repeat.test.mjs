// Regression test for the delivery check's repeat gate (and its silencedetect first/last edges).
//   node --test easy-edits/check/test/*.test.mjs   (needs ffmpeg, ~/.easy-edits venv; source ~/.easy-edits/env.sh first)
// Builds clips in a temp dir from raw-media/porter_30s.mp4 (gitignored source; the test skips without it):
//   spliced  0.4 s silence + "Europa Clipper is a massive spacecraft" (0.60-3.10 s) twice + 0.4 s silence
//   clean    0.4 s silence + "Europa Clipper ... kind of pretty." (0.60-6.10 s) once + 0.4 s silence
// The spliced clip must FAIL no-repeat (with or without --reference); the clean one must PASS it. Both must PASS first/last (padded).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '../../../raw-media/porter_30s.mp4');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-delivery-test-'));

// pad + chunk x n + pad, as a 1080x1920 30 fps mp4 (black frames, 48 kHz stereo AAC)
function clip(name, a, b, n) {
  const out = path.join(tmp, name);
  const pad = 'anullsrc=r=48000:cl=stereo,atrim=0:0.4';
  const parts = ['[p0]', ...Array.from({ length: n }, (_, i) => `[c${i}]`), '[p1]'];
  const fc = [`${pad}[p0]`, `${pad}[p1]`,
    `[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,asplit=${n}${parts.slice(1, -1).join('')}`,
    `${parts.join('')}concat=n=${n + 2}:v=0:a=1[a]`].join(';');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', SRC, '-f', 'lavfi', '-i', 'color=black:s=1080x1920:r=30',
    '-filter_complex', fc, '-map', '1:v', '-map', '[a]', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return out;
}

function check(video, extra = []) {
  const r = spawnSync(process.execPath, [path.join(HERE, '../delivery.mjs'), video, ...extra], { encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1, `delivery.mjs errored (${r.status}): ${r.stderr}`);
  const lines = Object.fromEntries([...r.stdout.matchAll(/^(PASS|FAIL) {2}(\S+)\s+(.*)$/gm)].map((m) => [m[2], { pass: m[1] === 'PASS', msg: m[3] }]));
  return { out: r.stdout, lines };
}

const skip = fs.existsSync(SRC) ? false : `missing ${SRC}`;

test('spliced repeat of a 6-word phrase fails no-repeat', { skip }, () => {
  const { out, lines } = check(clip('spliced.mp4', 0.60, 3.10, 2));
  assert.equal(lines['no-repeat']?.pass, false, out);
  assert.equal(lines['first-word']?.pass, true, out);
  assert.equal(lines['last-word']?.pass, true, out);
});

test('clean clip passes no-repeat', { skip }, () => {
  const { out, lines } = check(clip('clean.mp4', 0.60, 6.10, 1));
  assert.equal(lines['no-repeat']?.pass, true, out);
  assert.equal(lines['first-word']?.pass, true, out);
  assert.equal(lines['last-word']?.pass, true, out);
});

// --reference (the words the edit put on screen): the phrase is in it ONCE, so the spliced repeat is extra audio
// and still FAILs; a mishearing would only be a NOTE (check/test/repeat-reference.test.mjs)
test('spliced repeat still fails no-repeat with a --reference that has the phrase once', { skip }, () => {
  const ref = path.join(tmp, 'ref.json');
  fs.writeFileSync(ref, JSON.stringify({ words: ['Europa', 'Clipper', 'is', 'a', 'massive', 'spacecraft.'].map((text) => ({ text })) }));
  const { out, lines } = check(clip('spliced-ref.mp4', 0.60, 3.10, 2), ['--reference', ref]);
  assert.equal(lines['no-repeat']?.pass, false, out);
  assert.match(lines['no-repeat'].msg, /\(extra/, out);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

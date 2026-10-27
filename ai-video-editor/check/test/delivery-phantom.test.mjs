// Regression test for the delivery check's speech-backing filter (phantom outro words over a music tail).
//   node --test ai-video-editor/check/test/*.test.mjs   (needs ffmpeg, ~/.ai-video-editor venv; source ~/.ai-video-editor/env.sh first)
//   real     renders/gen_screen.mp4 copied to a temp dir (gitignored; skipped without it). Whisper decodes its
//            last ~1 s as a separate window into "Thanks for watching, and I'll see you in the next video.",
//            which the TTS narration never says. Those words must be dropped, and last-word must name "facts.".
//            Synthetic beds (silence, brown noise, a tone mix under porter speech with 0.6-4.5 s tails) and
//            excerpts of the real file did not reproduce the phantom window, so the test uses the whole file.
//   bed      raw-media/porter_30s.mp4 0.60-6.10 s with a quiet tone-mix bed under it and 2 s of the bed after
//            it: nothing may be dropped (the bed must not make real words look unbacked) and it stays 17 words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(HERE, '../../../renders/gen_screen.mp4');
const NARR = path.join(HERE, '../../../test-media/screen/narr.txt');
const SRC = path.join(HERE, '../../../raw-media/porter_30s.mp4');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-phantom-test-'));

function check(video, ...args) {
  const r = spawnSync(process.execPath, [path.join(HERE, '../delivery.mjs'), video, ...args], { encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1, `delivery.mjs errored (${r.status}): ${r.stderr}`);
  const lines = Object.fromEntries([...r.stdout.matchAll(/^(PASS|FAIL) {2}(\S+)\s+(.*)$/gm)].map((m) => [m[2], { pass: m[1] === 'PASS', msg: m[3] }]));
  return { out: r.stdout, lines, heard: /^heard: (.*)$/m.exec(r.stdout)?.[1] ?? '', dropped: /^dropped .*?: (.*)$/m.exec(r.stdout)?.[1] ?? '' };
}

test('phantom outro over the tail of gen_screen is dropped', { skip: fs.existsSync(REAL) ? false : `missing ${REAL}` }, () => {
  const video = path.join(tmp, 'gen_screen.mp4');
  fs.copyFileSync(REAL, video);
  const { out, lines, heard, dropped } = check(video, ...(fs.existsSync(NARR) ? ['--script', NARR] : []));
  assert.match(heard, /Three clicks to the facts\.$/, out);
  assert.doesNotMatch(heard, /watching|next video/i, out);
  assert.match(dropped, /Thanks for watching/, out);
  assert.equal(lines['last-word']?.pass, true, out);
  assert.match(lines['last-word'].msg, /last word "facts\."/, out);
  if (lines.outro) assert.equal(lines.outro.pass, true, out);
});

test('real words under a music-like bed are kept', { skip: fs.existsSync(SRC) ? false : `missing ${SRC}` }, () => {
  const video = path.join(tmp, 'bed.mp4');
  const bed = 'aevalsrc=0.02*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*2*t))+0.015*sin(2*PI*330*t)+0.01*sin(2*PI*110*t):s=48000';
  const fc = ['anullsrc=r=48000:cl=stereo,atrim=0:0.4[p]',
    '[0:a]atrim=0.60:6.10,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[v]',
    '[p][v]concat=n=2:v=0:a=1,apad=pad_dur=2[sp]', '[1:a]aformat=sample_rates=48000:channel_layouts=stereo[b]',
    '[sp][b]amix=inputs=2:duration=first:normalize=0[a]'].join(';');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', SRC, '-f', 'lavfi', '-i', bed, '-f', 'lavfi', '-i', 'color=black:s=1080x1920:r=30',
    '-filter_complex', fc, '-map', '2:v', '-map', '[a]', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', video], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const { out, lines, heard, dropped } = check(video);
  assert.equal(dropped, '', out);
  assert.match(heard, /^Europa Clipper .* kind of pretty\.$/, out);
  assert.equal(lines.transcript?.msg, '17 words heard', out);
  assert.equal(lines['no-repeat']?.pass, true, out);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

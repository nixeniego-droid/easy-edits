// fetch-input.sh: URL -> local mp4 via yt-dlp (a fake yt-dlp here, so no network): stdout is only the path, the
//   format/merge flags, reuse without a second download, --cookies validated and copied (the user's file is never
//   written), friendly errors with both options and exit 4, a file without audio rejected (exit 5), usage errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FETCH = path.join(HERE, '../fetch-input.sh');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-fetch-input-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// fake yt-dlp: logs its args, then per FAKE_MODE writes a 1 s mp4 into -P and prints it, or fails like yt-dlp does
const FAKE = path.join(dir, 'yt-dlp');
fs.writeFileSync(FAKE, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
P=. C=; while [ $# -gt 0 ]; do case "$1" in -P) P="$2"; shift ;; --cookies) C="$2"; shift ;; esac; shift; done
[ -n "$C" ] && echo "# written back by yt-dlp" >> "$C"
case "$FAKE_MODE" in
  ok|noaudio) f="$P/Youtube-abc123.mp4"
    a=(-f lavfi -i sine=d=1); [ "$FAKE_MODE" = noaudio ] && a=()
    ffmpeg -v error -y -f lavfi -i testsrc=d=1:s=320x240 "\${a[@]}" -shortest -c:v libx264 -c:a aac "$f" || exit 9
    echo "$f" ;;
  bot) echo "ERROR: [youtube] abc123: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies" >&2; exit 1 ;;
  geo) echo "ERROR: [youtube] abc123: The uploader has not made this video available in your country" >&2; exit 1 ;;
  private) echo "ERROR: [youtube] abc123: Private video. Sign in if you've been granted access to this video" >&2; exit 1 ;;
  gone) echo "ERROR: [youtube] abc123: This video is unavailable" >&2; exit 1 ;;
esac
`, { mode: 0o755 });

const LOG = path.join(dir, 'calls.log');
const run = (args, mode = 'ok') => spawnSync('bash', [FETCH, ...args], {
  encoding: 'utf8', cwd: dir,
  env: { ...process.env, EASY_EDITS_YTDLP: FAKE, EASY_EDITS_HOME: path.join(dir, 'home'), FAKE_MODE: mode, FAKE_LOG: LOG },
});
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : []);
const VURL = 'https://www.youtube.com/watch?v=abc123';

test('downloads into --work-dir, prints only the path, asks for <=1080p merged mp4; second run reuses it', () => {
  const work = path.join(dir, 'w1');
  const r = run([VURL, '--work-dir', work]);
  assert.equal(r.status, 0, r.stderr);
  const file = path.join(work, 'Youtube-abc123.mp4');
  assert.equal(r.stdout, file + '\n');
  assert.ok(fs.existsSync(file));
  const a = calls().at(-1);
  assert.match(a, /height<=1080/);
  assert.match(a, /--merge-output-format mp4/);
  assert.match(a, /--no-playlist/);
  assert.match(a, /-- https:\/\/www\.youtube\.com\/watch\?v=abc123$/);
  const n = calls().length;
  const again = run([VURL, '--work-dir', work], 'bot');   // would fail if it touched the network
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, file + '\n');
  assert.match(again.stderr, /reusing/);
  assert.equal(calls().length, n, 'no second yt-dlp call');
});

test('a deleted cached file is downloaded again', () => {
  const work = path.join(dir, 'w2');
  assert.equal(run([VURL, '--work-dir', work]).status, 0);
  fs.rmSync(path.join(work, 'Youtube-abc123.mp4'));
  const n = calls().length, r = run([VURL, '--work-dir', work]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls().length, n + 1);
});

test('--cookies: a Netscape file is passed as a copy, the original is untouched', () => {
  const ck = path.join(dir, 'cookies.txt');
  const body = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n';
  fs.writeFileSync(ck, body);
  const r = run([VURL, '--work-dir', path.join(dir, 'w3'), '--cookies', ck]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(calls().at(-1), /--cookies \S+/);
  assert.doesNotMatch(calls().at(-1), new RegExp(`--cookies ${ck}`));
  assert.equal(fs.readFileSync(ck, 'utf8'), body);
});

test('--cookies: missing or non-Netscape file is a usage error before any download', () => {
  const n = calls().length;
  assert.equal(run([VURL, '--cookies', path.join(dir, 'nope.txt')]).status, 2);
  const bad = path.join(dir, 'bad.txt'); fs.writeFileSync(bad, '{"cookies": []}\n');
  const r = run([VURL, '--cookies', bad]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Netscape/);
  assert.equal(calls().length, n);
});

for (const [mode, why] of [['bot', /not a bot.*server and cloud IPs/], ['geo', /geo-blocked/], ['private', /private/], ['gone', /unavailable/]]) {
  test(`failure (${mode}): exit 4, says what happened and both options`, () => {
    const r = run([VURL, '--work-dir', path.join(dir, `e-${mode}`)], mode);
    assert.equal(r.status, 4);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /Couldn't download https:\/\/www\.youtube\.com/);
    assert.match(r.stderr, why);
    assert.match(r.stderr, /--cookies cookies\.txt/);
    assert.match(r.stderr, /download the video yourself and pass the file path/);
  });
}

test('failure with --cookies already given suggests a fresh export', () => {
  const ck = path.join(dir, 'cookies2.txt');
  fs.writeFileSync(ck, '.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n');
  const r = run([VURL, '--work-dir', path.join(dir, 'e-ck'), '--cookies', ck], 'bot');
  assert.equal(r.status, 4);
  assert.match(r.stderr, /FRESH cookies\.txt/);
});

test('a download without an audio stream is rejected (exit 5) and not cached', () => {
  const work = path.join(dir, 'w-na');
  const r = run([VURL, '--work-dir', work], 'noaudio');
  assert.equal(r.status, 5);
  assert.match(r.stderr, /no video\+audio/);
  assert.ok(!fs.readdirSync(work).some(f => f.startsWith('url-')));
});

test('--js-runtimes: the first Node >= 20 (EASY_EDITS_NODE, PATH, EASY_EDITS_HOME/node, ~/.local/node*), never an older one', () => {
  const fakeNode = (p, major) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `#!/bin/sh\necho ${major}\n`, { mode: 0o755 }); return p; };
  const home = path.join(dir, 'nhome'), oldBin = path.join(dir, 'oldnode/bin');
  fakeNode(path.join(oldBin, 'node'), 18);
  const local = fakeNode(path.join(home, '.local/node22/bin/node'), 22);
  const go = (extra = {}) => spawnSync('bash', [FETCH, VURL, '--work-dir', path.join(dir, `wn${calls().length}`)], { encoding: 'utf8', cwd: dir,
    env: { ...process.env, PATH: `${oldBin}:${process.env.PATH}`, HOME: home, EASY_EDITS_YTDLP: FAKE, EASY_EDITS_HOME: path.join(dir, 'home'), FAKE_MODE: 'ok', FAKE_LOG: LOG, ...extra } });
  assert.equal(go().status, 0);
  assert.match(calls().at(-1), new RegExp(`--js-runtimes node:${local}( |$)`), 'old node on PATH skipped, ~/.local/node22 used');
  const pinned = fakeNode(path.join(dir, 'pinned/node'), 24);
  assert.equal(go({ EASY_EDITS_NODE: pinned }).status, 0);
  assert.match(calls().at(-1), new RegExp(`--js-runtimes node:${pinned}( |$)`));
  fs.rmSync(local);
  const r = go();
  assert.equal(r.status, 0);
  assert.doesNotMatch(calls().at(-1), /--js-runtimes/);
  assert.match(r.stderr, /no Node >= 20/);
});

test('usage: non-URL input, no input, unknown flag; missing yt-dlp is exit 3', () => {
  assert.equal(run(['talk.mp4']).status, 2);
  assert.equal(run([]).status, 2);
  assert.equal(run([VURL, '--bogus']).status, 2);
  const r = spawnSync('bash', [FETCH, VURL], { encoding: 'utf8', cwd: dir,
    env: { PATH: '/usr/bin:/bin', HOME: dir, EASY_EDITS_HOME: path.join(dir, 'home') } });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /install\.sh/);
});

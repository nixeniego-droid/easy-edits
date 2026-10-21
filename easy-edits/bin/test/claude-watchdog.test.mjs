// claude-watchdog idle detection with partial messages, against a fake claude (no paid calls).
//   node --test easy-edits/bin/test/*.test.mjs   (~100 s; both cases run concurrently with --idle 60)
// deltas: stream_event lines every 5 s for 90 s, then a result -> no restart, deltas not echoed.
// silent: one stream_event, then no output -> killed after 60 s and resumed once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WATCHDOG = path.join(HERE, '../claude-watchdog.mjs');
const FAKE = path.join(HERE, 'fake-claude.mjs');

function run(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gc-watchdog-${mode}-`));
  const prompt = path.join(dir, 'brief.md'), argsLog = path.join(dir, 'args.jsonl');
  fs.writeFileSync(prompt, 'do the thing');
  return new Promise((resolve) => {
    const p = spawn('node', [WATCHDOG, '--prompt-file', prompt, '--idle', '60', '--max-restarts', '2',
      '--log', path.join(dir, 'watchdog.log'), '--claude', FAKE, '--', '--model', 'fake'],
    { env: { ...process.env, FAKE_MODE: mode, FAKE_ARGS_LOG: argsLog }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.on('close', (code) => {
      const lines = stdout.trim().split('\n');
      resolve({ code, lines, summary: JSON.parse(lines.at(-1)),
        calls: fs.readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) });
    });
  });
}

const checkArgs = (calls) => {
  for (const a of calls) {
    assert.ok(a.includes('--include-partial-messages'), `missing --include-partial-messages: ${a.join(' ')}`);
    assert.deepEqual(a.slice(-2), ['--model', 'fake']);
  }
};

test('watchdog', { concurrency: true }, async (t) => {
  await Promise.all([
    t.test('stream_event deltas for 90 s keep a run alive under --idle 60', { timeout: 150_000 }, async () => {
      const r = await run('deltas');
      assert.equal(r.code, 0);
      assert.equal(r.summary.restarts, 0);
      assert.equal(r.summary.result, 'done');
      assert.equal(r.calls.length, 1);
      checkArgs(r.calls);
      assert.ok(!r.lines.some((l) => l.includes('stream_event')), 'stream_event lines were echoed');
      assert.ok(r.lines.some((l) => l.includes('"type":"result"')), 'result line not echoed');
    }),
    t.test('a silent run is still killed and resumed', { timeout: 150_000 }, async () => {
      const r = await run('silent');
      assert.equal(r.code, 0);
      assert.equal(r.summary.restarts, 1);
      assert.equal(r.calls.length, 2);
      assert.equal(r.calls[1][r.calls[1].indexOf('--resume') + 1], 'fake-session');
      checkArgs(r.calls);
    }),
  ]);
});

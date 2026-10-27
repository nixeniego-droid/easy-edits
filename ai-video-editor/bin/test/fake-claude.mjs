#!/usr/bin/env node
// Fake `claude -p` for claude-watchdog tests. Appends its argv (one JSON line) to $FAKE_ARGS_LOG.
// FAKE_MODE=deltas: init, then a ~4 KB stream_event every 5 s for 90 s, then assistant + result.
// FAKE_MODE=silent: init + one stream_event, then hangs without output (a resume returns a result).
// FAKE_MODE=edit (edit.sh tests): appends the entries of $FAKE_PROJECTS (one JSON array line) to $FAKE_LS, emits a Bash
//   tool_use with $FAKE_BASH when set, then: FAKE_HANG=1 hangs 20 s; FAKE_EXIT=n exits n without a result (resumes
//   too); else a result. FAKE_TOUCH=<file>: writes that file first (the draft sheet in --draft-only tests).
import { appendFileSync, readdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (process.env.FAKE_ARGS_LOG) appendFileSync(process.env.FAKE_ARGS_LOG, JSON.stringify(args) + '\n');
const session_id = 'fake-session';
const out = (o) => process.stdout.write(JSON.stringify({ ...o, session_id }) + '\n');
const delta = () => out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'x'.repeat(4096) } } });
const finish = () => {
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.01, duration_ms: 1000, num_turns: 1 });
};

out({ type: 'system', subtype: 'init' });
if (process.env.FAKE_MODE === 'edit') {
  appendFileSync(process.env.FAKE_LS, JSON.stringify(readdirSync(process.env.FAKE_PROJECTS).sort()) + '\n');
  if (process.env.FAKE_TOUCH) writeFileSync(process.env.FAKE_TOUCH, 'sheet');
  if (process.env.FAKE_BASH) out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: process.env.FAKE_BASH } }] } });
  if (process.env.FAKE_HANG) setTimeout(() => process.exit(0), 20_000);
  else if (process.env.FAKE_EXIT) process.exit(Number(process.env.FAKE_EXIT));
  else finish();
} else if (args.includes('--resume')) finish();
else if (process.env.FAKE_MODE === 'deltas') {
  let t = 0;
  const iv = setInterval(() => { t += 5; delta(); if (t >= 90) { clearInterval(iv); finish(); } }, 5000);
} else { delta(); setInterval(() => {}, 1 << 30); }

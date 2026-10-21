#!/usr/bin/env node
// Watchdog for headless Claude Code runs: restarts a stalled `claude -p` (e.g. an ECONNRESET hang
// that leaves the process alive but silent) by resuming its session.
//
//   node easy-edits/bin/claude-watchdog.mjs --prompt-file brief.md [--idle 300] [--max-restarts 3]
//        [--log watchdog.log] [--stream-log stream.jsonl] [--resume-prompt "..."] [--claude claude] [-- <extra claude args>]
//
// Runs `claude -p <prompt> --output-format stream-json --verbose --include-partial-messages <extra args>`,
// echoes the stream to stdout (and appends it to --stream-log), and takes session_id from the stream. Partial-message lines (type
// "stream_event", token deltas) are not echoed or logged; they only count as activity, so a long
// silent tool call (e.g. one large Write, whose assistant message arrives only when complete) is
// not mistaken for a stall. If no stdout line at all arrives for --idle seconds (default 300: the model can think silently between turns for over a minute; env
// EASY_EDITS_WATCHDOG_IDLE; an ECONNRESET hang produces no deltas either), it kills the process group
// and runs `claude -p <resume prompt> --resume <session_id> ...` with the same extra args, at most
// --max-restarts times. Restarts are logged with ISO timestamps. At the end prints one JSON line
// {result, session_id, cost_usd, duration_ms, num_turns, restarts, is_error} (cost and duration
// summed over all attempts). Exit 0 on a successful result, 1 otherwise. SIGINT / SIGTERM kill the running claude's
// process group, then exit 130 / 143.
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const dd = argv.indexOf('--');
const own = dd >= 0 ? argv.slice(0, dd) : argv, extra = dd >= 0 ? argv.slice(dd + 1) : [];
const opt = (k, d) => { const i = own.indexOf(k); return i >= 0 ? own[i + 1] : d; };
const promptFile = opt('--prompt-file');
if (!promptFile) { console.error('usage: claude-watchdog.mjs --prompt-file <file> [--idle 300] [--max-restarts 3] [--log file] [--resume-prompt text] [--claude bin] [-- claude args]'); process.exit(2); }
const IDLE = Number(opt('--idle', process.env.EASY_EDITS_WATCHDOG_IDLE || 300));
const MAX = Number(opt('--max-restarts', 3));
const LOG = opt('--log', 'claude-watchdog.log');
const STREAM_LOG = opt('--stream-log', '');
const BIN = opt('--claude', process.env.EASY_EDITS_CLAUDE || 'claude');
const RESUME = opt('--resume-prompt', 'The previous connection stalled. Continue where you left off; do not redo finished steps.');
const prompt = readFileSync(promptFile, 'utf8');

const log = (msg) => { const line = `${new Date().toISOString()} ${msg}`; appendFileSync(LOG, line + '\n'); console.error(`[watchdog] ${line}`); };

let current = null; // the running claude, killed with its process group when the watchdog gets SIGINT / SIGTERM
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(sig, () => {
  log(`${sig}: killing ${current ? `pid ${current.pid}` : 'nothing'}`);
  if (current) try { process.kill(-current.pid, 'SIGTERM'); } catch {}
  process.exit(code);
});

function attempt(args) {
  return new Promise((done) => {
    const child = current = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
    let sessionId = null, result = null, stalled = false, timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => {
      stalled = true;
      log(`no stdout for ${IDLE} s (pid ${child.pid}, session ${sessionId}); killing`);
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000).unref();
    }, IDLE * 1000); };
    arm();
    createInterface({ input: child.stdout }).on('line', (line) => {
      arm();
      let ev = null;
      try { ev = JSON.parse(line); } catch {}
      if (ev?.session_id) sessionId = ev.session_id;
      if (ev?.type === 'stream_event') return; // token delta: activity only, not echoed
      process.stdout.write(line + '\n');
      if (STREAM_LOG) appendFileSync(STREAM_LOG, line + '\n');
      if (ev?.type === 'result') result = ev;
    });
    child.on('error', (e) => { log(`spawn failed: ${e.message}`); });
    child.on('close', (code, signal) => { clearTimeout(timer); done({ code, signal, sessionId, result, stalled }); });
  });
}

const base = ['--output-format', 'stream-json', '--verbose', '--include-partial-messages', ...extra];
log(`start: ${BIN} -p <${promptFile}> ${base.join(' ')} (idle ${IDLE} s, max restarts ${MAX})`);
let r = await attempt(['-p', prompt, ...base]);
let sessionId = r.sessionId, restarts = 0, cost = 0, duration = 0;
const add = (res) => { if (res) { cost += res.total_cost_usd || 0; duration += res.duration_ms || 0; } };
add(r.result);
while (!r.result && restarts < MAX) {
  if (!sessionId) { log(`exited (code ${r.code}, signal ${r.signal}) before a session_id was seen; cannot resume`); break; }
  restarts++;
  log(`restart ${restarts}/${MAX}: --resume ${sessionId} (${r.stalled ? 'stalled' : `exited code ${r.code} signal ${r.signal} without a result`})`);
  r = await attempt(['-p', RESUME, '--resume', sessionId, ...base]);
  sessionId = r.sessionId || sessionId;
  add(r.result);
}
const res = r.result;
const summary = { result: res?.result ?? null, session_id: sessionId, cost_usd: Number(cost.toFixed(4)), duration_ms: duration,
  num_turns: res?.num_turns ?? null, restarts, is_error: !res || !!res.is_error };
log(`end: ${JSON.stringify({ ...summary, result: undefined })}`);
console.log(JSON.stringify(summary));
process.exitCode = summary.is_error ? 1 : 0;

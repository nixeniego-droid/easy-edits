// Pinned plans: a reviewed plan is reused on every re-run of the same source, so re-runs are deterministic (the agent
// planner / picker varies from call to call). Store: ${EASY_EDITS_PLANS:-${EASY_EDITS_HOME:-~/.easy-edits}/plans}/<mode>/<key>.json,
// key = the source's content hash (+ a variant, e.g. a shorts --range). A plan is read from, in order: --plan FILE,
// the pinned plan for this source (unless --replan), else planned fresh; whatever was used is pinned for next time.
// A pin carries `pin: {mode, source, sourceHash, words, made, from}`; `words` fingerprints the transcript it was
// anchored on, so a changed cut is detected (talking-head beats then re-anchor by phrase).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const storeDir = (env = process.env) => env.EASY_EDITS_PLANS || path.join(env.EASY_EDITS_HOME || path.join(os.homedir(), '.easy-edits'), 'plans');

/** content hash of a media file: sha256 over its size and three 4 MiB samples (head, middle, tail); 16 hex chars.
 * Same bytes -> same key wherever the file lives; any re-encode or trim -> a new key. Fast on multi-GB sources. */
export function sourceHash(file) {
  const size = fs.statSync(file).size, CH = 4 << 20, h = crypto.createHash('sha256').update(`size:${size}\n`);
  const fd = fs.openSync(file, 'r');
  try {
    for (const at of [...new Set([0, Math.max(0, Math.floor(size / 2) - CH / 2), Math.max(0, size - CH)])]) {
      const buf = Buffer.alloc(Math.min(CH, size - at)); fs.readSync(fd, buf, 0, buf.length, at); h.update(buf);
    }
  } finally { fs.closeSync(fd); }
  return h.digest('hex').slice(0, 16);
}

/** fingerprint of a word transcript (text + times to the ms): did the cut / transcript change since the pin? */
export const wordsKey = (words) => crypto.createHash('sha256').update(words.map((w) => `${w.text}|${Math.round(w.start * 1000)}|${Math.round(w.end * 1000)}`).join('\n')).digest('hex').slice(0, 16);

export const pinPath = (mode, key, env = process.env) => path.join(storeDir(env), mode, `${key}.json`);

export function loadPin(mode, key, env = process.env) {
  const f = pinPath(mode, key, env);
  try { return { file: f, plan: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { return null; }
}

/** write `plan` as the pin for (mode, key); returns the file. */
export function savePin(mode, key, plan, meta = {}, env = process.env) {
  const f = pinPath(mode, key, env);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const out = { ...plan, pin: { mode, sourceHash: key.split('_')[0], ...meta, made: new Date().toISOString() } };
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  return f;
}

/** the beats with their resolved times removed (at / end / i0, list item times): re-anchored by phrase on a new cut */
export function stripTimes(plan) {
  return { ...plan, beats: (plan.beats || []).map(({ at, end, i0, untilTime, ...b }) => {
    for (const k of ['items', 'rows']) if (Array.isArray(b[k])) b[k] = b[k].map(({ at: _a, ...it }) => it);
    return b.anchor ? b : { ...b, at, ...(untilTime != null ? { untilTime } : {}) };
  }) };
}

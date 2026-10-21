// smoke/asr_words.py --disfluent and check/asr_excerpts.py --disfluent on 2-6 s of test-media/talk_30s.mp4
// (faster-whisper small; skipped without the Easy Edits venv or the source): the flag is parsed (not taken as the
// model), produced_by says "disfluent", excerpt word times are in the file's timeline.
//   node --test easy-edits/check/test/asr-disfluent.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '../../../test-media/talk_30s.mp4');
const PY = [process.env.EASY_EDITS_PYTHON, path.join(process.env.EASY_EDITS_HOME || path.join(os.homedir(), '.easy-edits'), 'venv/bin/python')].find((p) => p && fs.existsSync(p));
const skip = (!PY && 'no Easy Edits venv') || (!fs.existsSync(SRC) && 'test-media/talk_30s.mp4 absent');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-asr-disfl-'));

test('asr_words.py --disfluent', { skip }, () => {
  const clip = path.join(tmp, 'clip.wav'), out = path.join(tmp, 'w.json');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '2', '-t', '4', '-i', SRC, '-vn', '-ac', '1', '-ar', '16000', clip]);
  const r = spawnSync(PY, ['-I', path.join(HERE, '../../smoke/asr_words.py'), clip, out, 'small', '--disfluent', '--lang', 'en'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(j.model, 'small'); assert.match(j.produced_by, /small disfluent$/);
  assert.ok(j.words.length > 0 && j.words.every((w) => w.start >= 0 && w.start <= 4.2));
});
test('asr_excerpts.py --disfluent', { skip }, () => {
  const r = spawnSync(PY, ['-I', path.join(HERE, '../asr_excerpts.py'), SRC, 'small', '[[2,6],[20,22]]', '--disfluent'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const w = JSON.parse(r.stdout);
  assert.equal(w.length, 2); assert.ok(w[0].length > 0);
  for (const [i, [a, b]] of [[2, 6], [20, 22]].entries()) assert.ok(w[i].every((x) => x.start >= a - 0.5 && x.start <= b), JSON.stringify(w[i]));
});

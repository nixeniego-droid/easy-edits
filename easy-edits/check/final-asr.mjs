// Fresh faster-whisper transcript of a finished render, cached in $EASY_EDITS_CACHE or ~/.cache/easy-edits/asr
// (<name>-<size>-<mtime>.<model>[-disfluent].json). Model: EASY_EDITS_ASR_MODEL or medium (int8, ~2 GB; falls back to small when
// medium fails to load, e.g. OOM, and says so in `model`). Uses easy-edits/smoke/asr_words.py --lang <resolveLang()>.
// Language (resolveLang): the caller's lang, else EASY_EDITS_LANG (edit.sh exports the style's / --lang value), else
// ~/.easy-edits/profile.json `language`, else "auto" (faster-whisper detects it: language=None). Cache keys carry it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PY = [process.env.EASY_EDITS_PYTHON, path.join(process.env.EASY_EDITS_HOME || path.join(os.homedir(), '.easy-edits'), 'venv/bin/python'), 'python3'].find((p) => p && (p === 'python3' || fs.existsSync(p)));

/** --lang / EASY_EDITS_LANG / profile.json language / "auto". */
export function resolveLang(lang, { env = process.env, profile = path.join(env.EASY_EDITS_HOME || path.join(os.homedir(), '.easy-edits'), 'profile.json') } = {}) {
  if (lang) return lang;
  if (env.EASY_EDITS_LANG) return env.EASY_EDITS_LANG;
  try { const l = JSON.parse(fs.readFileSync(profile, 'utf8')).language; if (l) return l; } catch { /* no profile */ }
  return 'auto';
}

/** argv -> the --lang value (undefined when absent), for checks that pass it on. */
export const langArg = (argv) => { const i = argv.indexOf('--lang'); return i >= 0 ? argv[i + 1] : undefined; };

/** {model, words:[{text,start,end}]} of <video>, decoded once and cached. */
export function finalAsr(video, { model = process.env.EASY_EDITS_ASR_MODEL || 'medium', disfluent = false, lang } = {}) {
  lang = resolveLang(lang);
  const tag = (disfluent ? '-disfluent' : '') + (lang === 'en' ? '' : `-${lang}`);
  for (const m of model === 'medium' ? ['medium', 'small'] : [model]) {
    const st = fs.statSync(video), dir = path.join(process.env.EASY_EDITS_CACHE || path.join(os.homedir(), '.cache/easy-edits'), 'asr');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${path.basename(video, path.extname(video))}-${st.size}-${Math.round(st.mtimeMs)}.${m}${tag}.json`);
    if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
    const r = spawnSync(PY, ['-I', path.join(HERE, '../smoke/asr_words.py'), video, out, m, '--lang', lang, ...(disfluent ? ['--disfluent'] : [])], { encoding: 'utf8' });
    if (r.status === 0 && fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
    console.error(`final-asr: ${m} failed (${(r.stderr || '').trim().split('\n').at(-1)})${m === 'medium' ? '; trying small' : ''}`);
  }
  throw new Error(`final-asr: no transcript for ${video}`);
}

export const norm = (s) => (s.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').match(/[\p{L}\p{N}]+/gu) || []);

/** Words of short excerpts [[a, b], ...] of <video>, each decoded alone (check/asr_excerpts.py). */
export function excerptAsr(video, spans, { model = process.env.EASY_EDITS_ASR_MODEL || 'medium', disfluent = false, lang } = {}) {
  if (!spans.length) return [];
  const r = spawnSync(PY, ['-I', path.join(HERE, 'asr_excerpts.py'), video, model, JSON.stringify(spans), '--lang', resolveLang(lang), ...(disfluent ? ['--disfluent'] : [])], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`asr_excerpts: ${(r.stderr || '').trim().split('\n').at(-1)}`);
  return JSON.parse(r.stdout);
}

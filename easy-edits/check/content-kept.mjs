// Easy Edits content gate: the edit removed only disfluencies, never real speech. Compares an independent transcript
// of the SOURCE with one of the FINAL render, so it is not blind to speech that never reached the edit's own
// transcript (talk_30s run #6: the cut's chunk decode returned one word for 0-11 s, the dead-air rule cut 9 s of
// real speech, and every caption/audio gate passed because they only look at what was kept).
//   node easy-edits/check/content-kept.mjs <project-dir> <final.mp4> --source <src> [--lang auto|en|..] [--json]
// Transcripts: check/asr_content.py (Silero VAD + plain faster-whisper medium in 10 s chunks, junk chunks and
// word-less VAD speech decoded again; never the cut's disfluent decode). Source transcript cached by file sha1.
// Content tokens: verbatim-guard norm, fillers (uh um er ah eh hmm mm) dropped. A source token is REMOVED when its
// word lies outside every keep of assets/edit-decisions.json (overlap < 50 %).
//   repeat     a removed token said again within the next 8 / previous 3 content tokens, where that copy is kept
//              (a retake: "a, a, a gigantic, a very large, a very large" keeps the last "a very large").
//   unrepeated any other removed token (a false-start word like "gigantic").
// FAIL when
//   - a run of >= 3 unrepeated removed tokens with no kept token between them, or more unrepeated tokens than
//     max(2, 4 % of the source's content tokens): real speech was cut;
//   - VAD speech >= 0.5 s outside every keep that no source word covers, even after a disfluent re-decode of it
//     (fillers count as covered): speech was cut that the check cannot even transcribe;
//   - >= 3 consecutive kept tokens missing from the final transcript and from an excerpt re-decode of the final
//     around that spot: the render lost kept speech.
// Kept tokens the final ASR misses one or two at a time are WARN (ASR variance; verbatim-final covers captions).
// Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { excerptAsr, norm, resolveLang } from './final-asr.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.EASY_EDITS_PYTHON || 'python3';
export const FILLERS = new Set('uh um uhm umm er erm ah eh hmm hm mm mhm'.split(' '));
export const RUN_MAX = 2, NEXT = 8, PREV = 3, SPEECH_MIN = 0.5, MISS_RUN = 3;
const r2 = (v) => Math.round(v * 100) / 100;

/** words -> content tokens [{t, start, end, w}] (one word may give several tokens; fillers dropped). */
export const contentTokens = (words) => words.flatMap((w, wi) => norm(w.text).filter((t) => !FILLERS.has(t)).map((t) => ({ t, start: w.start, end: w.end, wi })));

const inKeeps = (a, b, keeps) => {
  const d = Math.max(b - a, 0.01);
  return keeps.some((k) => Math.min(b, k.sourceEnd) - Math.max(a, k.sourceStart) >= 0.5 * d) || keeps.some((k) => a >= k.sourceStart && b <= k.sourceEnd);
};

/** LCS index pairs of two token arrays. */
export function lcs(A, B) {
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  for (let i = 0, j = 0; i < n && j < m;) { if (A[i] === B[j]) { out.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  return out;
}

/** Removed-content verdict from the source transcript and the keeps. */
export function judgeRemoved(srcWords, keeps) {
  const tk = contentTokens(srcWords).map((x) => ({ ...x, kept: inKeeps(x.start, x.end, keeps) }));
  for (let i = 0; i < tk.length; i++) {
    if (tk[i].kept) continue;
    const near = [...tk.slice(i + 1, i + 1 + NEXT), ...tk.slice(Math.max(0, i - PREV), i)];
    tk[i].kind = near.some((y) => y.kept && y.t === tk[i].t) ? 'repeat' : 'unrepeated';
  }
  const runs = []; let cur = [];
  for (const x of tk) {
    if (x.kept) { if (cur.length) runs.push(cur); cur = []; continue; }
    if (x.kind === 'unrepeated') cur.push(x);
  }
  if (cur.length) runs.push(cur);
  const unrep = tk.filter((x) => x.kind === 'unrepeated'), budget = Math.max(2, Math.ceil(0.04 * tk.length));
  const longRuns = runs.filter((r) => r.length > RUN_MAX);
  return { tokens: tk, removed: tk.filter((x) => !x.kept), unrepeated: unrep, budget, longRuns,
    fail: longRuns.length > 0 || unrep.length > budget };
}

/** VAD speech pieces >= SPEECH_MIN outside every keep that no source word touches. */
export function bareRemovedSpeech(speech, keeps, srcWords) {
  const pieces = [];
  for (const [a, b] of speech) {
    let cuts = [[a, b]];
    for (const k of keeps) cuts = cuts.flatMap(([x, y]) => [[x, Math.min(y, k.sourceStart)], [Math.max(x, k.sourceEnd), y]].filter(([p, q]) => q - p > 0.001));
    pieces.push(...cuts);
  }
  return pieces.filter(([a, b]) => b - a >= SPEECH_MIN && !srcWords.some((w) => w.start < b && w.end > a)).map(([a, b]) => [r2(a), r2(b)]);
}

/** Kept source tokens missing from the final transcript, grouped in runs (by LCS). */
export function missingKept(tokens, finWords) {
  const kept = tokens.filter((x) => x.kept), fin = contentTokens(finWords);
  const pairs = lcs(kept.map((x) => x.t), fin.map((x) => x.t)), hit = new Set(pairs.map(([i]) => i));
  const runs = []; let cur = [];
  kept.forEach((x, i) => { if (hit.has(i)) { if (cur.length) runs.push(cur); cur = []; } else cur.push({ ...x, i }); });
  if (cur.length) runs.push(cur);
  return { kept, fin, pairs, runs };
}

const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
export function contentAsr(media, { lang, cache = true, model = process.env.EASY_EDITS_ASR_MODEL || 'medium' } = {}) {
  const dir = path.join(process.env.EASY_EDITS_CACHE || path.join(os.homedir(), '.cache/easy-edits'), 'content');
  const out = path.join(dir, `${sha1(media)}.${model}.${lang}.v1.json`);
  if (cache && fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
  const r = spawnSync(PY, ['-I', path.join(HERE, 'asr_content.py'), media, model, '--lang', lang], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`asr_content: ${(r.stderr || '').trim().split('\n').at(-1)}`);
  const j = JSON.parse(r.stdout);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(out, JSON.stringify(j));
  return j;
}

function main(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } else pos.push(argv[i]); }
  const [proj, final] = pos;
  if (!proj || !final || !opt.source) { console.error('usage: content-kept.mjs <project-dir> <final.mp4> --source <src> [--lang L] [--json]'); return 2; }
  const ed = JSON.parse(fs.readFileSync(path.join(proj, 'assets/edit-decisions.json'), 'utf8'));
  const lang = resolveLang(opt.lang === true ? undefined : opt.lang), keeps = ed.keeps;
  const src = contentAsr(opt.source, { lang }), fin = contentAsr(final, { lang, cache: false });
  const L = src.language || lang;
  const rem = judgeRemoved(src.words, keeps);
  // bare removed speech: give it one disfluent decode (fillers count as covered)
  let bare = bareRemovedSpeech(src.speech, keeps, src.words);
  if (bare.length) {
    const heard = excerptAsr(opt.source, bare.map(([a, b]) => [Math.max(0, a - 0.5), b + 0.5]), { disfluent: true, lang: L });
    bare = bare.filter((_, k) => !(heard[k] || []).some((w) => norm(w.text).length));
  }
  // kept speech missing from the final: re-check long runs on a final excerpt
  const mk = missingKept(rem.tokens, fin.words), lostRuns = [];
  const finTime = (i) => { const p = mk.pairs.filter(([a]) => a < i).at(-1); return p ? mk.fin[p[1]].start : 0; };
  for (const run of mk.runs.filter((r) => r.length >= MISS_RUN)) {
    // the excerpt spans the whole run (its source length + 2 s, at most 30 s): a 7 s excerpt could not hold a 9 s run
    // (talk_01: "mission informs ... our head" was in the final but 4 words fell outside the excerpt)
    const t = finTime(run[0].i), len = Math.min(30, run.at(-1).end - run[0].start + 3);
    const ex = excerptAsr(final, [[Math.max(0, t - 1), t + len]], { lang: L })[0] || [];
    const heard = new Set(contentTokens(ex).map((x) => x.t)), still = run.filter((x) => !heard.has(x.t));
    if (still.length >= MISS_RUN) lostRuns.push(still);
  }
  const fail = rem.fail || bare.length > 0 || lostRuns.length > 0;
  const rep = { pass: !fail, language: L, sourceTokens: rem.tokens.length, keptTokens: mk.kept.length, finalTokens: mk.fin.length,
    matched: mk.pairs.length, removed: rem.removed.map((x) => ({ t: x.t, at: r2(x.start), kind: x.kind })), unrepeated: rem.unrepeated.length,
    budget: rem.budget, longRuns: rem.longRuns.map((r) => ({ at: r2(r[0].start), words: r.map((x) => x.t).join(' ') })), bareRemovedSpeech: bare,
    lostInFinal: lostRuns.map((r) => r.map((x) => x.t).join(' ')), warnMissing: mk.runs.filter((r) => r.length < MISS_RUN).flat().map((x) => x.t),
    vadRedecoded: { source: src.redecoded, final: fin.redecoded }, junk: { source: src.junk, final: fin.junk } };
  if (opt.json) { console.log(JSON.stringify(rep, null, 1)); return fail ? 1 : 0; }
  console.log(`content-kept: source ${rep.sourceTokens} content words, ${rep.removed.length} removed (${rem.removed.length - rem.unrepeated.length} retake repeats, ${rep.unrepeated} unrepeated, budget ${rep.budget}); kept ${rep.keptTokens}, final hears ${rep.matched} of them in order`);
  for (const x of rep.removed) console.log(`  removed ${String(x.at).padStart(6)} s  ${x.kind.padEnd(10)} ${x.t}`);
  for (const r of rep.longRuns) console.log(`  FAIL REAL SPEECH CUT at ${r.at} s: "${r.words}" (unrepeated run > ${RUN_MAX})`);
  if (!rem.longRuns.length && rem.unrepeated.length > rem.budget) console.log(`  FAIL ${rem.unrepeated.length} unrepeated removed words > budget ${rem.budget}`);
  for (const [a, b] of bare) console.log(`  FAIL UNTRANSCRIBED SPEECH CUT ${a}-${b} s (VAD speech outside every keep, no word heard)`);
  for (const r of rep.lostInFinal) console.log(`  FAIL KEPT SPEECH MISSING FROM FINAL: "${r}"`);
  if (rep.warnMissing.length) console.log(`  WARN final ASR missed kept word(s): ${rep.warnMissing.join(', ')}`);
  console.log(`content-kept: ${fail ? 'FAIL' : 'PASS'}`);
  return fail ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));

// AI Video Editor disfluency check on the finished render: no stutter (an immediately repeated word) and no repeated
// 2-3 word phrase (a restart) left in the speech.
//   node ai-video-editor/check/disfluency.mjs <final.mp4> [--lang auto|en|tl] [--fillers-only] [--json]   (language: check/final-asr.mjs resolveLang)
// --fillers-only (clean-cut light mode, the default since 2026-10-18): repeats and restarts are the speaker's and
// stay; FAIL only on a filler (uh / um / er / ah / hmm ...) heard at the same moment (<= NEAR) by >= AGREE windows.
// faster-whisper medium with the --disfluent prompt (check/asr_excerpts.py), which writes the repeats Whisper
// normally cleans up, decoded over 6 s windows every 2 s (each moment is heard by up to 3 windows). That prompt
// also makes Whisper invent repeats (a "We were, uh" echo of the prompt, "I, I, I, I" loops on music): a
// repeat counts only when at least 2 windows hear the same repeat within 0.6 s. Whole-file decodes with the
// prompt collapse (gen_talk_v5: "The building is really a"), hence the windows. Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { excerptAsr, langArg, norm } from './final-asr.mjs';

export const WIN = 6, STEP = 2, NEAR = 0.6, AGREE = 2;

export const windows = (dur) => { const s = []; for (let a = 0; a < dur - 0.5; a += STEP) s.push([a, +Math.min(dur, a + WIN).toFixed(3)]); return s; };

/** words [{text, start}] -> repeats [{text, kind, t}] (token: "a a"; phrase: 2-3 words said twice in a row). */
export function repeatsIn(words) {
  const tk = words.flatMap((w) => norm(w.text).map((t) => ({ t, s: w.start }))), out = [];
  for (let i = 0; i + 1 < tk.length; i++) {
    if (tk[i].t === tk[i + 1].t) { out.push({ text: `${tk[i].t} ${tk[i].t}`, kind: 'token', t: tk[i].s }); continue; }
    for (const n of [2, 3]) {
      if (i + 2 * n > tk.length) break;
      const a = tk.slice(i, i + n).map((x) => x.t).join(' '), b = tk.slice(i + n, i + 2 * n).map((x) => x.t).join(' ');
      if (a === b) out.push({ text: `${a}, ${b}`, kind: 'phrase', t: tk[i].s });
    }
  }
  return out;
}

export const FILLER_WORDS = new Set('uh um uhm umm uhh er erm ah hmm hm mm'.split(' '));
/** per-window word lists -> {confirmed, unconfirmed} fillers (kind "filler"), grouped like the repeats. */
export function checkFillers(winWords) {
  const groups = [];
  const all = winWords.flatMap((ws, w) => ws.filter((x) => norm(x.text).some((t) => FILLER_WORDS.has(t))).map((x) => ({ text: norm(x.text).join(' '), t: x.start, w })));
  for (const r of all.sort((a, b) => a.t - b.t)) {
    const g = groups.find((g) => Math.abs(g.t - r.t) <= NEAR);
    if (g) g.wins.add(r.w); else groups.push({ text: r.text, kind: 'filler', t: r.t, wins: new Set([r.w]) });
  }
  const out = groups.map((g) => ({ text: g.text, kind: g.kind, t: +g.t.toFixed(2), windows: g.wins.size }));
  return { confirmed: out.filter((g) => g.windows >= AGREE), unconfirmed: out.filter((g) => g.windows < AGREE) };
}

/** per-window word lists -> {confirmed: [{text, kind, t, windows}], unconfirmed} */
export function checkDisfluency(winWords) {
  const all = winWords.flatMap((ws, w) => repeatsIn(ws).map((r) => ({ ...r, w })));
  const groups = [];
  for (const r of all.sort((a, b) => a.t - b.t)) {
    const g = groups.find((g) => g.text === r.text && Math.abs(g.t - r.t) <= NEAR);
    if (g) g.wins.add(r.w); else groups.push({ text: r.text, kind: r.kind, t: r.t, wins: new Set([r.w]) });
  }
  const out = groups.map((g) => ({ text: g.text, kind: g.kind, t: +g.t.toFixed(2), windows: g.wins.size }));
  return { confirmed: out.filter((g) => g.windows >= AGREE), unconfirmed: out.filter((g) => g.windows < AGREE) };
}

function main(argv) {
  const video = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lang');
  if (!video || !fs.existsSync(video)) { console.error('usage: disfluency.mjs <final.mp4> [--lang auto|en|tl] [--json]'); return 2; }
  const dur = +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout.trim();
  const fo = argv.includes('--fillers-only'), ww = excerptAsr(video, windows(dur), { disfluent: true, lang: langArg(argv) });
  const r = fo ? checkFillers(ww) : checkDisfluency(ww), what = fo ? 'filler(s)' : 'repeat(s)';
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  for (const c of r.confirmed) console.log(`  ${fo ? 'FILLER' : 'REPEAT'} ${c.t.toFixed(2).padStart(6)} s ${c.kind.padEnd(6)} "${c.text}" (${c.windows} windows)`);
  console.log(`disfluency: ${r.confirmed.length ? 'FAIL' : 'PASS'} ${r.confirmed.length} ${what} heard by >= ${AGREE} windows (${r.unconfirmed.length} single-window ignored)`);
  return r.confirmed.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));

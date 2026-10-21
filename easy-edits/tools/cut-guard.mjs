// Easy Edits cut guard: every cut lands between words, never inside one.
//   node easy-edits/tools/cut-guard.mjs <project-dir> [--source <media>] [--pad 0.03] [--hot -12] [--json]
// Keeps = <project>/assets/edit-decisions.json `keeps[]` ({sourceStart, sourceEnd} in source seconds). Words =
// <project>/assets/source-transcript.json (source time; never the retimed transcript). Source media = --source,
// else the single media file in <project>/raw/. Each keep start and end is a boundary, except the source's own
// start (0) and end (last 0.1 s). Per boundary:
//   word    FAIL when it falls inside a word's [start - pad, end + pad] (pad 30 ms): the cut clips that word. With
//           source media, only when one of that word's voiced 10 ms windows (within 25 dB of the speech level, 6 dB
//           over the noise floor = 10th percentile window, and 18 dB of the word's own peak) is within pad of the
//           boundary, since ASR spans often absorb the pause next to a word.
//   energy  1.5-5 kHz speech-band RMS of the source in the 30 ms on the kept side of the boundary (before a keep
//           end, after a keep start), in dB re the source's speech level (median RMS of its speech windows,
//           10 ms windows above the speech-band RMS - 20 dB, the gates.mjs floor). FAIL when above --hot (-12 dB)
//           and more than 9 dB over the quietest 30 ms within 0.3 s (the pause, or the music bed under a
//           music-backed source): speech is still running where the cut lands. ASR word edges are often 20-80 ms off; this catches
//           what the word test misses (an onset before the ASR start, a word ASR merged or misheard).
// Exit 1 on any FAIL, 2 on usage / missing files, 0 otherwise. Without source media only the word test runs.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BAND = 'highpass=f=1500,lowpass=f=5000';
const WIN = 0.01;

/** Speech-band RMS (dB) per 10 ms window of a media file. */
export function bandWindows(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `${BAND},pan=mono|c0=c0,aresample=48000,asetnsamples=480,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return [...r.stdout.matchAll(/RMS_level=(-?[\d.inf]+)/g)].map((m) => Number(m[1]) || -120);
}

/** Boundaries of keeps checked against words (and band windows when given). */
export function checkCuts(keeps, words, { win = null, pad = 0.03, hot = -12, sourceEnd = Infinity } = {}) {
  let speech = null;
  if (win) {
    const lin = win.map((d) => 10 ** (d / 10)), all = 10 * Math.log10(lin.reduce((a, b) => a + b, 0) / lin.length);
    const act = win.filter((d) => d > all - 20).sort((a, b) => a - b);
    speech = act[act.length >> 1];
    const sorted = [...win].sort((a, b) => a - b);
    var noise = sorted[Math.floor(sorted.length * 0.1)];
  }
  // ASR spans often absorb the pause next to a word (gen-talk-v3: "is" 1.19-2.35 s is 0.2 s of voice and 0.7 s
  // of pause). With band windows a boundary is inside a word only when one of that word's voiced windows (within
  // 25 dB of the speech level, 6 dB over the noise floor = 10th percentile window, and 18 dB of the word's own
  // peak) lies within pad of it.
  const voicedNear = (w, b) => {
    if (!win) return true;
    const i0 = Math.floor(w.start / WIN), i1 = Math.ceil(w.end / WIN);
    let pk = -Infinity; for (let i = i0; i < i1; i++) pk = Math.max(pk, win[i] ?? -120);
    const thr = Math.max(speech - 25, noise + 6, pk - 18);
    for (let i = Math.max(i0, Math.floor((b - pad) / WIN)); i < Math.min(i1, Math.ceil((b + pad) / WIN)); i++) if (win[i] > thr) return true;
    return false;
  };
  const band = (a, z) => { const seg = win.slice(Math.max(0, Math.floor(a / WIN)), Math.ceil(z / WIN)); if (!seg.length) return NaN; return 10 * Math.log10(seg.reduce((t, d) => t + 10 ** (d / 10), 0) / Math.max(1, seg.length)); };
  const rows = [];
  for (const [i, k] of keeps.entries()) {
    for (const [side, b] of [['start', k.sourceStart], ['end', k.sourceEnd]]) {
      if ((side === 'start' && b <= 0.001) || (side === 'end' && b >= sourceEnd - 0.1)) continue;
      const inside = words.find((w) => b > w.start - pad && b < w.end + pad && voicedNear(w, b));
      const row = { keep: i, side, at: +b.toFixed(3), word: inside ? `${inside.text} ${inside.start.toFixed(2)}-${inside.end.toFixed(2)}` : null };
      if (win) {
        const e = side === 'end' ? band(b - 0.03, b) : band(b, b + 0.03);
        // quietest 30 ms within 0.3 s: the pause (or the music bed) the cut should sit in
        let lo = e; for (let t = Math.max(0, b - 0.3); t <= Math.min(b + 0.27, sourceEnd - 0.03); t += WIN) { const v = band(t, t + 0.03); if (v < lo) lo = v; }
        row.energy = +(e - speech).toFixed(1);
        row.overLocalMin = +(e - lo).toFixed(1);
        row.hot = row.energy > hot && row.overLocalMin > 9;
      }
      row.fail = !!inside || !!row.hot;
      rows.push(row);
    }
  }
  return { speechDb: speech === null ? null : +speech.toFixed(1), rows };
}

export function sourceMedia(proj) {
  const dir = path.join(proj, 'raw');
  if (!fs.existsSync(dir)) return null;
  const m = fs.readdirSync(dir).filter((f) => /\.(mp4|mov|mkv|webm|m4a|wav|mp3)$/i.test(f));
  return m.length === 1 ? path.join(dir, m[0]) : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2), proj = argv[0];
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (!proj || proj.startsWith('--')) { console.error('usage: cut-guard.mjs <project-dir> [--source <media>] [--pad 0.03] [--hot -12] [--json]'); process.exit(2); }
  const ed = path.join(proj, 'assets/edit-decisions.json'), tr = path.join(proj, 'assets/source-transcript.json');
  for (const f of [ed, tr]) if (!fs.existsSync(f)) { console.error(`cut-guard: missing ${f}`); process.exit(2); }
  const keeps = (JSON.parse(fs.readFileSync(ed, 'utf8')).keeps || []).filter((k) => Number.isFinite(k.sourceStart) && Number.isFinite(k.sourceEnd));
  const words = JSON.parse(fs.readFileSync(tr, 'utf8')).words.filter((w) => (w.type || 'word') === 'word');
  const src = opt('--source') || sourceMedia(proj);
  if (src && !fs.existsSync(src)) { console.error(`cut-guard: missing source ${src}`); process.exit(2); }
  const win = src ? bandWindows(src) : null;
  const sourceEnd = win ? win.length * WIN : Math.max(...words.map((w) => w.end));
  const { speechDb, rows } = checkCuts(keeps, words, { win, pad: Number(opt('--pad', 0.03)), hot: Number(opt('--hot', -12)), sourceEnd });
  const fails = rows.filter((r) => r.fail), pass = !fails.length;
  const res = { pass, project: proj, source: src, keeps: keeps.length, speechDb, boundaries: rows };
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else {
    console.log(`cut-guard: ${pass ? 'PASS' : 'FAIL'} (${rows.length} cut boundaries in ${keeps.length} keeps${src ? `, source ${path.basename(src)}` : ', no source media: word test only'})`);
    for (const r of rows) console.log(`  ${r.fail ? 'FAIL' : 'ok  '} keep ${r.keep} ${r.side.padEnd(5)} ${String(r.at).padStart(7)} s${r.word ? `  inside "${r.word}"` : ''}${r.energy !== undefined ? `  speech band ${r.energy} dB re speech, +${r.overLocalMin} dB over local min${r.hot ? ' (speech at the cut)' : ''}` : ''}`);
    if (!pass) console.log('  Move each failing boundary into the silence between words: a keep ends >= 30 ms after the last kept word ends and starts >= 30 ms before the next kept word, where the speech band is quiet.');
  }
  process.exit(pass ? 0 : 1);
}

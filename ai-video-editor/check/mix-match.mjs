// AI Video Editor mix-match gate: the final's audio IS the composition's mix. Lets the audio gates (disfluency, dead-air,
// room-tone, verbatim-final) run on assets/mix.wav while the video renders (clean-cut), and proves afterwards that
// the render carried that mix unchanged: same length (+- 0.05 s after the lead-in offset = final - mix duration) and
// the same 10 ms RMS envelope (Pearson r >= 0.98 on the dB envelopes, windows above the mix's floor + 6 dB), aligned
// at the best lag within the extra length + 20 ms (frame rounding: talk_30s final 0.033 s longer, lag 0, r 1.000).
//   node ai-video-editor/check/mix-match.mjs <mix.wav> <final.mp4> [--json]
// Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DUR_TOL = 0.05, R_MIN = 0.98;
const durOf = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);

/** 10 ms RMS dB envelope of a media file's audio (mono, 16 kHz). */
export function envelope(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const s = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)), out = [];
  for (let i = 0; i + 160 <= s.length; i += 160) { let e = 0; for (let j = i; j < i + 160; j++) e += s[j] * s[j]; out.push(10 * Math.log10(e / 160 + 1e-12)); }
  return out;
}

/** mix / final envelopes + their durations -> {pass, durDiff, offset, lag, r, n}. The final may be longer than the mix
 * by a lead-in (post) and by video frame rounding, so the envelope is aligned at the best lag in
 * [0, final - mix + LAG_SLACK] (10 ms steps); the length check then uses that lag. */
export const LAG_SLACK = 0.02;
export function compareMix(mixEnv, finEnv, mixDur, finDur) {
  const offset = Math.max(0, finDur - mixDur);
  const srt = [...mixEnv].sort((a, b) => a - b), floor = srt[Math.floor(srt.length * 0.1)] + 6;
  const corr = (lag) => {
    const xs = [], ys = [];
    mixEnv.forEach((v, i) => { const w = finEnv[i + lag]; if (v > floor && w != null) { xs.push(v); ys.push(w); } });
    const m = (a) => a.reduce((t, v) => t + v, 0) / Math.max(1, a.length), mx = m(xs), my = m(ys);
    let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    return { r: xs.length > 10 && sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0, n: xs.length };
  };
  let best = { lag: 0, ...corr(0) };
  for (let lag = 1; lag <= Math.round((offset + LAG_SLACK) * 100); lag++) { const c = corr(lag); if (c.r > best.r) best = { lag, ...c }; }
  const durDiff = Math.abs(finDur - best.lag / 100 - mixDur);
  return { pass: durDiff <= DUR_TOL && best.r >= R_MIN, durDiff: +durDiff.toFixed(3), offset: +offset.toFixed(3), lag: best.lag / 100, r: +best.r.toFixed(4), n: best.n };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2), [mix, fin] = argv.filter((a) => !a.startsWith('--'));
  if (!mix || !fin || !fs.existsSync(mix) || !fs.existsSync(fin)) { console.error('usage: mix-match.mjs <mix.wav> <final.mp4> [--json]'); process.exit(2); }
  const r = compareMix(envelope(mix), envelope(fin), durOf(mix), durOf(fin));
  if (argv.includes('--json')) console.log(JSON.stringify(r));
  console.log(`mix-match: ${r.pass ? 'PASS' : 'FAIL'} final audio vs mix: length diff ${r.durDiff} s (aligned at ${r.lag} s of ${r.offset} s extra, need <= ${DUR_TOL}), envelope r ${r.r} (need >= ${R_MIN}, ${r.n} windows)`);
  process.exit(r.pass ? 0 : 1);
}

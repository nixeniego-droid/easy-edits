// Easy Edits dead-air check on the FINAL audio: no internal silence > --max (0.15 s) between words.
//   node easy-edits/check/dead-air.mjs <video.mp4> [--max 0.15] [--rel 10] [--json]
// Same detector as delivery.mjs: ffmpeg silencedetect on the 1.5-5 kHz speech band (low SFX ignored), d = --max,
// noise = the clip's speech-band RMS - --rel dB (default 10). delivery's -20 dB floor sits under the music bed in a
// mixed final (gen_th_style2b: 0 gaps at -47 dB while its transcript shows 12 word gaps of 0.17-0.49 s). The lead-in
// (a silence starting at 0) and the tail (a silence running to the audio end) are excluded; every other silence
// is a gap the cut step should have trimmed (briefs/edit-30s-embedded.md: cut gaps > 0.15 s at speech edges, ~40 ms
// pad). Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const BAND = 'highpass=f=1500,lowpass=f=5000,pan=mono|c0=c0';

/** silencedetect stderr + audio end -> [[start, end]] (an open trailing silence ends at aEnd). */
export function parseSilences(stderr, aEnd) {
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => [s, ends[i] ?? aEnd]);
}

/** silences -> internal gaps over max (lead-in at 0 and the tail at aEnd excluded). */
export function internalGaps(silences, aEnd, max = 0.15) {
  return silences.filter(([s, e]) => s > 0.001 && e < aEnd - 0.001 && e - s > max + 1e-9).map(([s, e]) => ({ start: +s.toFixed(3), end: +e.toFixed(3), dur: +(e - s).toFixed(3) }));
}

export function deadAir(video, { max = 0.15, rel = 10 } = {}) {
  const ff = (af) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-af', af, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const bandRms = Number(/RMS level dB:\s*(-?[\d.]+)/.exec(ff(`${BAND},astats=measure_perchannel=0`).split('Overall').pop())?.[1]);
  const floorDb = Math.round(bandRms - rel);
  const aEnd = Number(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout);
  const sil = parseSilences(ff(`${BAND},silencedetect=noise=${floorDb}dB:d=${max}`), aEnd);
  return { floorDb, aEnd, gaps: internalGaps(sil, aEnd, max) };
}

function main(argv) {
  const pos = [], o = { max: 0.15, rel: 10 };
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i] === '--max' ? (o.max = +argv[++i]) : argv[i] === '--rel' ? (o.rel = +argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 1 || !fs.existsSync(pos[0])) { console.error('usage: dead-air.mjs <video.mp4> [--max 0.15] [--rel 10] [--json]'); return 2; }
  const r = deadAir(pos[0], o);
  if (o.json) console.log(JSON.stringify(r, null, 1));
  for (const g of r.gaps) console.log(`  FAIL DEAD AIR ${g.start.toFixed(2)}-${g.end.toFixed(2)} s (${g.dur.toFixed(2)} s silence between words)`);
  console.log(`dead-air: ${r.gaps.length ? 'FAIL' : 'PASS'} ${r.gaps.length} internal silence(s) over ${o.max} s (speech band, ${r.floorDb} dB)`);
  return r.gaps.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));

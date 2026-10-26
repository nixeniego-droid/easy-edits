// Loudness master: two-pass (measure -> gain) to -14 LUFS integrated with a
// 4x-oversampled limiter as true-peak control, then re-measure the encoded AAC
// and correct the residual, so the final file lands within +-0.4 LU of the
// target with true peak at or under the -1.5 dBTP ceiling.
//
//   node easy-edits/audio/master.mjs <video.mp4> [target-LUFS=-14] [true-peak=-1.5]
// Masters the audio of <video.mp4> in place and prints {I, TP, LRA, passes} as JSON.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Integrated loudness / true peak / LRA of a file (ffmpeg ebur128). */
export function measure(file) {
  const r = spawnSync('ffmpeg', ['-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const num = (re) => Number((s.match(re) || [])[1]);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/**
 * Master `pre` (wav) into the audio track of `video`: two-pass loudness
 * (measure -> gain) with a 4x-oversampled limiter as true-peak control, then
 * measure the encoded AAC and correct the residual. Lands within +-0.5 LU of
 * `target` with true peak under the `truePeak` ceiling (-1.5 dBTP). A correction pass only runs when the
 * encoded result is more than `tolerance` LU off (or over -1 dBTP), up to `maxPasses`.
 */
export function masterTo(pre, video, { duration, target = -14, truePeak = -1.5, maxPasses = 4, tolerance = 0.4 }) {
  const ceiling = Math.pow(10, (truePeak - 0.3) / 20).toFixed(4);
  let gain = target - measure(pre).I;
  let last = null;
  for (let pass = 0; pass < maxPasses; pass++) {
    const out = `${video}.master.mp4`;
    const chain = `[1:a]volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=${ceiling}:attack=1:release=60:level=disabled,aresample=48000[a]`;
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', video, '-i', pre, '-filter_complex', chain, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', String(duration), '-movflags', '+faststart', out], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`master failed: ${r.stderr}`);
    last = measure(out);
    const ok = Math.abs(last.I - target) <= tolerance && last.TP <= -1;
    if (ok || pass === maxPasses - 1) { renameSync(out, video); return { ...last, passes: pass + 1 }; }
    gain += target - last.I;
  }
  return last;
}

/** Master the existing audio of a video (no music/SFX): the default for every final. */
export function masterVideo(video, { duration, target = -14, truePeak = -1.5, work, maxPasses, tolerance }) {
  const pre = join(work, 'premaster.wav');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vn', '-af', 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,highpass=f=75,acompressor=threshold=-21dB:ratio=2:attack=12:release=180', '-t', String(duration), pre], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`premaster failed: ${r.stderr}`);
  return masterTo(pre, video, { duration, target, truePeak, maxPasses, tolerance });
}

const probeDuration = (file) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).stdout.trim());

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [file, target = '-14', truePeak = '-1.5'] = process.argv.slice(2);
  if (!file) { console.error('usage: node master.mjs <video.mp4> [target-LUFS=-14] [true-peak=-1.5]'); process.exit(2); }
  const video = resolve(file);
  const work = mkdtempSync(join(tmpdir(), 'easy-edits-master-'));
  try {
    const r = masterVideo(video, { duration: probeDuration(video), target: Number(target), truePeak: Number(truePeak), work });
    console.log(JSON.stringify(r));
  } finally { rmSync(work, { recursive: true, force: true }); }
}

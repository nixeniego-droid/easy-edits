// Lead-in: hold the first frame and delay the audio by D seconds, so the first
// word never starts on frame 0 (players and feeds clip the first instant).
//   ffmpeg -vf tpad=start_duration=D:start_mode=clone -af adelay=D_ms:all=1
//
//   node easy-edits/post/leadin.mjs <in.mp4> [out.mp4] [--lead-in 0.3 | --no-lead-in]
// In place when out is omitted. Default 0.2 s; env EASY_EDITS_LEADIN overrides the
// default, the flag overrides both; 0 or --no-lead-in disables (file untouched). x264 preset: EASY_EDITS_LEADIN_PRESET
// (default medium; clean-cut uses veryfast at the same crf 16).
import { spawnSync } from 'node:child_process';
import { copyFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_LEADIN = 0.2;

/** Lead-in seconds from argv flags (--lead-in D / --lead-in=D / --no-lead-in) and env EASY_EDITS_LEADIN. */
export function resolveLeadIn(argv = [], env = process.env) {
  let v = env.EASY_EDITS_LEADIN ?? DEFAULT_LEADIN;
  argv.forEach((a, i) => {
    if (a === '--no-lead-in') v = 0;
    else if (a === '--lead-in') v = argv[i + 1];
    else if (a.startsWith('--lead-in=')) v = a.slice(10);
  });
  const d = Number(v);
  if (!Number.isFinite(d) || d < 0) throw new Error(`invalid lead-in "${v}" (seconds >= 0)`);
  return d;
}

/** Write `input` with a D-second cloned-frame / silent lead-in to `output`. D = 0 copies (or no-ops in place). */
export function leadIn(input, output = input, seconds = DEFAULT_LEADIN) {
  if (!(seconds > 0)) { if (resolve(output) !== resolve(input)) copyFileSync(input, output); return { leadIn: 0 }; }
  const tmp = `${output}.leadin.mp4`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', input,
    '-vf', `tpad=start_duration=${seconds}:start_mode=clone`, '-af', `adelay=${Math.round(seconds * 1000)}:all=1`,
    '-c:v', 'libx264', '-preset', process.env.EASY_EDITS_LEADIN_PRESET || 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k',
    '-movflags', '+faststart', tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`lead-in failed: ${r.stderr}`);
  renameSync(tmp, output);
  return { leadIn: seconds };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lead-in');
  if (!pos[0]) { console.error('usage: node leadin.mjs <in.mp4> [out.mp4] [--lead-in 0.2 | --no-lead-in]'); process.exit(2); }
  console.log(JSON.stringify(leadIn(resolve(pos[0]), resolve(pos[1] || pos[0]), resolveLeadIn(argv))));
}

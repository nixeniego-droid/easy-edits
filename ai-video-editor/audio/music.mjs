// Fetch-at-render music bed: search Openverse, keep only CC0 / CC BY tracks longer
// than the video (or 15 s), download (cached), mix under the voice and write
// CREDITS.txt next to the output (addMusic + the
// CC0/CC-BY pick from audioLayer). Run the loudness master (master.mjs) afterwards.
//
//   node ai-video-editor/audio/music.mjs <video.mp4> "<query>" [volume-dB=-24]
import { spawnSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ov from './openverse.mjs';

export const ALLOWED = ['cc0', 'by'];

/** First CC0 / CC BY result long enough to cover `minMs` (unknown durations allowed). Pure. */
export const pickTrack = (results, minMs = 15000) =>
  results.find((r) => ALLOWED.includes(String(r.license).toLowerCase()) && (r.duration_ms == null || r.duration_ms > minMs));

export async function addMusic(out, { query = 'calm acoustic background', volumeDb = -24, duration }) {
  const results = await ov.search(query, { pageSize: 20 });
  const pick = pickTrack(results, Math.max(15000, duration * 1000));
  if (!pick) throw new Error(`no CC0/CC BY Openverse result for "${query}"`);
  const file = await ov.download(pick);
  const tmp = `${out}.mix.mp4`;
  const d = duration;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', out, '-stream_loop', '-1', '-i', file, '-filter_complex',
    `[1:a]volume=${volumeDb}dB,afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, d - 1.5)}:d=1.5,atrim=0:${d}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(d), tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`music mix failed: ${r.stderr}`);
  renameSync(tmp, out);
  const credits = resolve(dirname(out), 'CREDITS.txt');
  writeFileSync(credits, `Music for ${basename(out)} (Openverse)\n\n${ov.creditsText([pick])}`);
  return { pick, file, credits };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [file, query, db = '-24'] = process.argv.slice(2);
  if (!file || !query) { console.error('usage: node music.mjs <video.mp4> "<query>" [volume-dB=-24]'); process.exit(2); }
  const out = resolve(file);
  const duration = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out], { encoding: 'utf8' }).stdout.trim());
  const r = await addMusic(out, { query, volumeDb: Number(db), duration });
  console.log(`music: "${r.pick.title}" by ${r.pick.creator} (${String(r.pick.license).toUpperCase()} ${r.pick.license_version || ''}) -> ${r.credits}`);
}

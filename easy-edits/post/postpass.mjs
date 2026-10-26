// Easy Edits post-pass for every finished render, in order:
//   1. lead-in (easy-edits/post/leadin.mjs, default 0.2 s)
//   2. optional Openverse music bed (easy-edits/audio/music.mjs)
//   3. loudness master (easy-edits/audio/master.mjs, -14 LUFS, -1.5 dBTP ceiling)
//   4. delivery check (easy-edits/check/delivery.mjs; skip with --no-check)
//
//   node easy-edits/post/postpass.mjs <video.mp4> [--lead-in 0.3 | --no-lead-in] [--music "<query>"] [--music-db -24] [--no-check]
// Works in place. Env: EASY_EDITS_LEADIN, EASY_EDITS_MUSIC, EASY_EDITS_MUSIC_DB. Exits 1 if the delivery check fails.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { leadIn, resolveLeadIn } from './leadin.mjs';
import { addMusic } from '../audio/music.mjs';
import { masterVideo } from '../audio/master.mjs';

const probeDuration = (file) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).stdout.trim());

export async function postPass(video, { leadInSec = resolveLeadIn([]), music = process.env.EASY_EDITS_MUSIC, musicDb = Number(process.env.EASY_EDITS_MUSIC_DB || -24), target = -14, truePeak = -1.5 } = {}) {
  const report = {};
  report.leadIn = leadIn(video, video, leadInSec).leadIn;
  if (music) {
    const m = await addMusic(video, { query: music, volumeDb: musicDb, duration: probeDuration(video) });
    report.music = { title: m.pick.title, license: m.pick.license, credits: m.credits };
  }
  const work = mkdtempSync(join(tmpdir(), 'easy-edits-post-'));
  try { report.master = masterVideo(video, { duration: probeDuration(video), target, truePeak, work }); } finally { rmSync(work, { recursive: true, force: true }); }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const video = argv.find((a, i) => !a.startsWith('--') && !['--lead-in', '--music', '--music-db'].includes(argv[i - 1]));
  if (!video) { console.error('usage: node postpass.mjs <video.mp4> [--lead-in 0.3 | --no-lead-in] [--music "<query>"] [--music-db -24]'); process.exit(2); }
  const report = await postPass(resolve(video), { leadInSec: resolveLeadIn(argv), music: opt('--music', process.env.EASY_EDITS_MUSIC),
    musicDb: Number(opt('--music-db', process.env.EASY_EDITS_MUSIC_DB || -24)) });
  console.log(JSON.stringify(report));
  if (!argv.includes('--no-check')) {
    const check = spawnSync(process.execPath, [fileURLToPath(new URL('../check/delivery.mjs', import.meta.url)), resolve(video)], { stdio: 'inherit' });
    process.exitCode = check.status ?? 1;
  }
}

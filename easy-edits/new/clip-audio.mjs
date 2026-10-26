// The ambient audio of generated video clips (host / hosted video backends deliver clips with a faint AAC track).
// --clip-audio auto (default) | keep | duck | drop:
//   auto  dropped when there is narration or a song (the voice / song replaces it), ducked -18 dB under a music
//         bed, kept as-is when it is the only audio
//   keep  as-is (0 dB) under everything;  duck  -18 dB;  drop  never used
// The kept audio is laid on the timeline at each shot's place and length and mixed into the pre-master; the
// finish preset (social -14 LUFS / -1.5 dBTP, podcast -16 LUFS / -1.5 dBTP) is applied afterwards by the master.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CLIP_AUDIO = ['auto', 'keep', 'duck', 'drop'];
export const DUCK_DB = -18;

/** { mode: keep|duck|drop, gainDb, reason } for the flag and what else is on the soundtrack. */
export function clipAudioPolicy(flag = 'auto', { voice = false, song = false, music = false } = {}) {
  if (flag === 'drop') return { mode: 'drop', gainDb: null, reason: '--clip-audio drop' };
  if (flag === 'keep') return { mode: 'keep', gainDb: 0, reason: '--clip-audio keep' };
  if (flag === 'duck') return { mode: 'duck', gainDb: DUCK_DB, reason: '--clip-audio duck' };
  if (voice) return { mode: 'drop', gainDb: null, reason: 'replaced by the narration' };
  if (song) return { mode: 'drop', gainDb: null, reason: 'replaced by the song' };
  if (music) return { mode: 'duck', gainDb: DUCK_DB, reason: `ducked ${DUCK_DB} dB under the music` };
  return { mode: 'keep', gainDb: 0, reason: 'kept as-is: it is the only audio' };
}

/** true when the file has an audio stream. */
export function hasAudio(file) {
  if (!file || !fs.existsSync(file)) return false;
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return r.status === 0 && /audio/.test(r.stdout);
}

function ff(args, label) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${label} failed: ${(r.stderr || '').slice(-1200)}`);
}

/**
 * clips: [{ file, at, dur }] (timeline seconds). Writes a 48 kHz stereo wav of `total` s with each clip's own audio
 * placed at `at` for `dur` s (short 40 ms fades at the joins) at `gainDb`. Returns null when no clip has audio.
 */
export function clipAudioTrack(clips, { total, gainDb = 0, out }) {
  const withAudio = clips.filter((c) => c.dur > 0 && hasAudio(c.file));
  if (!withAudio.length) return null;
  const T = total.toFixed(3);
  const ins = ['-f', 'lavfi', '-t', T, '-i', 'anullsrc=r=48000:cl=stereo'];
  const f = [];
  withAudio.forEach((c, i) => {
    ins.push('-i', c.file);
    const d = c.dur.toFixed(3), ms = Math.max(0, Math.round(c.at * 1000)), fade = Math.min(0.04, c.dur / 4).toFixed(3);
    f.push(`[${i + 1}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=0:${d},asetpts=PTS-STARTPTS,apad=whole_dur=${d},atrim=0:${d},afade=t=in:d=${fade},afade=t=out:st=${(c.dur - Number(fade)).toFixed(3)}:d=${fade},volume=${gainDb}dB,adelay=${ms}:all=1[c${i}]`);
  });
  f.push(`[0:a]${withAudio.map((_, i) => `[c${i}]`).join('')}amix=inputs=${withAudio.length + 1}:normalize=0:duration=first,atrim=0:${T}[a]`);
  ff([...ins, '-filter_complex', f.join(';'), '-map', '[a]', '-c:a', 'pcm_f32le', out], 'clip audio');
  return { file: out, clips: withAudio.length };
}

/** Mix `track` into the pre-master `pre` in place (no normalisation; the master sets the loudness). */
export function mixInto(pre, track) {
  const tmp = `${pre}.clips.wav`;
  ff(['-i', pre, '-i', track, '-filter_complex', '[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[p];[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[c];[p][c]amix=inputs=2:normalize=0:duration=first[a]', '-map', '[a]', '-c:a', 'pcm_f32le', tmp], 'clip audio mix');
  fs.renameSync(tmp, pre);
  return pre;
}

/**
 * The whole step for an assembler: decide the policy, build the track, mix it in. Returns the report entry
 * { flag, mode, reason, gainDb, clips } (clips = how many generated clips had audio and were used).
 */
export function applyClipAudio(pre, clips, { flag = 'auto', voice = false, song = false, music = false, total, work }) {
  const p = clipAudioPolicy(flag, { voice, song, music });
  const res = { flag, mode: p.mode, reason: p.reason, gainDb: p.gainDb, clips: 0, withAudio: clips.filter((c) => hasAudio(c.file)).length };
  if (p.mode === 'drop' || !res.withAudio) return res;
  const t = clipAudioTrack(clips, { total, gainDb: p.gainDb, out: path.join(work, 'clip-audio.wav') });
  if (t) { mixInto(pre, t.file); res.clips = t.clips; }
  return res;
}

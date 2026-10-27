// Finishing presets for `ai-video-editor new`: loudness targets, the audio-only master (WAV + MP3) and the delivery
// verification (ffmpeg ebur128 + ffprobe colour tags + duration range).
//   social   -14 LUFS integrated / -1.5 dBTP (vertical / social video; the default)
//   podcast  -16 LUFS integrated / -1.5 dBTP (podcast audio and its video variant)
// Video masters go through audio/masterTo (same two-pass + oversampled limiter as every edit mode).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { measure, masterTo } from '../audio/master.mjs';

export const PRESETS = {
  social: { name: 'social', target: -14, truePeak: -1.5 },
  podcast: { name: 'podcast', target: -16, truePeak: -1.5 },
};

/** --loudness social|podcast|<LUFS> (+ the recipe's default preset) -> { name, target, truePeak }. */
export function finishPreset(loudness, fallback = 'social') {
  if (loudness == null || loudness === true) return { ...PRESETS[fallback] };
  const s = String(loudness).trim().toLowerCase();
  if (PRESETS[s]) return { ...PRESETS[s] };
  const n = Number(s);
  if (!Number.isFinite(n) || n > -5 || n < -40) throw new Error(`--loudness ${loudness}: use social, podcast or a target in LUFS such as -16`);
  return { name: 'custom', target: n, truePeak: -1.5 };
}

const ffmpeg = (args, label) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${label || 'ffmpeg'} failed: ${(r.stderr || '').slice(-1500)}`);
  return r;
};

const limiterChain = (gain, truePeak) => {
  const ceiling = Math.pow(10, (truePeak - 0.3) / 20).toFixed(4);
  return `volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=${ceiling}:attack=1:release=60:level=disabled,aresample=48000`;
};

/** Master a premix (wav) into the audio track of a video file in place (audio/master.mjs masterTo). */
export function masterVideoAudio(pre, video, preset, duration) {
  return masterTo(pre, video, { duration, target: preset.target, truePeak: preset.truePeak });
}

/**
 * Audio-only master: `pre` -> WAV (pcm 48 kHz stereo) and MP3 (320k), both at the preset target. Two-pass gain with
 * the oversampled limiter, then each encoded file is re-measured and corrected (up to 4 passes) like masterTo.
 */
export function masterAudioFiles(pre, { wav, mp3 }, preset, { tolerance = 0.4, maxPasses = 4 } = {}) {
  const res = {};
  for (const [file, codec] of [[wav, ['-c:a', 'pcm_s16le']], [mp3, ['-c:a', 'libmp3lame', '-b:a', '320k']]]) {
    if (!file) continue;
    let gain = preset.target - measure(pre).I;
    let m = null;
    for (let pass = 0; pass < maxPasses; pass++) {
      ffmpeg(['-i', pre, '-af', limiterChain(gain, preset.truePeak), '-ac', '2', ...codec, file], 'audio master');
      m = measure(file);
      if ((Math.abs(m.I - preset.target) <= tolerance && m.TP <= preset.truePeak) || pass === maxPasses - 1) break;
      gain += preset.target - m.I;
      if (m.TP > preset.truePeak) gain -= 0.3;
    }
    res[file] = m;
  }
  return res;
}

/** ffprobe: duration, first video stream colour tags and size. */
export function probeFile(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,color_primaries,color_transfer,color_space,r_frame_rate', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout || '{}');
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  return { duration: Number(j.format?.duration), video: v || null, audio: !!a };
}

/**
 * Delivery verification of one output: loudness (I within target +-1 LU, TP <= target ceiling), BT.709 tags on
 * video, and the --length range. Returns { pass, checks:[{name,pass,text}], measured:{I,TP}, color, duration }.
 * `notes` collects soft findings (a type's default length target), which never fail the run.
 */
export function verifyOutput(file, { preset, length = null, defaultLength = null, silent = false } = {}) {
  const checks = [], notes = [];
  const p = probeFile(file);
  const add = (name, pass, text) => checks.push({ name, pass, text: `${name}: ${text} ${pass ? 'PASS' : 'FAIL'}` });
  let measured = null;
  if (p.audio) {
    measured = measure(file);
    if (silent) notes.push(`loudness: ${measured.I} LUFS (silent track by request; not mastered)`);
    else add('loudness', Number.isFinite(measured.I) && Math.abs(measured.I - preset.target) <= 1 && measured.TP <= preset.truePeak + 0.05,
      `integrated ${measured.I} LUFS (need ${preset.target}+-1), true peak ${measured.TP} dBTP (need <= ${preset.truePeak})`);
  } else add('audio', false, 'no audio stream');
  let color = null;
  if (p.video) {
    color = `${p.video.color_primaries || 'unknown'}/${p.video.color_transfer || 'unknown'}/${p.video.color_space || 'unknown'}`;
    add('color', color === 'bt709/bt709/bt709', color);
  }
  const range = length || defaultLength;
  if (range && Number.isFinite(p.duration)) {
    const ok = p.duration >= range[0] - 0.5 && p.duration <= range[1] + 0.5;
    const text = `${p.duration.toFixed(1)} s (target ${range[0] === range[1] ? `${range[0]}` : `${range[0]}-${range[1]}`} s)`;
    if (length) add('length', ok, text);
    else if (!ok) notes.push(`length: ${text} is outside this type's usual range`);
  }
  return { file, pass: checks.every((c) => c.pass), checks, notes, measured, color, duration: p.duration, width: p.video?.width, height: p.video?.height };
}

export const exists = (f) => !!f && fs.existsSync(f);

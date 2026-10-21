// Easy Edits synth SFX kit: soft, dry sounds rendered locally with ffmpeg lavfi
// (no samples, no network, no licence questions). Palette follows the Herk
// playbook: air whooshes, damped taps, dry clicks, one warm tone, no zaps.
//   node easy-edits/audio/sfx-synth.mjs <out-dir>        -> <out-dir>/<name>.wav
//   import { synthKit, mixSfx } from './sfx-synth.mjs'
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const SR = 48000;
// name -> [duration s, lavfi source, filter chain]
export const KIT = {
  whoosh: [0.45, `anoisesrc=c=pink:a=0.6:d=0.45`, `bandpass=f=900:w=1.4,afade=t=in:d=0.22:curve=qsin,afade=t=out:st=0.22:d=0.23:curve=qsin`],
  whoosh_low: [0.6, `anoisesrc=c=brown:a=0.8:d=0.6`, `lowpass=f=700,highpass=f=80,afade=t=in:d=0.3:curve=qsin,afade=t=out:st=0.3:d=0.3:curve=qsin`],
  tap: [0.25, `sine=f=190:d=0.25`, `volume=1.2,afade=t=out:d=0.25:curve=exp`],
  thud: [0.5, `sine=f=110:d=0.5`, `volume=1.6,afade=t=out:d=0.5:curve=exp,lowpass=f=300`],
  click: [0.06, `anoisesrc=c=white:a=0.5:d=0.06`, `highpass=f=2500,afade=t=out:d=0.035:curve=exp`],
  click2: [0.08, `sine=f=1400:d=0.08`, `afade=t=out:d=0.05:curve=exp,volume=0.6`],
  tone: [0.9, `sine=f=660:d=0.9`, `afade=t=in:d=0.01,afade=t=out:d=0.89:curve=exp,volume=0.5`],
  shimmer: [0.9, `sine=f=2093:d=0.9`, `tremolo=f=11:d=0.7,afade=t=in:d=0.05,afade=t=out:st=0.1:d=0.8:curve=exp,volume=0.35`],
  crackle: [0.35, `anoisesrc=c=velvet:a=0.9:d=0.35`, `highpass=f=1800,lowpass=f=7000,tremolo=f=23:d=0.9,afade=t=out:d=0.35:curve=exp,volume=0.8`],
  wrap: [0.7, `anoisesrc=c=pink:a=0.5:d=0.7`, `bandpass=f=2200:w=1.2,tremolo=f=9:d=0.8,afade=t=in:d=0.1,afade=t=out:st=0.4:d=0.3,volume=0.8`],
  stop: [0.18, `sine=f=120:d=0.18`, `afade=t=out:d=0.18:curve=exp,volume=1.2`],
};

function detect(src, af) {
  return spawnSync('ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', src, '-af', `${af},volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
}

export function synthKit(outDir, names = Object.keys(KIT)) {
  fs.mkdirSync(outDir, { recursive: true });
  const out = {};
  for (const n of names) {
    const [d, src, chain] = KIT[n];
    const f = path.join(outDir, `${n}.wav`);
    const af = `aformat=sample_rates=${SR}:channel_layouts=mono,${chain},atrim=0:${d}`;
    // peak-normalise every sound to -3 dBFS so cue levels in mixSfx are comparable
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(detect(src, af))[1]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-af', `${af},volume=${(-3 - peak).toFixed(2)}dB`, '-ac', '2', '-ar', String(SR), f]);
    out[n] = f;
  }
  return out;
}

// House SFX level, dB re the voice's whole-file sample peak: every class -13.5 (target 12-15 dB under the voice
// peaks: audible but soft; check/sfx-mix.mjs measures it on the final post audio by matched filter). A cue's own
// `db` is read as dB re the voice peak and clamped to -15..-12. The voice is never ducked under a cue.
export const HOUSE = {
  pop: { names: ['click', 'click2', 'tap', 'stop'], db: -13.5, range: [-15, -12] },
  swish: { names: ['whoosh', 'whoosh_low', 'wrap'], db: -13.5, range: [-15, -12] },
  accent: { names: ['thud', 'tone', 'shimmer', 'crackle'], db: -13.5, range: [-15, -12] },
};
export const houseClass = (sfx) => Object.keys(HOUSE).find((k) => HOUSE[k].names.includes(sfx)) || 'accent';
/** Cue level re the voice peak: the cue's db clamped into its class range, else the class default. */
export function houseDb(cue) {
  const h = HOUSE[houseClass(cue.sfx)];
  return Number.isFinite(cue.db) ? Math.min(h.range[1], Math.max(h.range[0], cue.db)) : h.db;
}
// sample peak after the master's 75 Hz high-pass (the delivered voice peak; the high-pass alone raises it a few dB)
const peakDb = (file) => Number(/max_volume: (-?[\d.]+) dB/.exec(spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'highpass=f=75,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)[1]);

/** Mix voice + cues [{time, sfx, db}] into out.wav (voice untouched, cues at their onset, house level re the voice peak). */
export function mixSfx(voice, cues, kitDir, out, duration) {
  cues = cues.filter((c) => c.sfx);
  const vp = peakDb(voice), kp = {};
  const args = ['-v', 'error', '-y', '-i', voice];
  const f = [];
  cues.forEach((c, i) => {
    args.push('-i', path.join(kitDir, `${c.sfx}.wav`));
    const k = path.join(kitDir, `${c.sfx}.wav`);
    kp[c.sfx] ??= peakDb(k);
    f.push(`[${i + 1}:a]volume=${(vp + houseDb(c) - kp[c.sfx]).toFixed(2)}dB,adelay=${Math.round(c.time * 1000)}:all=1[s${i}]`);
  });
  f.push(`[0:a]${cues.map((_, i) => `[s${i}]`).join('')}amix=inputs=${cues.length + 1}:normalize=0:duration=first,atrim=0:${duration}[m]`);
  execFileSync('ffmpeg', [...args, '-filter_complex', f.join(';'), '-map', '[m]', '-ac', '2', '-ar', String(SR), '-c:a', 'pcm_s16le', out]);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node sfx-synth.mjs <out-dir>'); process.exit(1); }
  console.log(Object.keys(synthKit(dir)).join(' '), '->', dir);
}

// ai-video-editor captions: auto-captions only. No cuts: the whole source, captioned in the Clean cut caption
// look (captions-minimal), burned per format, plus .srt / .vtt. 0.2 s lead-in like every AI Video Editor final.
// A --transcript + --review-patch pair (the clean-cut review format) supplies verified caption text.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { normalise, sdrClip, asrAsync, faceTrack, log } from '../engine/media.mjs';
import { exportFormats } from '../engine/export.mjs';
import { probe } from '../engine/audio.mjs';
import { TAIL_HOLD } from '../styles/clean-cut/build.mjs';
import { requireSpeech } from '../engine/final-output.mjs';
import { joinHyphenWords } from '../engine/words.mjs';

export default async function captions(o) {
  const src = normalise(o.input, o.work);
  // tail: the clean-cut tail hold (TAIL_HOLD): the last frame held 0.4 s while the room tone fades out, so a source
  // that ends on speech still ends >= 0.15 s after the last word (the Final check); nothing is cut
  const sdr = sdrClip(src.file, path.join(o.work, 'clip_sdr.mp4'));
  const clip = path.join(o.work, 'clip_tail.mp4'), voice = path.join(o.work, 'voice.wav');
  const d = probe(sdr).duration;
  o._progress?.stage?.('prep', 'Preparing your video…');
  o._progress?.tick?.(5);
  if (!fs.existsSync(clip)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', sdr, '-vf', `tpad=stop_mode=clone:stop_duration=${TAIL_HOLD}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', clip]);
  if (!fs.existsSync(voice)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src.file, '-map', '0:a:0', '-af', `atrim=0:${d},apad=pad_dur=${TAIL_HOLD},afade=t=out:st=${(d - 0.1).toFixed(3)}:d=${(TAIL_HOLD + 0.1).toFixed(3)}:curve=cub`, '-ar', '48000', '-ac', '2', voice]);
  let words;
  if (o.transcript) {
    const j = JSON.parse(fs.readFileSync(o.transcript, 'utf8'));
    words = j.words.filter((w) => (w.type || 'word') === 'word' && String(w.text).trim()).map((w) => ({ text: String(w.text).trim(), start: w.start, end: w.end }));
    o._progress?.stage?.('asr', 'Using your transcript…');
    o._progress?.tick?.(25);
  } else {
    words = await asrAsync(src.file, path.join(o.work, 'source.words.json'), { lang: o.lang || 'auto', logFile: o.logFile, progress: o._progress });
  }
  words = joinHyphenWords(requireSpeech(words, o.input));
  // --review-patch: only its caption text fixes apply here (index = word index of the transcript; "" blanks a
  // caption word, the audio is never touched); keep / remove are ignored: captions mode never cuts
  if (o.reviewPatch) {
    const fix = JSON.parse(fs.readFileSync(o.reviewPatch, 'utf8')).text || {};
    words = words.map((w, i) => (fix[i] != null ? { ...w, text: String(fix[i]).trim() } : w)).filter((w) => w.text);
    log(`Applied ${Object.keys(fix).length} caption text fix(es)`);
  }
  o._progress?.stage?.('track', 'Finding the face…');
  o._progress?.tick?.(40);
  const track = faceTrack(clip, path.join(o.work, 'clip.track.json'), { logFile: o.logFile });
  o._progress?.stage?.('render', 'Rendering your video…');
  o._progress?.tick?.(50);
  const res = await exportFormats(o, { clipFile: clip, track, words, voice, plan: { beats: [] }, captions: 'minimal', intro: 0, outro: 0, progress: false, lowerThird: false, music: null, leadIn: 0.2 });
  return { words: words.length, ...res };
}

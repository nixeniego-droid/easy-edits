// ai-video-editor explainer: script or transcript -> scenes.
//   video input (screen recording with voiceover, or a talking head): the clean cut (dead air, fillers, slips),
//     then a screen recording (no face in most samples) is letterboxed on the card background and the camera
//     zooms to where the screen changes (engine/activity.py); a talking head gets face framing. The planner leans on
//     cards, lists and diagrams (compare) for the explanation; --script FILE gives it the intended wording.
//   script input (.txt / .md): HyperFrames' local TTS (Kokoro-82M) voices the script, the voiceover is transcribed
//     for word timing, and the scenes are cards + kinetic type on the brand background.
// Both: intro title, voiceover-synced reveals, clean end card, a low music bed (Openverse, fetched at render).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, run, log, PY, sdrClip, faceTrack, asrAsync } from '../engine/media.mjs';
import { exportFormats } from '../engine/export.mjs';
import { cleanBuild, makePlan } from './talking-head.mjs';
import { probe } from '../engine/audio.mjs';
import { sourceHash } from '../engine/plan-store.mjs';

export default async function explainer(o) {
  o._progress?.stage?.('prep', 'Preparing your explainer…');
  o._progress?.tick?.(5);
  const isScript = /\.(txt|md)$/i.test(o.input);
  let words, voice, clip, track, screen = false;
  if (isScript) {
    voice = path.join(o.work, 'voice.wav');
    if (!fs.existsSync(voice)) {
      const text = fs.readFileSync(o.input, 'utf8').replace(/^#+\s*/gm, '').trim();
      fs.writeFileSync(path.join(o.work, 'script.txt'), text);
      log('Recording the voiceover…');
      run(path.join(REPO, 'node_modules/.bin/hyperframes'), ['tts', path.join(o.work, 'script.txt'), '-o', path.join(o.work, 'tts.wav'), '-v', process.env.AI_VIDEO_EDITOR_TTS_VOICE || 'am_michael'], { label: 'TTS', logFile: o.logFile });
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(o.work, 'tts.wav'), '-af', 'aresample=48000,adelay=150:all=1,apad=pad_dur=0.6', '-ac', '2', voice]);
    }
    o._progress?.stage?.('asr', 'Listening and writing captions…');
    o._progress?.tick?.(20);
    words = await asrAsync(voice, path.join(o.work, 'voice.words.json'), { lang: o.lang || 'en', logFile: o.logFile, progress: o._progress });
    const d = probe(voice).duration;
    clip = path.join(o.work, 'bg.mp4');
    if (!fs.existsSync(clip)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `gradients=s=1080x1920:c0=0x0b1020:c1=0x1d2b5a:x0=0:y0=0:x1=1080:y1=1920:d=${d}:speed=0.004,format=yuv420p`, '-t', String(d), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', clip]);
    track = { samples: [] };
    screen = true;
    if (!o.script) o.script = o.input;
  } else {
    const b = cleanBuild(o);
    words = b.words; voice = b.voice;
    clip = sdrClip(b.clip, path.join(o.work, 'clip_sdr.mp4'));
    track = faceTrack(clip, path.join(o.work, 'clip.track.json'), { logFile: o.logFile });
    if ((track.coverage ?? 0) < 0.3) {
      screen = true;
      const act = path.join(o.work, 'clip.activity.json');
      if (!fs.existsSync(act)) run(PY, [path.join(REPO, 'ai-video-editor/engine/activity.py'), clip, act, '--fps', '4'], { label: 'activity track', logFile: o.logFile });
      track = JSON.parse(fs.readFileSync(act, 'utf8'));
      log(`explainer: screen recording (face in ${Math.round((track.coverage ?? 0) * 100)}% of samples): zooms follow screen activity`);
    }
  }
  const scriptText = o.script ? fs.readFileSync(o.script, 'utf8').slice(0, 4000) : '';
  const notes = [o.notes, 'This is an EXPLAINER: every step or idea gets a visual. Aim for one beat every 3-5 seconds. Favour list (steps), compare (diagram) and card beats; top boxes may cover up to 60% of the video here, but leave the screen visible when the speaker describes what is on it. "punch" zooms into the screen where the action is (use it on each click / scroll / reveal the speaker narrates); icon and stat pops mark names and numbers.', scriptText ? `Intended wording (script; use it for spelling and card text, timing comes from the transcript):\n${scriptText}` : ''].filter(Boolean).join('\n');
  const duration = Math.min(probe(clip).duration, probe(voice).duration);
  const { plan, dropped } = makePlan({ ...o, notes }, words, duration, 'explainer', { maxTopShare: isScript ? 0.8 : 0.65, pin: { key: sourceHash(o.input), source: o.input } });
  if (o.planOnly) { const p = path.join(o.out, `ai-video-editor_${o.mode}_${o.clip}.plan.json`); console.log(p); return { plan: p, exports: [] }; }
  const res = await exportFormats(o, {
    clipFile: clip, track, words, voice, plan, captions: 'kinetic', intro: 1.8, outro: 2.6, screen,
    title: plan.title, subtitle: plan.subtitle, speaker: plan.speaker, lowerThird: !!plan.speaker,
    music: o.noMusic ? null : (o.music || 'upbeat corporate'), bedDb: -30,
  });
  return { plan: { planner: plan.planner, title: plan.title, beats: plan.beats, dropped }, screen, ...res };
}

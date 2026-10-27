// Shared render path for shot-based recipes: voice (TTS per plan.voice line) -> timeline -> one clip per shot per
// format (generated once, conformed per format) -> crossfades + burned captions -> premix -> master.
// Recipes call renderShots() from their render(); podcast's waveform video and audio-only use the pieces directly.
import fs from 'node:fs';
import path from 'node:path';
import {
  conformClip, stillClip, voiceDurations, codeCard, assembleVideo, fitDurations, timelineSec, captionsFromSegments, writeSrt, writeVtt,
  voiceTimeline, premix, muxAndMaster, clipFaults, aspectOf, transitionSec,
} from './assemble.mjs';
import { probeFile } from './finish.mjs';
import { applyClipAudio } from './clip-audio.mjs';

export const PALETTE = { bg: '#101418', fg: '#FFFFFF', accent: '#FFD60A', muted: '#B8C0CC' };

/** TTS every plan.voice line once (shared by all formats). Returns segments [{file,durationSec,text,speaker,label}]. */
export async function voiceSegments(plan, ctx) {
  const segs = [];
  for (const v of plan.voice || []) {
    if (v.silent) {
      const d = Math.max(1.2, v.text.split(/\s+/).length / 2.5), file = path.join(ctx.work, `silent_${v.id}.wav`);
      ctx.ff(['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=mono`, '-t', d.toFixed(3), file], 'silent line');
      segs.push({ id: v.id, file, durationSec: d, text: v.text, speaker: v.speaker || null, label: v.label || null, silent: true });
      continue;
    }
    const r = await ctx.generate('tts', { text: v.text, voice: v.voice || null, speaker: v.speaker || null, rate: v.rate || 1 }, { id: v.id });
    segs.push({ id: v.id, file: r.file, durationSec: Number(r.durationSec) || probeSec(r.file), text: v.text, speaker: v.speaker || null, label: v.label || null, labelColor: v.labelColor || null, shot: v.shot || null });
  }
  return segs;
}

const probeSec = (f) => probeFile(f).duration;

/** The source media for a shot, generated at most once per run (cached on ctx by shot id). */
async function shotSource(s, plan, ctx, fmt0, voiceById) {
  if (s.source === 'user') return { file: s.file, type: 'video' };
  if (s.source === 'still' && s.file) return { file: s.file, type: 'image' };
  if (s.source === 'code') return { type: 'code' };
  const aspect = aspectOf(fmt0);
  if (s.source === 'still') {
    const r = await ctx.generate('image', { prompt: s.prompt, aspect, width: fmt0.w, height: fmt0.h, refs: s.refs, seed: s.seed ?? null }, { id: s.id });
    return { file: r.file, type: 'image' };
  }
  if (s.kind === 'avatar') {
    const v = voiceById[s.voice];
    const r = await ctx.generate('avatar', { audio: v?.file, hostImage: s.hostImage || null, aspect, likeness: s.likeness || 'fictional', consent: s.consent || null, durationSec: v?.durationSec || s.durationSec, width: fmt0.w, height: fmt0.h }, { id: s.id });
    return { file: r.file, type: 'video', durationSec: Number(r.durationSec) || probeSec(r.file) };
  }
  const r = await ctx.generate('video', { prompt: s.prompt, durationSec: s.durationSec, aspect, width: fmt0.w, height: fmt0.h, refs: s.refs, seed: s.seed ?? null }, { id: s.id });
  return { file: r.file, type: 'video', durationSec: Number(r.durationSec) || probeSec(r.file) };
}

/**
 * Render every format of a shot plan. opts:
 *   segments   voice segments (voiceSegments) or []
 *   total      timeline length (default: voice end, else the planned shot lengths, else plan.length min)
 *   bed        { file, db } music bed, or null; roomTone: bool; silent: bool (no master, e.g. --no-music promo)
 *   drawCode   (shot, fmt, out, dur) => file   recipe-specific code-drawn scene (default: a text card)
 *   pre        an already mixed wav of length total (instead of segments + bed), e.g. a user's song
 */
export async function renderShots(plan, ctx, opts = {}) {
  const segsIn = opts.segments || [];
  const { segments, end } = segsIn.length ? voiceTimeline(segsIn, opts.timing || {}) : { segments: [], end: 0 };
  const planned = timelineSec(plan.shots.map((s) => s.durationSec), plan.shots);
  let total = opts.total || (segments.length ? end : planned);
  if (plan.length && total < plan.length[0]) total = plan.length[0];
  if (plan.length && !segments.length && !opts.total && total > plan.length[1]) total = plan.length[1];   // no voice: fit the target
  const durs = voiceDurations(plan.shots, segments, total) || fitDurations(plan.shots, total);
  const bed = typeof opts.bed === 'function' ? opts.bed(total) : opts.bed || null;
  const weak = [];
  const voiceById = Object.fromEntries(segsIn.map((s) => [s.id, s]));
  const srcs = {};
  for (const s of plan.shots) {
    try { srcs[s.id] = await shotSource(s, plan, ctx, plan.formats[0], voiceById); } catch (e) {
      if (ctx.strict) throw e;
      weak.push({ shot: s.id, reason: `generation failed (${e.message.split('\n')[0]}); replaced with a code-drawn card`, fix: 're-generate' });
      srcs[s.id] = { type: 'code' };
    }
  }
  ctx.checkpoint?.();   // host assets pending: stop here (exit 3); `ai-video-editor resume` comes back with the files
  let t = 0;
  plan.shots.forEach((s, i) => {
    const src = srcs[s.id];
    s._at = t; t += durs[i] - (i + 1 < plan.shots.length ? transitionSec(plan.shots[i + 1].transition || 'fade') : 0);
    if (src.type === 'video' && s.source === 'generate' && src.durationSec && src.durationSec + 1 < durs[i]) {
      weak.push({ shot: s.id, at: Number(s._at.toFixed(2)), reason: `generated clip is ${src.durationSec.toFixed(1)} s for a ${durs[i].toFixed(1)} s shot; the last frame is held for ${(durs[i] - src.durationSec).toFixed(1)} s`, fix: 'split the shot or re-generate longer' });
    }
    if (src.type === 'video' && s.source === 'generate') for (const f of clipFaults(src.file, src.durationSec || durs[i])) weak.push({ shot: s.id, at: Number(s._at.toFixed(2)), reason: f, fix: 're-generate or replace with a still' });
  });
  const captions = captionsFromSegments(segments);
  const outputs = [], captionFiles = [];
  let clipAudio = null;
  for (const fmt of plan.formats) {
    const fw = path.join(ctx.work, fmt.id);
    fs.mkdirSync(fw, { recursive: true });
    const clips = [];
    for (const [i, s] of plan.shots.entries()) {
      const src = srcs[s.id], dur = durs[i];
      const out = path.join(fw, `${String(i + 1).padStart(2, '0')}_${s.id}.mp4`);
      if (src.type === 'video') conformClip(src.file, out, { w: fmt.w, h: fmt.h, dur, logFile: ctx.logFile });
      else if (src.type === 'image') stillClip(src.file, out, { w: fmt.w, h: fmt.h, dur, dir: i % 2 ? -1 : 1, logFile: ctx.logFile });
      else if (opts.drawCode) opts.drawCode(s, fmt, out, dur, i);
      else codeCard(out, { w: fmt.w, h: fmt.h, dur, bg: s.scene?.bg || PALETTE.bg, work: fw, logFile: ctx.logFile, layers: [{ text: s.scene?.title || s.caption || s.prompt, size: 0.075, y: 0.42, color: s.scene?.fg || PALETTE.fg }, ...(s.scene?.subtitle ? [{ text: s.scene.subtitle, size: 0.045, y: 0.58, color: PALETTE.accent, delay: 0.35 }] : [])] });
      clips.push({ file: out, durationSec: dur, transition: s.transition });
    }
    const video = ctx.outName(fmt, 'mp4');
    const tmp = path.join(fw, 'video.mp4');
    const a = assembleVideo({ clips, w: fmt.w, h: fmt.h, out: tmp, work: fw, captions: opts.burnCaptions === false ? [] : captions, logFile: ctx.logFile });
    const pre = opts.pre || path.join(ctx.work, 'premix.wav');
    if (!opts.pre && !fs.existsSync(pre)) premix(pre, { total: a.durationSec, segments, roomTone: !!opts.roomTone, bed, logFile: ctx.logFile });
    if (!clipAudio) {   // once: the generated clips' own audio (dropped / ducked / kept, see clip-audio.mjs)
      const gen = plan.shots.map((s, i) => ({ s, i })).filter(({ s }) => srcs[s.id].type === 'video' && s.source === 'generate').map(({ s, i }) => ({ file: srcs[s.id].file, at: s._at, dur: durs[i] }));
      clipAudio = applyClipAudio(pre, gen, { flag: plan.options?.clipAudio || 'auto', voice: segments.some((sg) => !sg.silent), song: !!opts.pre, music: !!bed?.file, total: a.durationSec, work: ctx.work });
    }
    fs.copyFileSync(tmp, video);
    muxAndMaster(video, pre, plan.finish, a.durationSec, { silent: !!opts.silent });
    outputs.push({ file: video, format: fmt.id, kind: 'video', width: fmt.w, height: fmt.h });
  }
  if (captions.length) captionFiles.push(writeSrt(captions, ctx.outName(null, 'srt')), writeVtt(captions, ctx.outName(null, 'vtt')));
  return { outputs, captions: captionFiles, weakShots: weak, clipAudio, timeline: { total, shots: plan.shots.map((s, i) => ({ id: s.id, at: Number(s._at.toFixed(2)), durationSec: Number(durs[i].toFixed(2)) })) } };
}

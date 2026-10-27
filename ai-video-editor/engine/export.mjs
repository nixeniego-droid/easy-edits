// AI Video Editor export: one composition per format -> silent HyperFrames render -> soundtrack (voice + music + SFX)
// -> mux + loudness master -> delivery check -> contact sheet + SRT / VTT. Shared by every mode except the
// approved clean-cut 9:16 path (which keeps its own burn render).
import fs from 'node:fs';
import path from 'node:path';
import { compose } from './compose.mjs';
import { buildSoundtrack, fetchMusic, creditsFor, probe } from './audio.mjs';
import { renderProject, muxMaster, deliveryCheck, contactSheet, writeSubtitles, log } from './media.mjs';
import { themeOf } from './theme.mjs';
import { stylePlan } from './style-pack.mjs';
import { lumaGrid } from './contrast.mjs';
import { applyFaceTrack } from './face-override.mjs';

export const exportName = (o, fmt) => `ai-video-editor_${o.mode}_${o.clip}${o.formats.length > 1 ? `_${fmt}` : ''}`;

/**
 * spec: { clipFile (SDR, edited), track, words (edited timeline), voice (edited wav), plan, captions, intro, outro,
 *         title, subtitle, speaker, music: query|null, progress, lowerThird, name (override export base),
 *         hookCard (text), lowerThirds [{name, role, start, end}], steady, joins (jump-cut times) }
 * o.style (a loaded style pack): its theme, its pacing on the plan, only its scenes (intro / outro / progress / lower
 * thirds / hook card / beat types), its default music. o.face (engine/face-override.mjs): the face position for
 * every framing. o.ink ('auto' | 'light' | 'dark' | '#RRGGBB'): caption text colour; auto samples the clip.
 */
export async function exportFormats(o, spec) {
  // spec is reassigned below (the pack's music); the caller's object is never changed
  const info = probe(spec.clipFile);
  const clip = { src: 'assets/clip.mp4', w: info.w, h: info.h, duration: Math.min(info.duration, probe(spec.voice).duration) };
  const S = o.style || null, allow = (k) => !S || S.scenes.includes(k);
  const theme = themeOf(S, o.preset?.accent || spec.accent);
  const styled = stylePlan(spec.plan, S);
  if (styled.dropped.length) log(`style ${S.id}: left out ${styled.dropped.length} beat(s): ${styled.dropped.map((d) => `${d[0]}@${d[1]} (${d[2]})`).join('; ')}`);
  // a screen recording's track is screen activity, not a face: --face leaves it alone
  const face = o.face && !spec.screen ? o.face : null;
  const track = face ? applyFaceTrack(spec.track, face, { width: info.w, height: info.h }) : spec.track;
  if (face) log(`face: --face ${face.label} (framing, captions and pops use it instead of face detection)`);
  else if (o.face) log(`face: --face ignored: this is a screen recording (zooms follow screen activity)`);
  // auto contrast: a tiny greyscale grid of the clip (cached next to it) for the caption backgrounds
  const ink = o.ink || 'auto';
  const luma = spec.captions !== 'none' && ink === 'auto' && (!S || S.captions.color === 'auto') ? lumaGrid(spec.clipFile, `${spec.clipFile}.luma`) : null;
  // the pack's default music bed replaces the mode's (--music / --no-music still win)
  if (S && spec.music && !o.music) spec = { ...spec, music: S.sound.music };
  let music = null;
  if (spec.music) {
    music = await fetchMusic(spec.music, clip.duration + (spec.intro || 0) + (spec.outro || 0));
    if (music) log(`music: "${music.pick.title}" by ${music.pick.creator} (${music.pick.license}) via Openverse`);
    else log('music: no CC0/CC BY track reachable; exporting without a music bed');
  }
  const exports = [];
  for (const fmt of spec.formatsOnly || o.formats) {
    const base = spec.name ? `${spec.name}${o.formats.length > 1 ? `_${fmt}` : ''}` : exportName(o, fmt);
    const proj = path.join(o.work, `comp_${base}`);
    const c = compose({
      fmt, clip, track, words: spec.words, plan: styled.plan, captions: spec.captions,
      intro: allow('intro') ? spec.intro || 0 : 0, outro: allow('outro') ? spec.outro || 0 : 0, title: spec.title, subtitle: spec.subtitle, speaker: spec.speaker,
      accent: o.preset.accent || spec.accent, watermark: o.preset.watermark, cta: o.cta || o.preset.cta,
      progress: allow('progress') ? spec.progress : false, lowerThird: allow('lower-third') ? spec.lowerThird : false, hook: allow('hook') ? spec.hook : null, screen: spec.screen,
      hookCard: allow('hook') ? spec.hookCard : null, lowerThirds: allow('lower-third') ? spec.lowerThirds : [], steady: spec.steady, joins: spec.joins,
      style: S, theme, luma, ink,
    });
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'compose.json'), JSON.stringify({ segments: c.segments, cues: c.cues, captions: c.captions, overlaps: c.overlaps }, null, 1));
    const silent = path.join(o.work, `${base}.silent.mp4`);
    renderProject(proj, c.html, spec.clipFile, silent, { logFile: o.logFile });
    const wav = path.join(o.work, `${base}.soundtrack.wav`);
    buildSoundtrack({ voice: spec.voice, offset: c.offset, total: c.duration, speechEnd: c.offset + clip.duration, cues: c.cues, music, bedDb: spec.bedDb, work: path.join(o.work, `audio_${fmt}`), out: wav });
    const out = path.join(o.out, `${base}.mp4`);
    const m = muxMaster(silent, wav, out, { work: o.work, lead: spec.leadIn || 0 });
    const duration = probe(out).duration;   // the delivered file (includes the lead-in), not the composition
    const chk = deliveryCheck(out, { logFile: o.logFile, lang: o.lang || 'auto', voice: music ? path.join(o.work, `audio_${fmt}`, 'voice.wav') : undefined, words: spec.words });
    contactSheet(out, path.join(o.out, `${base}_sheet.png`));
    writeSubtitles(spec.words, path.join(o.out, base), { offset: c.offset + (spec.leadIn || 0), duration: clip.duration });
    if (music) fs.writeFileSync(path.join(o.out, 'CREDITS.txt'), creditsFor(music.pick, `${exportName(o, '*')}`));
    exports.push({ format: fmt, file: out, duration, loudness: m.measured, pass: chk.pass, note: chk.note, check: chk.out.split('\n').slice(-12).join('\n'), captions: c.captions.length, overlaps: c.overlaps,
      contrast: { mode: luma ? 'auto' : (S && S.captions.color !== 'auto' && ink === 'auto' ? S.captions.color : ink), light: c.ink.light, dark: c.ink.dark },
      ...(S ? { style: S.id, transitions: c.transitions, signatures: c.signatures, styleDropped: styled.dropped } : {}), ...(face ? { face: face.label } : {}) });
    if (c.ink.dark) log(`${fmt}: auto contrast: ${c.ink.dark} of ${c.ink.light + c.ink.dark} captions in dark text (bright footage behind them)`);
    if (c.overlaps.length) log(`${fmt}: WARN ${c.overlaps.length} caption overlap(s): ${c.overlaps.slice(0, 4).map((x) => `${x.t}s "${x.caption}" x ${x.with}`).join('; ')}`);
    log(`${fmt}: ${out} (${duration.toFixed(1)} s, ${chk.pass ? 'delivery PASS' : 'delivery FAIL'})`);
  }
  return { exports, music: music ? { title: music.pick.title, creator: music.pick.creator, license: music.pick.license, url: music.pick.foreign_landing_url || music.pick.url } : null };
}

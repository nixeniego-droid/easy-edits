// Easy Edits export: one composition per format -> silent HyperFrames render -> soundtrack (voice + music + SFX)
// -> mux + loudness master -> delivery check -> contact sheet + SRT / VTT. Shared by every mode except the
// approved clean-cut 9:16 path (which keeps its own burn render).
import fs from 'node:fs';
import path from 'node:path';
import { compose } from './compose.mjs';
import { buildSoundtrack, fetchMusic, creditsFor, probe } from './audio.mjs';
import { renderProject, muxMaster, deliveryCheck, contactSheet, writeSubtitles, log } from './media.mjs';

export const exportName = (o, fmt) => `easy-edits_${o.mode}_${o.clip}${o.formats.length > 1 ? `_${fmt}` : ''}`;

/**
 * spec: { clipFile (SDR, edited), track, words (edited timeline), voice (edited wav), plan, captions, intro, outro,
 *         title, subtitle, speaker, music: query|null, progress, lowerThird, name (override export base),
 *         hookCard (text), lowerThirds [{name, role, start, end}], steady, joins (jump-cut times) }
 */
export async function exportFormats(o, spec) {
  const info = probe(spec.clipFile);
  const clip = { src: 'assets/clip.mp4', w: info.w, h: info.h, duration: Math.min(info.duration, probe(spec.voice).duration) };
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
      fmt, clip, track: spec.track, words: spec.words, plan: spec.plan, captions: spec.captions,
      intro: spec.intro || 0, outro: spec.outro || 0, title: spec.title, subtitle: spec.subtitle, speaker: spec.speaker,
      accent: o.preset.accent || spec.accent, watermark: o.preset.watermark, cta: o.cta || o.preset.cta,
      progress: spec.progress, lowerThird: spec.lowerThird, hook: spec.hook, screen: spec.screen,
      hookCard: spec.hookCard, lowerThirds: spec.lowerThirds, steady: spec.steady, joins: spec.joins,
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
    exports.push({ format: fmt, file: out, duration, loudness: m.measured, pass: chk.pass, note: chk.note, check: chk.out.split('\n').slice(-12).join('\n'), captions: c.captions.length, overlaps: c.overlaps });
    if (c.overlaps.length) log(`${fmt}: WARN ${c.overlaps.length} caption overlap(s): ${c.overlaps.slice(0, 4).map((x) => `${x.t}s "${x.caption}" x ${x.with}`).join('; ')}`);
    log(`${fmt}: ${out} (${duration.toFixed(1)} s, ${chk.pass ? 'delivery PASS' : 'delivery FAIL'})`);
  }
  return { exports, music: music ? { title: music.pick.title, creator: music.pick.creator, license: music.pick.license, url: music.pick.foreign_landing_url || music.pick.url } : null };
}

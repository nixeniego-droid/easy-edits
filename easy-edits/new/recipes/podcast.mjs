// podcast (SPEC G7 / F3 / L3): a speaker-tagged script -> one or two TTS voices with turn gaps and room tone.
//   easy-edits new podcast -o out/ --script episode.txt [--speakers "A=Ana,B=Ben"] [--voices "A=v1,B=v2"]
//                          [--audio-only] [--format 16x9] [--loudness podcast]
// Script lines are "A: text" / "B: text" (any short tag before a colon; untagged lines continue the last speaker).
// Default output: a waveform video with speaker-named captions. --audio-only: WAV + MP3. Both at -16 LUFS / -1.5 dBTP.
// Caption names are the tags the user wrote (or --speakers); names are never guessed.
import path from 'node:path';
import fs from 'node:fs';
import { parseScript, estSec } from '../recipes.mjs';
import { voiceSegments } from '../render.mjs';
import { voiceTimeline, premix, captionsFromSegments, captionFilters, writeSrt, writeVtt, drawText, ff, muxAndMaster, FPS, TAG709 } from '../assemble.mjs';
import { masterAudioFiles } from '../finish.mjs';

const COLORS = { A: '#FFD60A', B: '#5AC8FA' };
const kv = (s) => Object.fromEntries(String(s || '').split(',').map((x) => x.split('=').map((y) => y.trim())).filter((p) => p.length === 2 && p[0] && p[1]));

export const recipe = {
  name: 'podcast',
  description: 'podcast from a speaker-tagged script: two voices, turn gaps, room tone; waveform video or --audio-only',
  keywords: ['podcast', 'episode', 'interview', 'conversation', 'dialogue', 'chat', 'discussion', 'show', 'radio', 'audio'],
  defaults: { loudness: 'podcast' },
  plan(o) {
    if (!o.script) throw new Error('new podcast: needs --script FILE with speaker-tagged lines ("A: ..." / "B: ...")');
    const lines = parseScript(fs.readFileSync(o.script, 'utf8'));
    if (!lines.length) throw new Error(`new podcast: ${o.script} has no lines`);
    const tags = [];
    let last = null;
    for (const l of lines) { if (!l.speaker) l.speaker = last || 'A'; last = l.speaker; if (!tags.includes(l.speaker)) tags.push(l.speaker); }
    if (tags.length > 2) throw new Error(`new podcast: ${tags.length} speakers (${tags.join(', ')}); one or two voices are supported`);
    if (!o.canGen('tts')) throw new Error('new podcast: needs a TTS backend (backend "none" has none); use --backend or EASY_EDITS_BACKEND');
    const names = kv(o.speakers), voices = kv(o.voices);
    const slot = (t) => (tags.indexOf(t) === 1 ? 'B' : 'A');
    const voice = lines.map((l, i) => ({ id: `v${i + 1}`, speaker: slot(l.speaker), tag: l.speaker, label: names[l.speaker] || l.speaker, voice: voices[l.speaker] || voices[slot(l.speaker)] || null, text: l.text }));
    let total = 0.35 + 0.6; let prev = null;
    for (const v of voice) { total += estSec(v.text) + (prev == null ? 0 : prev !== v.speaker ? 0.45 : 0.2); prev = v.speaker; }
    const audioOnly = !!o.audioOnly;
    const shots = [{ id: 's1', durationSec: Number(total.toFixed(2)), source: 'code', prompt: audioOnly ? 'audio only (no picture is rendered)' : `waveform visual with speaker-named captions${o.title ? `, title "${o.title}"` : ''}`, refs: [], camera: 'static', transition: 'cut' }];
    return {
      title: o.title || null, shots, voice, notes: [`${tags.length} voice(s): ${tags.map((t) => `${t} -> voice ${slot(t)}${names[t] ? ` (${names[t]})` : ''}`).join(', ')}`],
      options: { audioOnly, speakers: Object.fromEntries(tags.map((t) => [slot(t), names[t] || t])), roomTone: true },
    };
  },
  async render(plan, ctx) {
    const segs = (await voiceSegments(plan, ctx)).map((s) => ({ ...s, labelColor: COLORS[s.speaker] || COLORS.A }));
    const { segments, end } = voiceTimeline(segs, { lead: 0.35, gap: 0.2, turnGap: 0.45, tail: 0.6 });
    const total = Math.max(end, plan.length ? plan.length[0] : 0);
    const pre = premix(path.join(ctx.work, 'premix.wav'), { total, segments, roomTone: true, logFile: ctx.logFile });
    const captions = captionsFromSegments(segments);
    const capFiles = [writeSrt(captions, ctx.outName(null, 'srt')), writeVtt(captions, ctx.outName(null, 'vtt'))];
    const outputs = [];
    if (plan.options.audioOnly) {
      const wav = ctx.outName(null, 'wav'), mp3 = ctx.outName(null, 'mp3');
      masterAudioFiles(pre, { wav, mp3 }, plan.finish);
      outputs.push({ file: wav, format: 'wav', kind: 'audio' }, { file: mp3, format: 'mp3', kind: 'audio' });
    } else {
      for (const fmt of plan.formats) {
        const fw = path.join(ctx.work, fmt.id);
        fs.mkdirSync(fw, { recursive: true });
        const tmp = path.join(fw, 'video.mp4');
        const { w, h } = fmt;
        const wh = Math.round(h * (w < h ? 0.2 : 0.3) / 2) * 2;
        let g = `color=c=#0E1116:s=${w}x${h}:r=${FPS}:d=${total.toFixed(3)}[bg];`;
        g += `[0:a]aformat=channel_layouts=mono,showwaves=s=${w}x${wh}:mode=cline:draw=full:rate=${FPS}:colors=0xFFD60A:scale=sqrt,format=rgba[wave];`;
        g += `[bg][wave]overlay=0:${Math.round(h * (w < h ? 0.42 : 0.38) - wh / 2)}:shortest=1,format=yuv420p`;
        if (plan.title) g += `,${drawText(fw, plan.title, { size: Math.min(w, h) * 0.065, color: '#FFFFFF', y: `${Math.round(h * 0.12)}` })}`;
        const names = Object.values(plan.options.speakers || {});
        if (names.length) g += `,${drawText(fw, names.join('  &  '), { size: Math.min(w, h) * 0.04, color: '#B8C0CC', y: `${Math.round(h * 0.12 + Math.min(w, h) * 0.1)}` })}`;
        g += `${captionFilters(captions, { w, h, work: fw })},${TAG709},setsar=1[v]`;
        ff(['-i', pre, '-filter_complex', g, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-r', String(FPS), '-t', total.toFixed(3), '-an', tmp], 'podcast video', { logFile: ctx.logFile });
        const video = ctx.outName(fmt, 'mp4');
        fs.copyFileSync(tmp, video);
        muxAndMaster(video, pre, plan.finish, total);
        outputs.push({ file: video, format: fmt.id, kind: 'video', width: w, height: h });
      }
    }
    return {
      outputs, captions: capFiles, weakShots: [],
      timeline: { total: Number(total.toFixed(2)), turns: segments.map((s) => ({ id: s.id, speaker: s.label, at: Number(s.start.toFixed(2)), end: Number(s.end.toFixed(2)) })) },
      notes: ['voices are synthetic (TTS)'],
    };
  },
};

export default recipe;

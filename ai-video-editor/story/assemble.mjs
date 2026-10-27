// Multi-shot assembly: conformed shots joined with cuts or xfade transitions (each transition centred on the
// planned cut, so cut times stay where the plan / the beat grid put them), captions burned from an ASS file, and
// the soundtrack (narration placed per shot, an owned song or music bed, or a quiet synthesised ambient bed).
import fs from 'node:fs';
import path from 'node:path';
import { ff, X264, TAG709, FPS, r3 } from './ffx.mjs';

/**
 * Clip lengths for the timeline: shot i is extended by half of each neighbouring transition so the transition's
 * midpoint sits on the planned cut. Transitions are clamped to fit both neighbours. Returns [{len, td}] (td = the
 * transition INTO shot i, 0 for a cut).
 */
export function timelineLengths(shots) {
  const td = shots.map((s, i) => {
    if (!i || s.transition === 'cut') return 0;
    const lim = Math.min(shots[i - 1].durationSec, s.durationSec) * 0.8;
    return Math.max(0, Math.round(Math.min(Number(s.transitionSec) || 0.5, lim) * FPS / 2) * 2 / FPS);
  });
  return shots.map((s, i) => ({ td: td[i], len: r3(s.durationSec + td[i] / 2 + (td[i + 1] || 0) / 2) }));
}

const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/** Join conformed clips into one silent BT.709 mp4 of `total` seconds, with optional burned captions (ASS file). */
export function assembleVideo(clips, { total, out, ass = null, work }) {
  // one timebase everywhere: xfade refuses inputs whose timebases differ (concat output vs a fresh input)
  const parts = clips.map((_, k) => `[${k}:v]settb=1/${FPS * 1000},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[i${k}]`);
  let cur = '[i0]', acc = clips[0].len;
  for (let k = 1; k < clips.length; k++) {
    const lab = `[v${k}]`, { td, transition } = clips[k];
    if (td > 0) { parts.push(`${cur}[i${k}]xfade=transition=${transition}:duration=${td.toFixed(3)}:offset=${(acc - td).toFixed(3)},settb=1/${FPS * 1000},fps=${FPS}${lab}`); acc += clips[k].len - td; }
    else { parts.push(`${cur}[i${k}]concat=n=2:v=1:a=0,settb=1/${FPS * 1000},fps=${FPS}${lab}`); acc += clips[k].len; }
    cur = lab;
  }
  parts.push(`${cur}${ass ? `ass='${esc(path.relative(work, ass))}',` : ''}format=yuv420p,setsar=1,${TAG709}[vout]`);
  const script = path.join(work, 'assemble.filter');
  fs.writeFileSync(script, parts.join(';\n'));
  ff(['-v', 'error', ...clips.flatMap((c) => ['-i', path.relative(work, c.file)]), '-filter_complex_script', 'assemble.filter', '-map', '[vout]', '-t', total.toFixed(3), '-r', String(FPS), ...X264, '-an', path.relative(work, out)], { cwd: work, label: 'assemble' });
  return { file: out, assembledSec: r3(acc) };
}

const assTime = (t) => { const cs = Math.round(Math.max(0, t) * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const srtTime = (t, sep) => { const ms = Math.round(Math.max(0, t) * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };

/** Caption cues [{start,end,text}] -> an ASS file sized for WxH (white, dark outline, lower third) + .srt / .vtt. */
export function writeCaptions(cues, { width: w, height: h, assFile, base }) {
  const fsz = Math.round(Math.min(w, h) * 0.062), mv = Math.round(h * (h > w ? 0.16 : 0.08));
  const ev = cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,${c.text.replace(/[{}\\]/g, '').replace(/\n/g, '\\N')}`);
  fs.writeFileSync(assFile, `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Cap,Sans,${fsz},&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(fsz / 14))},0,2,${Math.round(w * 0.08)},${Math.round(w * 0.08)},${mv},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${ev.join('\n')}\n`);
  const files = [];
  if (base) {
    fs.writeFileSync(`${base}.srt`, cues.map((c, i) => `${i + 1}\n${srtTime(c.start, ',')} --> ${srtTime(c.end, ',')}\n${c.text}\n`).join('\n'));
    fs.writeFileSync(`${base}.vtt`, `WEBVTT\n\n${cues.map((c) => `${srtTime(c.start, '.')} --> ${srtTime(c.end, '.')}\n${c.text}\n`).join('\n')}`);
    files.push(`${base}.srt`, `${base}.vtt`);
  }
  return { ass: assFile, files };
}

/**
 * Pre-master soundtrack (48 kHz stereo wav, `total` s): `bed` = {file, gainDb} (an owned song / music file) or null
 * for a quiet synthesised ambient bed; `voices` = [{file, at}] narration clips placed on the timeline; the bed sits
 * under narration. Loudness is set afterwards by the master (ffx.finishAudio).
 */
export function buildSoundtrack({ bed, voices = [], total, out, ambient = true }) {
  const T = total.toFixed(3), ins = [], f = [];
  if (!bed?.file && !ambient) { ins.push('-f', 'lavfi', '-t', T, '-i', 'anullsrc=r=48000:cl=stereo'); f.push('[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[bed]'); }   // the clips' own audio is the soundtrack
  else if (bed?.file) { ins.push('-i', bed.file); f.push(`[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=0:${T},apad=whole_dur=${T},volume=${voices.length ? -14 : bed.gainDb || 0}dB[bed]`); }
  else {
    ins.push('-f', 'lavfi', '-i', `aevalsrc='0.10*sin(2*PI*110*t)*(0.75+0.25*sin(2*PI*0.13*t))+0.07*sin(2*PI*164.81*t)*(0.75+0.25*sin(2*PI*0.09*t+1))+0.05*sin(2*PI*220*t)*(0.7+0.3*sin(2*PI*0.07*t+2))':s=48000:d=${T}`);
    f.push(`[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,afade=t=in:d=${Math.min(1, total / 4).toFixed(2)},afade=t=out:st=${Math.max(0, total - 1).toFixed(2)}:d=${Math.min(1, total / 4).toFixed(2)},volume=${voices.length ? -18 : 0}dB[bed]`);
  }
  voices.forEach((v, i) => { ins.push('-i', v.file); f.push(`[${i + 1}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(v.at * 1000)}:all=1[n${i}]`); });
  const mix = voices.length ? `[bed]${voices.map((_, i) => `[n${i}]`).join('')}amix=inputs=${voices.length + 1}:duration=first:normalize=0[mx];[mx]atrim=0:${T}[a]` : '[bed]atrim=0:' + T + '[a]';
  ff(['-v', 'error', ...ins, '-filter_complex', [...f, mix].join(';'), '-map', '[a]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', out], { label: 'soundtrack' });
  return out;
}

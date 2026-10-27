#!/usr/bin/env node
// AI Video Editor CLEAN CUT build: the cut list -> assets/clip.mp4 (video, keeps concatenated frame-exact, natural grade,
// source aspect: never squeezed, the 9:16 cover crop is CSS in the composition), assets/mix.wav (the same keeps with
// a 30 ms equal-power crossfade centred on every join: room tone runs under each join, no silence, no click) and
// index.html (the speaker video + the captions-minimal track; no graphics).
//   node ai-video-editor/styles/clean-cut/build.mjs <project-dir> --source <media> --prep <source-prep.json> [--fps 30] [--dry-run]
// Reads assets/edit-decisions.json + assets/transcript.json (cut.mjs). --dry-run writes index.html only (no ffmpeg).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captionGroups } from '../../presets/captions-default.mjs';
import { captionKeepOut, pickCaptionY } from '../../engine/compose.mjs';
import { joinHyphenWords } from '../../engine/words.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const preset = JSON.parse(fs.readFileSync(path.join(HERE, 'captions.json'), 'utf8'));
export const look = JSON.parse(fs.readFileSync(path.join(HERE, 'look.json'), 'utf8'));
export const XF = 0.03, MIN_CAP = 0.35;
const r3 = (v) => Math.round(v * 1000) / 1000;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** ffmpeg filter_complex for keeps: video trims + concat (+ grade), audio trims extended XF/2 into each neighbour
 * pause + acrossfade (so the audio length equals the video length). */
export const TAIL_HOLD = 0.4;
/** seconds of held last frame + room tone to append: the source ends on speech (no TAIL pad after the last word
 * fits), so delivery's >= 0.15 s after the last word needs a hold; 0 when the last keep has its pad. The room tone
 * under the hold fades out (cubic, the whole hold): an editor's tail fade, and below delivery's -47 dB floor for the
 * last ~0.3 s once mastered (talk_30s room tone ~ -40 dB after the +4 dB master). */
// talk_01: the source runs 0.23 s past the last keep but the room (PA hum, ~-45 dB once mastered) never drops under
// delivery's -50 dB floor, so a hold is added whenever less than TAIL_HOLD + 0.2 s of source follows the last keep.
export const tailHold = (keeps, dur) => (Number.isFinite(dur) && dur - keeps.at(-1).sourceEnd < TAIL_HOLD + 0.2 ? TAIL_HOLD : 0);

/** the longest removed pause (room tone) of the cut list, for the tail hold: [start, end] or null. */
export function roomTone(removed = []) {
  const g = removed.filter((r) => /^dead-air/.test(r.reason || '')).sort((a, b) => (b.sourceEnd - b.sourceStart) - (a.sourceEnd - a.sourceStart))[0];
  return g && g.sourceEnd - g.sourceStart >= 0.1 ? [g.sourceStart, g.sourceEnd] : null;
}

/** the source's video clock vs the cut's frame grid. cut.mjs places every edit on frame f = round(t * fps) of the
 * AUDIO clock; trim=start_frame counts the source's own frames, so on a source that is not `fps`/1 CFR from 0 the
 * picture lands on the wrong instant: a shorts window cut with -ss is 29.97 fps (30000/1001) with its video starting
 * at 0.033 s, so frame f is at 0.033 + f * 1.001 / 30 s, the picture of every keep starts 33-44 ms late in the
 * source (it shows what the voice says a frame later) and -r 30 duplicates frames to make up the 0.1 %. Such a
 * source is resampled to the grid first (fps=<fps>:start_time=0, on the audio clock), a plain 30/1 source from 0
 * keeps the frame-exact graph as it was. `video` = {rate, avgRate, start} (ffprobe r_frame_rate / avg_frame_rate
 * as numbers, video start_time minus the audio's). */
export const needsResample = (video, fps = 30) => !!video && [video.rate, video.avgRate ?? video.rate].some((r) => Number.isFinite(r) && Math.abs(r - fps) > 1e-6) || Math.abs(video?.start || 0) > 1e-6;
const rate = (s) => { const [a, b] = String(s || '').split('/').map(Number); return b ? a / b : a; };
/** {rate, avgRate, start} of the first video stream relative to the first audio stream (ffprobe) */
export function probeVideoClock(src) {
  const j = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,r_frame_rate,avg_frame_rate,start_time', '-of', 'json', src], { encoding: 'utf8' }).stdout || '{}');
  const v = (j.streams || []).find((x) => x.codec_type === 'video'), a = (j.streams || []).find((x) => x.codec_type === 'audio');
  if (!v) return null;
  return { rate: rate(v.r_frame_rate), avgRate: rate(v.avg_frame_rate) || rate(v.r_frame_rate), start: Math.round(((Number(v.start_time) || 0) - (Number(a?.start_time) || 0)) * 1e6) / 1e6 };
}

export function filterGraph(keeps, { grade = look.ffmpeg, xf = XF, dur = Infinity, fps = 30, tail = 0, room = null, video = null } = {}) {
  // every video edit point on the frame grid; audio cut at the same instant (plus a keep's slip)
  const fr = (t) => Math.round(t * fps), n = keeps.length, f = [];
  // video on the frame grid (videoStart / videoEnd when cut.mjs slipped an audio edge into the quiet, else the
  // keep's own times); audio at the keep's exact sourceStart / sourceEnd, then padded / trimmed to the video length
  let vlen = 0;
  keeps = keeps.map((k) => { const f0 = fr(k.videoStart ?? k.sourceStart), f1 = fr(k.videoEnd ?? k.sourceEnd); vlen += f1 - f0; const sl = k.videoStart != null || k.videoEnd != null; return { sourceStart: sl ? k.sourceStart : r3(f0 / fps), sourceEnd: sl ? k.sourceEnd : r3(f1 / fps), f0, f1 }; });
  // the tail hold pads the LAST segment (tpad after concat never sees EOF on trimmed inputs)
  // a non-grid source: one resample to fps CFR on the audio clock (the first frame held back to 0), split per keep
  const rs = needsResample(video, fps), vin = (i) => (rs ? `[s${i}]` : '[0:v]');
  if (rs) f.push(`[0:v]fps=fps=${fps}:start_time=0,split=${n}${keeps.map((_, i) => `[s${i}]`).join('')}`);
  keeps.forEach((k, i) => f.push(`${vin(i)}trim=start_frame=${k.f0}:end_frame=${k.f1},setpts=PTS-STARTPTS${tail && i === n - 1 ? `,fps=${fps},tpad=stop_mode=clone:stop_duration=${tail}` : ''}[v${i}]`));
  f.push(`${keeps.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0${grade ? `,${grade}` : ''},format=yuv420p[vout]`);
  keeps.forEach((k, i) => {
    const a = i ? r3(Math.max(0, k.sourceStart - xf / 2)) : k.sourceStart, b = i < n - 1 ? r3(Math.min(dur, k.sourceEnd + xf / 2)) : k.sourceEnd;
    f.push(`[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
  });
  let last = 'a0';
  for (let i = 1; i < n; i++) { const o = `x${i}`; f.push(`[${last}][a${i}]acrossfade=d=${xf}:c1=qsin:c2=qsin[${o}]`); last = o; }
  if (tail && room) { // room tone under the held tail (a removed pause), crossfaded on like any join
    // from a SECOND input of the same file ([1:a]): a second consumer of [0:a] whose range lies before later keeps
    // stalls the implicit split and every later keep comes out as digital silence (talk_01 run #2: audio gone
    // after 23.6 s of 44.4 s; mix-match and the ASR gates on that mix could not see it)
    f.push(`[1:a]atrim=start=${r3(room[0])}:end=${r3(Math.min(room[1], room[0] + tail + xf))},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[rt]`);
    f.push(`[${last}][rt]acrossfade=d=${xf}:c1=qsin:c2=qsin[xt]`); last = 'xt';
  }
  f.push(`[${last}]apad,atrim=end=${r3(vlen / fps + tail)}${tail ? `,afade=t=out:st=${r3(vlen / fps)}:d=${tail}:curve=cub` : ''}[aout]`);
  return f.join(';');
}

/** Face box [x,y,w,h] (source px) + cover -> output-space sample for captionKeepOut. */
export function faceOut(face, cover) {
  if (!face || !cover || !(face[2] > 0)) return null;
  const [x, y, w, h] = face;
  return { cx: (x + w / 2) * cover.scale + cover.x, cy: (y + h / 2) * cover.scale + cover.y, fw: w * cover.scale };
}

/** Caption centre y + side clear of the face (compose pickCaptionY). Returns { band: 'upper'|'lower', y, side }.
 * Sticky via optional `prev` ({side,y}). When the face fills the frame, floor extends past safeZone.bottom so
 * captions sit over the bottom UI rather than the face (same policy as compose). */
export function captionBand(face, cover, p = preset, prev = null) {
  const ch = p.font.size * p.font.lineHeight * p.box.lines;
  const want = p.safeY.lower, top = p.safeZone.top, bottom = p.safeZone.bottom;
  const floor = 1920 - 40; // over bottom UI rather than the face when the crop is tight
  const ko = captionKeepOut([faceOut(face, cover)].filter(Boolean), 1080);
  const pick = pickCaptionY({ want, ch, ko, top, bottom, floor, lo: p.safeZone.top + ch / 2, hi: floor - ch / 2, prev });
  // band label for burn/gates that still key on upper/lower: above-face => upper, else lower
  const band = pick.side === 'above' ? 'upper' : 'lower';
  return { band, y: pick.y, side: pick.side };
}

export function captions(words, { duration, fps = 30, p = preset, bandAt = () => ({ band: 'lower', y: preset.safeY.lower, side: 'below' }) } = {}) {
  const trim = new RegExp(p.trimPunctuation);
  // disfluent-decode word spans overlap ("relationship" ends after "builds" starts): clip each end at the next start
  words = words.map((w, i) => ({ ...w, end: Math.max(w.start + 0.05, Math.min(w.end, words[i + 1]?.start ?? Infinity)) }));
  const g = captionGroups(words, { duration, fps, p });
  // light mode keeps stutters ("a, a, a gigantic"): the comma break leaves a one-word group on screen for 0.05 s
  // (readability gate: settled < 0.3 s). A group shorter than MIN_CAP joins its neighbour (the next one, else the previous).
  for (let i = 0; i < g.length; i++) {
    if (g.length < 2 || g[i].end - g[i].start >= MIN_CAP) continue;
    const j = i + 1 < g.length ? i + 1 : i - 1, [a, b] = j > i ? [g[i], g[j]] : [g[j], g[i]];
    g.splice(Math.min(i, j), 2, { ...a, text: `${a.text} ${b.text}`, end: b.end, lastEnd: b.lastEnd ?? b.end, words: [...(a.words || []), ...(b.words || [])] });
    i = Math.max(-1, Math.min(i, j) - 1);
  }
  let prev = null;
  return g.map((c) => {
    const pick = bandAt(c.words[0], prev); // bandAt may return string (legacy) or {band,y,side}
    const band = typeof pick === 'string' ? pick : pick.band;
    const y = typeof pick === 'string' ? (pick === 'upper' ? p.safeY.upper : p.safeY.lower) : pick.y;
    const side = typeof pick === 'string' ? (pick === 'upper' ? 'above' : 'below') : pick.side;
    prev = { side, y };
    return { ...c, text: c.text.replace(trim, ''), band, y, side };
  });
}

export function html({ duration, caps, cover, src = { width: 1920, height: 1080 }, p = preset }) {
  const f = p.font, W = r3(src.width * cover.scale), H = r3(src.height * cover.scale), up = p.safeY.upper - p.safeY.lower;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>AI Video Editor clean cut</title>
<script src="assets/gsap.min.js"></script>
<style>
*{box-sizing:border-box}
html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#000}
#root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#000;font-family:'${f.family}',sans-serif}
#spkwrap{position:absolute;left:0;top:0;width:1080px;height:1920px}
#spk{position:absolute;left:${cover.x}px;top:${cover.y}px;width:${W}px;height:${H}px;object-fit:cover}
#caps{position:absolute;left:0;top:${p.safeY.lower}px;width:1080px;height:0;z-index:20}
.cap{position:absolute;left:${p.box.left}px;width:${p.box.width}px;top:0;display:flex;justify-content:center;transform:translateY(-50%)}
.cap span{display:inline-block;font:${f.weight} ${f.size}px/${f.lineHeight} '${f.family}',sans-serif;color:${f.color};letter-spacing:${f.letterSpacing}px;text-align:center;white-space:normal;max-width:${p.box.width}px;${p.stroke ? `-webkit-text-stroke:${p.stroke};paint-order:stroke fill;` : ''}text-shadow:${p.shadow}}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920">
<div id="spkwrap"><video id="spk" src="assets/clip.mp4" muted playsinline data-start="0" data-duration="${duration}" data-track-index="0"></video></div>
<div id="caps">
${caps.map((c, i) => { const y = c.y != null ? c.y : (c.band === 'upper' ? p.safeY.upper : p.safeY.lower); const top = r3(y - p.safeY.lower); return `<div id="cap${i}" class="cap clip" data-start="${c.start}" data-duration="${r3(c.end - c.start)}" data-track-index="4"${top ? ` style="top:${top}px"` : ''}><span>${esc(c.text)}</span></div>`; }).join('\n')}
</div>
<audio id="mix" src="assets/mix.wav" data-start="0" data-duration="${duration}" data-track-index="6" data-volume="1"></audio>
</div>
<script>
const tl=gsap.timeline({paused:true});
tl.set({}, {}, ${duration});
window.__timelines=window.__timelines||{};window.__timelines['main']=tl;
</script></body></html>
`;
}

/** the prep scene at source time t (its face box and 1080x1920 cover transform). */
export function sceneAt(prep, t) {
  const sc = prep?.scenes || [];
  return sc.find((s) => t >= s.start && t < s.end) || sc.at(-1) || null;
}

function main(argv) {
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const proj = argv[0], src = opt('--source'), prepF = opt('--prep'), fps = Number(opt('--fps', 30));
  if (!proj || !src) { console.error('usage: build.mjs <project-dir> --source <media> --prep <source-prep.json> [--fps 30] [--dry-run]'); return 2; }
  const A = path.join(proj, 'assets');
  const ed = JSON.parse(fs.readFileSync(path.join(A, 'edit-decisions.json'), 'utf8'));
  const words = joinHyphenWords(JSON.parse(fs.readFileSync(path.join(A, 'transcript.json'), 'utf8')).words);
  const prep = prepF && fs.existsSync(prepF) ? JSON.parse(fs.readFileSync(prepF, 'utf8')) : null;
  const pr = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', src], { encoding: 'utf8' }).stdout).streams[0];
  const srcDur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' }).stdout);
  const srcDur0 = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' }).stdout);
  const tail = tailHold(ed.keeps, srcDur0), room = roomTone(ed.removed);
  const duration = r3(ed.keeps.at(-1).end + tail);
  // one cover crop for the whole clip: the speaker scene holding the most kept time (no reframing moves)
  const kept = new Map();
  for (const k of ed.keeps) { const s = sceneAt(prep, (k.sourceStart + k.sourceEnd) / 2); if (s) kept.set(s, (kept.get(s) || 0) + k.sourceEnd - k.sourceStart); }
  const main = [...kept].sort((a, b) => b[1] - a[1])[0]?.[0];
  const sc = Math.max(1080 / pr.width, 1920 / pr.height);
  const cover = main?.cover1080x1920 || { scale: r3(sc), x: r3((1080 - pr.width * sc) / 2), y: r3((1920 - pr.height * sc) / 2) };
  const srcT = (t) => { const k = ed.keeps.find((k) => t >= k.start && t <= k.end) || ed.keeps.at(-1); return k.sourceStart + t - k.start; };
  const caps = captions(words, { duration, fps, bandAt: (w, prev) => captionBand(sceneAt(prep, srcT(w.start))?.face?.box, cover, preset, prev) });
  fs.writeFileSync(path.join(proj, 'index.html'), html({ duration, caps, cover, src: pr }));
  fs.writeFileSync(path.join(A, 'captions.json'), JSON.stringify(caps.map(({ words: w, ...c }) => c), null, 1));
  const gsap = path.join(HERE, '../../../node_modules/gsap/dist/gsap.min.js');
  if (!fs.existsSync(path.join(A, 'gsap.min.js'))) fs.copyFileSync(gsap, path.join(A, 'gsap.min.js'));
  console.error(`clean-cut build: ${ed.keeps.length} keeps,${tail ? ` tail hold ${tail} s (room tone ${room ? room.join('-') : 'none'}),` : ''} ${caps.length} captions (${caps.filter((c) => c.band === 'upper').length} upper band), ${duration} s, cover ${JSON.stringify(cover)}`);
  if (argv.includes('--dry-run')) return 0;
  const dur = srcDur;
  const video = probeVideoClock(src);
  if (needsResample(video, fps)) console.error(`clean-cut build: source video ${video.rate.toFixed(3)} fps (avg ${video.avgRate.toFixed(3)}), starts ${video.start} s after the audio: resampled to ${fps} fps CFR on the audio clock before cutting`);
  const fg = filterGraph(ed.keeps, { dur, fps, tail, room, video });
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, ...(tail && room ? ['-i', src] : []), '-filter_complex', fg,
    '-map', '[vout]', '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-g', String(fps), '-keyint_min', String(fps), '-movflags', '+faststart', '-an', path.join(A, 'clip.mp4'),
    '-map', '[aout]', '-c:a', 'pcm_s16le', path.join(A, 'mix.wav')], { encoding: 'utf8' });
  if (r.status) { console.error(`clean-cut build: ffmpeg failed: ${r.stderr}`); return 1; }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));

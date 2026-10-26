// Cited explainer render (SPEC R3, R4, C1, L1, L2): script.json + sources store -> per format
//   <base>.mp4          narration (TTS per claim), a still (image backend) or a code-drawn card per claim, the
//                       citation chip "[n] Source title" for each claim's time, burned captions from the script text
//                       (no ASR: we know the words), a "Sources" end card; -14 LUFS / -1.5 dBTP, BT.709 tagged
//   <base>.srt / .vtt   the same caption groups
//   <base>_sheet.png    contact sheet
// plus SOURCES.txt (numbered in order of first citation, title, URL, retrieved date) in the output folder.
// Everything is drawn by ffmpeg (libass), so it needs no browser and runs with zero video generations.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getBackend } from '../gen/index.mjs';
import { masterTo, measure } from '../audio/master.mjs';
import { contrastRatio, hexRgb } from '../engine/contrast.mjs';
import { contactSheet, REPO } from '../engine/media.mjs';
import { installedFonts } from '../engine/style-pack.mjs';
import { checkCitations } from './citations.mjs';
import { normWs } from './extract.mjs';
import { sourcesTxt } from './sources.mjs';
import { genOpts, PendingAssetsError } from '../new/hostflow.mjs';

export const FORMATS = { '9x16': [1080, 1920], '16x9': [1920, 1080] };
export const SOCIAL = { target: -14, truePeak: -1.5 };
export const MIN_CAPTION_SEC = 0.3;          // same floor as check/readability.mjs (settled >= 0.3 s)
const LEAD = 0.25, TAIL = 0.35, FPS = 30, CAPTION_BOX = 0.85;   // caption box: the look's background at 85% opacity
const r3 = (v) => Math.round(v * 1000) / 1000;
const DEFAULT_LOOK = { background: '#0E1726', surface: '#1C2A3F', text: '#FFFFFF', accent: '#FFC83D', font: null, display: null };

function ff(args, { cwd, label = 'ffmpeg' } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8', cwd, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${label} failed: ${(r.stderr || '').slice(-1500)}`);
}
export function ffprobe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,color_space,color_primaries,color_transfer,duration', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout || '{}');
  const v = (j.streams || []).find((s) => s.codec_type === 'video'), a = (j.streams || []).find((s) => s.codec_type === 'audio');
  return { duration: Number(j.format?.duration || 0), video: v || null, audio: a || null };
}

/** the citation look: a style pack's palette and body font, else the default dark card look. */
export function citationLook(pack) {
  const have = installedFonts();
  const fallback = have?.has('Montserrat') ? 'Montserrat' : 'DejaVu Sans';
  if (!pack) return { ...DEFAULT_LOOK, font: fallback, display: fallback, id: 'default' };
  const p = pack.palette || {};
  const fam = (f) => (f?.family && (!have || have.has(f.family)) ? f.family : fallback);
  return { background: p.background || DEFAULT_LOOK.background, surface: p.surface || DEFAULT_LOOK.surface, text: p.text || DEFAULT_LOOK.text, accent: p.accent || DEFAULT_LOOK.accent, font: fam(pack.fonts?.body), display: fam(pack.fonts?.display), id: pack.id };
}

/** '#RRGGBB' + opacity 0-1 -> ASS &HAABBGGRR */
const assColor = (hex, opacity = 1) => { const [r, g, b] = hexRgb(hex); const h = (n) => n.toString(16).padStart(2, '0').toUpperCase(); return `&H${h(Math.round((1 - opacity) * 255))}${h(b)}${h(g)}${h(r)}`; };
const assText = (s) => String(s).replace(/\\/g, '/').replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\n/g, '\\N');
const assTime = (t) => { const cs = Math.round(Math.max(0, t) * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const subTime = (t, sep) => { const ms = Math.round(Math.max(0, t) * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const blend = (top, alpha, under) => { const a = hexRgb(top), b = hexRgb(under); return `#${a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`; };

/** claim text -> caption groups (<= 5 words / 30 chars, break after punctuation), timed by characters across [t0, t1]. */
export function captionGroups(text, t0, t1, { maxWords = 5, maxChars = 30 } = {}) {
  const ws = normWs(text).split(' ').filter(Boolean), groups = [];
  let cur = [];
  for (const w of ws) {
    const len = [...cur, w].join(' ').length;
    if (cur.length && (cur.length >= maxWords || len > maxChars)) { groups.push(cur); cur = []; }
    cur.push(w);
    if (/[.,;:!?]["'’”)]?$/.test(w) && cur.length >= 2) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  const weight = groups.map((g) => g.join(' ').length + 2), total = weight.reduce((a, b) => a + b, 0) || 1;
  let t = t0;
  return groups.map((g, i) => { const d = ((t1 - t0) * weight[i]) / total; const c = { text: g.join(' '), start: r3(t), end: r3(i === groups.length - 1 ? t1 : t + d) }; t += d; return c; });
}

/** TTS for one claim -> wav; the configured backend, else local Kokoro through HyperFrames when installed. */
async function speak(text, file, { tts, voice, rate, offline, work }) {
  if (tts.name !== 'none') {
    const r = await tts.generate({ text, voice, speaker: 'A', rate }, { outDir: path.join(work, 'tts'), offline });
    ff(['-i', r.file, '-af', 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo', file], { label: 'tts convert' });
    return { file, adapter: tts.name, cost: r.cost || 0, cached: !!r.cached };
  }
  const hf = path.join(REPO, 'node_modules/.bin/hyperframes');
  if (!fs.existsSync(hf)) throw new Error('no TTS backend: configure one (EASY_EDITS_BACKEND / --tts-backend) or run ./install.sh for the local Kokoro voice');
  const txt = `${file}.txt`;
  fs.writeFileSync(txt, `${text}\n`);
  const r = spawnSync(hf, ['tts', txt, '-o', `${file}.raw.wav`, '-v', voice || process.env.EASY_EDITS_TTS_VOICE || 'am_michael'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`local Kokoro TTS failed: ${(r.stderr || '').slice(-800)}`);
  ff(['-i', `${file}.raw.wav`, '-af', 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo', file], { label: 'tts convert' });
  return { file, adapter: 'kokoro', cost: 0, cached: false };
}

/** the timeline shared by every format: per claim {start, speechStart, speechEnd, end}, then the end card. */
export function timeline(durations, nSources) {
  let t = 0;
  const segs = durations.map((d) => { const s = { start: r3(t), speechStart: r3(t + LEAD), speechEnd: r3(t + LEAD + d), end: r3(t + LEAD + d + TAIL) }; t = s.end; return s; });
  const endDur = Math.min(8, 3 + 0.6 * nSources);
  return { segs, endCard: { start: r3(t), end: r3(t + endDur) }, duration: r3(t + endDur) };
}

function assFile({ W, H, fmt, look, script, tl, cited, claimSrc, visuals }) {
  const tall = H > W, u = tall ? W : H;
  const capSize = Math.round(u * (tall ? 0.062 : 0.058)), chipSize = Math.round(u * 0.034), numSize = Math.round(u * (tall ? 0.24 : 0.22));
  const capMargin = Math.round(H * (tall ? 0.2 : 0.085)), chipX = Math.round(W * 0.06), chipY = Math.round(H * (tall ? 0.1 : 0.07));
  const outline = Math.max(2, Math.round(u * 0.012));
  const st = (name, font, size, primary, outlineC, back, bold, border, ol, align, ml, mr, mv) => `Style: ${name},${font},${size},${primary},${primary},${outlineC},${back},${bold ? -1 : 0},0,0,0,100,100,0,0,${border},${ol},0,${align},${ml},${mr},${mv},1`;
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: TV.709', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    st('Caption', look.font, capSize, assColor(look.text), assColor(look.background, CAPTION_BOX), assColor('#000000', 0), true, 3, outline, 2, Math.round(W * 0.08), Math.round(W * 0.08), capMargin),
    st('Chip', look.font, chipSize, assColor(look.text), assColor(look.surface), assColor('#000000', 0), true, 3, Math.round(chipSize * 0.45), 7, chipX, chipX, chipY),
    st('Number', look.display, numSize, assColor(look.accent), assColor('#000000', 0), assColor('#000000', 0), true, 1, 0, 5, 0, 0, 0),
    st('Heading', look.display, Math.round(u * 0.05), assColor(look.text), assColor('#000000', 0), assColor('#000000', 0), true, 1, 0, 5, Math.round(W * 0.1), Math.round(W * 0.1), 0),
    st('EndTitle', look.display, Math.round(u * 0.085), assColor(look.accent), assColor('#000000', 0), assColor('#000000', 0), true, 1, 0, 8, Math.round(W * 0.08), Math.round(W * 0.08), Math.round(H * (tall ? 0.16 : 0.1))),
    st('EndItem', look.font, Math.round(u * (tall ? 0.036 : 0.034)), assColor(look.text), assColor('#000000', 0), assColor('#000000', 0), false, 1, 0, 7, Math.round(W * 0.09), Math.round(W * 0.09), 0),
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = (layer, a, b, style, text) => lines.push(`Dialogue: ${layer},${assTime(a)},${assTime(b)},${style},,0,0,0,,${text}`);
  const captions = [], chips = [];
  script.claims.forEach((c, i) => {
    const s = tl.segs[i], src = claimSrc(c);
    if (visuals[i].type === 'code') {
      ev(0, s.start, s.end, 'Number', `{\\pos(${Math.round(W / 2)},${Math.round(H * (tall ? 0.4 : 0.38))})\\fad(150,100)}${String(i + 1).padStart(2, '0')}`);
      ev(0, s.start, s.end, 'Heading', `{\\pos(${Math.round(W / 2)},${Math.round(H * (tall ? 0.52 : 0.6))})\\fad(150,100)}${assText(clip(script.title, 60))}`);
    }
    const chip = `[${src.n}] ${clip(src.title, tall ? 34 : 56)}`;
    ev(2, s.start, s.end, 'Chip', `{\\fad(120,80)}{\\c${assColor(look.accent)}}[${src.n}]{\\c${assColor(look.text)}} ${assText(chip.slice(String(src.n).length + 3))}`);
    chips.push({ claim: c.id, n: src.n, text: chip, start: s.start, end: s.end });
    for (const g of captionGroups(c.text, s.speechStart, s.speechEnd)) { ev(3, g.start, g.end, 'Caption', assText(g.text)); captions.push(g); }
  });
  const e = tl.endCard;
  ev(1, e.start, e.end, 'EndTitle', '{\\fad(200,0)}Sources');
  const top = H * (tall ? 0.3 : 0.28), step = Math.min(H * (tall ? 0.085 : 0.11), (H * 0.62) / Math.max(1, cited.length));
  cited.forEach((s, i) => ev(1, e.start, e.end, 'EndItem', `{\\pos(${Math.round(W * 0.09)},${Math.round(top + i * step)})\\fad(200,0)}{\\c${assColor(look.accent)}}[${s.n}]{\\c${assColor(look.text)}} ${assText(clip(s.title, tall ? 38 : 64))}\\N{\\fs${Math.round(u * 0.024)}\\alpha&H40&}${assText(clip(s.url.replace(/^https?:\/\//, ''), tall ? 52 : 90))}`));
  return { text: `${lines.join('\n')}\n`, captions, chips };
}

function writeSubs(captions, base) {
  fs.writeFileSync(`${base}.srt`, captions.map((c, i) => `${i + 1}\n${subTime(c.start, ',')} --> ${subTime(c.end, ',')}\n${c.text}\n`).join('\n'));
  fs.writeFileSync(`${base}.vtt`, `WEBVTT\n\n${captions.map((c) => `${subTime(c.start, '.')} --> ${subTime(c.end, '.')}\n${c.text}\n`).join('\n')}`);
  return [`${base}.srt`, `${base}.vtt`];
}

/** delivery checks for one export -> [{name, pass, text}] */
export function deliveryChecks(file, { captions, chips, look, cited, script, sourcesFile, citation, target = SOCIAL.target, truePeak = SOCIAL.truePeak }) {
  const out = [citation];
  const m = measure(file);
  const lOk = Math.abs(m.I - target) <= 1 && m.TP <= truePeak;
  out.push({ name: 'loudness', pass: lOk, text: `loudness: ${lOk ? 'PASS' : 'FAIL'} I ${m.I} LUFS (target ${target} +-1), TP ${m.TP} dBTP (max ${truePeak})`, I: m.I, TP: m.TP, LRA: m.LRA });
  const p = ffprobe(file), v = p.video || {};
  const cOk = v.color_space === 'bt709' && v.color_primaries === 'bt709' && v.color_transfer === 'bt709';
  out.push({ name: 'color', pass: cOk, text: `color: ${v.color_primaries}/${v.color_transfer}/${v.color_space} ${cOk ? 'PASS' : 'FAIL (want bt709/bt709/bt709)'}` });
  const short = captions.filter((c) => c.end - c.start < MIN_CAPTION_SEC);
  const overlap = captions.filter((c, i) => i && c.start < captions[i - 1].end - 1e-3);
  const capOk = captions.length > 0 && !short.length && !overlap.length;
  out.push({ name: 'captions', pass: capOk, text: `captions: ${capOk ? 'PASS' : 'FAIL'} ${captions.length} groups from the script text, ${short.length} on screen < ${MIN_CAPTION_SEC} s, ${overlap.length} overlapping` });
  // readability of the chip and captions: WCAG contrast on their own box (captions: worst case, the box over white or black)
  const chipText = contrastRatio(look.text, look.surface), chipNum = contrastRatio(look.accent, look.surface);
  const capText = Math.min(...['#FFFFFF', '#000000'].map((u) => contrastRatio(look.text, blend(look.background, CAPTION_BOX, u))));
  const shortChip = chips.filter((c) => c.end - c.start < 1);
  const rOk = chipText >= 4.5 && chipNum >= 3 && capText >= 4.5 && !shortChip.length;
  out.push({ name: 'citation-chip', pass: rOk, text: `citation-chip: ${rOk ? 'PASS' : 'FAIL'} ${chips.length} chips timed to their claims (${shortChip.length} < 1 s), contrast text ${chipText.toFixed(1)}:1, number ${chipNum.toFixed(1)}:1, captions >= ${capText.toFixed(1)}:1` });
  const listed = fs.readFileSync(sourcesFile, 'utf8');
  const missing = cited.filter((s) => !listed.includes(`[${s.n}] ${s.title}`) || !listed.includes(s.url));
  const usedIds = new Set(script.claims.map((c) => c.source));
  const sOk = !missing.length && cited.length === usedIds.size;
  out.push({ name: 'sources', pass: sOk, text: `sources: ${sOk ? 'PASS' : 'FAIL'} ${cited.length} cited source(s) in SOURCES.txt and on the end card${missing.length ? `; missing ${missing.map((s) => s.id).join(', ')}` : ''}` });
  const ad = Number(p.audio?.duration || 0), vd = Number(v.duration || 0);
  const avOk = !!p.audio && Math.abs(ad - vd) <= 0.15;
  out.push({ name: 'av', pass: avOk, text: `av: ${avOk ? 'PASS' : 'FAIL'} video ${vd.toFixed(2)} s, audio ${ad.toFixed(2)} s` });
  const inRange = p.duration >= 30 && p.duration <= 120;
  out.push({ name: 'length', pass: true, note: !inRange, text: `length: ${p.duration.toFixed(1)} s${inRange ? ' (in the 30-120 s explainer range)' : ' NOTE outside the 30-120 s explainer range (--length)'}` });
  return out;
}

/**
 * Render every format. script: script.json object; sources: [{id, title, url, retrieved, text}] (loadSources).
 * opts: {out, base, formats, sizes ({fmt: [W, H]} for other sizes), work, backends:{tts,image}, voice, rate, offline,
 *        pack, scale, log, getBackend (an injected backend source, e.g. `easy-edits new`'s generation session)}
 * One still per claim is generated (at the first format's size) and cropped for the others. With the host image
 * backend the stills are listed in GENERATION_MANIFEST.json and the render stops (PendingAssetsError) until they exist.
 * -> {exports:[{format, file, sheet, subtitles, pass, checks, captions, chips}], sourcesFile, citation, generations, notes}
 */
export async function renderExplainer(script, sources, { out, base = 'easy-edits_explainer-cited', formats = ['9x16'], sizes = {}, work, backends = {}, voice, rate, offline = false, pack = null, scale = 1, log = () => {}, getBackend: getB = getBackend } = {}) {
  work = work || path.join(out, '.work', 'explainer-cited');
  fs.mkdirSync(path.join(work, 'tts'), { recursive: true });
  for (const f of formats) if (!FORMATS[f] && !sizes[f]) throw new Error(`explainer-cited renders 9x16 and 16x9 (got ${f})`);
  const dims = (fmt) => (sizes[fmt] ? [...sizes[fmt]] : FORMATS[fmt].map((v) => Math.round((v * scale) / 2) * 2));
  const citation = checkCitations(script, sources);
  log(citation.text);
  const byId = new Map(sources.map((s) => [s.id, s]));
  // display numbers in order of first citation, so [1] is the first source the video cites
  const cited = [];
  for (const c of script.claims) if (byId.has(c.source) && !cited.some((s) => s.id === c.source)) cited.push({ ...byId.get(c.source), n: cited.length + 1 });
  const unknown = { n: '?', title: 'unknown source', url: '' };
  const claimSrc = (c) => cited.find((s) => s.id === c.source) || unknown;
  const sourcesFile = path.join(out, 'SOURCES.txt');
  fs.writeFileSync(sourcesFile, sourcesTxt(cited, { title: script.title }));

  const notes = [], gens = { video: 0, image: 0, tts: 0 };
  // stills first (one per claim, shared by every format), so a host run stops before any voice work
  const image = getB('image', { name: backends.image });
  const visuals = [];
  let pending = 0;
  {
    const [W, H] = dims(formats[0]);
    for (const c of script.claims) {
      if (image.name === 'none') { visuals.push({ type: 'code' }); continue; }
      const req = { prompt: `Editorial illustration, no text: ${c.text}`, aspect: formats[0].replace('x', ':'), width: W, height: H, refs: [], seed: 1 };
      try {
        const r = await image.generate(req, genOpts(image, { out, dir: path.join(work, 'img'), id: c.id, kind: 'image', req, offline }));
        if (r.pending) { pending++; visuals.push({ type: 'pending' }); continue; }
        visuals.push({ type: 'still', file: r.file }); gens.image++;
      } catch (e) { notes.push(`${c.id}: image backend failed (${e.message.split('\n')[0]}); code card instead`); visuals.push({ type: 'code' }); }
    }
  }
  if (pending) throw new PendingAssetsError(out);
  const tts = getB('tts', { name: backends.tts });
  const durs = [];
  for (const [i, c] of script.claims.entries()) {
    const wav = path.join(work, 'tts', `${c.id}.wav`);
    const r = await speak(c.text, wav, { tts, voice, rate, offline, work });
    gens.tts++;
    durs.push(ffprobe(wav).duration);
    log(`voice ${i + 1}/${script.claims.length} (${r.adapter}) ${durs.at(-1).toFixed(1)} s`);
  }
  const tl = timeline(durs, cited.length);
  // narration: each claim padded to its segment, then silence under the end card
  const pre = path.join(work, 'narration.wav');
  const inputs = script.claims.flatMap((c) => ['-i', path.join(work, 'tts', `${c.id}.wav`)]);
  const chain = tl.segs.map((s, i) => `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(LEAD * 1000)}:all=1,apad=whole_dur=${r3(s.end - s.start)},atrim=0:${r3(s.end - s.start)},asetpts=N/SR/TB[a${i}]`).join(';');
  ff([...inputs, '-filter_complex', `${chain};${tl.segs.map((_, i) => `[a${i}]`).join('')}concat=n=${tl.segs.length}:v=0:a=1,apad=whole_dur=${tl.duration},atrim=0:${tl.duration}[a]`, '-map', '[a]', '-c:a', 'pcm_s16le', pre], { label: 'narration mix' });

  const look = citationLook(pack);
  const exports = [];
  for (const fmt of formats) {
    const [W, H] = dims(fmt);
    const fbase = path.join(out, `${base}${formats.length > 1 ? `_${fmt}` : ''}`);
    const fwork = path.join(work, fmt);
    fs.mkdirSync(fwork, { recursive: true });
    const ass = assFile({ W, H, fmt, look, script, tl, cited, claimSrc, visuals });
    fs.writeFileSync(path.join(fwork, 'overlay.ass'), ass.text);
    const args = [], parts = [];
    const segs = [...tl.segs.map((s, i) => ({ ...visuals[i], d: r3(s.end - s.start) })), { type: 'code', d: r3(tl.endCard.end - tl.endCard.start) }];
    segs.forEach((s, i) => {
      const frames = Math.max(1, Math.round(s.d * FPS));
      if (s.type === 'still') {
        args.push('-i', s.file);
        parts.push(`[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0007,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},trim=end_frame=${frames},setsar=1,format=yuv420p[v${i}]`);
      } else {
        args.push('-f', 'lavfi', '-i', `color=c=0x${look.background.slice(1)}:s=${W}x${H}:r=${FPS}:d=${s.d}`);
        parts.push(`[${i}:v]trim=end_frame=${frames},setsar=1,format=yuv420p[v${i}]`);
      }
    });
    const video = `${fbase}.mp4`;
    const graph = `${parts.join(';')};${segs.map((_, i) => `[v${i}]`).join('')}concat=n=${segs.length}:v=1:a=0,ass=overlay.ass,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv[v]`;
    log(`render ${fmt} ${W}x${H} ${tl.duration.toFixed(1)} s ...`);
    ff([...args, '-filter_complex', graph, '-map', '[v]', '-t', String(tl.duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-r', String(FPS), '-an', '-movflags', '+faststart', video], { cwd: fwork, label: `render ${fmt}` });
    const mastered = masterTo(pre, video, { duration: tl.duration, target: SOCIAL.target, truePeak: SOCIAL.truePeak });
    const subtitles = writeSubs(ass.captions, fbase);
    const sheet = contactSheet(video, `${fbase}_sheet.png`);
    const checks = deliveryChecks(video, { captions: ass.captions, chips: ass.chips, look, cited, script, sourcesFile, citation });
    for (const c of checks) log(c.text);
    exports.push({ format: fmt, file: video, sheet, subtitles, width: W, height: H, duration: tl.duration, master: mastered, pass: checks.every((c) => c.pass), checks, visuals: visuals.map((v) => v.type), captions: ass.captions, chips: ass.chips });
  }
  return { exports, sourcesFile, citation, cited: cited.map(({ id, n, title, url, retrieved }) => ({ id, n, title, url, retrieved })), generations: gens, look, timeline: tl, notes };
}

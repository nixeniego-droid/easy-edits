// Presenter short (SPEC recipe 2: G4 fictional host, G5 own likeness + X1 consent, C1 script captions).
//   planPresenter(opts)          -> plan (no generation; every refusal happens here, before any backend call)
//   renderPresenter(plan, ctx)   -> { exports, report }  script -> tts -> avatar -> captions -> -14 LUFS / BT.709
// Backends come from ai-video-editor/gen (getBackend). With the avatar backend "none" the host is a local still with
// subtle motion (no lip-sync), so a presenter renders with no avatar model at all.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getBackend } from '../gen/index.mjs';
import { masterTo, measure } from '../audio/master.mjs';
import { captionAss } from '../presets/captions-ass.mjs';
import { writeSubtitles, contactSheet } from '../engine/media.mjs';
import { verifyConsent, consentSummary, normaliseScope, sha256File, ConsentError } from './consent.mjs';
import { splitSentences, estimateSeconds, wordCount, timeWords, chunkTimeline, SENTENCE_GAP, LEAD, TAIL, WORDS_PER_SECOND } from './script.mjs';
import { stillAvatar } from './still-avatar.mjs';
import { genOpts, PendingAssetsError } from '../new/hostflow.mjs';

export const MIN_SEC = 15, MAX_SEC = 90;
export const SOCIAL = { target: -14, truePeak: -1.5 };
export const DISCLOSURE_TEXT = 'AI-generated presenter';
export const DEFAULT_HOST_PROMPT = 'A friendly fictional presenter, head and shoulders, facing the camera, plain softly lit studio '
  + 'background, vertical 9:16 portrait, natural skin, not resembling any real or famous person';

/** Refusals and bad requests: the runner prints the message and exits 2, nothing is generated. */
export class PresenterError extends Error {
  constructor(msg) { super(msg); this.name = 'PresenterError'; }
}

const r2 = (v) => Math.round(v * 100) / 100;
const IMAGE = /\.(png|jpe?g|webp|bmp)$/i;

/** Hash of the plan's content (everything except planHash / createdAt), so an approved plan can be pinned. */
export function planHash(plan) {
  const { planHash: _h, createdAt: _c, ...rest } = plan;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

function backendInfo(b) {
  return { name: b.name, network: !!b.capabilities.network, voiceClone: !!b.capabilities.voiceClone, maxClipSeconds: b.capabilities.maxClipSeconds, costPerCall: b.capabilities.costPerCall || 0 };
}

/**
 * opts: { script (file) | text, length, likeness ('fictional' | 'self'), use ('face'|'voice'|'both'), consent (file),
 *         subject, hostImage, hostLicense, hostPrompt, voice, backend, imageBackend, ttsBackend, avatarBackend, disclosure (default true), disclosureText,
 *         name, width, height, offline, now }
 */
export function planPresenter(opts = {}) {
  const likeness = String(opts.likeness || 'fictional').toLowerCase();
  if (!['fictional', 'self'].includes(likeness)) {
    throw new PresenterError(`refused: --likeness ${opts.likeness}: only "fictional" (a generated or licensed host) or "self" (your own likeness, with a consent record) are supported. AI Video Editor never synthesises a third party or a public figure`);
  }
  if (opts.use && likeness !== 'self') throw new PresenterError('--use is for --likeness self (which of your face / voice to synthesise)');

  // script
  let text = opts.text;
  if (opts.script) {
    if (!fs.existsSync(opts.script)) throw new PresenterError(`missing script file ${opts.script}`);
    text = fs.readFileSync(opts.script, 'utf8');
  }
  const sentences = splitSentences(text || '');
  if (!sentences.length) throw new PresenterError('a script is required: --script FILE (.txt / .md) or --text "..."');
  const estSec = estimateSeconds(sentences);
  let length = null;
  if (opts.length != null) {
    length = Number(opts.length);
    if (!Number.isFinite(length) || length < MIN_SEC || length > MAX_SEC) throw new PresenterError(`--length ${opts.length}: a presenter short is ${MIN_SEC}-${MAX_SEC} s`);
    if (estSec > length * 1.15 + 1) throw new PresenterError(`the script reads in about ${estSec} s, too long for --length ${length} (shorten it to about ${Math.round((length - LEAD - TAIL) * 2.5)} words)`);
  }
  if (estSec > MAX_SEC * 1.1) throw new PresenterError(`the script reads in about ${estSec} s; a presenter short is at most ${MAX_SEC} s`);
  const notes = [];
  if (length && estSec < length * 0.8) notes.push(`the script reads in about ${estSec} s, shorter than --length ${length}; the video follows the script`);
  if (estSec < MIN_SEC) notes.push(`the script reads in about ${estSec} s; the end is held on the host to reach ${MIN_SEC} s`);

  // consent gate (before anything else touches a backend)
  let consent = null, use = null;
  if (likeness === 'self') {
    use = normaliseScope(opts.use || 'both');
    try { consent = verifyConsent(opts.consent, { use, subject: opts.subject, now: opts.now }); } catch (e) { if (e instanceof ConsentError) throw new PresenterError(e.message); throw e; }
  }
  const selfFace = likeness === 'self' && use !== 'voice';
  const selfVoice = likeness === 'self' && use !== 'face';

  const width = opts.width || 1080, height = opts.height || 1920;
  // --backend for every kind, --<kind>-backend for one (AI_VIDEO_EDITOR_BACKEND still overrides both, see gen/CONTRACT.md)
  const backendNames = { image: opts.imageBackend || opts.backend || null, tts: opts.ttsBackend || opts.backend || null, avatar: opts.avatarBackend || opts.backend || null };
  const pick = (kind) => getBackend(kind, { name: backendNames[kind] || undefined });
  const tts = pick('tts'), avatar = pick('avatar');

  // host image
  let host, image = null;
  if (selfFace) {
    const ref = consent.faceRefs.find((r) => IMAGE.test(r.file)) || consent.faceRefs[0];
    host = { source: 'consent-reference', ref: path.basename(ref.file), sha256: ref.sha256, file: ref.file };
  } else if (opts.hostImage) {
    if (!fs.existsSync(opts.hostImage)) throw new PresenterError(`missing host image ${opts.hostImage}`);
    if (!String(opts.hostLicense || '').trim()) throw new PresenterError('--host-image needs --host-license "..." (who made the image and the licence that lets you use it as a fictional host)');
    host = { source: 'licensed', image: path.basename(opts.hostImage), license: String(opts.hostLicense).trim(), sha256: sha256File(opts.hostImage), file: path.resolve(opts.hostImage) };
  } else {
    image = pick('image');
    if (image.name === 'none') throw new PresenterError('no image backend configured to generate a fictional host: pass --host-image FILE --host-license "...", or choose a backend with --backend NAME');
    host = { source: 'generated', prompt: String(opts.hostPrompt || DEFAULT_HOST_PROMPT) };
  }

  // voice
  if (tts.name === 'none') throw new PresenterError('no tts backend configured for the narration: choose one with --backend NAME');
  let voice;
  if (selfVoice) {
    if (!tts.capabilities.voiceClone) throw new PresenterError(`refused: tts backend "${tts.name}" can't clone a voice (capability voiceClone); use --use face or a backend that can`);
    voice = { mode: 'clone', refs: consent.voiceRefs.map((r) => path.basename(r.file)) };
  } else voice = { mode: 'stock', voice: opts.voice || 'default' };

  // avatar
  const stillFallback = avatar.name === 'none';
  const maxClip = stillFallback ? 0 : avatar.capabilities.maxClipSeconds || 0;
  // the render cuts avatar clips between sentences, so count them on the estimated timeline
  let avatarCalls = 0;
  if (!stillFallback) {
    let t = LEAD;
    const spans = sentences.map((s, i) => { const a = t + (i ? SENTENCE_GAP : 0), b = a + wordCount(s) / WORDS_PER_SECOND; t = b; return { start: a, end: b }; });
    avatarCalls = chunkTimeline(spans, Math.max(t + TAIL, MIN_SEC), maxClip).length;
  }

  // what leaves the machine (W8): only with a network backend, listed here and approved before render
  const willSend = [];
  if (image?.capabilities.network) willSend.push(`the host prompt to image backend "${image.name}"`);
  if (tts.capabilities.network) willSend.push(`the script text${selfVoice ? ` and ${consent.voiceRefs.length} voice reference file(s) of ${consent.record.subject}` : ''} to tts backend "${tts.name}"`);
  if (!stillFallback && avatar.capabilities.network) willSend.push(`the narration audio and the host image${selfFace ? ` (the face reference of ${consent.record.subject})` : ''} to avatar backend "${avatar.name}"`);
  if (opts.offline && willSend.length) throw new PresenterError(`refused by --offline: this plan would send ${willSend.join('; ')}`);

  const generations = { video: 0, image: image ? 1 : 0, tts: sentences.length, avatar: avatarCalls };
  const backends = { tts: backendInfo(tts), avatar: stillFallback ? { name: 'none', fallback: 'local still + subtle motion (no lip-sync)' } : backendInfo(avatar) };
  if (image) backends.image = backendInfo(image);
  const estCost = r2((image ? image.capabilities.costPerCall || 0 : 0) + sentences.length * (tts.capabilities.costPerCall || 0) + avatarCalls * (stillFallback ? 0 : avatar.capabilities.costPerCall || 0));

  const plan = {
    recipe: 'presenter', version: 1,
    name: String(opts.name || (opts.script ? path.basename(opts.script).replace(/\.[^.]+$/, '') : 'presenter')).replace(/[^A-Za-z0-9_-]+/g, '-'),
    likeness, use, synthetic: true,
    aspect: '9:16', width, height, fps: 30,
    length: { target: length, min: MIN_SEC, max: MAX_SEC, estimate: estSec },
    script: { sentences, words: sentences.reduce((n, s) => n + wordCount(s), 0) },
    host, voice, backends, generations, estCost, willSend,
    consent: consent ? consentSummary(consent) : null,
    consentFile: consent ? path.resolve(opts.consent) : null,
    disclosure: { onScreen: opts.disclosure !== false, text: String(opts.disclosureText || DISCLOSURE_TEXT) },
    captions: 'script',
    finishing: { ...SOCIAL, color: 'bt709' },
    notes,
    backendNames,
  };
  plan.planHash = planHash(plan);
  plan.createdAt = (opts.now || new Date()).toISOString();
  return plan;
}

/** PLAN.txt: what will happen, what it uses, what leaves the machine. */
export function planText(plan) {
  const g = plan.generations;
  const host = plan.host.source === 'generated' ? `generated by image backend "${plan.backends.image.name}" (fictional)`
    : plan.host.source === 'licensed' ? `licensed image ${plan.host.image} (${plan.host.license})`
      : `your face reference ${plan.host.ref} (consent ${plan.consent.id})`;
  return [
    `PRESENTER PLAN  ${plan.name}`,
    `generations: ${g.video} video, ${g.image} image, ${g.tts} TTS, ${g.avatar} avatar   est. cost ${plan.estCost}`,
    `likeness: ${plan.likeness}${plan.use ? ` (${plan.use})` : ''}   synthetic: yes   on-screen disclosure: ${plan.disclosure.onScreen ? `"${plan.disclosure.text}"` : 'off'}`,
    plan.consent ? `consent: ${plan.consent.subject} allows ${plan.consent.allowed} until ${plan.consent.expires_at} (${plan.consent.attestation})` : null,
    `host: ${host}`,
    `voice: ${plan.voice.mode === 'clone' ? `your cloned voice (${plan.voice.refs.join(', ')}) via tts "${plan.backends.tts.name}"` : `${plan.voice.voice} via tts "${plan.backends.tts.name}"`}`,
    `avatar: ${plan.backends.avatar.fallback ? plan.backends.avatar.fallback : `avatar backend "${plan.backends.avatar.name}", clips <= ${plan.backends.avatar.maxClipSeconds} s`}`,
    `format: ${plan.aspect} ${plan.width}x${plan.height}, ${plan.length.min}-${plan.length.max} s (script estimate ${plan.length.estimate} s${plan.length.target ? `, target ${plan.length.target} s` : ''})`,
    `finishing: ${plan.finishing.target} LUFS / ${plan.finishing.truePeak} dBTP, BT.709; captions from the script`,
    `will send: ${plan.willSend.length ? plan.willSend.join('; ') : 'nothing (all backends local)'}`,
    ...plan.notes.map((n) => `note: ${n}`),
    '',
    'script:',
    ...plan.script.sentences.map((s, i) => `  ${String(i + 1).padStart(2)}. ${s}`),
    '',
  ].filter((l) => l != null).join('\n');
}

// --- render ---------------------------------------------------------------------------------------------

function ff(args, { cwd } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', cwd, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || '').trim().slice(-800)}`);
}
export function ffprobeJson(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
const duration = (file) => Number(ffprobeJson(file).format.duration);
const silence = (file, sec) => ff(['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=mono`, '-t', sec.toFixed(3), '-c:a', 'pcm_s16le', file]);

/** One wav per sentence -> narration.wav with lead / gaps / tail, plus the sentence spans and timed words. */
function buildNarration(clips, work, minTotal) {
  const parts = [], spans = [], words = [];
  let t = 0;
  const add = (file, sec) => { parts.push(file); t += sec; };
  silence(path.join(work, 'sil-lead.wav'), LEAD); add('sil-lead.wav', LEAD);
  silence(path.join(work, 'sil-gap.wav'), SENTENCE_GAP);
  clips.forEach((c, i) => {
    if (i) add('sil-gap.wav', SENTENCE_GAP);
    spans.push({ start: t, end: t + c.sec });
    words.push(...timeWords(c.text, t, c.sec));
    add(path.basename(c.file), c.sec);
  });
  const tail = Math.max(TAIL, minTotal - t);
  silence(path.join(work, 'sil-tail.wav'), tail); add('sil-tail.wav', tail);
  fs.writeFileSync(path.join(work, 'narration.txt'), parts.map((p) => `file '${p}'`).join('\n') + '\n');
  ff(['-f', 'concat', '-safe', '0', '-i', 'narration.txt', '-c:a', 'pcm_s16le', 'narration.wav'], { cwd: work });
  return { file: path.join(work, 'narration.wav'), total: duration(path.join(work, 'narration.wav')), spans, words };
}

/** A still for the host: an image as is; a video reference -> its middle frame (extracted locally). */
function hostStill(file, work) {
  if (IMAGE.test(file)) return file;
  const out = path.join(work, 'host-frame.png');
  ff(['-ss', String(Math.max(0, duration(file) / 2)), '-i', file, '-frames:v', '1', out]);
  return out;
}

/** Fit a clip to WxH 30 fps, exactly `sec` long (a short clip holds its last frame), video only. */
function conform(src, out, { width, height, sec }) {
  ff(['-i', src, '-an', '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${Math.ceil(sec) + 1}`,
    '-t', sec.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', out]);
}

const assTime = (t) => { const cs = Math.round(t * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };

/** Script captions (house caption look) + the optional "AI-generated presenter" label at the top. */
export function presenterAss(words, { duration: total, width, height, disclosure }) {
  let ass = captionAss(words, { duration: total, width, height, layout: 'face' });
  if (disclosure?.onScreen) {
    const size = Math.round(height * 0.019);
    const style = `Style: Disc,DejaVu Sans,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H8C000000,0,0,0,0,100,100,1,0,3,${Math.round(size * 0.35)},0,8,0,0,${Math.round(height * 0.045)},1`;
    ass = ass.replace(/^(Style: Cap,.*)$/m, `$1\n${style}`);
    ass += `Dialogue: 1,${assTime(0)},${assTime(total)},Disc,,0,0,0,,${String(disclosure.text).replace(/[{}\\]/g, '')}\n`;
  }
  return ass;
}

/** Delivery checks for a presenter export, read back with ffprobe / ebur128. */
export function checkExport(file, { target = SOCIAL.target, truePeak = SOCIAL.truePeak, min = MIN_SEC, max = MAX_SEC } = {}) {
  const p = ffprobeJson(file), v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio');
  const m = a ? measure(file) : { I: NaN, TP: NaN };
  const dur = Number(p.format.duration);
  const checks = [
    { id: 'aspect', pass: !!v && Math.abs(v.width / v.height - 9 / 16) < 0.01, text: v ? `${v.width}x${v.height}` : 'no video stream' },
    { id: 'length', pass: dur >= min - 0.05 && dur <= max + 0.05, text: `${r2(dur)} s (${min}-${max} s)` },
    { id: 'loudness', pass: Math.abs(m.I - target) <= 1 && m.TP <= truePeak + 0.1, text: `I ${m.I} LUFS (target ${target} +-1), TP ${m.TP} dBTP (<= ${truePeak})` },
    { id: 'color', pass: !!v && v.color_primaries === 'bt709' && v.color_transfer === 'bt709' && v.color_space === 'bt709', text: v ? `${v.color_primaries}/${v.color_transfer}/${v.color_space}` : 'no video stream' },
  ];
  return { checks, pass: checks.every((c) => c.pass), loudness: { I: m.I, TP: m.TP }, duration: r2(dur) };
}

/**
 * ctx: { out, work?, approved, offline, log, getBackend? (injected backends, e.g. `ai-video-editor new`'s session) }.
 * With the host image backend the fictional host is listed in GENERATION_MANIFEST.json and the render stops
 * (PendingAssetsError) until the assistant has saved it. Re-checks the plan hash and the consent record (it can expire or
 * its references change between plan and render) before the first generation.
 */
export async function renderPresenter(plan, ctx = {}) {
  const log = ctx.log || (() => {});
  if (plan.planHash !== planHash(plan)) throw new PresenterError('the plan was changed after it was made (plan hash mismatch); plan again');
  if (plan.willSend.length && !ctx.approved) throw new PresenterError(`approval needed before render: this plan would send ${plan.willSend.join('; ')}. Review PLAN.txt, then re-run with --approve <plan.json>`);
  if (ctx.offline && plan.willSend.length) throw new PresenterError(`refused by --offline: this plan would send ${plan.willSend.join('; ')}`);
  let consent = null;
  if (plan.likeness === 'self') {
    try { consent = verifyConsent(plan.consentFile, { use: plan.use, subject: plan.consent.subject }); } catch (e) { if (e instanceof ConsentError) throw new PresenterError(e.message); throw e; }
    if (consent.id !== plan.consent.id) throw new PresenterError('refused: the consent record changed since the plan was made; plan again');
  }

  const out = path.resolve(ctx.out || '.');
  const work = path.resolve(ctx.work || path.join(out, '.work', `presenter_${plan.name}`));
  fs.mkdirSync(work, { recursive: true });
  const gen = path.join(work, 'gen');
  const { width, height } = plan;
  const pick = (kind) => (ctx.getBackend || getBackend)(kind, { name: plan.backendNames[kind] || undefined });
  const genOpts0 = { outDir: gen, offline: !!ctx.offline };
  const t0 = Date.now();
  const calls = [];

  // 1. host image
  let hostImage;
  if (plan.host.source === 'generated') {
    log(`host: generating a fictional host (${plan.backends.image.name})`);
    const ib = pick('image');
    const req = { prompt: plan.host.prompt, aspect: '9:16', width, height, refs: [], seed: 7 };
    const r = await ib.generate(req, genOpts(ib, { out, dir: gen, id: 'host', kind: 'image', req, offline: !!ctx.offline }));
    calls.push({ kind: 'image', backend: plan.backends.image.name, cost: r.cost || 0, cached: !!r.cached });
    if (r.pending) throw new PendingAssetsError(out);   // the assistant makes the host image first; resume continues
    hostImage = r.file;
  } else hostImage = hostStill(plan.host.file, work);

  // 2. narration, one TTS call per sentence (cloned voice only with a voice / both consent record)
  const tts = pick('tts');
  const clips = [];
  for (const [i, text] of plan.script.sentences.entries()) {
    const req = { text, voice: plan.voice.mode === 'clone' ? 'clone' : plan.voice.voice, speaker: 'A', rate: 1 };
    if (plan.voice.mode === 'clone') Object.assign(req, { voiceClone: true, refs: consent.voiceRefs.map((r) => r.file), consent: plan.consent.id });
    const r = await tts.generate(req, genOpts0);
    calls.push({ kind: 'tts', backend: tts.name, cost: r.cost || 0, cached: !!r.cached });
    const wav = path.join(work, `line-${String(i + 1).padStart(2, '0')}.wav`);
    ff(['-i', r.file, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
    clips.push({ text, file: wav, sec: duration(wav) });
  }
  const narr = buildNarration(clips, work, MIN_SEC);
  log(`narration: ${plan.script.sentences.length} line(s), ${r2(narr.total)} s`);

  // 3. presenter track: avatar clips (<= the backend's clip length, cut between sentences) or the local still
  const track = path.join(work, 'presenter-track.mp4');
  let avatarInfo;
  if (plan.backends.avatar.fallback) {
    stillAvatar(hostImage, track, { width, height, duration: narr.total, audio: narr.file });
    avatarInfo = { backend: 'none', fallback: plan.backends.avatar.fallback, chunks: 1 };
  } else {
    const avatar = pick('avatar');
    const chunks = chunkTimeline(narr.spans, narr.total, plan.backends.avatar.maxClipSeconds);
    const parts = [];
    for (const [i, c] of chunks.entries()) {
      const sec = c.end - c.start, a = path.join(work, `chunk-${i + 1}.wav`), v = path.join(work, `chunk-${i + 1}.mp4`);
      ff(['-i', narr.file, '-ss', c.start.toFixed(3), '-t', sec.toFixed(3), '-c:a', 'pcm_s16le', a]);
      const r = await avatar.generate({
        audio: a, hostImage, aspect: '9:16', width, height, durationSec: Math.round(sec * 1000) / 1000, seed: 7,
        likeness: plan.likeness, consent: plan.consent ? { id: plan.consent.id, subject: plan.consent.subject, allowed: plan.consent.allowed, expires_at: plan.consent.expires_at } : null,
      }, genOpts0);
      calls.push({ kind: 'avatar', backend: avatar.name, cost: r.cost || 0, cached: !!r.cached });
      conform(r.file, v, { width, height, sec });
      parts.push(path.basename(v));
    }
    fs.writeFileSync(path.join(work, 'track.txt'), parts.map((p) => `file '${p}'`).join('\n') + '\n');
    ff(['-f', 'concat', '-safe', '0', '-i', 'track.txt', '-c', 'copy', 'presenter-track.mp4'], { cwd: work });
    avatarInfo = { backend: avatar.name, chunks: chunks.length, maxClipSeconds: plan.backends.avatar.maxClipSeconds };
    log(`avatar: ${chunks.length} clip(s) from "${avatar.name}"`);
  }

  // 4. captions (+ disclosure) burned in, BT.709, then the -14 LUFS / -1.5 dBTP master
  fs.writeFileSync(path.join(work, 'captions.ass'), presenterAss(narr.words, { duration: narr.total, width, height, disclosure: plan.disclosure }));
  fs.mkdirSync(out, { recursive: true });
  const base = path.join(out, `ai-video-editor_presenter_${plan.name}`);
  const mp4 = `${base}.mp4`;
  ff(['-i', track, '-an', '-vf', `scale=${width}:${height}:out_color_matrix=bt709:out_range=tv,setsar=1,fps=30,ass=captions.ass,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`,
    '-t', narr.total.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', mp4], { cwd: work });
  const pre = path.join(work, 'premaster.wav');
  ff(['-i', narr.file, '-af', 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,highpass=f=75', pre]);
  const master = masterTo(pre, mp4, { duration: narr.total, target: SOCIAL.target, truePeak: SOCIAL.truePeak });
  log(`master: I ${master.I} LUFS, TP ${master.TP} dBTP (${master.passes} pass(es))`);

  // 5. sidecars + checks
  const subs = writeSubtitles(narr.words, base, { duration: narr.total });
  const sheet = contactSheet(mp4, `${base}_sheet.png`);
  const check = checkExport(mp4);
  const exp = { file: mp4, format: '9x16', pass: check.pass, checks: check.checks, sheet, subtitles: subs, note: check.checks.filter((c) => !c.pass).map((c) => `FAIL ${c.id}: ${c.text}`).join('; ') || undefined };
  const report = {
    mode: 'presenter', recipe: 'presenter', name: plan.name, seconds: Math.round((Date.now() - t0) / 1000),
    synthetic: true, likeness: plan.likeness, use: plan.use,
    disclosure: plan.disclosure,
    host: { ...plan.host, file: undefined },
    voice: plan.voice,
    consent: plan.consent,
    avatar: avatarInfo,
    captions: { source: 'script', words: narr.words.length },
    generations: plan.generations, calls, cost: r2(calls.reduce((a, c) => a + c.cost, 0)),
    willSend: plan.willSend,
    length: { ...plan.length, actual: check.duration },
    loudness: { ...check.loudness, target: SOCIAL.target, truePeak: SOCIAL.truePeak, passes: master.passes },
    planHash: plan.planHash,
    notes: plan.notes,
    exports: [exp],
  };
  fs.writeFileSync(`${base}.report.json`, JSON.stringify(report, null, 1));
  return { exports: [exp], report, reportFile: `${base}.report.json` };
}

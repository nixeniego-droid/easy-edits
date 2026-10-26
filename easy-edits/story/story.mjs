// Multi-shot story planner (SPEC S2, G1, G3, E2, F1; recipe 4). A brief or shotlist.json -> shots[] with the
// characters.json descriptions attached to every prompt, beats longer than the video backend's maxClipSeconds split,
// and a source per shot (video, still + Ken Burns, card, or user clip). renderPlan() (render.mjs) renders it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseAspect, sha, r3 } from './ffx.mjs';
import { loadCharacters, loadShots, normaliseShots } from './shots.mjs';
import { resolveBackends, plannedSource, usable } from './sources.mjs';
import { RefusalError } from './errors.mjs';

export const LOUDNESS_SOCIAL = { target: -14, truePeak: -1.5 };

/** A user-supplied music file needs the ownership attestation; returns the record that goes into report.json. */
export function musicAttestation(file, attested) {
  if (!attested) throw new RefusalError('NO_MUSIC_ATTESTATION', `refusing to use ${path.basename(file)}: only music you own or have licensed for this use. Re-run with --i-own-this-music to attest that you do (it is recorded in report.json).`);
  if (!fs.existsSync(file)) throw new Error(`music file not found: ${path.basename(file)}`);
  const h = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return { file: path.resolve(file), sha256: h, attestation: { owned: true, flag: '--i-own-this-music', statement: 'the user attested that they own this music or have licensed it for this use (not verified by Easy Edits)', song: path.basename(file), sha256: h, attestedAt: new Date().toISOString() } };
}

/** The backends summary that goes into a plan (names + the capabilities the planner used; never keys). */
export function backendSummary(b) {
  const c = (x) => ({ name: x?.name || 'none', maxClipSeconds: x?.capabilities?.maxClipSeconds || 0, references: !!x?.capabilities?.references, costPerCall: x?.capabilities?.costPerCall || 0, network: !!x?.capabilities?.network });
  return { video: c(b.video), image: c(b.image), tts: c(b.tts) };
}

/** Plan a story. opts: brief | shotlist, characters, aspect, backend, length, shotSec, narrate, narration, captions, music + iOwnThisMusic, style, title, transition. */
export function planStory(opts = {}) {
  const dims = parseAspect(opts.aspect || opts.format || '9:16');
  const characters = loadCharacters(opts.characters);
  const backends = resolveBackends(opts.backend, opts.backends);
  const loaded = loadShots({ brief: opts.brief, shotlist: opts.shotlist, characters, length: opts.length, shotSec: opts.shotSec, narrate: !!opts.narrate, transition: opts.transition || 'fade' });
  const source = plannedSource(backends);
  const maxClip = usable(backends.video, 'video') ? backends.video.capabilities.maxClipSeconds : 0;
  const { shots, splits, total } = normaliseShots(loaded.shots, { characters, maxClipSeconds: maxClip, source, style: opts.style || loaded.style });
  const notes = [];
  if (opts.narration && !fs.existsSync(opts.narration)) throw new Error(`narration file not found: ${path.basename(opts.narration)}`);
  if (source !== 'video') notes.push(source === 'still' ? 'no video backend: generated stills with a Ken Burns move' : 'no video or image backend: code-drawn text cards stand in for every generated shot');
  for (const s of splits) notes.push(`shot ${s.from} split into ${s.into.join(', ')} (${s.reason})`);
  const music = opts.music ? musicAttestation(opts.music, !!opts.iOwnThisMusic) : null;
  const narr = shots.filter((s) => s.narration).length;
  const per = backendSummary(backends);
  const generations = {
    video: shots.filter((s) => s.source === 'video').length, image: shots.filter((s) => s.source === 'still').length,
    tts: usable(backends.tts, 'tts') ? narr : 0,
  };
  generations.estimatedCost = r3(generations.video * per.video.costPerCall + generations.image * per.image.costPerCall + generations.tts * per.tts.costPerCall);
  const plan = {
    recipe: 'story', version: 1, title: opts.title || loaded.title || null, ...dims, fps: 30,
    backend: opts.backend || null, backends: per, characters, shots, splits, durationSec: total,
    captions: opts.captions !== false && shots.some((s) => s.caption || s.narration),
    ...(music ? { music } : {}), ...(opts.narration ? { narrationFile: path.resolve(opts.narration) } : {}), voice: opts.voice || null, loudness: { ...LOUDNESS_SOCIAL }, generations, notes,
  };
  plan.id = sha({ s: shots.map((s) => [s.id, s.durationSec, s.fullPrompt, s.source]), w: dims.width, h: dims.height });
  return plan;
}

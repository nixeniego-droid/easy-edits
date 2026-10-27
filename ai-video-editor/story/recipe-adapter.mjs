// The `ai-video-editor new` registry shape for story and music-video (see ../new/recipes.mjs): maps the CLI options onto
// planStory / planMusicVideo, turns their shots into plan.json shots[] / voice[] (so the approval gate counts the
// generations), and renders through renderPlan with the generation session's backends (budget, host flow).
import fs from 'node:fs';
import path from 'node:path';
import { getBackend } from '../gen/index.mjs';
import { renderPlan } from './render.mjs';
import { usable } from './sources.mjs';
import { RefusalError } from './errors.mjs';
import { FPS, r3 } from './ffx.mjs';

const SOURCE = { video: 'generate', still: 'still', card: 'code', clip: 'user' };
const planBackends = (names) => Object.fromEntries(['video', 'image', 'tts'].map((k) => {
  try { return [k, getBackend(k, { name: names[k] })]; } catch { return [k, getBackend(k, { name: 'none' })]; }
}));

/** Native options shared by both planners. */
export function nativeOptions(o) {
  if (o.formats.length !== 1) throw new Error(`new ${o.type || 'story'}: one aspect per plan (--format 9x16, 16x9, 1x1, 4x5 or WxH)`);
  const f = o.formats[0];
  return {
    aspect: `${f.w}x${f.h}`, backends: planBackends(o.backends), characters: o.characters, shotlist: o.shotlist, title: o.title,
    transition: o.transition, shotSec: o.shotSec, voice: o.voice, style: o.stylePrompt,
  };
}

/** plan.json shots[] / voice[] for a native story / music-video plan. */
export function toRegistryPlan(native, o, extra = {}) {
  const ttsOk = usable(planBackends(o.backends).tts, 'tts');
  const shots = native.shots.map((s) => ({
    id: s.id, durationSec: s.durationSec, source: SOURCE[s.source] || 'code', prompt: s.fullPrompt || s.prompt || '',
    refs: (s.refs || []).map((r) => path.basename(r)), camera: s.camera || 'static', transition: s.transition || 'cut',
    ...(s.source === 'clip' ? { file: s.clip } : {}), ...(s.characters?.length ? { characters: s.characters } : {}),
  }));
  const voice = native.shots.filter((s) => s.narration).map((s) => ({ id: `n_${s.id}`, speaker: s.speaker || null, text: s.narration, shot: s.id, ...(ttsOk ? {} : { silent: true }) }));
  return { title: native.title || o.title || null, shots, voice, notes: native.notes || [], options: { native }, ...extra };
}

/**
 * A hand-edited (and re-pinned) plan.json: its shots[] win over the planner's copy. Ids, order, durations, prompts,
 * transitions and sources (generate / still / code / user + file) are taken from plan.shots; timing is recomputed.
 */
export function applyShotEdits(native, shots) {
  const byId = new Map(native.shots.map((s) => [s.id, s]));
  const back = Object.fromEntries(Object.entries(SOURCE).map(([k, v]) => [v, k]));
  let nf = 0;
  native.shots = shots.map((b, i) => {
    const n = { ...(byId.get(b.id) || { ...native.shots[0], narration: undefined, caption: undefined, splitFrom: undefined, part: undefined, parts: undefined }), id: b.id };
    n.durationSec = r3(Math.round(Number(b.durationSec) * FPS) / FPS);
    if (b.prompt && b.prompt !== n.fullPrompt) { n.fullPrompt = b.prompt; n.prompt = b.prompt; }
    n.transition = i ? (b.transition || n.transition || 'cut') : 'cut';
    if (back[b.source]) n.source = back[b.source];
    if (b.source === 'user' && b.file) n.clip = b.file; else delete n.clip;
    n.start = r3(nf / FPS); nf += Math.round(n.durationSec * FPS);
    for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k];
    return n;
  });
  native.durationSec = r3(nf / FPS);
  return native;
}

/** Render through renderPlan and map its report onto the registry's result. */
export async function renderRegistry(plan, ctx) {
  const native = applyShotEdits(structuredClone(plan.options.native), plan.shots);
  const fmt = plan.formats[0];
  const r = await renderPlan(native, {
    outDir: ctx.out, offline: ctx.offline, work: path.join(ctx.work, native.recipe), clipAudio: plan.options.clipAudio,
    backends: { video: ctx.getBackend('video'), image: ctx.getBackend('image'), tts: ctx.getBackend('tts') },
    log: (m) => fs.appendFileSync(ctx.logFile, `${m}\n`),
  });
  const rep = r.report;
  const dur = rep.checks.find((c) => c.startsWith('duration:'));
  const credits = rep.music ? [`${native.recipe === 'music-video' ? 'song' : 'music'}: ${rep.music.file} (supplied by the user; ${rep.music.attestation.statement})`] : [];
  return {
    outputs: [{ file: r.file, format: fmt.id, kind: 'video', width: rep.width, height: rep.height, extraChecks: dur ? [{ name: 'duration', pass: dur.endsWith('PASS'), text: dur }] : [] }],
    captions: (rep.captions?.files || []).map((f) => path.join(ctx.out, f)), sheets: rep.sheet ? [path.join(ctx.out, rep.sheet)] : [],
    weakShots: rep.WEAK_SHOTS.map((w) => ({ shot: w.shot, at: w.startSec, reason: `${w.check}: ${w.reason}`, fix: w.fix })),
    credits, notes: rep.notes || [], clipAudio: rep.clipAudio || null,
    details: { report: path.basename(r.reportFile), shots: rep.shots.length, qa: rep.qa, generations: rep.generations,
      ...(rep.snap ? { snap: rep.snap, bpm: rep.beats?.bpm } : {}), ...(rep.music ? { music: rep.music } : {}), ...(rep.captions ? { captionSource: rep.captions.source } : {}) },
  };
}

export const requireAttestation = (native) => {
  if (!native?.music?.attestation?.owned) throw new RefusalError('NO_MUSIC_ATTESTATION', 'refusing to render: the plan has no music ownership attestation (--i-own-this-music)');
};

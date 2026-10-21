// easy-edits talking-head: the approved clean cut (same cut rules) + the motion-design layer.
import fs from 'node:fs';
import path from 'node:path';
import { REPO, run, log, sdrClip, faceTrack } from '../engine/media.mjs';
import { heuristicPlan, agentPlan, validatePlan, mergePlans, locate } from '../engine/plan.mjs';
import { sourceHash, wordsKey, loadPin, savePin, stripTimes } from '../engine/plan-store.mjs';
import { exportFormats } from '../engine/export.mjs';
import { probe } from '../engine/audio.mjs';

/** clean-cut.sh --build-only into the work dir: {proj, words (edited), clip, voice} */
export function cleanBuild(o) {
  const proj = path.join(o.work, 'proj');
  const cutOut = path.join(o.work, 'cut.mp4');
  if (!fs.existsSync(path.join(proj, 'assets/mix.wav')) || o.fresh) {
    const args = [path.join(REPO, 'easy-edits/bin/clean-cut.sh'), o.input, proj, cutOut, '--build-only'];
    if (o.transcript) args.push('--transcript', o.transcript);
    if (o.reviewPatch) args.push('--review-patch', o.reviewPatch);
    else if (o.noReview || process.env.EASY_EDITS_AGENT === 'none') args.push('--no-review');
    if (o.lang) args.push('--lang', o.lang);
    if (o.modeCut) args.push('--mode', o.modeCut);
    if (o.names) args.push('--names', o.names);
    log('clean cut (build only) ...');
    // one retry: on a loaded box a transient failure (an ffmpeg killed under memory pressure) is not a verdict
    const r = run('bash', args, { label: 'clean-cut build', logFile: o.logFile, allowFail: true });
    if (r.status !== 0) { log(`clean cut failed (exit ${r.status}); retrying once`); run('bash', args, { label: 'clean-cut build', logFile: o.logFile }); }
  }
  const tr = JSON.parse(fs.readFileSync(path.join(proj, 'assets/transcript.json'), 'utf8'));
  const words = tr.words.filter((w) => (w.type || 'word') === 'word' && String(w.text).trim()).map((w) => ({ text: String(w.text).trim(), start: w.start, end: w.end }));
  return { proj, words, clip: path.join(proj, 'assets/clip.mp4'), voice: path.join(proj, 'assets/mix.wav') };
}

/** the plan: --plan FILE, else the plan pinned for this source (`pin`: {key, source}; skipped with --replan), else
 * the agent planner, else the heuristic one; validated against the transcript. With `pin`, the plan used is pinned
 * (engine/plan-store.mjs) and copied to <out>/easy-edits_<mode>_<clip>.plan.json, so a re-run renders the same beats. */
export function makePlan(o, words, duration, mode, { maxTopShare = 0.45, pin = null } = {}) {
  let plan = null, from = null;
  if (o.plan) { plan = JSON.parse(fs.readFileSync(o.plan, 'utf8')); plan.planner = plan.planner || `file:${path.basename(o.plan)}`; from = `file:${o.plan}`; }
  else if (pin && !o.replan) {
    const p = loadPin(mode, pin.key);
    if (p && Array.isArray(p.plan.beats)) { plan = p.plan; from = 'pinned'; log(`plan: pinned ${p.file} (${p.plan.pin?.made || '?'}; --replan to plan again)`); }
  }
  if (plan?.pin) {
    if (plan.pin.words && plan.pin.words !== wordsKey(words)) { log('plan: the cut changed since this plan was made: beats re-anchored by phrase'); plan = stripTimes(plan); }
    if ((plan.pin.notes || '') !== (o.notes || '') && from === 'pinned') log('plan: note: --notes differ from the pinned plan\'s (--replan to plan with them)');
    delete plan.pin;
  }
  const speaker = o.speaker ? { name: o.speaker, role: o.role || '' } : null;
  if (!plan) { log('planning (agent) ...'); plan = agentPlan(words, { mode, notes: o.notes || '', title: o.title, speaker }, { log: path.join(o.work, 'plan-agent.log') }); }
  if (!plan || !Array.isArray(plan.beats)) { log('planning: heuristic planner'); plan = heuristicPlan(words, { title: o.title, speaker }); }
  else if (!from) plan = mergePlans(plan, heuristicPlan(words, { title: o.title, speaker })); // grounded beats win
  if (o.title) plan.title = o.title;
  if (o.subtitle) plan.subtitle = o.subtitle;
  plan.speaker = speaker || null; // the lower-third name is never planned or guessed
  let v = validatePlan(plan, words, { duration, maxTopShare });
  // heuristic pops fill the gaps the plan left (> 4 s from any pop or top box)
  if (plan.heuristicPops?.length) {
    const busy = v.plan.beats.filter((b) => b.type !== 'punch');
    const add = plan.heuristicPops.map((b) => ({ ...b, ...(locate(words, b.anchor) ? { at0: locate(words, b.anchor).start } : {}) }))
      .filter((b) => b.at0 != null && !busy.some((x) => b.at0 > x.at - 4 && b.at0 < x.end + 4));
    if (add.length) v = validatePlan({ ...v.plan, beats: [...v.plan.beats, ...add.map(({ at0, ...b }) => b)] }, words, { duration, maxTopShare });
  }
  fs.writeFileSync(path.join(o.work, 'plan.json'), JSON.stringify(v.plan, null, 1));
  if (pin) {
    const meta = { source: pin.source, words: wordsKey(words), notes: o.notes || '', from: from || v.plan.planner };
    if (from !== 'pinned') log(`plan: pinned ${savePin(mode, pin.key, v.plan, meta)} (re-runs of this source reuse it; --replan to plan again)`);
    if (o.out) fs.writeFileSync(path.join(o.out, `easy-edits_${o.mode || mode}_${o.clip}.plan.json`), JSON.stringify({ ...v.plan, pin: { mode, sourceHash: pin.key, ...meta } }, null, 1));
  }
  if (v.dropped.length) log(`plan: dropped ${v.dropped.map((d) => d.join(' ')).join('; ')}`);
  log(`plan (${v.plan.planner}): "${v.plan.title}", ${v.plan.beats.length} beats: ${v.plan.beats.map((b) => `${b.type}@${b.at}`).join(' ')}`);
  return v;
}

export default async function talkingHead(o) {
  const b = cleanBuild(o);
  const clip = sdrClip(b.clip, path.join(o.work, 'clip_sdr.mp4'));
  const track = faceTrack(clip, path.join(o.work, 'clip.track.json'), { logFile: o.logFile });
  const duration = Math.min(probe(clip).duration, probe(b.voice).duration); // the clip (tail hold included), not the last word
  const { plan, dropped } = makePlan(o, b.words, Math.max(duration, 1), 'talking-head', { pin: { key: sourceHash(o.input), source: o.input } });
  if (o.planOnly) { const p = path.join(o.out, `easy-edits_${o.mode}_${o.clip}.plan.json`); console.log(p); return { plan: p, exports: [] }; }
  const res = await exportFormats(o, {
    clipFile: clip, track, words: b.words, voice: b.voice, plan, captions: 'kinetic', intro: 1.7, outro: 2.6,
    title: plan.title, subtitle: plan.subtitle, speaker: plan.speaker, music: o.noMusic ? null : (o.music || 'upbeat'),
  });
  return { plan: { planner: plan.planner, title: plan.title, beats: plan.beats, dropped }, ...res };
}

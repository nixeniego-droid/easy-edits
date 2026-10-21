// Easy Edits cutaway spans: where the final shows footage with the speaker OFF screen (b-roll / cutaway), so the
// speaker's face, head zone and grade are not the reference there.
//   planCutaways(plan)            -> [{start, end, why}] plan.json scenes whose layout / type / kind is
//                                    broll / b-roll / cutaway / footage (composition s)
//   mergeSpans(spans) / inSpans(spans, t) / sideOf(spans, t, d) -> {before, after} cutaway flags at a boundary
//   projectCutaways(proj)         -> plan spans of a project dir (assets/plan.json)
//   planBounds(plan) / projectBounds(proj) -> scene start times (scene / layout boundaries, composition s)
// Used by caption-face-final.mjs (faces of the cutaway, not the speaker head zone) and grade-continuity.mjs (cutaway
// in / out is a content change, not a grade jump).
import fs from 'node:fs';
import path from 'node:path';

export const CUTAWAY = /^(b-?roll|cutaway|footage)$/i;

export const isCutawayScene = (s) => [s.layout, s.type, s.kind].some((v) => typeof v === 'string' && CUTAWAY.test(v.trim()));

export function planCutaways(plan) {
  return mergeSpans((plan?.scenes || []).filter(isCutawayScene).map((s) => ({ start: +s.start, end: +s.end, why: `scene ${s.id} ${s.layout || s.type || s.kind}` })));
}

export function projectCutaways(proj) {
  try { return planCutaways(JSON.parse(fs.readFileSync(path.join(proj, 'assets/plan.json'), 'utf8'))); } catch { return []; }
}

/** plan -> composition s of every scene start (scene / layout boundaries: face, punch, top-box, split, idea, broll ...). */
export const planBounds = (plan) => [...new Set((plan?.scenes || []).map((s) => +s.start).filter(Number.isFinite))].sort((a, b) => a - b);
export function projectBounds(proj) {
  try { return planBounds(JSON.parse(fs.readFileSync(path.join(proj, 'assets/plan.json'), 'utf8'))); } catch { return []; }
}

export function mergeSpans(spans) {
  const out = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const l = out.at(-1);
    if (l && s.start <= l.end) { l.end = Math.max(l.end, s.end); if (!l.why.split(', ').includes(s.why)) l.why += `, ${s.why}`; } else out.push({ ...s });
  }
  return out;
}

export const inSpans = (spans, t) => spans.some((s) => t >= s.start && t < s.end);
/** boundary at t (composition s) -> cutaway flags of the windows d s before and after. */
export const sideOf = (spans, t, d = 0.17) => ({ before: inSpans(spans, t - d), after: inSpans(spans, t + d) });

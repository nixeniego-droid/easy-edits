// Easy Edits face-safe text on the finished render: no caption AND no kinetic word seen in the DOM may touch the
// face Haar finds on the encoded frames.
//   node easy-edits/check/caption-face-final.mjs <project-dir> <final.mp4> [--from s] [--to s] [--fps 15] [--prep source-prep.json] [--json]
// Text: tools/dom-sample.mjs items of kind `cap` and `kinetic`, the box of EVERY sampled frame the text is
// visible (opacity >= 0.3, pop-ins included, composition px = output px), shifted by the post stage's lead-in
// (leadOffset). Faces: OpenCV Haar frontal + both profiles on every frame (tools/source-prep-faces.py `both`) on
// the final between --from/--to, per frame the largest face >= 6% of the frame width that a neighbouring frame
// also sees (single-frame hits on kinetic type / badges are dropped); frames without one HOLD the face box over
// the gap (linear between the faces either side, else the nearest, up to HOLD s), so punch-ins and head turns
// the cascades miss are still covered. Keep-out = face box extended down by 35% of its height (chin) plus a 4% of
// frame width margin on every side. FAIL when any text box on screen in that frame intersects it.
// Why the old check missed style1 "RELATIONSHIP" / "BRIDGING ..." (kinetic): it only read `cap` runs, only their
// settled union box, and dropped the frames with no stable face.
// FIXED HEAD ZONE (always on, in addition to the per-frame boxes): the Haar frontal box starts at the brows, so
// the per-frame keep-out (4% margin) left the forehead and cap open; gen_th_style2b passed with "WITH OUR GUYS"
// (11.4-12.2 s, y 200-305) and "NOT" / "ONLY" (20.6-21.2 s, y 85-215) on his cap. Each Haar face is mapped back
// through the speaker wrapper's punch transform (index.html tl.set / tl.to of #spkwrap scale + transformOrigin)
// to scale 1, the MEDIAN box over the clip is taken, and per frame that box is re-scaled by the current punch
// transform and extended UP by HEAD x its height (forehead + hat) and down by the chin: FAIL OVER HEAD ZONE when a
// text box intersects it.
// CARDS (C3): every UI card is checked too, at the box MEASURED on the final frame (card-final.mjs: white card
// segmented at its settled time, not the DOM box) over its settled window, against the same head zone and per-frame
// face + chin keep-out. gen_th_style2c "BEEN HERE BEFORE?" (11.8-13.1 s, y 861-1160) sits on the chin / mouth.
// --no-cards skips them.
// CUTAWAYS (lib/cutaways.mjs): plan.json broll / cutaway / footage scenes only (a no-face stretch in a speaker scene
// keeps that scene's head zone). There the speaker head zone and (held) face box are not used and no speaker box is
// held into or across them; instead every stable face Haar finds in that frame (any size: gen_th_style2f 14.2-17.4 s,
// the uniformed man ~110 px at y ~650, the kids at y ~1160-1300) gets the chin + margin keep-out scaled to its own box
// (FAIL OVER CUTAWAY FACE). Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { easyEditsPython } from './lib/python.mjs';
import { pathToFileURL } from 'node:url';
import { projectSamples, leadOffset } from '../tools/dom-sample.mjs';
import { stableFaces, hit } from './caption-face.mjs';
import { finalCards, cardBoxesAt } from './card-final.mjs';
import { projectCutaways, projectBounds, inSpans } from './lib/cutaways.mjs';

const FACES = new URL('../tools/source-prep-faces.py', import.meta.url).pathname;
export const CHIN = 0.35, MARGIN = 0.04, MIN_FACE = 0.06, HOLD = 1.0, TEXT_KINDS = ['cap', 'kinetic'];
// False-positive filter (gen-th-style2 7.73 s: a held 178 px "face" on the uniform chest, lower left):
// reject a box narrower than MIN_REL x the reference face (prep face in output px, else the clip's median),
// whose centre is in the bottom BOTTOM of the frame, or whose centre jumps more than JUMP x the tracked face's
// width from the last accepted face (within HOLD s).
export const MIN_REL = 0.5, BOTTOM = 0.25, JUMP = 0.6;
/** Head zone: the median face box extended up by HEAD x its height (forehead + cap: gen_th_style2b 11.6 s, Haar y 436 h 572, cap top ~y 160). */
export const HEAD = 0.45;

/** index.html -> (t) => {s, ox, oy}: the speaker wrapper's scale / origin (tl.set jumps, tl.to linear); .times = event starts (layout changes). */
export function punchAt(html, id = 'spkwrap') {
  const ev = [];
  for (const m of html.matchAll(new RegExp(`tl\\.(set|to)\\('#${id}',\\{([^}]*)\\},([\\d.]+)\\)`, 'g'))) {
    const sc = /scale:([\d.]+)/.exec(m[2]); if (!sc) continue;
    const o = /transformOrigin:'([\d.]+)px ([\d.]+)px'/.exec(m[2]), d = /duration:([\d.]+)/.exec(m[2]);
    ev.push({ t: +m[3], s: +sc[1], dur: m[1] === 'to' && d ? +d[1] : 0, ox: o ? +o[1] : null, oy: o ? +o[2] : null });
  }
  ev.sort((a, b) => a.t - b.t);
  return Object.assign((t) => {
    let s = 1, ox = 540, oy = 960;
    for (const e of ev) {
      if (e.t > t) break;
      if (e.ox != null) { ox = e.ox; oy = e.oy; }
      s = e.dur && t < e.t + e.dur ? s + (e.s - s) * (t - e.t) / e.dur : e.s;
    }
    return { s, ox, oy };
  }, { times: ev.map((e) => e.t) });
}
const unpunch = ([x, y, w, h], { s, ox, oy }) => [ox + (x - ox) / s, oy + (y - oy) / s, w / s, h / s];
const repunch = ([x, y, w, h], { s, ox, oy }) => [ox + (x - ox) * s, oy + (y - oy) * s, w * s, h * s];
const med = (a) => { const v = [...a].sort((x, y) => x - y); return v[v.length >> 1]; };
/** tracked faces + punch(t) -> median face box at scale 1, or null. */
export function medianFace(frames, tracked, punch, lead = 0, from = 0, min = 5) {
  const bs = tracked.map((b, i) => (b ? unpunch(b, punch(from + frames[i].t - lead)) : null)).filter(Boolean);
  return bs.length >= min ? [0, 1, 2, 3].map((j) => med(bs.map((b) => b[j]))) : null;
}
/** Cards (kind 'card') keep out of the face down to the CHIN LINE only: Haar bottom + CARD_CHIN x h + CARD_M x W
 *  (style2c 3.68 s: Haar bottom y 868, visible chin y ~880; a card may sit below it, never over chin / mouth). */
export const CARD_CHIN = 0.1, CARD_M = 0.02;
const forCard = (z, [x, y, w, h], W, kind) => (kind === 'card' ? { ...z, y1: y + h * (1 + CARD_CHIN) + CARD_M * W } : z);
/** Face box -> head keep-out (forehead / cap above, chin below, margin). */
export const headZone = ([x, y, w, h], W) => { const m = MARGIN * W; return { x0: x - m, x1: x + w + m, y0: y - HEAD * h - m, y1: y + h * (1 + CHIN) + m }; };

/** Haar box [x,y,w,h] -> keep-out rect (chin + margin, W = frame width). */
export const keepOut = ([x, y, w, h], W) => { const m = MARGIN * W; return { x0: x - m, x1: x + w + m, y0: y - m, y1: y + h * (1 + CHIN) + m }; };

const cx = (b) => b[0] + b[2] / 2, cy = (b) => b[1] + b[3] / 2;

/** Per-scene median head zone needs SCENE_MIN tracked faces in that scene, else the clip median is kept. */
export const SCENE_MIN = 3;
/** frames -> median width of the largest stable face per frame (the size filter's reference when no prep face). */
export const stableW = (frames, W = 1080) => med(frames.map((f, i) => stableFaces(frames, i, MIN_FACE * W).sort((a, b) => b[2] * b[3] - a[2] * a[3])[0]?.[2]).filter(Boolean)) || 0;
/** frames -> per-frame largest stable face that passes the size / bottom / jump filter, else null. */
export function trackedFaces(frames, W = 1080, { H = W * 16 / 9, refW } = {}) {
  const stable = frames.map((f, i) => stableFaces(frames, i, MIN_FACE * W).sort((a, b) => b[2] * b[3] - a[2] * a[3]));
  if (!refW) refW = stableW(frames, W);
  let last = null;
  return stable.map((cands, i) => {
    const track = last && frames[i].t - last.t <= HOLD ? last.box : null;
    const ok = cands.find((b) => b[2] >= MIN_REL * refW && cy(b) <= (1 - BOTTOM) * H
      && (!track || Math.hypot(cx(b) - cx(track), cy(b) - cy(track)) <= JUMP * track[2]));
    if (ok) last = { box: ok, t: frames[i].t };
    return ok || null;
  });
}

/** prep (source-prep.json) -> reference face width in output px (median over scenes with a face), or undefined. */
export const prepFaceW = (prep) => {
  const ws = (prep?.scenes || []).filter((s) => s.face?.box && s.cover1080x1920?.scale).map((s) => s.face.box[2] * s.cover1080x1920.scale).sort((a, b) => a - b);
  return ws.length ? ws[ws.length >> 1] : undefined;
};

/** frames [{t, faces}] -> per-frame face [x,y,w,h] | null: tracked largest, gaps held (interpolated) up to HOLD s. */
export function heldFaces(frames, W = 1080, opt = {}) {
  const best = trackedFaces(frames, W, opt);
  return best.map((b, i) => {
    if (b) return { box: b, held: false };
    let p = i - 1, n = i + 1;
    while (p >= 0 && !best[p]) p--;
    while (n < best.length && !best[n]) n++;
    const dp = p >= 0 ? frames[i].t - frames[p].t : Infinity, dn = n < best.length ? frames[n].t - frames[i].t : Infinity;
    if (dp <= HOLD && dn <= HOLD) { const k = dp / (dp + dn); return { box: best[p].map((v, j) => v + (best[n][j] - v) * k), held: true }; }
    if (Math.min(dp, dn) <= HOLD) return { box: dp < dn ? best[p] : best[n], held: true };
    return null;
  });
}

/** dom-sample -> (t composition s) -> [{id, text, kind, box}] visible text boxes of TEXT_KINDS at the nearest sample. */
export const textBoxesAt = (sample) => (t) => {
  const s = sample.samples[Math.round(t / sample.step)];
  if (!s) return [];
  return s.items.filter((it) => it.opacity >= 0.3 && TEXT_KINDS.includes(sample.elements[it.id]?.kind))
    .map((it) => ({ id: it.id, text: sample.elements[it.id].text, kind: sample.elements[it.id].kind, box: { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h } }));
};

/** Cutaway frames (speaker off screen): every stable detection in the frame, any size (neighbour-confirmed, as
 *  stableFaces), keep-out scaled to THAT face: chin CHIN x h, margin CUT_M x its width (the speaker's 4% of 1080 =
 *  43 px is ~0.086 x his ~500 px face); cards down to the chin line (CARD_CHIN) + the same margin. */
export const CUT_M = 0.1;
export const cutKeepOut = ([x, y, w, h], kind) => { const m = CUT_M * w; return { x0: x - m, x1: x + w + m, y0: y - m, y1: y + h * (1 + (kind === 'card' ? CARD_CHIN : CHIN)) + m }; };

/** frames [{t, faces}] (t from `from`) + textAt(t) or legacy caps [{text, settledStart, settledEnd, box}] -> {bad, frames, faced, held, cut}.
 *  cutaways: [{start, end}] composition s, ONLY real b-roll / cutaway scenes (lib/cutaways.mjs planCutaways). A stretch with
 *  no detected face inside a speaker scene keeps that scene's median head zone (no face-derived cutaways). Cutaway frames skip the head zone and the
 *  (held) speaker face and check every face detected in that frame instead; speaker frames are checked as before.
 *  bounds: composition s of every scene / layout change (plan.json scene starts + #spkwrap punch sets: sceneBounds).
 *  Tracking, the jump / bottom filters, the hold and the median head zone run per scene: a speaker box is never
 *  carried across a boundary (gen_th_style2g 3.93 / 4.40 s: the pre-split face held into top-box s03; 5.80 / 6.47 s:
 *  into idea s04), the new scene starts from its own first detections. */
export function checkFinalFaces({ caps = [], textAt, frames, lead = 0, from = 0, W = 1080, H, refW, hold = true, punch, cutaways = [], bounds = [] }) {
  const bad = new Map();
  let faced = 0, held = 0;
  const tc = (f) => from + f.t - lead;
  // pad each span by one detection frame: the cut lands between two sampled frames (style2f 14.20 s shows the b-roll and
  // its top caption while 14.20 - lead is still 9 ms before the plan's scene start)
  const step = frames.length > 1 ? frames[1].t - frames[0].t : 0;
  const spans = cutaways.map((s) => ({ ...s, start: s.start - step, end: s.end + step }));
  const isCut = frames.map((f) => inSpans(spans, tc(f)));
  const blank = () => frames.map((f, i) => (isCut[i] ? { ...f, faces: [] } : f)); // cutaway faces are never the speaker
  const sf = spans.length ? blank() : frames;
  if (!refW) refW = stableW(sf, W);
  const bs = [...new Set(bounds.map(Number))].sort((a, b) => a - b), sceneOf = (f) => bs.filter((b) => tc(f) >= b).length;
  // fixed head zone from the median face (needs the punch transform and a text source)
  const mf = punch && textAt ? medianFace(sf, trackedFaces(sf, W, { H, refW }), punch, lead, from) : null;
  // speaker tracking / hold / median per run of speaker frames inside one scene: never across a cutaway or a scene /
  // layout boundary
  const fb = new Array(frames.length).fill(null), mfs = new Array(frames.length).fill(mf);
  for (let i = 0; i < frames.length;) {
    if (isCut[i]) { i++; continue; }
    let j = i; while (j < frames.length && !isCut[j] && sceneOf(frames[j]) === sceneOf(frames[i])) j++;
    const seg = frames.slice(i, j), tr = trackedFaces(seg, W, { H, refW });
    const r = hold ? heldFaces(seg, W, { H, refW }) : tr.map((b) => (b ? { box: b } : null));
    const m = mf && medianFace(seg, tr, punch, lead, from, SCENE_MIN);
    r.forEach((v, k) => { fb[i + k] = v; if (m) mfs[i + k] = m; });
    i = j;
  }
  if (mf) frames.forEach((f, i) => {
    if (isCut[i]) return;
    const t = tc(f), fz = repunch(mfs[i], punch(t)), hz = headZone(fz, W);
    for (const c of textAt(t)) {
      const key = `head:${c.id || c.text}`, zone = forCard(hz, fz, W, c.kind);
      if (bad.has(key) || !hit(c.box, zone)) continue;
      bad.set(key, { cap: c.text, id: c.id, kind: c.kind, t: +(from + f.t).toFixed(3), face: mfs[i].map(Math.round), zone: true, rect: zone, box: c.box });
    }
  });
  const textOn = (t) => (textAt ? textAt(t) : caps.filter((c) => c.box && t >= c.settledStart && t < c.settledEnd).map((c) => ({ ...c, kind: c.kind || 'cap' })));
  let cut = 0;
  frames.forEach((f, i) => {
    if (isCut[i]) {
      cut++;
      const faces = stableFaces(frames, i, 0).filter((b) => cy(b) <= (1 - BOTTOM) * (H || W * 16 / 9)), t = tc(f); // bottom 25%: chest / hand false positives
      if (!faces.length) return;
      for (const c of textOn(t)) {
        const key = `cut:${c.id || c.text}`;
        if (bad.has(key)) continue;
        const face = faces.find((b) => hit(c.box, cutKeepOut(b, c.kind)));
        if (face) bad.set(key, { cap: c.text, id: c.id, kind: c.kind, t: +(from + f.t).toFixed(3), face, cutaway: true, rect: cutKeepOut(face, c.kind), box: c.box });
      }
      return;
    }
    if (!fb[i]) return;
    const face = fb[i].box;
    faced++; if (fb[i].held) held++;
    const t = tc(f), ko = keepOut(face, W);
    for (const c of textOn(t)) {
      if (c.kind === 'card') continue; // cards: median head zone only (a single oversized Haar box, style2c 22.73 s, would graze a card 3 px)
      const key = c.id || c.text, rect = forCard(ko, face, W, c.kind);
      if (bad.has(key) || !hit(c.box, rect)) continue;
      bad.set(key, { cap: c.text, id: c.id, kind: c.kind, t: +(from + f.t).toFixed(3), face: face.map(Math.round), held: !!fb[i].held, rect, box: c.box });
    }
  });
  return { bad: [...bad.values()], frames: frames.length, faced, held, cut, cutaways: spans };
}

export function haarFrames(video, from, to, fps = 15) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gcface-')), 'clip.mp4');
  try {
    const cut = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(from), ...(to ? ['-to', String(to)] : []), '-i', video, '-an', '-c:v', 'libx264', '-crf', '12', tmp]);
    if (cut.status) throw new Error(`ffmpeg: ${cut.stderr}`);
    const r = spawnSync(easyEditsPython(), [FACES, tmp, String(fps), '960', 'both'], { maxBuffer: 1 << 28, encoding: 'utf8' });
    if (r.status) throw new Error(`face detector exit ${r.status}: ${r.stderr}`);
    return JSON.parse(r.stdout).frames;
  } finally { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); }
}

async function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' || argv[i] === '--no-cards' ? (o[argv[i].slice(2)] = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 2) { console.error('usage: caption-face-final.mjs <project-dir> <final.mp4> [--from s] [--to s] [--fps 15] [--prep source-prep.json] [--json]'); return 2; }
  const [proj, video] = pos;
  const pr = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', video], { encoding: 'utf8' });
  const info = JSON.parse(pr.stdout), W = info.streams[0].width, H = info.streams[0].height;
  const refW = o.prep ? prepFaceW(JSON.parse(fs.readFileSync(o.prep, 'utf8'))) : undefined;
  const sample = await projectSamples(proj), lead = leadOffset(+info.format.duration, sample.duration);
  const from = +(o.from || 0), frames = haarFrames(video, from, o.to && +o.to, +(o.fps || 15));
  const html = fs.existsSync(path.join(proj, 'index.html')) ? fs.readFileSync(path.join(proj, 'index.html'), 'utf8') : '';
  const capsAt = textBoxesAt(sample);
  let textAt = capsAt;
  if (!o['no-cards']) { const fc = await finalCards(proj, video, { lead }), cardsAt = cardBoxesAt(fc.cards); textAt = (t) => [...capsAt(t), ...cardsAt(t)]; }
  const punch = punchAt(html), r = checkFinalFaces({ textAt, frames, lead, from, W, H, refW, punch, cutaways: projectCutaways(proj), bounds: [...projectBounds(proj), ...punch.times] });
  if (o.json) console.log(JSON.stringify(r, null, 1));
  for (const s of r.cutaways) console.log(`  cutaway ${s.start.toFixed(2)}-${s.end.toFixed(2)} s (${s.why}): every detected face, no speaker head zone`);
  for (const b of r.bad) console.log(`  ${b.zone ? 'FAIL OVER HEAD ZONE' : b.cutaway ? 'FAIL OVER CUTAWAY FACE' : 'OVER FACE '} ${b.t.toFixed(2)} s ${b.kind} "${b.cap}"${b.held ? ' (face held)' : ''} y ${b.box.y0}-${b.box.y1} x ${b.box.x0}-${b.box.x1} vs ${b.cutaway ? `face [${b.face.join(',')}]+chin+margin` : b.kind === 'card' ? 'face+chin line' : 'face+chin+margin'} y ${b.rect.y0.toFixed(0)}-${b.rect.y1.toFixed(0)} x ${b.rect.x0.toFixed(0)}-${b.rect.x1.toFixed(0)}`);
  console.log(`caption-face-final: ${r.bad.length ? 'FAIL' : 'PASS'} ${r.bad.length} text(s) over the face (${r.faced}/${r.frames} frames with a face, ${r.held} held, ${r.cut} cutaway, lead ${lead} s)`);
  return r.bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv.slice(2));

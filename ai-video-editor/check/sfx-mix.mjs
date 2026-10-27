// AI Video Editor SFX mix check on the FINAL post audio: every SFX is present, sits 12-15 dB under the voice PEAK (the
// whole-file voice peak level), the voice is not ducked under it, and it starts only on a card / graphic entry.
//   node ai-video-editor/check/sfx-mix.mjs <final.mp4|mix.wav> <project-dir> [--lo 15] [--hi 12] [--tol 0] [--duck 2] [--json]
// Cues = plan.json events with an sfx; template = the rendered kit wav <project>/assets/sfx/<sfx>.wav. The final is
// aligned to assets/voice.wav (check/sfx-audible.mjs align, post lead-in), the voice is removed with a fitted gain
// per 10 ms block, and each cue is found by a matched filter: the template (first 0.35 s) slid over the residual
// in [t-0.15, t+0.15]; best lag = max correlation. detected = normalised correlation >= 0.3 (present).
//   level  = fitted template gain x template peak, dB re the delivered whole-file voice peak (reference peak x
//            median voice gain); must lie in [-lo - tol, -hi + tol] (default -15..-12 dB, no tolerance: the reviewer's card-pop target).
//   duck   = median voice gain over the speech blocks in [t-0.1, t+0.5] re the file's median voice gain; FAIL when
//            the voice drops more than --duck (2) dB under a cue (no ducking: the voice stays untouched).
// Entry rule: the cue's event type must be a card / graphic entry (card, paper, panel, chip, icon, glyph, badge,
// diagram / arrow / underline draw, lower-third, title, label, tag, -in, keyword-pop) and a card / graphic entry (plan scenes of
// a non-face layout or such an event) must be within 0.1 s. Never on kinetic words / word pops, punch-ins, zooms or
// cuts to the face. Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { align, decode, sfxEvents } from './sfx-audible.mjs';

const SR = 48000;
export const LO = 15, HI = 12, TOL = 0, DUCK = 2, SNAP = 0.1, MIN_NCC = 0.3;
const GRAPHIC = /pop|chip|card|lower-?third|slam|paper|panel|title|label|tag|underline|draw|graphic|badge|icon|glyph|-in$/i;
const NOT_ENTRY = /punch|zoom|cut-to-face|face|kinetic|word/i;
// keyword-pop: the look's one SFX exception on text (the yellow key word's pop), counted as a graphic entry.
export const isEntryType = (type) => /^keyword-pop$/i.test(type || '') || GRAPHIC.test(type || '') && !NOT_ENTRY.test(type || '');

/** plan -> sorted card / graphic entry times (composition s). */
export function entryTimes(plan) {
  const t = [];
  for (const s of plan.scenes || []) if (s.layout && s.layout !== 'face' && s.layout !== 'punch') t.push(+s.start);
  for (const e of plan.events || []) if (isEntryType(e.type)) t.push(+e.time);
  return t.sort((a, b) => a - b);
}

const db = (x) => 20 * Math.log10(Math.max(Math.abs(x), 1e-9));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

/** Matched-filter measurement of each cue in `out` (final audio) given the dry voice `ref` and kit templates. */
export function measureCues(ref, out, events, tpl) {
  const lag = align(ref, out), B = 480, at = (t) => Math.round(t * SR);
  const gainAt = (b) => { let xy = 0, xx = 0; for (let i = b; i < b + B; i++) { const r = ref[i - lag] ?? 0; xy += r * (out[i] ?? 0); xx += r * r; } return xx / B > 1e-4 ? xy / xx : NaN; };
  const gains = [];
  for (let b = lag; b + B < out.length; b += B) { const g = gainAt(b); if (Number.isFinite(g)) gains.push(g); }
  const g0 = median(gains);
  let rp = 0; for (const x of ref) rp = Math.max(rp, Math.abs(x));
  const voicePeak = rp * g0;
  const rows = events.map((e) => {
    const T = tpl[e.sfx], n = Math.min(T.length, at(0.35)), c = at(e.time) + lag;
    const s = Math.max(0, c - at(0.15)), end = Math.min(out.length, c + at(0.15) + n + B);
    const res = new Float32Array(end - s);
    const lg = [];
    for (let b = s; b < end; b += B) {
      let xy = 0, xx = 0; const be = Math.min(end, b + B);
      for (let i = b; i < be; i++) { const r = ref[i - lag] ?? 0; xy += r * out[i]; xx += r * r; }
      const g = xx > 1e-6 ? xy / xx : 0;
      for (let i = b; i < be; i++) res[i - s] = out[i] - g * (ref[i - lag] ?? 0);
    }
    for (let b = c - at(0.1); b < c + at(0.5); b += B) { const g = gainAt(b); if (Number.isFinite(g)) lg.push(g); }
    let tt = 0, tp = 0; for (let i = 0; i < n; i++) { tt += T[i] * T[i]; tp = Math.max(tp, Math.abs(T[i])); }
    let best = -Infinity, bd = 0;
    for (let d = 0; d + n <= res.length && d <= at(0.3); d++) { let x = 0; for (let i = 0; i < n; i++) x += res[d + i] * T[i]; if (x > best) { best = x; bd = d; } }
    let rr = 0; for (let i = 0; i < n; i++) rr += res[bd + i] ** 2;
    const a = best / tt, ncc = best / Math.sqrt(tt * rr || 1e-30);
    return {
      time: e.time, sfx: e.sfx, type: e.type, detected: ncc >= MIN_NCC, ncc: +ncc.toFixed(2),
      offset: +((bd + s - c) / SR).toFixed(3), level: +(db(a * tp) - db(voicePeak)).toFixed(1),
      duck: lg.length ? +(db(median(lg)) - db(g0)).toFixed(1) : 0,
    };
  });
  return { lag: +(lag / SR).toFixed(3), voicePeakDb: +db(voicePeak).toFixed(1), rows };
}

/** rows [{time, sfx, type, detected, level, duck}] + entries -> bad [{...row, why}] */
export function checkSfxMix(rows, entries, { lo = LO, hi = HI, tol = TOL, duck = DUCK } = {}) {
  const bad = [];
  for (const r of rows) {
    const why = [];
    if (!r.detected) why.push(`not detected (matched filter ncc ${r.ncc} < ${MIN_NCC})`);
    else if (r.level > -hi + tol || r.level < -lo - tol) why.push(`${r.level} dB re voice peak (want -${lo}..-${hi})`);
    if (r.detected && r.duck < -duck) why.push(`voice ducked ${r.duck} dB under the cue (no ducking)`);
    if (!isEntryType(r.type)) why.push(`on a ${r.type} (SFX only on card/graphic entries)`);
    else if (!entries.some((t) => Math.abs(t - r.time) <= SNAP)) why.push(`no card/graphic entry within ${SNAP} s (${r.type})`);
    if (why.length) bad.push({ ...r, why });
  }
  return bad;
}

function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = +argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 2) { console.error('usage: sfx-mix.mjs <final.mp4|mix.wav> <project-dir> [--lo 15] [--hi 12] [--tol 0] [--duck 2] [--json]'); return 2; }
  const [media, proj] = pos, events = sfxEvents(proj);
  if (!events.length) { console.log('sfx-mix: PASS (no planned SFX)'); return 0; }
  const plan = JSON.parse(fs.readFileSync(path.join(proj, 'assets/plan.json'), 'utf8'));
  const voice = path.join(proj, 'assets/voice.wav');
  if (!fs.existsSync(voice)) { console.error(`sfx-mix: no ${voice}`); return 2; }
  const tpl = {};
  for (const e of events) {
    const f = path.join(proj, 'assets/sfx', `${e.sfx}.wav`);
    if (!fs.existsSync(f)) { console.error(`sfx-mix: no rendered SFX ${f}`); return 2; }
    tpl[e.sfx] ??= decode(f);
  }
  // a post output (lead-in) went through the premaster's high-pass once more: match the reference's phase
  const out = decode(media), lead = align(decode(voice), out) / SR;
  const m = measureCues(decode(voice, lead > 0.05 ? 'highpass=f=75,highpass=f=75' : 'highpass=f=75'), out, events, tpl);
  const opt = { lo: o.lo ?? LO, hi: o.hi ?? HI, tol: o.tol ?? TOL, duck: o.duck ?? DUCK };
  const bad = checkSfxMix(m.rows, entryTimes(plan), opt);
  if (o.json) console.log(JSON.stringify({ ...m, bad }, null, 1));
  for (const r of m.rows) console.log(`  ${bad.some((b) => b.time === r.time) ? 'FAIL' : 'ok  '} ${r.time.toFixed(2).padStart(6)} s ${String(r.sfx).padEnd(10)} ${String(r.type).padEnd(13)} ${r.detected ? 'detected' : 'MISSING '} ncc ${r.ncc}  ${r.level} dB re voice peak  voice ${r.duck} dB`);
  for (const b of bad) console.log(`  BAD ${b.time.toFixed(2).padStart(6)} s ${String(b.sfx).padEnd(10)} ${b.why.join('; ')}`);
  console.log(`sfx-mix: ${bad.length ? 'FAIL' : 'PASS'} ${m.rows.length - bad.length}/${m.rows.length} SFX present at -${opt.lo}..-${opt.hi} dB re the voice peak, voice not ducked, on a card/graphic entry (voice peak ${m.voicePeakDb} dBFS, lead ${m.lag} s)`);
  return bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));

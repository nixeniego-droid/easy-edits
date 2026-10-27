// ai-video-editor shorts: long talk -> ranked 9:16 shorts, in two steps (or one).
//   PICKER  `--propose`: the whole transcript goes to the agent picker (claude / codex, when installed) as numbered
//           lines; it proposes standalone moments (hook in the first seconds, one complete thought, a clean ending),
//           each snapped to exact transcript words and validated (length after the clean cut, no transcript holes,
//           no garbled stretches). The sentence-window heuristic fills in (and is the whole picker without an agent).
//           Writes <out>/PROPOSALS.txt (rank, score 0-100, source timestamps, hook line, reason) + one fast low-res
//           preview per candidate (raw window, face-follow crop, source captions, hook text), then stops.
//   RENDER  `--pick 1,3`: renders only those proposals at full quality and marks them used. No --propose / --pick:
//           propose --clips N and render them all.
//   DEDUPE  <out>/<source-id>/used_clips.json (time ranges + normalised quotes): proposals skip a candidate that
//           overlaps a used range by > 30 % or repeats a used quote; --reset-used clears it.
// Per clip: the window is cut out of the source (an 87-min podcast is never cleaned whole), gets the approved clean
// cut (fillers / dead air / slips out, review + caption verify), a face-tracked 9:16 reframe that follows the active
// speaker (facetrack --switch: speaker turns on wide shots, hard cuts, steady framing, punch-ins hiding jump cuts),
// the approved clean-cut captions, a lower third for named people (--speaker / --people, recognised on screen
// against reference stills: engine/faceid.py), the optional --hook card, -14 LUFS / -1.5 dBTP, delivery check.
// Nothing is ever posted or scheduled.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { normalise, faceTrack, sdrClip, log, run, PY, REPO } from '../engine/media.mjs';
import { cleanBuild, makePlan } from './talking-head.mjs';
import { exportFormats } from '../engine/export.mjs';
import { sentences, norm, findPhrase, locate } from '../engine/plan.mjs';
import { probe } from '../engine/audio.mjs';
import { sourceHash, loadPin, savePin } from '../engine/plan-store.mjs';
import { captionGroups } from '../presets/captions-default.mjs';

const r3 = (v) => Math.round(v * 1000) / 1000;
const pad = (n) => String(n).padStart(2, '0');
export const hms = (t) => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`; };
export const sec = (v) => String(v).trim().split(':').reduce((a, b) => a * 60 + Number(b), 0);
const HOOK_WORDS = /\b(why|how|what|secret|mistake|never|always|nobody|everyone|best|worst|most|only|biggest|truth|problem|stop|without|imagine|remember|important|key|reason|because|but|perish|future|first)\b/;
const STOP = new Set('the a an and or but so of to in on at for with is are was were be it this that we you i they our your my me us them what can do just very really'.split(' '));
const FILLER = /^(um+|uh+|ah+|er+|hmm+|mm+)[,.]?$/i;

export function candidates(words, { min = 20, max = 60 } = {}) {
  const S = sentences(words), out = [];
  for (let i = 0; i < S.length; i++) {
    for (let j = i; j < S.length; j++) {
      const d = S[j].end - S[i].start;
      if (d > max) break;
      if (d < min) continue;
      const first = norm(S[i].text), fw = first.split(' ');
      const all = S.slice(i, j + 1).map((s) => norm(s.text)).join(' ').split(' ');
      let hook = 0;
      if (/\?$/.test(S[i].text)) hook += 2;
      if (/\byou\b/.test(first)) hook += 1;
      if (/\b\d+\b/.test(first)) hook += 1;
      hook += Math.min(2, (first.match(new RegExp(HOOK_WORDS, 'g')) || []).length * 0.7);
      if (fw.length <= 14) hook += 1;
      if (/^(and|but|so|because|or|then|it|this|that|while|also|which|me)\b/.test(first)) hook -= 1.5; // opens mid-thought
      const counts = {}; all.forEach((w) => { if (w.length > 3 && !STOP.has(w)) counts[w] = (counts[w] || 0) + 1; });
      const focus = Math.min(2, Math.max(0, ...Object.values(counts)) / 3);
      const wps = all.length / d, density = wps > 1.6 && wps < 3.8 ? 1 : 0;
      const complete = /[.!?]$/.test(S[j].text) ? 1 : 0;
      const score = r3(hook * 1.5 + focus + density + complete);
      out.push({ i0: S[i].i0, i1: S[j].i1, start: S[i].start, end: S[j].end, dur: r3(d), score, hook: S[i].text, text: S.slice(i, j + 1).map((s) => s.text).join(' ') });
    }
  }
  return out.sort((a, b) => b.score - a.score || b.dur - a.dur);
}

export function pick(cands, n) {
  const chosen = [];
  for (const c of cands) { if (chosen.length >= n) break; if (chosen.some((x) => c.start < x.end && c.end > x.start)) continue; chosen.push(c); }
  return chosen;
}

// ---------- window checks ----------
/** spoken length once the clean cut has taken the pauses out: word time + at most 0.3 s per gap, fillers dropped. */
export function estDuration(words, i0, i1) {
  let d = 0;
  for (let i = i0; i <= i1; i++) {
    if (!FILLER.test(words[i].text)) d += Math.max(0.05, words[i].end - words[i].start);
    if (i < i1) d += Math.min(0.3, Math.max(0, words[i + 1].start - words[i].end));
  }
  return r3(d);
}
/** the longest silence between two words: a long one inside a talk is usually speech the ASR skipped. */
export const maxGap = (words, i0, i1) => { let g = 0; for (let i = i0; i < i1; i++) g = Math.max(g, words[i + 1].start - words[i].end); return r3(g); };
/** words with characters no Latin-script speaker said (a garbled decode: "với", "っちゃ", "ไดo", U+FFFD). */
export const noisyWords = (words, i0, i1) => words.slice(i0, i1 + 1).filter((w) => /[^\u0000-ɏ‘’“”–—…]/.test(w.text)).length;

// ---------- clean ending: every short ends on a finished sentence / thought, never mid-sentence ----------
export const END_PAUSE = 0.25;
const bare = (t) => String(t).replace(/["'”’)\]]+$/, '');
const endsSentence = (t) => /[.!?]$/.test(bare(t)) && !/(\.\.\.|…)$/.test(bare(t));
/** why the clip may not end after word i (null = a clean ending): the word closes a sentence (. ! ?, not a trailing
 * "..."), that sentence has >= 3 words (not a lone "Yeah." / "Exactly." reaction or an ASR split like "They
 * believe."), and a pause of >= 0.25 s follows (the speaker finished; no word runs on), or the talk ends there. */
export function endingProblem(words, i, { pause = END_PAUSE } = {}) {
  const w = words[i];
  if (!w) return 'no such word';
  if (!endsSentence(w.text)) return `mid-sentence ("${w.text}")`;
  const nx = words[i + 1];
  if (nx && nx.start - w.end < pause - 1e-6) return `no pause after "${w.text}" (${Math.max(0, nx.start - w.end).toFixed(2)} s)`;
  let k = i; while (k > 0 && !endsSentence(words[k - 1].text)) k--;
  const n = words.slice(k, i + 1).filter((x) => !/^-/.test(x.text) && !FILLER.test(x.text)).length;
  if (n < 3) return `last sentence too short ("${words.slice(k, i + 1).map((x) => x.text).join(' ')}")`;
  return null;
}

/** the nearest clean ending to word i1 (endingProblem null) whose clip [i0, k] still fits min / max after the clean
 * cut, within 15 s back / 8 s forward; a "?" ending costs 2 s (prefer a statement). {i1, moved, was} or {reject}. */
export function snapEnding(words, i0, i1, { min, max, back = 15, fwd = 8 } = {}) {
  const was = endingProblem(words, i1);
  if (!was) return { i1, moved: 0, was: null };
  const t = words[i1].end, fits = (k) => { const e = estDuration(words, i0, k); return !(min && e < min * 0.85) && !(max && e > max * 1.05); };
  let best = null;
  for (let k = i0 + 1; k < words.length && words[k].end <= t + fwd; k++) {
    if (words[k].end < t - back || endingProblem(words, k) || !fits(k)) continue;
    const cost = Math.abs(words[k].end - t) + (/\?$/.test(bare(words[k].text)) ? 2 : 0);
    if (!best || cost < best.cost) best = { k, cost };
  }
  if (!best) return { reject: `no clean ending within ${back} s before / ${fwd} s after ${hms(t)} (${was})` };
  return { i1: best.k, moved: r3(words[best.k].end - t), was };
}

/** is there speech-level audio in [a, b] of the source? (mean level within 8 dB of the speech around it) */
export function speechGapFn(srcFile) {
  const vol = (a, b) => { const r = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(a), '-t', String(Math.max(0.2, b - a)), '-i', srcFile, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); const m = (r.stderr || '').match(/mean_volume:\s*(-?[\d.]+)/); return m ? Number(m[1]) : -91; };
  return (a, b) => { const gap = vol(a + 0.3, b - 0.3), around = Math.max(vol(a - 4, a), vol(b, b + 4)); return gap > around - 8; };
}

// ---------- used-clips log (dedupe) ----------
export const usedPath = (out, sourceId) => path.join(out, sourceId, 'used_clips.json');
export function loadUsed(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { clips: [] }; } }
const overlapFrac = (a, b) => { const o = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)); return Math.max(o / Math.max(0.1, a.end - a.start), o / Math.max(0.1, b.end - b.start)); };
/** why a candidate repeats a used clip (> 30 % time overlap, or a used quote said again), else null. */
export function usedReason(c, used) {
  const text = ` ${norm(c.text || '')} `, q = norm(c.quote || '');
  for (const u of used.clips || []) {
    const f = overlapFrac(c, u);
    if (f > 0.3) return `overlaps used ${hms(u.start)}-${hms(u.end)} by ${Math.round(f * 100)} %`;
    for (const uq of [u.quote, u.hook].filter(Boolean)) {
      if (uq.split(' ').length >= 4 && (text.includes(` ${uq} `) || (q.split(' ').length >= 4 && uq.includes(q)))) return `repeats used quote "${uq.slice(0, 60)}"`;
    }
  }
  return null;
}
export function markUsed(file, sourceId, clips) {
  const u = loadUsed(file);
  u.source = sourceId;
  for (const c of clips) {
    // the same clip again (same span, or a re-render of the same file with an edited span) replaces its entry
    u.clips = (u.clips || []).filter((x) => !(Math.abs(x.start - c.start) < 0.5 && Math.abs(x.end - c.end) < 0.5) && !(c.file && x.file === c.file));
    u.clips.push({ start: r3(c.start), end: r3(c.end), quote: norm(c.quote || ''), hook: norm(c.hook || ''), title: c.title, file: c.file, used: new Date().toISOString() });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(u, null, 1));
  return u;
}

// ---------- agent picker ----------
/** transcript lines for the picker: sentences, long ones split at <= maxDur s. */
export function agentLines(words, maxDur = 18) {
  const out = [], mk = (a, b) => ({ i0: a, i1: b, start: words[a].start, end: words[b].end, text: words.slice(a, b + 1).map((w) => w.text).join(' ') });
  for (const s of sentences(words)) {
    let a = s.i0;
    for (let i = s.i0 + 1; i <= s.i1; i++) if (words[i].end - words[a].start > maxDur) { out.push(mk(a, i - 1)); a = i; }
    out.push(mk(a, s.i1));
  }
  return out;
}

export function pickerPrompt(words, lines, { n, min, max, notes = '', used = [] }) {
  const L = lines.map((l, k) => `L${k} [${hms(l.start)}]${noisyWords(words, l.i0, l.i1) > 1 ? ' [noisy]' : ''} ${l.text}`).join('\n');
  return `You pick short-form clips (TikTok / Reels / YouTube Shorts, 9:16) out of ONE long recording. The transcript below is automatic speech recognition: it may mix languages (e.g. Taglish: Tagalog + English) and has recognition errors; lines marked [noisy] are garbled, so avoid clips that need them. Each line: L<n> [m:ss] text.

Pick the ${n} best standalone moments, ranked best first. Each clip must:
- last about ${min}-${max} s once pauses and fillers are removed (a raw span of roughly ${Math.round(min * 1.05)}-${Math.round(max * 1.3)} s);
- open on a hook: its FIRST sentence alone makes a scroller stop (a bold claim, a question, a story opener, a striking line), never a reply to something the viewer did not hear;
- be ONE complete thought (setup -> payoff) that makes sense with no context;
- end cleanly on a finished sentence or punchline: never mid-sentence, never on a dangling question or a cross-talk reaction;
- not overlap another pick.${used.length ? `\nAlready published from this recording (do NOT propose these again or reuse their quotes):\n${used.map((u) => `- ${hms(u.start)}-${hms(u.end)} "${u.quote || u.hook}"`).join('\n')}` : ''}${notes ? `\nEditor notes: ${notes}` : ''}

For each clip give: start_line, end_line (line numbers), first_words (the exact first 3-6 words of the clip as written in start_line; the clip may start mid-line), last_words (the exact last 3-6 words as written in end_line; it may end mid-line), score (0-100: how likely it holds a viewer to the end), title (hook card text, 2-7 words, in the speakers' own words and language or a faithful paraphrase: no fact they did not say, no clickbait), quote (the clip's most quotable sentence, verbatim from the transcript), reason (one line: why it works as a short).
Output ONLY a JSON array: [{"start_line":0,"end_line":0,"first_words":"","last_words":"","score":0,"title":"","quote":"","reason":""}]

TRANSCRIPT
${L}`;
}

function callAgent(prompt, logFile) {
  const want = (process.env.AI_VIDEO_EDITOR_AGENT || 'auto').toLowerCase();
  const has = (b) => spawnSync('sh', ['-c', `command -v ${b}`], { encoding: 'utf8' }).status === 0;
  if (want === 'none') return null;
  const cap = Number(process.env.AI_VIDEO_EDITOR_PICK_CAP || 420) * 1000;
  let r = null;
  if ((want === 'auto' || want === 'claude') && has('claude')) r = spawnSync('claude', ['-p', '--model', process.env.AI_VIDEO_EDITOR_PICK_MODEL || 'opus', '--max-turns', '1', '--output-format', 'text'], { input: prompt, encoding: 'utf8', timeout: cap, maxBuffer: 1 << 26 });
  else if ((want === 'auto' || want === 'codex') && has('codex')) { const o = `${logFile}.out`; r = spawnSync('codex', ['exec', '--skip-git-repo-check', '-o', o, '-'], { input: prompt, encoding: 'utf8', timeout: cap, maxBuffer: 1 << 26 }); if (fs.existsSync(o)) r.stdout = fs.readFileSync(o, 'utf8'); }
  if (!r) return null;
  if (logFile) fs.writeFileSync(logFile, `${r.stdout || ''}\n--- stderr\n${r.stderr || ''}\nexit ${r.status}`);
  const m = (r.stdout || '').match(/\[[\s\S]*\]/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

/** snap an agent proposal to exact word indices; returns a candidate or {reject}. */
export function snapProposal(words, lines, p, { min, max, speechGap } = {}) {
  const a = lines[p.start_line], b = lines[p.end_line];
  if (!a || !b || p.end_line < p.start_line) return { reject: `bad line range L${p.start_line}-L${p.end_line}` };
  let i0 = a.i0, i1 = b.i1;
  if (p.first_words) { const k = findPhrase(words, p.first_words, a.i0); if (k >= 0 && k <= a.i1) i0 = k; }
  if (p.last_words) {
    const from = p.end_line === p.start_line ? i0 : b.i0;
    const l = locate(words, p.last_words, from);
    if (l && l.i1 <= b.i1 + 2) i1 = l.i1;
  }
  while (i0 < i1 && FILLER.test(words[i0].text)) i0++;
  while (i1 > i0 && FILLER.test(words[i1].text)) i1--;
  const e = snapEnding(words, i0, i1, { min, max });
  if (e.reject) return { reject: e.reject, i0, i1, start: words[i0].start, end: words[i1].end, est: estDuration(words, i0, i1) };
  const endFix = e.moved || e.was ? `end moved ${e.moved > 0 ? '+' : ''}${e.moved.toFixed(1)} s to a clean ending (was: ${e.was})` : undefined;
  i1 = e.i1;
  const c = { i0, i1, start: words[i0].start, end: words[i1].end, dur: r3(words[i1].end - words[i0].start), est: estDuration(words, i0, i1), ...(endFix ? { endFix } : {}) };
  c.text = words.slice(i0, i1 + 1).map((w) => w.text).join(' ');
  c.hook = sentences(words.slice(i0, i1 + 1))[0]?.text || c.text.split(' ').slice(0, 12).join(' ');
  if (c.est < min * 0.85) return { reject: `too short (~${c.est.toFixed(0)} s)`, ...c };
  if (c.est > max * 1.05) return { reject: `too long (~${c.est.toFixed(0)} s)`, ...c };
  const g = maxGap(words, i0, i1);
  if (g > 4) { // a long silence between words: speech the ASR skipped (reject), or a real pause / a silent demo (fine)
    let k = i0; for (let i = i0; i < i1; i++) if (words[i + 1].start - words[i].end >= g - 1e-6) k = i;
    if (!speechGap || speechGap(words[k].end, words[k + 1].start)) return { reject: `transcript hole of ${g.toFixed(1)} s inside`, ...c };
  }
  const nz = noisyWords(words, i0, i1); if (nz > 2) return { reject: `${nz} garbled words`, ...c };
  return c;
}

/** ranked proposals: agent picks (snapped + validated) first, heuristic windows fill; used clips skipped. */
export function propose(words, { n = 4, min = 30, max = 75, notes, used = { clips: [] }, range, logFile, speechGap } = {}) {
  const inRange = (c) => !range || (c.start >= range[0] && c.end <= range[1]);
  const W = words, lines = agentLines(W).filter((l) => inRange(l));
  const out = [], rejected = [];
  const free = (c) => !out.some((x) => c.start < x.end && c.end > x.start);
  const raw = lines.length ? callAgent(pickerPrompt(W, lines, { n: Math.max(8, n * 2), min, max, notes, used: used.clips || [] }), logFile) : null;
  const take = (list, round) => {
    for (const p of [...(list || [])].sort((x, y) => (Number(y.score) || 0) - (Number(x.score) || 0))) {
      const c = snapProposal(W, lines, p, { min, max, speechGap });
      const why = c.reject || usedReason({ ...c, quote: p.quote }, used) || (!inRange(c) ? 'outside --range' : null) || (!free(c) ? 'overlaps a better pick' : null);
      if (why) { rejected.push({ ...p, why, round, est: c.est }); continue; }
      out.push({ ...c, score: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))), title: String(p.title || '').trim(), quote: String(p.quote || '').trim(), reason: String(p.reason || '').trim(), by: round ? 'agent (repaired)' : 'agent' });
    }
  };
  take(raw, 0);
  // repair round: a strong pick that missed only on length / a hole goes back once with the reason, to be tightened
  const fixable = rejected.filter((r) => /too (long|short)|hole|clean ending/.test(r.why) && (Number(r.score) || 0) >= 60);
  if (fixable.length) {
    const ctx = new Set(); fixable.forEach((r) => { for (let k = Math.max(0, r.start_line - 15); k <= Math.min(lines.length - 1, r.end_line + 15); k++) ctx.add(k); });
    const prompt = `These short-form clip picks from one recording were rejected. Fix each one by choosing a tighter (or longer) span of the SAME moment so it lasts ${min}-${max} s once pauses and fillers are removed, still opens on a hook, is one complete thought and ends on a finished sentence. If a pick cannot be fixed, leave it out. A "transcript hole" is a stretch the speech recognition skipped: avoid spanning it.\n\n${fixable.map((r) => `- L${r.start_line}-L${r.end_line} "${r.title}" (score ${r.score}): ${r.why}${r.est ? ` (now ~${Math.round(r.est)} s)` : ''}`).join('\n')}\n\nOutput ONLY a JSON array in the same format: [{"start_line":0,"end_line":0,"first_words":"","last_words":"","score":0,"title":"","quote":"","reason":""}]\n\nTRANSCRIPT (excerpt)\n${[...ctx].sort((a, b) => a - b).map((k) => `L${k} [${hms(lines[k].start)}] ${lines[k].text}`).join('\n')}`;
    const fixed = callAgent(prompt, logFile && `${logFile}.repair`);
    if (fixed?.length) { const before = out.length; take(fixed, 1); log(`shorts: repair round: ${out.length - before} of ${fixable.length} rejected pick(s) fixed`); }
  }
  out.sort((x, y) => y.score - x.score);
  if (out.length < n) { // heuristic fill (no agent, or too few valid agent picks)
    const scoring = W.map((w) => (FILLER.test(w.text) ? { ...w, text: /[.!?]$/.test(w.text) ? '.' : '' } : w));
    const idx = scoring.map((w, i) => (w.text ? i : -1)).filter((i) => i >= 0);
    const hs = candidates(idx.map((i) => scoring[i]), { min: min * 1.05, max: max * 1.25 }).map((c) => ({ ...c, i0: idx[c.i0], i1: idx[c.i1] }));
    const top = hs[0]?.score || 1;
    for (const h0 of hs) {
      if (out.length >= n) break;
      const e = snapEnding(W, h0.i0, h0.i1, { min, max });
      if (e.reject) continue;
      const h = { ...h0, i1: e.i1, ...(e.was ? { endFix: `end moved ${e.moved > 0 ? '+' : ''}${e.moved.toFixed(1)} s to a clean ending (was: ${e.was})` } : {}) };
      const c = { ...h, start: W[h.i0].start, end: W[h.i1].end, est: estDuration(W, h.i0, h.i1) };
      c.text = W.slice(h.i0, h.i1 + 1).map((w) => w.text).join(' ');
      if (!inRange(c) || !free(c) || c.est < min * 0.85 || c.est > max * 1.05 || maxGap(W, h.i0, h.i1) > 4 || noisyWords(W, h.i0, h.i1) > 2 || usedReason(c, used)) continue;
      out.push({ ...c, hook: h.hook.replace(/\b(um+|uh+|ah+)\b,?\s*/gi, '').trim(), score: Math.round(35 + 45 * Math.max(0, h.score) / top), title: h.hook.split(/\s+/).slice(0, 7).join(' ').replace(/[,.;:]$/, ''), quote: h.hook, reason: 'heuristic: hook words in the opener, a complete ending, steady speech', by: 'heuristic' });
    }
  }
  return { proposals: out.slice(0, n).map((c, k) => ({ rank: k + 1, slug: slugify(c.title || c.hook), ...c })), rejected, agent: raw ? raw.length : 0 };
}

export const slugify = (s) => norm(s).replace(/'/g, '').split(' ').filter((w) => w && !STOP.has(w)).slice(0, 4).join('-').slice(0, 40) || 'clip';

export function proposalsText(src, P, { min, max, used }) {
  const head = `AI Video Editor shorts proposals: ${src}\n${new Date().toISOString().slice(0, 16).replace('T', ' ')} | ${P.length} candidates, ${min}-${max} s after the clean cut | used clips skipped: ${(used.clips || []).length}\nRender: ai-video-editor shorts <input> -o <out> --pick 1,3 [--hook | --hook "custom text"]\n`;
  return head + P.map((c) => `\n#${c.rank}  score ${c.score}/100  ${hms(c.start)}-${hms(c.end)} (source ${c.start.toFixed(1)}-${c.end.toFixed(1)} s)  ~${Math.round(c.est)} s after the clean cut\n    hook line: "${c.hook}"\n    hook card: "${c.title}"\n    why:       ${c.reason}${c.endFix ? `\n    ending:    ${c.endFix}` : ''}${c.review?.notes ? `\n    edits:     ${c.review.notes}` : ''}\n    preview:   ${c.preview ? path.basename(c.preview) : '- (span edited since the preview; --propose makes a new one)'}`).join('\n') + '\n';
}

// ---------- fast low-res preview ----------
const assTime = (t) => { const cs = Math.round(Math.max(0, t) * 100); return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`; };
const assEsc = (s) => String(s).replace(/[{}]/g, '').replace(/\n/g, '\\N');
export function previewClip(srcFile, c, words, out, { work, logFile, face = null }) {
  fs.mkdirSync(work, { recursive: true });
  const t0 = Math.max(0, c.start - 0.15), t1 = c.end + 0.5;
  const win = path.join(work, 'win.mp4');
  if (!fs.existsSync(win)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t0), '-i', srcFile, '-t', String(r3(t1 - t0)), '-vf', 'scale=640:360', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', win]);
  // --face: one steady crop on that point instead of the detected speaker turns
  const track = face ? { samples: [{ t: 0, cx: face.x * 640 }] } : faceTrack(win, path.join(work, 'win.track.json'), { logFile, switch: true });
  // crop: steady per speaker turn / shot (median face x), hard cuts between
  const S = track.samples || [], segs = [];
  for (const s of S) { if (!segs.length || s.cut) segs.push({ t: s.t, xs: [] }); segs.at(-1).xs.push(s.cx); }
  const cw = 202, xOf = (xs) => { const m = [...xs].sort((a, b) => a - b)[xs.length >> 1]; return Math.round(Math.max(0, Math.min(640 - cw, m - cw / 2))); };
  let ex = String(xOf(segs.at(-1)?.xs || [320]));
  for (let k = segs.length - 2; k >= 0; k--) ex = `if(lt(t,${segs[k + 1].t.toFixed(2)}),${xOf(segs[k].xs)},${ex})`;
  // captions (source words, the clean-cut grouping) + the hook card text for the first 3 s
  const ws = words.slice(c.i0, c.i1 + 1).filter((w) => !FILLER.test(w.text)).map((w) => ({ text: w.text, start: r3(w.start - t0), end: r3(w.end - t0) }));
  const p = JSON.parse(fs.readFileSync(path.join(REPO, 'ai-video-editor/styles/clean-cut/captions.json'), 'utf8'));
  const caps = captionGroups(ws, { duration: t1 - t0, p });
  const ass = path.join(work, 'preview.ass');
  fs.writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\nPlayResX: 360\nPlayResY: 640\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Cap,Montserrat,23,&H00FFFFFF,&H00FFFFFF,&H90000000,&H00000000,1,0,0,0,100,100,0,0,1,1.6,1,2,24,24,150,1\nStyle: Hook,Montserrat,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC0101020,1,0,0,0,100,100,0,0,3,10,0,8,26,26,80,1\nStyle: Tag,Montserrat,14,&H0000C8FF,&H0000C8FF,&H00000000,&H90000000,1,0,0,0,100,100,0,0,3,4,0,7,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
    caps.map((k) => `Dialogue: 0,${assTime(k.start)},${assTime(k.end)},Cap,,0,0,0,,${assEsc(k.words.map((w) => w.text).join(' ').replace(/[,.;:]+$/, ''))}`).join('\n') +
    `\nDialogue: 1,${assTime(0)},${assTime(3)},Hook,,0,0,0,,${assEsc(c.title || c.hook)}\nDialogue: 2,${assTime(0)},${assTime(t1 - t0)},Tag,,0,0,0,,PREVIEW #${c.rank} ${hms(c.start)}-${hms(c.end)} (raw, uncut)\n`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', win, '-vf', `crop=${cw}:360:'${ex}':0,scale=360:640:flags=lanczos,setsar=1,subtitles=${ass.replace(/([:\\'])/g, '\\$1')}`, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out]);
  return out;
}

// ---------- people: lower thirds for named speakers, recognised on screen ----------
function peopleRefs(o, srcFile) {
  let people = [];
  if (o.people) people = JSON.parse(fs.readFileSync(o.people, 'utf8'));
  if (o.speaker && o.speakerAt) people.unshift({ name: o.speaker, role: o.role || '', at: o.speakerAt });
  people = people.filter((p) => p.at != null);
  if (!people.length) return null;
  const dir = path.join(o.work, 'refs'); fs.mkdirSync(dir, { recursive: true });
  const refs = people.map((p, k) => {
    const image = path.join(dir, `ref${k}_${sec(p.at)}.jpg`);
    if (!fs.existsSync(image)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(sec(p.at)), '-i', srcFile, '-frames:v', '1', '-q:v', '2', image]);
    return { name: p.name || null, role: p.role || '', image, ...(p.x != null ? { x: Number(p.x) } : {}) };
  });
  const file = path.join(dir, 'refs.json');
  fs.writeFileSync(file, JSON.stringify(refs, null, 1));
  return { file, refs };
}

/** lower-third windows (clip timeline): each named person, ~1 s after their first steady on-screen run. */
export function lowerThirds(ids, refs, D, { delay = 1.0, hold = 3.5 } = {}) {
  const S = ids.samples || [], out = [];
  refs.forEach((r, k) => {
    if (!r.name) return;
    const runs = []; let cur = null;
    for (let j = 0; j < S.length; j++) {
      const on = S[j].who === k || (S[j].who == null && cur && S[j + 1]?.who === k); // one unknown sample inside a run
      if (on) { if (!cur) cur = { start: j === 0 ? 0 : S[j].t, end: S[j].t }; cur.end = S[j].t; } else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) { cur.end = D; runs.push(cur); }
    for (const ru of runs) {
      const s = r3(ru.start + delay), e = r3(Math.min(s + hold, ru.end - 0.2, D - 0.4));
      if (e - s >= 2.0) { out.push({ name: r.name, role: r.role, start: s, end: e }); break; }
    }
  });
  return out;
}

// ---------- captions vs audio (shorts run clean-cut.sh --build-only, which stops before its caption verify) ----------
/** Whisper splits Tagalog affixes and spelled letters into their own tokens ("nag -simula", "B -U -Y"): one word. */
export const joinAffixes = (ws) => ws.reduce((a, w) => {
  if (/^-\S/.test(w.text) && a.length) { const p = a[a.length - 1]; a[a.length - 1] = { ...p, text: p.text.replace(/[,.]$/, '') + w.text, end: w.end }; } else a.push({ ...w });
  return a;
}, []);

/** the clean-cut caption check on a built window: a second decode of the built audio (check/caption-verify.mjs), then
 * the same short text-only agent pass as clean-cut.sh (brief-captions.md). Returns {flagged, total, text} where text
 * is {window word index: fixed word} (empty when nothing should change or no agent). Cached in the clip dir. */
function captionCheck(o, cdir, proj) {
  const json = path.join(cdir, 'caption-verify.json'), txt = path.join(cdir, 'caption-verify.txt'), cp = path.join(cdir, 'caption-patch.json');
  if (!fs.existsSync(json)) {
    const r = run('node', [path.join(REPO, 'ai-video-editor/check/caption-verify.mjs'), proj, '--lang', o.lang || 'auto', '--json'], { label: 'caption verify', logFile: o.logFile, allowFail: true, env: { OMP_NUM_THREADS: process.env.AI_VIDEO_EDITOR_ASR_THREADS || '6' } });
    if (r.status !== 0) { log(`caption verify failed (see ${o.logFile}); continuing`); return null; }
    fs.writeFileSync(json, r.stdout);
  }
  const cv = JSON.parse(fs.readFileSync(json, 'utf8')), flagged = cv.captions.filter((c) => c.flags.length);
  const fl = (ws) => ws.map((w) => `${w.i ?? '?'}:${w.text}`).join(' ');
  fs.writeFileSync(txt, flagged.map((c) => `FLAG cap ${c.i} [${c.start.toFixed(2)}-${c.end.toFixed(2)}] "${c.text}" not heard: ${fl(c.flags)} | caption words: ${fl(c.words)} | heard: ${c.heard}`).concat(`caption-verify: ${flagged.length} of ${cv.captions.length} captions flagged`).join('\n'));
  if (!flagged.length || (process.env.AI_VIDEO_EDITOR_AGENT || 'auto') === 'none' || spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).status !== 0) return { flagged: flagged.length, total: cv.captions.length, text: {} };
  if (!fs.existsSync(cp)) {
    const brief = fs.readFileSync(path.join(REPO, 'ai-video-editor/styles/clean-cut/brief-captions.md'), 'utf8');
    const pf = path.join(cdir, 'caption-review.md');
    fs.writeFileSync(pf, brief.split('{{FLAGS}}').join(fs.readFileSync(txt, 'utf8').trim()).split('{{PATCH}}').join(cp));
    run('timeout', ['--signal=TERM', process.env.AI_VIDEO_EDITOR_REVIEW_CAP || '120', 'node', path.join(REPO, 'ai-video-editor/bin/claude-watchdog.mjs'), '--prompt-file', pf, '--log', path.join(cdir, 'caption-review.log'), '--stream-log', path.join(cdir, 'caption-review.jsonl'), '--', '--model', process.env.AI_VIDEO_EDITOR_REVIEW_MODEL || 'sonnet', '--max-turns', '3', '--permission-mode', 'bypassPermissions'], { label: 'caption review', logFile: o.logFile, allowFail: true });
    if (!fs.existsSync(cp)) fs.writeFileSync(cp, JSON.stringify({ text: {}, notes: 'caption review wrote no patch' }));
  }
  const p = JSON.parse(fs.readFileSync(cp, 'utf8'));
  return { flagged: flagged.length, total: cv.captions.length, text: p.text || {}, notes: p.notes };
}

// ---------- full render of one picked proposal ----------
/** the clean-cut review patch of one window (window word indices): --review-patch (transcript indices) + the
 * proposal's pinned `review` ({keep, remove, text} in the same word indices as i0 / i1), or null. A patch replaces
 * the agent review, so a pinned review makes the cut deterministic. */
export function windowPatch(c, idx, patch) {
  if (!patch && !c.review) return null;
  const map = new Map(); for (let k = c.i0; k <= c.i1; k++) map.set(idx[k], k - c.i0);
  const inWin = (k) => k >= c.i0 && k <= c.i1;
  const re = (a) => (a || []).filter((i) => map.has(i)).map((i) => map.get(i));
  const own = (a) => (a || []).map(Number).filter(inWin).map((k) => k - c.i0);
  const R = c.review || {};
  const text = { ...Object.fromEntries(Object.entries(patch?.text || {}).filter(([i]) => map.has(Number(i))).map(([i, v]) => [map.get(Number(i)), v])), ...Object.fromEntries(Object.entries(R.text || {}).filter(([k]) => inWin(Number(k))).map(([k, v]) => [Number(k) - c.i0, v])) };
  const remove = [...new Set([...re(patch?.remove), ...own(R.remove)])].sort((a, b) => a - b);
  const keep = [...new Set([...re(patch?.keep), ...own(R.keep)])].filter((k) => !remove.includes(k)).sort((a, b) => a - b);
  return { keep, remove, text, notes: [patch && 're-indexed from --review-patch', R.notes && `pinned review: ${R.notes}`].filter(Boolean).join(' | ') };
}

/** null when two keep-lists agree to a frame (1/30 s), else what differs */
export function edlDiff(want, got, tol = 1 / 30 + 1e-6) {
  if (want.length !== got.length) return `cut differs from the pinned EDL: ${got.length} keeps (pinned ${want.length})`;
  const k = want.findIndex((w, i) => ['sourceStart', 'sourceEnd', 'start', 'end'].some((f) => Math.abs(w[f] - got[i][f]) > tol));
  return k < 0 ? null : `cut differs from the pinned EDL at keep ${k}: ${JSON.stringify(got[k])} (pinned ${JSON.stringify(want[k])})`;
}

/** the clip's work dir: rank, start, and a hash of the span + pinned review (an edited plan never reuses an old cut) */
export const clipDir = (work, c) => path.join(work, `clip${c.rank}_${Math.round(c.start)}` + (c.review || c.endFix ? `_${crypto.createHash('sha256').update(JSON.stringify([c.i0, c.i1, c.review || null])).digest('hex').slice(0, 8)}` : ''));

async function renderPick(o, src, words, idx, c, patch, people) {
  const tag = `${c.rank}`, cdir = clipDir(o.work, c);
  fs.mkdirSync(cdir, { recursive: true });
  // the window, with breathing room on both sides for the clean cut's pads, but never into the neighbouring words: the
  // window transcript starts at i0, so the cut's head pad walks back through voiced audio into a previous word glued
  // to it ("for example, Sa akin nga" opened on "-ample,")
  const prevEnd = c.i0 > 0 ? words[c.i0 - 1].end : 0, nextStart = words[c.i1 + 1]?.start ?? src.duration;
  const t0 = Math.max(0, words[c.i0].start - 0.35, Math.min(prevEnd, words[c.i0].start));
  const t1 = Math.min(src.duration, words[c.i1].end + 0.6, Math.max(nextStart, words[c.i1].end));
  const win = path.join(cdir, 'window.mov');
  if (!fs.existsSync(win)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t0), '-i', src.file, '-t', String(r3(t1 - t0)), '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-c:a', 'pcm_s16le', win]);
  const wt = path.join(cdir, 'window.words.json');
  const sliceWords = (ws, z) => ws.map((w) => ({ text: w.text, start: r3(w.start - z), end: r3(w.end - z), type: 'word' }));
  fs.writeFileSync(wt, JSON.stringify({ language_code: o.lang || 'auto', words: sliceWords(words.slice(c.i0, c.i1 + 1), t0) }, null, 1));
  let wp = null;
  const wpatch = windowPatch(c, idx, patch); // --review-patch and / or the proposal's pinned review, window indices
  if (wpatch) { wp = path.join(cdir, 'window.patch.json'); fs.writeFileSync(wp, JSON.stringify(wpatch, null, 1)); if (c.review) log(`clip ${tag}: pinned review: remove ${wpatch.remove.length} word(s), keep ${wpatch.keep.length}, ${Object.keys(wpatch.text).length} text fix(es)`); }
  let b = cleanBuild({ ...o, input: win, transcript: wt, reviewPatch: wp, work: cdir });
  if (c.edl?.keeps) { // a plan with a pinned keep-list: the cut must reproduce it (same words, patch and cut code)
    const got = JSON.parse(fs.readFileSync(path.join(b.proj, 'assets/edit-decisions.json'), 'utf8')).keeps || [];
    log(`clip ${tag}: ${edlDiff(c.edl.keeps, got) || `cut matches the pinned EDL (${got.length} keeps, ${got.at(-1)?.end} s)`}`);
  }
  // captions vs audio: verify + text-only review; text fixes re-cut the window with the merged patch (cut unchanged)
  const cc = captionCheck(o, cdir, b.proj);
  const fixedMark = path.join(cdir, 'caption-fixed.json');
  if (cc && Object.keys(cc.text).length && !fs.existsSync(fixedMark)) {
    const rp = wp || path.join(cdir, 'cut.run', 'review-patch.json');
    let base = {}; try { base = JSON.parse(fs.readFileSync(rp, 'utf8')); } catch { /* no review patch: the deterministic cut */ }
    const merged = path.join(cdir, 'window.patch.captions.json');
    fs.writeFileSync(merged, JSON.stringify({ keep: base.keep || [], remove: base.remove || [], text: { ...(base.text || {}), ...cc.text }, notes: [base.notes, `caption review: ${cc.notes || ''}`].filter(Boolean).join(' | ') }, null, 1));
    log(`clip ${tag}: caption review fixed ${Object.keys(cc.text).length} word(s) (${cc.flagged}/${cc.total} captions flagged): ${JSON.stringify(cc.text)}`);
    b = cleanBuild({ ...o, input: win, transcript: wt, reviewPatch: merged, work: cdir, fresh: true });
    fs.writeFileSync(fixedMark, JSON.stringify({ patch: merged, text: cc.text }));
    for (const f of ['clip_sdr.mp4', 'voice.wav', 'track.json', 'faceid.json']) fs.rmSync(path.join(cdir, f), { force: true });
  } else if (cc) log(`clip ${tag}: caption verify ${cc.flagged}/${cc.total} captions flagged, no text change`);
  const ew = joinAffixes(b.words);
  const clip = sdrClip(b.clip, path.join(cdir, 'clip_sdr.mp4'));
  const voice = path.join(cdir, 'voice.wav');
  const D = Math.min(probe(clip).duration, probe(b.voice).duration);
  if (!fs.existsSync(voice)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', b.voice, '-af', `afade=t=out:st=${r3(Math.min(D - 0.1, ew.at(-1).end + 0.04))}:d=${r3(Math.max(0.1, D - ew.at(-1).end - 0.04))}:curve=cub`, /* room tone fades after the last word */ '-ar', '48000', '-ac', '2', voice]);
  const track = faceTrack(clip, path.join(cdir, 'track.json'), { logFile: o.logFile, switch: true });
  // jump cuts of the clean cut (joins inside one camera shot): alternate punch-ins hide them
  const ed = JSON.parse(fs.readFileSync(path.join(b.proj, 'assets/edit-decisions.json'), 'utf8'));
  const joins = (ed.keeps || []).slice(1).map((k) => k.start).filter((t) => t > 0.3 && t < D - 0.3);
  let lts = [];
  if (people) {
    const ids = path.join(cdir, 'faceid.json');
    if (!fs.existsSync(ids)) run(PY, [path.join(REPO, 'ai-video-editor/engine/faceid.py'), clip, path.join(cdir, 'track.json'), people.file, ids], { label: 'face id', logFile: o.logFile });
    lts = lowerThirds(JSON.parse(fs.readFileSync(ids, 'utf8')), people.refs, D);
    log(`clip ${tag}: lower third ${lts.map((l) => `${l.name} ${l.start}-${l.end} s`).join(', ') || 'none (no named person on screen long enough)'}`);
  }
  // --graphics: the talking-head planner's beats, briefed for short-form pacing; a re-run keeps the clip's
  // reviewed plan (--replan plans again). Default: clean (the approved captions, framing and cuts only).
  let plan = { beats: [] };
  if (o.graphics) {
    const notes = [o.notes, 'This is a standalone 9:16 SHORT: something should change every 2-4 seconds (punch-in, pop or box); 2-4 punch-ins; at most one or two top boxes.'].filter(Boolean).join('\n');
    const prev = path.join(cdir, 'plan.json'), keep = !o.replan && fs.existsSync(prev) ? path.join(cdir, 'plan.prev.json') : undefined;
    if (keep) fs.copyFileSync(prev, keep);
    plan = makePlan({ ...o, notes, work: cdir, title: undefined, plan: keep }, ew, D, 'shorts', { maxTopShare: 0.45 }).plan;
  }
  const hookText = o.hook ? (typeof o.hook === 'string' ? o.hook : (c.title || c.hook)) : null;
  const name = `short_${c.rank}_${c.slug}`;
  const res = await exportFormats({ ...o, formats: o.formats }, {
    name, clipFile: clip, track, words: ew, voice, plan, captions: o.graphics ? 'kinetic' : 'minimal', intro: 0, outro: 0,
    hookCard: hookText, lowerThirds: lts, lowerThird: false, title: null, progress: !!o.graphics, steady: true, joins: o.graphics ? [] : joins,
    music: o.music && !o.noMusic ? o.music : null, leadIn: 0.2,
  });
  return res.exports.map((e) => ({ rank: c.rank, ...e, sourceRange: [r3(words[c.i0].start), r3(words[c.i1].end)], score: c.score, hook: ew.length ? sentences(ew)[0]?.text : c.hook, hookCard: hookText, title: c.title, reason: c.reason, quote: c.quote, lowerThirds: lts }));
}

export function picksText(src, picks) {
  return `AI Video Editor shorts: finals from ${src}\n` + picks.sort((a, b) => a.rank - b.rank).map((p) => `\n#${p.rank}  ${path.basename(p.file)}\n    source:    ${hms(p.sourceRange[0])}-${hms(p.sourceRange[1])} (${p.sourceRange[0].toFixed(1)}-${p.sourceRange[1].toFixed(1)} s)\n    duration:  ${p.duration.toFixed(1)} s\n    hook line: "${p.hook}"\n    hook card: ${p.hookCard ? `"${p.hookCard}" (first 3 s)` : 'none'}\n    lower 3rd: ${p.lowerThirds?.length ? p.lowerThirds.map((l) => `${l.name} at ${l.start.toFixed(1)} s`).join(', ') : 'none'}\n    why:       ${p.reason}\n    delivery:  ${p.pass === false ? `FAIL ${p.note || ''}` : 'PASS'}${p.loudness ? ` (${p.loudness.I} LUFS, ${p.loudness.TP} dBTP)` : ''}`).join('\n') + '\n';
}

/** a saved shorts plan: --plan FILE, else <out>/<source-id>/proposals.json when made from this source (and --range),
 * else the pinned one (engine/plan-store.mjs). Returns the plan with `from`, or null. */
export function loadShortsPlan(o, propFile, key) {
  const read = (f) => { const p = JSON.parse(fs.readFileSync(f, 'utf8')); delete p.pin; if (!Array.isArray(p.proposals)) throw new Error(`${f}: not a shorts plan (no "proposals")`); return p; };
  if (o.plan) return { ...read(o.plan), from: `file:${o.plan}` };
  if (fs.existsSync(propFile)) {
    const p = read(propFile), [h, rg = null] = key.split('_');
    if ((!p.sourceHash || p.sourceHash === h) && String(p.range ? p.range.join('-') : null) === String(rg)) return { ...p, from: propFile };
  }
  const pin = loadPin('shorts', key);
  return pin ? { ...read(pin.file), from: pin.file } : null;
}

export default async function shorts(o) {
  const N = Number(o.clips || (o.propose ? 4 : 3)), MIN = Number(o.min || 30), MAX = Number(o.max || 75);
  const src = normalise(o.input, o.work);
  const sourceId = o.clip;
  const meta = path.join(o.out, sourceId);
  const usedFile = usedPath(o.out, sourceId), propFile = path.join(meta, 'proposals.json');
  if (o.resetUsed) { fs.rmSync(usedFile, { force: true }); log(`shorts: --reset-used: cleared ${usedFile}`); }
  let raw;
  if (o.transcript) raw = JSON.parse(fs.readFileSync(o.transcript, 'utf8')).words;
  else {
    const { asr } = await import('../engine/media.mjs');
    log('transcribing the whole source ...'); asr(src.file, path.join(o.work, 'source.words.json'), { lang: o.lang || 'auto', logFile: o.logFile });
    raw = JSON.parse(fs.readFileSync(path.join(o.work, 'source.words.json'), 'utf8')).words;
  }
  // keep transcript indices (a --review-patch refers to them) while dropping non-words
  const idx = [], words = [];
  raw.forEach((w, i) => { if ((w.type || 'word') === 'word' && String(w.text).trim()) { idx.push(i); words.push({ text: String(w.text).trim(), start: w.start, end: w.end }); } });
  const range = o.range ? String(o.range).split('-').map(sec) : null;
  if (range && !(range[1] > range[0])) throw new Error(`--range ${o.range}: want START-END, e.g. 22:05-26:00`);

  // the shorts plan (proposals: spans, hook text, pinned reviews): --plan FILE, else this folder's proposals.json or
  // the plan pinned for this source (+ --range), else a fresh pick; --replan always picks fresh. Pinned on every run.
  const key = sourceHash(o.input) + (range ? `_${range.join('-')}` : '');
  let plan = o.replan ? null : loadShortsPlan(o, propFile, key);
  if (plan && plan.words !== words.length) throw new Error(`shorts: the plan ${plan.from} was made from a different transcript (${plan.words} vs ${words.length} words); pass the same --transcript, or --replan`);
  if (plan) log(`shorts: plan ${plan.from} (${plan.proposals.length} proposals, made ${plan.made}; --replan to pick again)`);
  else if (o.pick) throw new Error(`--pick: no proposals for ${sourceId} in ${o.out} or the plan store (run --propose first, or --plan FILE)`);
  let P, rejected = [];
  const used = loadUsed(usedFile);
  if (plan) {
    // the clean-ending rule applies to pinned plans too (deterministic: same transcript, same end)
    for (const p of plan.proposals) {
      const e = snapEnding(words, p.i0, p.i1, { min: plan.min, max: plan.max });
      if (e.reject) { log(`shorts: note: #${p.rank} has no clean ending in reach (${e.reject}); left as planned`); continue; }
      if (e.i1 === p.i1) continue;
      log(`shorts: #${p.rank}: end moved ${e.moved > 0 ? '+' : ''}${e.moved.toFixed(1)} s to a clean ending (was: ${e.was})`);
      Object.assign(p, { i1: e.i1, end: words[e.i1].end, dur: r3(words[e.i1].end - words[p.i0].start), est: estDuration(words, p.i0, e.i1), text: words.slice(p.i0, e.i1 + 1).map((w) => w.text).join(' '), endFix: `end moved ${e.moved > 0 ? '+' : ''}${e.moved.toFixed(1)} s to a clean ending (was: ${e.was})` });
      delete p.preview; delete p.edl; // the preview and a pinned keep-list showed the old span
    }
    P = plan.proposals; rejected = plan.rejected || [];
  } else {
    log(`shorts: picking ${N} of ${words.length} words (${hms(words.at(-1)?.end || 0)}), ${(used.clips || []).length} used clip(s) skipped${range ? `, range ${o.range}` : ''} ...`);
    const r = propose(words, { n: N, min: MIN, max: MAX, notes: o.notes, used, range, logFile: path.join(o.work, 'picker.log'), speechGap: speechGapFn(src.file) });
    if (!r.proposals.length) throw new Error(`no ${MIN}-${MAX} s moment left in this source${(used.clips || []).length ? ' (used clips skipped; --reset-used)' : ''}`);
    log(`shorts: agent proposed ${r.agent}, ${r.rejected.length} rejected (${r.rejected.map((x) => x.why).join('; ') || '-'}); ${r.proposals.length} kept: ${r.proposals.map((p) => `#${p.rank} ${hms(p.start)} ${p.score}`).join(', ')}`);
    P = r.proposals; rejected = r.rejected;
    // a new proposal set replaces the old previews (their numbers no longer mean the same clips)
    if (o.propose) for (const f of fs.readdirSync(o.out)) if (/^proposal_\d+_.*_preview\.mp4$/.test(f)) fs.rmSync(path.join(o.out, f));
  }
  if (o.propose) {
    for (const p of P) {
      if (p.preview && fs.existsSync(p.preview)) continue; // a pinned proposal keeps its preview (an edited span drops it)
      p.preview = path.join(o.out, `proposal_${p.rank}_${p.slug}_preview.mp4`);
      log(`preview #${p.rank} ...`);
      previewClip(src.file, p, words, p.preview, { work: path.join(o.work, `preview${p.rank}_${Math.round(p.start)}_${Math.round(p.end)}`), logFile: o.logFile, face: o.face });
    }
  }
  const { from: _from, ...kept } = plan || {};
  const saved = { ...kept, source: o.input, sourceHash: key.split('_')[0], range: range || null, words: words.length, min: plan?.min ?? MIN, max: plan?.max ?? MAX, made: plan?.made || new Date().toISOString(), proposals: P, rejected };
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(propFile, JSON.stringify(saved, null, 1));
  const pinFile = savePin('shorts', key, saved, { source: o.input, from: plan ? plan.from : 'picker' });
  if (!plan) log(`shorts: plan pinned ${pinFile} (re-runs of this source reuse it; --replan to pick again)`);
  fs.writeFileSync(path.join(o.out, 'PROPOSALS.txt'), proposalsText(path.basename(o.input), P, { min: saved.min, max: saved.max, used }));
  if (o.propose) { log(`proposals: ${path.join(o.out, 'PROPOSALS.txt')} (render: --pick 1,3)`); return { proposals: P.map(({ rank, score, start, end, est, hook, title, reason, preview }) => ({ rank, score, start, end, est, hook, title, reason, preview })), exports: [] }; }
  if (o.pick) {
    const want = String(o.pick).split(',').map((x) => Number(x.trim())).filter(Boolean);
    P = want.map((r) => P.find((p) => p.rank === r) || (() => { throw new Error(`--pick ${r}: no such proposal (1-${P.length})`); })());
    for (const p of P) { const why = usedReason(p, used); if (why) log(`shorts: note: #${p.rank} was already used (${why}); rendering it again`); }
  }
  const patch = o.reviewPatch ? JSON.parse(fs.readFileSync(o.reviewPatch, 'utf8')) : null;
  const people = peopleRefs(o, src.file);
  const all = [];
  for (const c of P) all.push(...await renderPick(o, src, words, idx, c, patch, people));
  markUsed(usedFile, sourceId, P.map((c) => ({ ...c, file: all.find((e) => e.rank === c.rank)?.file })));
  // PICKS.txt: every final rendered into this folder (a later --pick adds to it)
  const pf = path.join(meta, 'picks.json');
  const prev = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : [];
  const picks = [...prev.filter((p) => !all.some((e) => e.rank === p.rank && e.format === p.format) && fs.existsSync(p.file)), ...all.map(({ check, ...e }) => e)];
  fs.writeFileSync(pf, JSON.stringify(picks, null, 1));
  fs.writeFileSync(path.join(o.out, 'PICKS.txt'), picksText(path.basename(o.input), picks));
  return { exports: all, picked: P.map((c) => c.rank) };
}

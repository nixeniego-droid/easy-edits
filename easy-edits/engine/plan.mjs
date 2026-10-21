// Easy Edits motion plan: transcript (edited timeline) -> beats (title, lower third, punch-ins, icon pops, stat chips,
// top-box cards). Three sources, in order: --plan FILE (written by a human or any agent), the built-in agent planner
// (one short `claude -p` / `codex exec` call when an agent CLI is installed; EASY_EDITS_AGENT=none skips it), else the
// deterministic heuristic planner below. Every plan is validated and anchored the same way (validatePlan).
//
// Plan schema (times are optional: a beat is placed by `anchor`, an exact phrase of the transcript):
//   { "title": str, "subtitle"?: str, "speaker"?: {"name": str, "role"?: str},
//     "beats": [
//       {"type":"punch",   "anchor":"phrase", "until"?:"phrase", "zoom"?:1.15-1.8}
//       {"type":"icon",    "anchor":"word",   "icon":"eye|heart|...", "label"?:str}
//       {"type":"stat",    "anchor":"phrase", "value":"29:18", "label":str}
//       {"type":"quote",   "anchor":"phrase", "until"?:"phrase", "text":str, "cite"?:str}            (top box)
//       {"type":"list",    "anchor":"phrase", "title":str, "items":[{"text":str,"anchor":"phrase"}]}  (top box)
//       {"type":"compare", "anchor":"phrase", "left":{"title":str,"icon"?:str}, "right":{...},
//                          "rows":[{"left":str,"right":str,"anchor":"phrase"}]}                      (top box)
//       {"type":"card",    "anchor":"phrase", "until"?:"phrase", "icon":str, "title":str, "sub"?:str} (top box)
//     ] }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ICONS, iconFor } from './icons.mjs';

const r3 = (v) => Math.round(v * 1000) / 1000;
export const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const TOPBOX = new Set(['quote', 'list', 'compare', 'card']);
const STOP = new Set('the a an and or but so of to in on at for with is are was were be been it its it\'s this that these those we you i he she they our your my me us them his her their what when where which who how not no yes do does did have has had will would can could should just very really also there here then than as if about from by up out into over more most some any all one two'.split(' '));

/** word index of the first occurrence of `phrase` at or after word `from` (normalised, punctuation-free). */
export function findPhrase(words, phrase, from = 0) {
  const p = norm(phrase).split(' ').filter(Boolean);
  if (!p.length) return -1;
  const W = words.map((w) => norm(w.text));
  for (let i = Math.max(0, from); i < W.length; i++) {
    let k = 0, j = i;
    // a transcript token may hold two words ("Few people"): compare on the joined text
    let acc = '';
    while (j < W.length && acc.split(' ').filter(Boolean).length < p.length) { acc = (acc + ' ' + W[j]).trim(); j++; }
    if (acc === p.join(' ') || acc.startsWith(p.join(' ') + ' ')) return i;
    void k;
  }
  return -1;
}

/** phrase -> {i0, i1, start, end} (i1 = index of the phrase's last word) or null. */
export function locate(words, phrase, from = 0) {
  const i0 = findPhrase(words, phrase, from);
  if (i0 < 0) return null;
  const n = norm(phrase).split(' ').length;
  let i1 = i0, cnt = norm(words[i0].text).split(' ').length;
  while (cnt < n && i1 + 1 < words.length) { i1++; cnt += norm(words[i1].text).split(' ').length; }
  return { i0, i1, start: words[i0].start, end: words[i1].end };
}

const sentenceEnds = (words) => words.map((w, i) => /[.!?]$/.test(w.text) || i === words.length - 1);
export function sentences(words) {
  const ends = sentenceEnds(words), out = [];
  let s = 0;
  words.forEach((w, i) => { if (ends[i]) { out.push({ i0: s, i1: i, start: words[s].start, end: w.end, text: words.slice(s, i + 1).map((x) => x.text).join(' ') }); s = i + 1; } });
  return out;
}

const cap = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** deterministic planner: relevant beats only (keyword concepts, numbers, scripture / quotes, X-but-Y contrasts). */
export function heuristicPlan(words, { title, speaker } = {}) {
  const beats = [], S = sentences(words);
  const busy = []; // [start, end] of top-box beats
  const free = (a, b) => !busy.some(([x, y]) => a < y + 0.6 && b > x - 0.6);
  // scripture reference + the quote that follows ("It says, ...")
  const text = words.map((w) => w.text).join(' ');
  const ref = text.match(/\b(Genesis|Exodus|Psalms?|Proverbs|Isaiah|Jeremiah|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Hebrews|James|Peter|Revelation)\s+(\d+)[,:]?\s+(?:verse\s+)?(\d+)/i);
  if (ref) {
    const cite = `${cap(ref[1].toLowerCase())} ${ref[2]}:${ref[3]}`;
    const at = locate(words, ref[0].split(/\s+/).slice(0, 2).join(' '));
    const qs = at && S.find((s) => s.start > at.start && /^(it says|says|it reads)/i.test(norm(s.text)));
    if (qs) {
      const body = qs.text.replace(/^(it says|says|it reads)[,:]?\s*/i, '').trim();
      const q = S[S.indexOf(qs)];
      beats.push({ type: 'quote', anchor: words.slice(at.i0, at.i0 + 2).map((w) => w.text).join(' '), until: words[q.i1].text, text: body.replace(/^./, (c) => c.toUpperCase()), cite });
      busy.push([at.start, q.end]);
    } else if (at) beats.push({ type: 'stat', anchor: words[at.i0].text, value: `${ref[2]}:${ref[3]}`, label: cap(ref[1].toLowerCase()) });
  }
  // contrast "X informs, but Y inspires" (+ a parallel follow-up sentence mentioning both) -> compare card
  for (let k = 0; k < S.length; k++) {
    const m = norm(S[k].text).match(/^(\w+) (\w+) but (\w+) (\w+)$/);
    if (!m || !free(S[k].start, S[k].end)) continue;
    const rows = [{ left: cap(m[2]), right: cap(m[4]), anchor: m[2] }];
    let end = S[k].end, last = k;
    for (let j = k + 1; j < Math.min(S.length, k + 4); j++) {
      const t = norm(S[j].text);
      if (t.includes(m[1]) || t.includes(m[3])) {
        const pair = S.slice(j, j + 2).map((s) => norm(s.text));
        const tl = pair.find((x) => x.includes(m[1])), tr = pair.find((x) => x.includes(m[3]));
        const tail = (x) => x && x.split(' ').slice(-1)[0];
        if (tl && tr && tail(tl) !== tail(tr)) { rows.push({ left: cap(tail(tl)), right: cap(tail(tr)), anchor: tail(tl), icons: [iconFor(tail(tl)), iconFor(tail(tr))] }); last = j + 1; end = S[Math.min(S.length - 1, j + 1)].end; }
        break;
      }
    }
    beats.push({ type: 'compare', anchor: words[S[k].i0].text + ' ' + words[S[k].i0 + 1].text, left: { title: cap(m[1]), icon: iconFor(m[1]) || 'target' }, right: { title: cap(m[3]), icon: iconFor(m[3]) || 'eye' }, rows, untilTime: end });
    busy.push([S[k].start, end]);
    k = last;
  }
  // numbers with a unit word -> stat chip (no invented numbers: the chip shows the spoken figure)
  words.forEach((w, i) => {
    const m = w.text.match(/^\$?(\d[\d,.]*%?)[,.]?$/);
    if (!m || !free(w.start, w.end + 2) || beats.some((b) => b.type === 'quote' && Math.abs(locate(words, b.anchor).start - w.start) < 8)) return;
    const unit = words[i + 1] && !STOP.has(norm(words[i + 1].text)) ? norm(words[i + 1].text) : '';
    if (unit) beats.push({ type: 'stat', anchor: w.text + ' ' + words[i + 1].text, value: m[1], label: cap(unit) });
  });
  // concept icons: first mention of a keyword concept, spaced >= 5 s, never during a top box
  const used = new Set(); let lastIcon = -9;
  words.forEach((w) => {
    const ic = iconFor(w.text);
    if (!ic || used.has(ic) || w.start - lastIcon < 5 || !free(w.start, w.start + 1.6)) return;
    used.add(ic); lastIcon = w.start;
    beats.push({ type: 'icon', anchor: w.text, icon: ic, label: cap(norm(w.text)) });
  });
  // punch-ins: alternate sentences >= 2.2 s (jump-cut rhythm), never inside a top box
  let alt = 0;
  S.forEach((s) => {
    if (s.end - s.start < 2.2 || !free(s.start, s.end)) return;
    if (alt++ % 2 === 1) beats.push({ type: 'punch', anchor: words.slice(s.i0, s.i0 + 2).map((w) => w.text).join(' '), untilTime: s.end });
  });
  const counts = {}; words.forEach((w) => { const n = norm(w.text); if (n.length > 3 && !STOP.has(n)) counts[n] = (counts[n] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { title: title || (top ? cap(top[0]) : 'Watch this'), speaker: speaker || null, beats, planner: 'heuristic' };
}

/** the agent planner prompt (any agent CLI): transcript with times -> plan JSON only. */
export function agentPrompt(words, { mode = 'talking-head', notes = '', title, speaker } = {}) {
  const lines = sentences(words).map((s) => `[${s.start.toFixed(2)}-${s.end.toFixed(2)}] ${s.text}`).join('\n');
  return `You plan motion graphics for a ${mode} video edit. Output ONLY one JSON object (no prose, no code fence).

Transcript of the EDITED video (seconds):
${lines}

Schema:
{"title": "<2-5 word animated title that names the topic; use the speaker's own words>",
 "subtitle": "<optional short line from the talk>",
 "beats": [
  {"type":"punch","anchor":"<exact phrase>","until":"<exact phrase>","zoom":1.4},
  {"type":"icon","anchor":"<exact word>","icon":"<one of: ${Object.keys(ICONS).join(', ')}>","label":"<1-2 words>"},
  {"type":"stat","anchor":"<exact phrase>","value":"<the spoken number>","label":"<what it counts>"},
  {"type":"quote","anchor":"<exact phrase>","until":"<exact phrase>","text":"<the quoted words, verbatim>","cite":"<source if spoken>"},
  {"type":"list","anchor":"<exact phrase>","title":"<short>","items":[{"text":"<1-4 words>","anchor":"<exact phrase where it is said>"}]},
  {"type":"compare","anchor":"<exact phrase>","left":{"title":"<word>","icon":"<icon>"},"right":{"title":"<word>","icon":"<icon>"},"rows":[{"left":"<1-3 words>","right":"<1-3 words>","anchor":"<exact phrase>"}]},
  {"type":"card","anchor":"<exact phrase>","until":"<exact phrase>","icon":"<icon>","title":"<2-6 words>","sub":"<optional>"}
 ]}

Rules:
- Anchors are EXACT phrases copied from the transcript (2-4 words; a single word only if unique). A beat starts on its anchor.
- Graphics only where they are relevant: a concept, a number, a list, a name, a quote, a contrast or a key point. Never decoration, never forced; but do not leave long stretches empty either: aim for one beat every 4-7 seconds.
- quote, list, compare and card are TOP-BOX beats (a full illustration panel above the speaker). Use them only when a beat truly needs illustration (a quote, a list, a comparison, a process); at most one top box per 8 seconds, and top boxes cover at most 40% of the video (unless the editor notes allow more). A top box lasts until its idea is finished (until).
- icon and stat are small pops next to the speaker (1-2 s). Do not put two pops within 3 seconds.
- punch = a jump-cut punch-in on emphasis (a key line, a payoff). Put 3-6 of them, not inside a top box.
- compare is ONLY for a contrast the speaker states (X vs Y, X but Y, before / after); parts or attributes of one thing are a list.
- A compare starts on the FIRST line of the contrast and gets one row per contrasting pair the speaker says (e.g. "X informs, but Y inspires" -> row informs | inspires).
- Never repeat the title as a card. A card's sub / cite and a quote's cite appear only if the speaker says them while the box is on screen.
- On-screen text uses only the speaker's words or a faithful 1-4 word label. Never invent facts, numbers, names or quotes. Fix nothing; do not correct the speaker.
${title ? `- The title is fixed: "${title}".\n` : ''}${speaker?.name ? `- The speaker is ${speaker.name}${speaker.role ? `, ${speaker.role}` : ''}.\n` : ''}${notes ? `- Editor notes: ${notes}\n` : ''}`;
}

/** run one agent CLI call for the plan; returns the parsed object or null. EASY_EDITS_AGENT=claude|codex|none. */
export function agentPlan(words, opts = {}, { log } = {}) {
  const want = (process.env.EASY_EDITS_AGENT || 'auto').toLowerCase();
  if (want === 'none') return null;
  const has = (b) => spawnSync('sh', ['-c', `command -v ${b}`], { encoding: 'utf8' }).status === 0;
  const prompt = agentPrompt(words, opts);
  const cap = Number(process.env.EASY_EDITS_AGENT_CAP || 240) * 1000;
  let r = null, who = null;
  if ((want === 'auto' || want === 'claude') && has('claude')) {
    who = 'claude';
    r = spawnSync('claude', ['-p', '--model', process.env.EASY_EDITS_PLAN_MODEL || 'sonnet', '--max-turns', '1', '--output-format', 'text'], { input: prompt, encoding: 'utf8', timeout: cap, maxBuffer: 1 << 24 });
  } else if ((want === 'auto' || want === 'codex') && has('codex')) {
    who = 'codex';
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'easy-edits-plan-')), 'plan.txt');
    r = spawnSync('codex', ['exec', '--skip-git-repo-check', '-o', out, '-'], { input: prompt, encoding: 'utf8', timeout: cap, maxBuffer: 1 << 24 });
    if (fs.existsSync(out)) r.stdout = fs.readFileSync(out, 'utf8');
  }
  if (!r) return null;
  if (log) fs.writeFileSync(log, `agent ${who} exit ${r.status}\n--- prompt\n${prompt}\n--- stdout\n${r.stdout || ''}\n--- stderr\n${r.stderr || ''}`);
  const m = (r.stdout || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { const p = JSON.parse(m[0]); p.planner = `agent:${who}`; return p; } catch { return null; }
}

/** anchor every beat, drop what cannot be placed, enforce spacing and top-box share. Returns {plan, dropped}. */
export function validatePlan(plan, words, { duration, minTopGap = 1.0, maxTopShare = 0.45 } = {}) {
  const dropped = [], beats = [];
  const resolve = (b, key = 'anchor', from = 0) => (b[key] ? locate(words, b[key], from) : null);
  for (const b0 of plan.beats || []) {
    const b = { ...b0 };
    const a = resolve(b);
    if (!a && b.at == null) { dropped.push([b.type, b.anchor, 'anchor not found']); continue; }
    b.at = r3(b.at ?? Math.max(0, a.start - 0.05));
    b.i0 = a?.i0;
    if (b.until) { const u = locate(words, b.until, a ? a.i0 : 0); b.end = u ? r3(u.end + 0.25) : null; }
    if (b.untilTime != null) b.end = r3(b.untilTime + 0.2);
    if (b.type === 'icon') { if (!ICONS[b.icon]) b.icon = iconFor(b.label || b.anchor) || 'sparkles'; b.end = r3(b.at + 1.6); }
    if (b.type === 'stat') b.end = r3(b.at + 2.2);
    if (b.type === 'punch') { b.end = b.end || r3(Math.min(b.at + 3, duration)); b.zoom = Number(b.zoom) ? Math.min(1.9, Math.max(1.12, Number(b.zoom))) : null; }
    for (const list of ['items', 'rows']) {
      if (!Array.isArray(b[list])) continue;
      let from = a ? a.i0 : 0;
      b[list] = b[list].map((it) => { const l = it.anchor ? locate(words, it.anchor, from) : null; if (l) from = l.i0; return { ...it, at: r3(l ? l.start : b.at) }; });
      b[list].forEach((it, k) => { if (k && it.at < b[list][k - 1].at) it.at = b[list][k - 1].at; });
      if (!b.end) b.end = r3(Math.max(...b[list].map((it) => it.at)) + 2.2);
      // the last reveal (a compare row's right cell is said after its left) stays up >= 1.2 s
      let lastReveal = Math.max(...b[list].map((it) => it.at));
      if (list === 'rows') for (const r of b.rows) { const fromI = words.findIndex((w) => w.start >= r.at - 0.01); const rl = r.right ? locate(words, r.right, Math.max(0, fromI)) : null; if (rl && rl.start - r.at < 6) lastReveal = Math.max(lastReveal, rl.start); }
      b.end = r3(Math.max(b.end, lastReveal + 1.2));
    }
    if (TOPBOX.has(b.type) && !b.end) b.end = r3(b.at + 3.5);
    if (b.type === 'card' && b.end - b.at > 5) b.end = r3(b.at + 5); // a static card stops earning its screen
    if (b.type === 'quote' && !b.end) b.end = r3(b.at + 3.5);
    b.end = r3(Math.min(b.end ?? b.at + 2, duration - 0.05));
    if (b.end - b.at < 0.8) { dropped.push([b.type, b.anchor, 'too short']); continue; }
    beats.push(b);
  }
  beats.sort((x, y) => x.at - y.at);
  // top boxes: no overlap, a gap between them, a share cap; grounded beats (prio, e.g. a verbatim quote) first,
  // then the earliest
  const acc = []; let topT = 0;
  for (const b of beats.filter((x) => TOPBOX.has(x.type)).sort((x, y) => (y.prio || 0) - (x.prio || 0) || x.at - y.at)) {
    const hitBox = acc.find((t) => b.at < t.end + minTopGap && b.end > t.at - minTopGap);
    if (hitBox) {
      // a list whose title promises more items than it has ("Three clicks" with two) absorbs the colliding beat
      const NUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
      const m = norm(hitBox.title || '').match(/\b(two|three|four|five|six|seven|[2-7])\b/);
      const want = m ? (NUM[m[1]] || Number(m[1])) : 0;
      // the spoken step (the anchor) names the item; the box's own title only when the anchor is long
      const an = String(b.anchor || '').replace(/[.,;:!?]+$/, '');
      const label = an && an.split(' ').length <= 5 ? an.charAt(0).toUpperCase() + an.slice(1) : (b.title || b.text || '');
      if (hitBox.type === 'list' && hitBox.items.length < want && label && label.split(' ').length <= 5 && b.at >= hitBox.at) {
        hitBox.items.push({ text: label, anchor: b.anchor, at: b.at });
        topT += Math.max(0, b.at + 2.2 - hitBox.end); hitBox.end = r3(Math.max(hitBox.end, Math.min(b.at + 2.2, duration - 0.05)));
        dropped.push([b.type, b.anchor, `merged into list "${hitBox.title}"`]); continue;
      }
      dropped.push([b.type, b.anchor, 'overlaps a top box']); continue;
    }
    if ((topT + b.end - b.at) / duration > maxTopShare) { dropped.push([b.type, b.anchor, 'top-box share cap']); continue; }
    topT += b.end - b.at; acc.push(b);
  }
  const out = beats.filter((b) => !TOPBOX.has(b.type) || acc.includes(b));
  // pops and punches never inside a top box; pops >= 2.5 s apart
  const tops = out.filter((b) => TOPBOX.has(b.type));
  const inTop = (b) => tops.some((t) => b.at < t.end + 0.2 && b.end > t.at - 0.2);
  const final = []; let lastPop = -9;
  for (const b of out) {
    if (!TOPBOX.has(b.type) && inTop(b)) {
      if (b.type === 'punch') { // shorten around the box instead of dropping
        const t = tops.find((x) => b.at < x.end + 0.2 && b.end > x.at - 0.2);
        if (t.at - b.at >= 1.2) { b.end = r3(t.at - 0.05); final.push(b); continue; }
      }
      dropped.push([b.type, b.anchor, 'inside a top box']); continue;
    }
    if (b.type === 'icon' || b.type === 'stat') { if (b.at - lastPop < 2.5) { dropped.push([b.type, b.anchor, 'pop too close']); continue; } lastPop = b.at; }
    final.push(b);
  }
  // punches never overlap each other
  const res = []; let lastPunch = null;
  for (const b of final) { if (b.type === 'punch' && lastPunch && b.at >= lastPunch.end && b.at < lastPunch.end + 1) { dropped.push([b.type, b.anchor, 'back-to-back punch (no visible cut)']); continue; } if (b.type === 'punch' && lastPunch && b.at < lastPunch.end) { if (lastPunch.end - b.at < 1) { lastPunch.end = r3(b.at); } else { dropped.push([b.type, b.anchor, 'overlaps a punch']); continue; } } if (b.type === 'punch') lastPunch = b; res.push(b); }
  return { plan: { ...plan, beats: res }, dropped };
}

/** agent plan + the transcript-grounded heuristic beats: verbatim quotes and stated contrasts win box conflicts
 * (prio 1), heuristic icon pops fill gaps > 4 s; cards that only repeat the title are dropped. */
export function mergePlans(agent, heur) {
  const t = norm(agent.title || '');
  const beats = (agent.beats || []).filter((b) => !(b.type === 'card' && t && norm(b.title || '') === t));
  for (const b of heur.beats || []) {
    if (b.type === 'quote' || b.type === 'compare') beats.push({ ...b, prio: 1 });
    if (b.type === 'punch') beats.push(b); // sentence-rhythm punch-ins; validation drops any that collide
  }
  return { ...agent, beats, heuristicPops: (heur.beats || []).filter((b) => b.type === 'icon' || b.type === 'stat') };
}

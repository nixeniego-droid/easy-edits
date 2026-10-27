// Shot lists for story / music-video: load a brief or shotlist.json, load characters.json, build each shot's
// prompt (character descriptions attached to every shot), split beats longer than the backend's maxClipSeconds,
// and pick each shot's source (generated video, generated still + Ken Burns, a code-drawn card, or user footage).
import fs from 'node:fs';
import path from 'node:path';
import { FPS, r3 } from './ffx.mjs';

/** xfade transitions we accept by name (plus "cut"); a few friendly aliases map onto them. */
export const TRANSITIONS = ['cut', 'fade', 'dissolve', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'slideup', 'slidedown', 'smoothleft', 'smoothright', 'circleopen', 'circleclose', 'radial', 'pixelize', 'zoomin'];
const ALIAS = { crossfade: 'fade', xfade: 'fade', 'dip-to-black': 'fadeblack', dip: 'fadeblack', whip: 'smoothleft', wipe: 'wipeleft', slide: 'slideleft', none: 'cut', hard: 'cut' };
export const SOURCES = ['video', 'still', 'card', 'clip'];

export const frames = (s) => Math.max(1, Math.round(s * FPS)) / FPS;   // seconds, on the 30 fps frame grid

export function normTransition(t) {
  const n = String(t || 'cut').toLowerCase().trim();
  const v = ALIAS[n] || n;
  if (!TRANSITIONS.includes(v)) throw new Error(`transition "${t}" not supported (use ${TRANSITIONS.join(', ')})`);
  return v;
}

/** characters.json: [{name, refs|references|images:[file], description}] or {characters:[...]}; ref paths resolve next to the file. */
export function loadCharacters(src) {
  if (!src) return [];
  let list = src, base = process.cwd();
  if (typeof src === 'string') { base = path.dirname(path.resolve(src)); list = JSON.parse(fs.readFileSync(src, 'utf8')); }
  if (!Array.isArray(list)) list = list.characters || [];
  return list.map((c, i) => {
    if (!c || !c.name) throw new Error(`characters[${i}] needs a name`);
    const refs = (c.refs || c.references || c.images || []).map((f) => path.resolve(base, f));
    for (const f of refs) if (!fs.existsSync(f)) throw new Error(`character "${c.name}": reference image not found: ${path.basename(f)}`);
    return { name: String(c.name), description: String(c.description || '').trim(), refs };
  });
}

const sentences = (t) => String(t).replace(/\r/g, '').split(/\n\s*\n|\n(?=\s*[-*\d])|(?<=[.!?])\s+(?=[A-Z0-9"'])/).map((s) => s.replace(/^\s*[-*]\s*|^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);

/**
 * Shots from a brief: one shot per sentence / bullet / paragraph, durations spread over `length` seconds (default
 * 4 s each). A character is attached to a shot when the sentence names them; with `narrate`, the sentence is also
 * the shot's narration.
 */
export function shotsFromBrief(text, { characters = [], length, shotSec = 4, narrate = false, transition = 'fade' } = {}) {
  const lines = sentences(text);
  if (!lines.length) throw new Error('the brief is empty');
  const d = length ? Number(length) / lines.length : shotSec;
  return lines.map((l, i) => ({
    id: `s${i + 1}`, durationSec: d, prompt: l,
    characters: characters.filter((c) => new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(l)).map((c) => c.name),
    camera: null, transition: i ? transition : 'cut', ...(narrate ? { narration: l } : {}),
  }));
}

/** Read --brief (a file or the text itself; a .json brief is a shotlist) / --shotlist into raw shots. */
export function loadShots({ brief, shotlist, characters = [], length, shotSec, narrate, transition } = {}) {
  let j = null;
  if (shotlist) j = typeof shotlist === 'string' ? JSON.parse(fs.readFileSync(shotlist, 'utf8')) : shotlist;
  else if (brief && typeof brief === 'string' && /\.json$/i.test(brief) && fs.existsSync(brief)) j = JSON.parse(fs.readFileSync(brief, 'utf8'));
  if (j) {
    const base = typeof shotlist === 'string' ? path.dirname(path.resolve(shotlist)) : process.cwd();
    const shots = Array.isArray(j) ? j : j.shots;
    if (!Array.isArray(shots) || !shots.length) throw new Error('shotlist has no shots[]');
    return { title: j.title || null, style: j.style || null, shots: shots.map((s, i) => ({ ...s, clip: s.clip ? path.resolve(base, s.clip) : undefined, id: String(s.id ?? `s${i + 1}`) })) };
  }
  if (brief == null) throw new Error('give a --brief (text or file) or a --shotlist shotlist.json');
  const text = typeof brief === 'string' && fs.existsSync(brief) ? fs.readFileSync(brief, 'utf8') : String(brief);
  return { title: null, style: null, shots: shotsFromBrief(text, { characters, length, shotSec, narrate, transition }) };
}

/** The prompt sent for a shot: style, the shot prompt, camera, then every attached character's description. */
export function shotPrompt(shot, characters, style) {
  const cs = (shot.characters || []).map((n) => characters.find((c) => c.name.toLowerCase() === String(n).toLowerCase())).filter(Boolean);
  const parts = [style, shot.prompt, shot.camera ? `Camera: ${shot.camera}` : null,
    cs.length ? `Characters (keep consistent across shots): ${cs.map((c) => (c.description ? `${c.name}: ${c.description}` : c.name)).join('; ')}` : null];
  return parts.filter(Boolean).map((p) => String(p).trim().replace(/[.\s]+$/, '')).join('. ') + '.';
}

/**
 * Normalise shots (ids, frame-grid durations, transitions, characters), then split every generated-video shot
 * longer than `maxClipSeconds` into equal parts (ids s3.1, s3.2, ...; hard cuts between parts; narration and
 * caption stay on the first part). Returns {shots, splits:[{from, into, reason}]}.
 */
export function normaliseShots(raw, { characters = [], maxClipSeconds = 0, source = 'card', style = null, transitionSec = 0.5 } = {}) {
  const ids = new Set(), shots = [], splits = [];
  for (const [i, s] of raw.entries()) {
    const id = String(s.id ?? `s${i + 1}`);
    if (ids.has(id)) throw new Error(`duplicate shot id ${id}`);
    ids.add(id);
    const d = Number(s.durationSec ?? s.duration ?? 4);
    if (!(d > 0)) throw new Error(`shot ${id}: durationSec must be > 0`);
    for (const n of s.characters || []) if (!characters.some((c) => c.name.toLowerCase() === String(n).toLowerCase())) throw new Error(`shot ${id}: character "${n}" is not in characters.json`);
    const src = s.clip ? 'clip' : (s.source && SOURCES.includes(s.source) ? s.source : source);
    if (s.clip && !fs.existsSync(s.clip)) throw new Error(`shot ${id}: clip not found: ${path.basename(s.clip)}`);
    const base = {
      id, prompt: String(s.prompt || s.description || ''), characters: (s.characters || []).map(String), camera: s.camera || null,
      transition: i ? normTransition(s.transition) : 'cut', transitionSec: Number(s.transitionSec ?? transitionSec),
      source: src, ...(s.clip ? { clip: s.clip, clipStart: Number(s.clipStart || 0) } : {}),
      ...(s.narration ? { narration: String(s.narration) } : {}), ...(s.caption ? { caption: String(s.caption) } : {}),
      ...(s.seed != null ? { seed: s.seed } : {}),
    };
    const n = src === 'video' && maxClipSeconds > 0 ? Math.ceil(d / maxClipSeconds - 1e-9) : 1;
    if (n <= 1) { shots.push({ ...base, durationSec: r3(frames(d)) }); continue; }
    const part = d / n, into = [];
    let used = 0;
    for (let k = 1; k <= n; k++) {
      const pd = k < n ? frames(part) : frames(d - used);
      used += pd;
      const pid = `${id}.${k}`; into.push(pid);
      shots.push({
        ...base, id: pid, splitFrom: id, part: k, parts: n, durationSec: r3(pd),
        prompt: `${base.prompt} (one continuous shot, part ${k} of ${n})`,
        transition: k === 1 ? base.transition : 'cut',
        ...(k > 1 ? { narration: undefined, caption: undefined } : {}),
      });
    }
    splits.push({ from: id, into, reason: `${r3(d)} s beat > backend maxClipSeconds ${maxClipSeconds}` });
  }
  let nf = 0;   // whole frames, so starts and the total never drift from float rounding
  for (const s of shots) {
    s.start = r3(nf / FPS); nf += Math.round(s.durationSec * FPS);
    s.fullPrompt = shotPrompt(s, characters, style);
    s.refs = (s.characters || []).flatMap((n) => characters.find((c) => c.name.toLowerCase() === n.toLowerCase())?.refs || []);
    for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];
  }
  return { shots, splits, total: r3(nf / FPS) };
}

/** Caption cues for a span of text: chunks of <= 7 words, time shared by word count. */
export function textCues(text, start, dur, { maxWords = 7 } = {}) {
  const w = String(text).split(/\s+/).filter(Boolean);
  if (!w.length || !(dur > 0)) return [];
  const chunks = [];
  for (let i = 0; i < w.length; i += maxWords) chunks.push(w.slice(i, i + maxWords));
  let t = start;
  return chunks.map((c) => { const d = dur * (c.length / w.length); const cue = { start: r3(t), end: r3(t + d), text: c.join(' ') }; t += d; return cue; });
}

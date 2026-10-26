// Recipe registry for `easy-edits new <type>`.
// A recipe is { name, description, keywords?, defaults?: { length:[min,max], loudness:'social'|'podcast' },
//               plan(opts) -> { shots[], voice?[], title?, options?, notes?, finish? },
//               render(plan, ctx) -> { outputs[], captions[], weakShots[], sources?[], credits?[], notes?[] },
//               preview?(shot, plan, out, work) -> png (storyboard cell for a code-drawn scene) }
// Built-in generic recipes cover every type so each one renders end to end; a file in ./recipes/<name>.mjs whose
// default export (or `recipe` export) has the same name replaces the built-in (workstreams register there).
// A file with a `recipe` export registers that one only, so its default export can stay the pipeline's own
// interface (the standalone runners and their tests use it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderShots, voiceSegments } from './render.mjs';
import { synthBed } from './assemble.mjs';

export const TYPES = ['explainer-cited', 'presenter', 'podcast', 'story', 'promo', 'music-video', 'other'];
const registry = new Map();
const HERE = path.dirname(fileURLToPath(import.meta.url));

export function registerRecipe(r) {
  if (!r?.name || typeof r.plan !== 'function' || typeof r.render !== 'function') throw new Error('a recipe needs { name, plan(opts), render(plan, ctx) }');
  registry.set(r.name, r);
  return r;
}
export const getRecipe = (name) => registry.get(name) || null;
export const listRecipes = () => [...registry.values()];

let loaded = false;
/** Load ./recipes/*.mjs once (sorted, so overrides are deterministic). */
export async function loadRecipes(dir = path.join(HERE, 'recipes')) {
  if (loaded) return listRecipes();
  loaded = true;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
      const m = await import(pathToFileURL(path.join(dir, f)).href);
      for (const r of new Set([m.recipe || m.default, ...(m.recipes || [])].filter(Boolean))) registerRecipe(r);
    }
  }
  return listRecipes();
}

/** "other": score the brief against each recipe's keywords; the best match wins (ties: registry order). */
export function mapBrief(brief) {
  const text = ` ${String(brief || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  let best = null;
  for (const r of listRecipes()) {
    const matched = (r.keywords || []).filter((k) => text.includes(` ${k.toLowerCase()} `) || text.includes(` ${k.toLowerCase()}s `));
    if (matched.length && (!best || matched.length > best.matched.length)) best = { recipe: r.name, matched };
  }
  return best || { recipe: 'explainer-cited', matched: [] };
}

/** Script lines: "A: text" / "Name: text" speaker tags (optional), blank lines and # comments skipped. */
export function parseScript(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z][\w .'-]{0,23}):\s+(.+)$/);
    out.push(m ? { speaker: m[1].trim(), text: m[2].trim() } : { speaker: null, text: line });
  }
  return out;
}

/** Narration lines from --script FILE, else the --brief split into sentences. */
export function narrationLines(o) {
  if (o.script) return parseScript(fs.readFileSync(o.script, 'utf8'));
  if (o.brief) return String(o.brief).split(/(?<=[.!?])\s+/).map((t) => t.trim()).filter(Boolean).map((text) => ({ speaker: null, text }));
  return [];
}

export const WPS = 2.5;   // words per second for planning (mock / Kokoro pace)
export const estSec = (text) => Math.max(1.2, String(text).split(/\s+/).filter(Boolean).length / WPS);

/**
 * Generic narrated recipe: one voice line per script line, one or more shots per line.
 * shotSource: 'generate' | 'still' | 'code' | 'avatar' | 'mixed' (code title, then stills).
 */
function narrated({ name, description, keywords, shotSource, defaults = {} }) {
  return {
    name, description, keywords, defaults,
    plan(o) {
      const lines = narrationLines(o);
      if (!lines.length) throw new Error(`new ${name}: needs --script FILE (one line per beat; "A: ..." speaker tags allowed) or --brief "..."`);
      const notes = [];
      const vcap = o.caps('video'), acap = o.caps('avatar');
      const fallback = (src) => {
        if (src === 'avatar' && !o.canGen('avatar')) { note('no avatar backend: presenter shots fall back to generated video'); src = 'generate'; }
        if (src === 'generate' && !o.canGen('video')) { note('no video backend: generated shots fall back to stills'); src = 'still'; }
        if (src === 'still' && !o.canGen('image')) { note('no image backend: stills fall back to code-drawn cards'); src = 'code'; }
        return src;
      };
      const note = (n) => { if (!notes.includes(n)) notes.push(n); };
      const silent = !o.canGen('tts');
      if (silent) note('no TTS backend: the script runs as timed on-screen captions over a code-synthesised music bed');
      const shots = [], voice = [];
      lines.forEach((l, i) => {
        const vid = `v${i + 1}`;
        voice.push({ id: vid, speaker: l.speaker, text: l.text, voice: o.voice || null, ...(silent ? { silent: true } : {}) });
        let src = shotSource === 'mixed' ? (i === 0 ? 'code' : 'still') : shotSource;
        src = fallback(src);
        const d = estSec(l.text) + 0.3;
        const max = src === 'generate' ? (vcap.maxClipSeconds || 8) : src === 'avatar' ? (acap.maxClipSeconds || 8) : 99;
        const parts = src === 'avatar' ? 1 : Math.max(1, Math.ceil(d / max));
        for (let k = 0; k < parts; k++) {
          const sh = {
            id: parts > 1 ? `s${i + 1}${'abcdefgh'[k]}` : `s${i + 1}`, durationSec: Number((d / parts).toFixed(2)),
            source: src === 'avatar' ? 'generate' : src, prompt: `${o.stylePrompt ? `${o.stylePrompt}. ` : ''}${l.text}`,
            refs: [], camera: src === 'still' ? 'push' : 'static', transition: i === 0 && k === 0 ? 'cut' : 'fade', voice: vid,
          };
          if (src === 'avatar') Object.assign(sh, { kind: 'avatar', likeness: 'fictional', prompt: `fictional host reads: ${l.text}` });
          if (src === 'code') sh.scene = { title: i === 0 && o.title ? o.title : l.text };
          shots.push(sh);
        }
      });
      if (shots.length > parts0(shots)) notes.push('beats longer than the backend clip limit were split into several shots');
      return { title: o.title || null, shots, voice, notes, options: { synthetic: shotSource === 'avatar' } };
    },
    async render(plan, ctx) {
      const segments = await voiceSegments(plan, ctx);
      const silent = segments.length && segments.every((sg) => sg.silent);
      const bed = silent ? (total) => ({ file: synthBed(path.join(ctx.work, 'bed.wav'), { dur: total, logFile: ctx.logFile }), db: 0 }) : null;
      const res = await renderShots(plan, ctx, { segments, bed });
      if (plan.options?.synthetic) res.notes = ['presenter is a synthetic (fictional, generated) host'];
      return res;
    },
  };
}
const parts0 = (shots) => new Set(shots.map((s) => s.voice)).size;

registerRecipe(narrated({ name: 'explainer-cited', description: 'cited explainer: code title + stills under a narrated script (zero video generations)', keywords: ['explain', 'explainer', 'how', 'why', 'facts', 'research', 'sources', 'cited', 'citation', 'guide', 'tutorial', 'lesson', 'learn'], shotSource: 'mixed', defaults: { length: [30, 120] } }));
registerRecipe(narrated({ name: 'presenter', description: 'presenter short: a fictional generated host reads the script', keywords: ['presenter', 'host', 'avatar', 'spokesperson', 'anchor', 'talking', 'face'], shotSource: 'avatar', defaults: { length: [15, 90] } }));
registerRecipe(narrated({ name: 'story', description: 'multi-shot story: one generated clip per beat, narrated', keywords: ['story', 'tale', 'character', 'narrative', 'film', 'scene', 'adventure', 'fairy'], shotSource: 'generate' }));

registerRecipe({
  name: 'music-video', description: 'music video: your own song (--song FILE --i-own-this-music) sets the length; one generated clip per ~4 s',
  keywords: ['music', 'song', 'lyrics', 'beat', 'track', 'band', 'singer', 'album'],
  plan(o) {
    if (!o.song) throw new Error('new music-video: needs --song FILE (a track you own) and --i-own-this-music');
    if (!o.iOwnThisMusic) throw new Error('new music-video: --song needs --i-own-this-music (only music you own or have licensed)');
    const len = o.probeSec(o.song);
    if (!(len > 0)) throw new Error(`new music-video: can't read the length of ${o.song}`);
    const vcap = o.caps('video');
    const src = vcap.maxClipSeconds ? 'generate' : 'still';
    const per = Math.min(4, vcap.maxClipSeconds || 4);
    const n = Math.max(1, Math.round(len / per));
    const base = o.brief || o.title || 'abstract light and motion';
    const shots = Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, durationSec: Number((len / n + (i ? 0.4 : 0)).toFixed(2)), source: src, prompt: `${base}, shot ${i + 1} of ${n}`, refs: [], camera: 'static', transition: i ? 'fade' : 'cut' }));
    return { title: o.title || null, shots, voice: [], notes: src === 'still' ? ['no video backend: shots fall back to stills'] : [], options: { song: o.song, ownership: 'attested with --i-own-this-music' }, length: [Math.floor(len), Math.ceil(len)] };
  },
  async render(plan, ctx) {
    const total = ctx.probeSec(plan.options.song);
    const pre = path.join(ctx.work, 'song.wav');
    ctx.ff(['-i', plan.options.song, '-vn', '-ac', '2', '-ar', '48000', '-t', total.toFixed(3), pre], 'song decode');
    const res = await renderShots(plan, ctx, { total, pre });
    res.credits = [`song: ${path.basename(plan.options.song)} (supplied by the user; ownership ${plan.options.ownership})`];
    return res;
  },
});

// AI Video Editor style packs: one JSON file per editing style (palette, fonts, caption look, motion, pacing, allowed
// scenes, sound). Built-in packs: ai-video-editor/styles/packs/<id>.json; your own: ~/.ai-video-editor/styles/<id>.json
// (AI_VIDEO_EDITOR_STYLES) or any path. Schema: ai-video-editor/styles/pack.schema.json, checked here by a small
// dependency-free validator (the subset of JSON Schema the schema uses) plus the rules a schema can't say
// (font weights the font has, readable palette contrast, punchZoom order).
//   loadPack(ref)              -> the validated pack, or throws StyleError listing every problem
//   checkRequest(pack, req)    -> [] or the reasons this render can't use the pack (mode, format, --plan beats, flags)
//   stylePlan(plan, pack, dur) -> {plan, dropped}: planner beats the pack doesn't allow left out, pacing applied
//   listPacks()                -> every pack found, valid or not
import './env-compat.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { contrastRatio } from './contrast.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACK_DIR = path.resolve(HERE, '../styles/packs');
export const SCHEMA_FILE = path.resolve(HERE, '../styles/pack.schema.json');
export const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
/** every font family a pack may use (install.sh installs them all) */
export const FONT_FAMILIES = [...SCHEMA.$defs.font.properties.family.enum];
export const userDir = () => process.env.AI_VIDEO_EDITOR_STYLES || path.join(process.env.AI_VIDEO_EDITOR_HOME || path.join(process.env.HOME || os.homedir(), '.ai-video-editor'), 'styles');
/** weight range of each font ./install.sh installs (variable fonts). */
export const FONT_WEIGHTS = { Montserrat: [100, 900], 'Playfair Display': [400, 900], 'JetBrains Mono': [100, 800] };
/** beat types that are top boxes / pops (engine/plan.mjs). */
const POPS = new Set(['icon', 'stat']);

export class StyleError extends Error {
  constructor(message, errors = []) { super(message); this.name = 'StyleError'; this.errors = errors; }
}

// ---------- JSON Schema subset ----------
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);
const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
const deref = (s, root) => (s?.$ref ? s.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], root) : s);

/** errors [{path, message}] of `value` against `schema` (keywords: type enum const pattern minimum maximum minLength
 * maxLength minItems maxItems uniqueItems items properties required additionalProperties oneOf $ref; x-error = the
 * message to show instead of the raw rule). */
export function schemaErrors(value, schema = SCHEMA, root = SCHEMA, at = '') {
  const s = deref(schema, root), errs = [], here = at || '(pack)';
  const fail = (message) => errs.push({ path: here, message: s['x-error'] || message });
  if (s.oneOf) {
    const ok = s.oneOf.filter((b) => !schemaErrors(value, b, root, at).length).length;
    if (ok !== 1) fail(`must match exactly one of ${s.oneOf.length} forms`);
    return errs;
  }
  if ('const' in s && value !== s.const) { fail(`must be ${show(s.const)} (got ${show(value)})`); return errs; }
  if (s.enum && !s.enum.includes(value)) { fail(`${show(value)} is not supported (supported: ${s.enum.join(', ')})`); return errs; }
  if (s.type) {
    const ts = [].concat(s.type);
    if (!ts.some((t) => isType(value, t))) { fail(`must be ${ts.map((t) => (t === 'integer' ? 'a whole number' : t === 'null' ? 'null' : `a${/^[aeiou]/.test(t) ? 'n' : ''} ${t}`)).join(' or ')} (got ${typeOf(value)})`); return errs; }
  }
  if (typeof value === 'string') {
    if (s.minLength != null && value.length < s.minLength) fail(`is too short (at least ${s.minLength} characters)`);
    if (s.maxLength != null && value.length > s.maxLength) fail(`is too long (at most ${s.maxLength} characters)`);
    if (s.pattern && !new RegExp(s.pattern).test(value)) fail(`${show(value)} does not match ${s.pattern}`);
  }
  if (typeof value === 'number') {
    if (s.minimum != null && value < s.minimum) fail(`${value} is below the minimum ${s.minimum}`);
    if (s.maximum != null && value > s.maximum) fail(`${value} is above the maximum ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems != null && value.length < s.minItems) fail(`needs at least ${s.minItems} item(s)`);
    if (s.maxItems != null && value.length > s.maxItems) fail(`takes at most ${s.maxItems} item(s)`);
    if (s.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) fail('has duplicate items');
    if (s.items) value.forEach((v, i) => errs.push(...schemaErrors(v, s.items, root, `${at}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = s.properties || {};
    for (const k of s.required || []) if (!(k in value)) errs.push({ path: at ? `${at}.${k}` : k, message: 'is required' });
    for (const [k, v] of Object.entries(value)) {
      const p = at ? `${at}.${k}` : k;
      if (props[k]) errs.push(...schemaErrors(v, props[k], root, p));
      else if (s.additionalProperties === false) errs.push({ path: p, message: `unknown key: packs don't support it (allowed here: ${Object.keys(props).join(', ')})` });
    }
  }
  return errs;
}

/** rules beyond the schema (only checked once the schema passes). */
function packRules(p) {
  const errs = [], e = (pth, message) => errs.push({ path: pth, message });
  for (const role of ['display', 'body', 'numbers']) {
    const f = p.fonts[role], [lo, hi] = FONT_WEIGHTS[f.family];
    if (f.weight < lo || f.weight > hi) e(`fonts.${role}.weight`, `${f.family} has weights ${lo}-${hi} (got ${f.weight})`);
  }
  const cf = p.fonts[p.captions.font].family, [lo, hi] = FONT_WEIGHTS[cf];
  if (p.captions.weight < lo || p.captions.weight > hi) e('captions.weight', `the caption font ${cf} has weights ${lo}-${hi} (got ${p.captions.weight})`);
  const P = p.palette, need = (a, b, min, pth) => { const c = contrastRatio(P[a], P[b]); if (c < min) e(pth, `${a} ${P[a]} on ${b} ${P[b]} has contrast ${c.toFixed(2)}:1, below ${min}:1 (hard to read)`); };
  need('text', 'background', 4.5, 'palette.text');
  need('text', 'surface', 4.5, 'palette.text');
  need('onAccent', 'accent', 4.5, 'palette.onAccent');
  if (p.pacing.punchZoom[0] > p.pacing.punchZoom[1]) e('pacing.punchZoom', `[min, max]: ${p.pacing.punchZoom[0]} is above ${p.pacing.punchZoom[1]}`);
  return errs;
}

/** {ok, errors: ['path: message']} for a parsed pack. */
export function validatePack(pack) {
  let errs = schemaErrors(pack);
  if (!errs.length) errs = packRules(pack);
  return { ok: !errs.length, errors: errs.map((x) => `${x.path}: ${x.message}`) };
}

/** a pack reference (id, or a path to a .json) -> {file, builtin}; throws StyleError when nothing matches. */
export function resolvePack(ref) {
  if (!ref || ref === true) throw new StyleError(`--style needs a pack: ${builtinIds().join(', ')} or a path to a pack .json`);
  const s = String(ref);
  if (s.endsWith('.json') || s.includes('/') || s.includes(path.sep)) {
    const f = path.resolve(s);
    if (!fs.existsSync(f)) throw new StyleError(`style pack file not found: ${f}`);
    return { file: f, builtin: path.dirname(f) === PACK_DIR };
  }
  for (const [dir, builtin] of [[userDir(), false], [PACK_DIR, true]]) {
    const f = path.join(dir, `${s}.json`);
    if (fs.existsSync(f)) return { file: f, builtin };
  }
  throw new StyleError(`unknown style "${s}" (built-in: ${builtinIds().join(', ')}; yours go in ${userDir()}/<id>.json, or pass a path to a pack .json; \`ai-video-editor style list\`)`);
}

export const builtinIds = () => fs.readdirSync(PACK_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();

/** read + validate; throws StyleError (message lists every problem) when the pack is broken. */
export function loadPack(ref) {
  const { file, builtin } = resolvePack(ref);
  let pack;
  try { pack = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new StyleError(`style pack ${file} is not valid JSON: ${e.message}`); }
  const v = validatePack(pack);
  if (!v.ok) throw new StyleError(`style pack ${file} is invalid (${v.errors.length} problem${v.errors.length > 1 ? 's' : ''}):\n${v.errors.map((x) => `  - ${x}`).join('\n')}`, v.errors);
  return { ...pack, file, builtin };
}

/** every pack in the built-in and user folders: [{id, name, description, file, builtin, ok, errors}] */
export function listPacks() {
  const out = [];
  for (const [dir, builtin] of [[PACK_DIR, true], [userDir(), false]]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const file = path.join(dir, f);
      let p = null, v;
      try { p = JSON.parse(fs.readFileSync(file, 'utf8')); v = validatePack(p); } catch (e) { v = { ok: false, errors: [`not valid JSON: ${e.message}`] }; }
      out.push({ id: p?.id || f.replace(/\.json$/, ''), name: p?.name || '?', description: p?.description || '', file, builtin, ok: v.ok, errors: v.errors });
    }
  }
  return out;
}

/** macOS font folders Chrome reads through CoreText (install.sh puts the fonts in the first one). */
export const MAC_FONT_DIRS = [path.join(os.homedir(), 'Library/Fonts'), '/Library/Fonts'];
/** the exact file ./install.sh installs for each family; its macOS doctor checks the same names (a test keeps them in sync). */
export const FONT_FILES = { Montserrat: 'Montserrat[wght].ttf', 'Playfair Display': 'PlayfairDisplay[wght].ttf', 'JetBrains Mono': 'JetBrainsMono[wght].ttf' };
/**
 * Families whose FONT_FILES file is in one of `dirs` (exact name: "MontserratAlternates-Bold.otf" is not Montserrat):
 * macOS has no fc-list of its own, and a Homebrew fc-list may not index ~/Library/Fonts.
 */
export function fontsInDirs(families, dirs = MAC_FONT_DIRS) {
  return new Set(families.filter((fam) => FONT_FILES[fam] && dirs.some((d) => fs.existsSync(path.join(d, FONT_FILES[fam])))));
}
/**
 * Font families installed for Chrome: fontconfig on Linux; on macOS, fontconfig (when present) plus the font
 * folders Chrome reads. null when nothing can tell (Linux without fc-list: not checkable).
 */
export function installedFonts({ platform = process.platform, families = FONT_FAMILIES, dirs = MAC_FONT_DIRS } = {}) {
  const r = spawnSync('fc-list', [':', 'family'], { encoding: 'utf8' });
  const fc = r.status === 0 ? r.stdout.split('\n').flatMap((l) => l.split(',')).map((x) => x.trim()).filter(Boolean) : null;
  if (platform !== 'darwin') return fc && new Set(fc);
  return new Set([...(fc || []), ...fontsInDirs(families, dirs)]);
}
/** pack font families that are not installed ([] when they all are, or fontconfig can't tell). */
export function missingFonts(pack, have = installedFonts()) {
  if (!have) return [];
  return [...new Set(Object.values(pack.fonts).map((f) => f.family))].filter((f) => !have.has(f));
}

/**
 * Can this render use the pack? req: {mode, formats, planBeats (beats of a --plan FILE), hook, speaker,
 * lowerThirds (shorts --speaker-at / --people), graphics}. Returns [] or the reasons (each a full sentence).
 */
export function checkRequest(pack, req) {
  const errs = [], allow = new Set(pack.scenes), id = pack.id;
  if (req.mode === 'clean-cut') errs.push(`clean-cut keeps the approved caption look and doesn't take --style; use captions, talking-head, explainer or shorts with --style ${id}`);
  else if (req.mode && !pack.modes.includes(req.mode)) errs.push(`style "${id}" doesn't support mode ${req.mode} (it supports: ${pack.modes.join(', ')})`);
  const badF = (req.formats || []).filter((f) => !pack.formats.includes(f));
  if (badF.length) errs.push(`style "${id}" doesn't support format ${badF.join(', ')} (it supports: ${pack.formats.join(', ')})`);
  const badB = (req.planBeats || []).map((b, i) => ({ b, i })).filter(({ b }) => b?.type && !allow.has(b.type));
  if (badB.length) errs.push(`the --plan has beat(s) style "${id}" doesn't allow: ${badB.map(({ b, i }) => `#${i} ${b.type}${b.anchor ? ` ("${b.anchor}")` : ''}`).join(', ')} (allowed: ${pack.scenes.join(', ')}); remove them or pick another style`);
  if (req.hook && !allow.has('hook')) errs.push(`style "${id}" has no hook card; drop --hook or pick a style with "hook" in its scenes`);
  if ((req.speaker || req.lowerThirds) && !allow.has('lower-third')) errs.push(`style "${id}" has no lower third; drop --speaker / --people or pick a style with "lower-third" in its scenes`);
  if (req.graphics && !['punch', 'icon', 'stat', 'quote', 'list', 'compare', 'card'].some((t) => allow.has(t))) errs.push(`style "${id}" allows no graphics beats; drop --graphics`);
  return errs;
}

/**
 * The plan as the pack allows it (validated beats with at / end): beats of a type the pack doesn't list are left out,
 * pops and punch-ins keep pacing.minBeatGap from each other, no 60 s window holds more than pacing.maxBeatsPerMinute
 * beats, and punch zooms stay inside pacing.punchZoom. Returns {plan, dropped: [[type, at, reason]]}.
 */
export function stylePlan(plan, pack) {
  if (!pack || !plan?.beats) return { plan, dropped: [] };
  const allow = new Set(pack.scenes), P = pack.pacing, dropped = [], kept = [];
  let lastLight = -Infinity;
  for (const b of [...plan.beats].sort((x, y) => x.at - y.at)) {
    if (!allow.has(b.type)) { dropped.push([b.type, b.at, `style ${pack.id} doesn't use ${b.type}`]); continue; }
    const light = POPS.has(b.type) || b.type === 'punch';
    if (light && b.at - lastLight < P.minBeatGap) { dropped.push([b.type, b.at, `under ${P.minBeatGap} s after the last pop / punch (style ${pack.id} pacing)`]); continue; }
    if (kept.filter((k) => k.at > b.at - 60).length >= P.maxBeatsPerMinute) { dropped.push([b.type, b.at, `over ${P.maxBeatsPerMinute} beats a minute (style ${pack.id} pacing)`]); continue; }
    const nb = b.type === 'punch' && b.zoom != null ? { ...b, zoom: Math.min(P.punchZoom[1], Math.max(P.punchZoom[0], b.zoom)) } : b;
    kept.push(nb);
    if (light) lastLight = b.at;
  }
  return { plan: { ...plan, beats: kept }, dropped };
}

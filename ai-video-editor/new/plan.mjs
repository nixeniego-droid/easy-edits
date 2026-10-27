// plan.json for `ai-video-editor new`: schema helpers, generation count, cost / wall-time estimate, "will send" lines,
// PLAN.txt, and the sha256 pin that the approval gate checks.
//
// plan.json (owned by workstream B; recipes add their own fields under `options` / per shot):
// {
//   "version": 1, "type": "promo", "recipe": "promo", "title": "...", "brief": "...",
//   "mapping": { "from": "other", "recipe": "promo", "matched": ["launch"], "brief": "..." }   // type other only
//   "formats": [{ "id": "9x16", "w": 1080, "h": 1920 }], "fps": 30,
//   "length": [15, 15] | null,                                // --length S or MIN-MAX (checked at delivery)
//   "finish": { "name": "social", "target": -14, "truePeak": -1.5 },
//   "backend": "mock", "offline": false,
//   "shots": [{ "id": "s1", "durationSec": 3, "source": "generate|still|code|user", "kind": "video|image|avatar",
//               "prompt": "...", "refs": [], "camera": "static", "transition": "fade", "file": "...", "scene": {...} }],
//   "voice": [{ "id": "v1", "speaker": "A", "text": "...", "voice": "..." }],     // one TTS generation per line
//   "assets": [{ "id": "host", "kind": "image", "prompt": "..." }],   // generations that are not shots (a presenter's host)
//   "backends": { "video": "host", "image": "host", "tts": "local", "avatar": "local", "llm": "none", "search": "none" },
//   "options": { ... recipe options ... },
//   "generations": { "video": 0, "image": 0, "tts": 0, "avatar": 0, "total": 0 },
//   "estimate": { "cost": 0, "wallSec": 12 }, "willSend": ["..."]
// }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getBackend } from '../gen/index.mjs';
import { backendOf } from './hostflow.mjs';

export const SOURCES = ['generate', 'still', 'code', 'user'];
export const PLAN_VERSION = 1;
// rough seconds per call when the backend does not say (capabilities.secondsPerCall overrides)
const CALL_SEC = { host: { video: 0, image: 0, tts: 0, avatar: 0 }, local: { video: 90, image: 12, tts: 4, avatar: 60 }, network: { video: 120, image: 15, tts: 5, avatar: 90 }, mock: { video: 1, image: 0.5, tts: 0.5, avatar: 1 } };

/** The generation kind a shot needs, or null (code-drawn, user footage, a user still). */
export function shotKind(s) {
  if (s.source === 'generate') return s.kind === 'avatar' ? 'avatar' : 'video';
  if (s.source === 'still') return s.file ? null : 'image';
  return null;
}

/** Validate shots[] in place (ids, durations, sources); throws with every problem listed. */
export function checkShots(shots) {
  const bad = [];
  if (!Array.isArray(shots) || !shots.length) bad.push('shots[] is empty');
  const ids = new Set();
  (shots || []).forEach((s, i) => {
    const at = `shots[${i}]`;
    if (!s.id) s.id = `s${i + 1}`;
    if (ids.has(s.id)) bad.push(`${at}: duplicate id ${s.id}`); ids.add(s.id);
    if (!(Number(s.durationSec) > 0)) bad.push(`${at}: durationSec must be > 0`);
    if (!SOURCES.includes(s.source)) bad.push(`${at}: source must be one of ${SOURCES.join(' | ')}`);
    if (s.source === 'user' && !s.file) bad.push(`${at}: a user shot needs "file"`);
    if (s.file && !fs.existsSync(s.file)) bad.push(`${at}: missing file ${s.file}`);
    s.refs = s.refs || []; s.camera = s.camera || 'static'; s.transition = s.transition || 'fade';
    s.prompt = s.prompt || '';
  });
  if (bad.length) throw new PlanError(`plan problems:\n${bad.map((b) => `  - ${b}`).join('\n')}`);
  return shots;
}

export class PlanError extends Error { constructor(m) { super(m); this.name = 'PlanError'; } }

export function countGenerations(plan) {
  const g = { video: 0, image: 0, tts: 0, avatar: 0 };
  for (const s of plan.shots) { const k = shotKind(s); if (k) g[k]++; }
  for (const a of plan.assets || []) if (g[a.kind] != null) g[a.kind]++;
  g.tts = (plan.voice || []).filter((v) => !v.silent).length;
  g.total = g.video + g.image + g.tts + g.avatar;
  return g;
}

const backendFor = (kind, name) => { try { return getBackend(kind, { name }); } catch { return null; } };

/** Cost and wall time from each backend's capabilities (costPerCall, secondsPerCall?, network). */
export function estimate(plan) {
  let cost = 0, wall = 0;
  const g = plan.generations;
  for (const kind of ['video', 'image', 'tts', 'avatar']) {
    if (!g[kind]) continue;
    const b = backendFor(kind, backendOf(plan, kind));
    const caps = b?.capabilities || {};
    cost += g[kind] * (Number(caps.costPerCall) || 0);
    const per = Number(caps.secondsPerCall) || CALL_SEC[b?.name === 'mock' ? 'mock' : caps.host ? 'host' : caps.network ? 'network' : 'local'][kind];
    wall += g[kind] * per;
  }
  const len = plan.shots.reduce((a, s) => a + s.durationSec, 0);
  wall += plan.formats.length * (4 + len * 0.6);   // conform + assemble + master per format
  return { cost: Math.round(cost * 100) / 100, wallSec: Math.round(wall) };
}

/** "will send: ..." lines for every network backend the plan uses (prompts, reference media, script text). */
export function willSend(plan) {
  const lines = [];
  const g = plan.generations;
  for (const kind of ['video', 'image', 'tts', 'avatar']) {
    if (!g[kind]) continue;
    const b = backendFor(kind, backendOf(plan, kind));
    if (!b?.capabilities?.network) continue;
    const shots = plan.shots.filter((s) => shotKind(s) === kind);
    const refs = shots.reduce((a, s) => a + (s.refs || []).length, 0);
    if (kind === 'tts') lines.push(`will send: ${g.tts} script line(s) (${(plan.voice || []).filter((v) => !v.silent).reduce((a, v) => a + v.text.split(/\s+/).length, 0)} words) to ${b.name} (tts)`);
    else if (kind === 'avatar') lines.push(`will send: ${g.avatar} voice clip(s)${refs ? ` + ${refs} reference image(s)` : ''} to ${b.name} (avatar)`);
    else lines.push(`will send: ${shots.length} prompt(s)${refs ? ` + ${refs} reference image(s)` : ''} to ${b.name} (${kind})`);
  }
  return lines;
}

export const usesNetwork = (plan) => willSend(plan).length > 0;

/** Fill the derived fields (generation count, estimate, will-send) after a recipe planned or a user edited shots. */
export function finalizePlan(plan) {
  plan.version = PLAN_VERSION;
  checkShots(plan.shots);
  plan.voice = (plan.voice || []).map((v, i) => ({ id: v.id || `v${i + 1}`, ...v }));
  plan.generations = countGenerations(plan);
  plan.estimate = estimate(plan);
  plan.willSend = willSend(plan);
  return plan;
}

/** Budget / offline refusals (exit 2 in the CLI); [] when the plan may run. */
export function gateProblems(plan, { maxGenerations = null, offline = false } = {}) {
  const bad = [];
  const g = plan.generations;
  if (maxGenerations != null && g.total > maxGenerations) bad.push(`the plan needs ${g.total} generations (${g.video} video, ${g.image} image, ${g.tts} TTS${g.avatar ? `, ${g.avatar} avatar` : ''}) but --max-generations is ${maxGenerations}`);
  if (offline && plan.willSend.length) bad.push(`--offline: backend "${plan.backend}" needs the network (${plan.willSend.join('; ')})`);
  return bad;
}

const fmtSec = (s) => (s >= 90 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s} s`);
const short = (t, n = 70) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}...` : s; };

/** Image / video generations that go to the host backend (the driving assistant) in this plan. */
export function hostCount(plan) {
  let n = 0;
  for (const kind of ['video', 'image']) if (plan.generations?.[kind] && backendFor(kind, backendOf(plan, kind))?.capabilities?.host) n += plan.generations[kind];
  return n;
}

export function planText(plan, { planFile, approveCmd } = {}) {
  const g = plan.generations;
  const L = [];
  L.push(`generations: ${g.video + g.avatar} video, ${g.image} image, ${g.tts} TTS${g.avatar ? ` (${g.avatar} of the video are avatar clips)` : ''}`);
  L.push(`estimated cost: $${plan.estimate.cost.toFixed(2)} (backend "${plan.backend}" costPerCall)`);
  L.push(`estimated wall time: ${fmtSec(plan.estimate.wallSec)}${hostCount(plan) ? ' plus the time your assistant takes to generate the host assets' : ''}`);
  if (hostCount(plan)) L.push(`host generation: ${hostCount(plan)} asset(s) are made by your assistant's built-in image/video generation after approval (GENERATION_MANIFEST.json, then ai-video-editor resume)`);
  if (plan.willSend.length) L.push(...plan.willSend); else L.push('will send: nothing (no network backend in this plan)');
  L.push('');
  L.push(`type: ${plan.mapping ? `other -> ${plan.recipe} (${plan.mapping.matched.length ? `matched: ${plan.mapping.matched.join(', ')}` : 'no keyword matched; default recipe'})` : plan.type}`);
  if (plan.title) L.push(`title: ${plan.title}`);
  if (plan.brief) L.push(`brief: ${short(plan.brief, 200)}`);
  L.push(`formats: ${plan.formats.map((f) => (f.id === `${f.w}x${f.h}` ? f.id : `${f.id} (${f.w}x${f.h})`)).join(', ')}, ${plan.fps} fps, BT.709`);
  L.push(`finish: ${plan.finish.name} ${plan.finish.target} LUFS / ${plan.finish.truePeak} dBTP${plan.options?.audioOnly ? ' (audio only: WAV + MP3)' : ''}`);
  if (plan.length) L.push(`length target: ${plan.length[0] === plan.length[1] ? plan.length[0] : plan.length.join('-')} s`);
  L.push(`planned length: ${plan.shots.reduce((a, s) => a + s.durationSec, 0).toFixed(1)} s in ${plan.shots.length} shot(s)`);
  L.push('');
  L.push('shots');
  for (const [i, s] of plan.shots.entries()) {
    const src = s.source === 'still' && s.file ? 'still (your image)' : s.source === 'user' ? 'user footage' : s.source === 'code' ? 'code-drawn' : s.source === 'generate' ? `generated ${s.kind === 'avatar' ? 'avatar' : 'video'}` : 'generated still';
    L.push(`  ${String(i + 1).padStart(2)}. ${s.id}  ${s.durationSec.toFixed(1)} s  ${src}  ${s.transition}${s.camera !== 'static' ? `  camera ${s.camera}` : ''}`);
    if (s.prompt) L.push(`      ${short(s.prompt, 110)}`);
  }
  if ((plan.voice || []).length) {
    L.push('', 'voice');
    for (const v of plan.voice) L.push(`  ${v.id}  ${v.label || v.speaker || 'narrator'}: ${short(v.text, 100)}`);
  }
  if (plan.notes?.length) { L.push('', 'notes'); for (const n of plan.notes) L.push(`  - ${n}`); }
  L.push('');
  L.push('Nothing has been generated yet. Review this plan and storyboard.png, then approve it:');
  if (approveCmd) L.push(`  ${approveCmd}`);
  L.push(`Edited ${planFile ? path.basename(planFile) : 'plan.json'}? Re-pin it first: ai-video-editor new repin ${planFile || 'plan.json'}`);
  return `${L.join('\n')}\n`;
}

export const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** Write plan.json + plan.json.sha256 (sha256sum format, so `sha256sum -c` works too). */
export function pinPlan(plan, planFile) {
  fs.mkdirSync(path.dirname(planFile), { recursive: true });
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  const h = sha256File(planFile);
  fs.writeFileSync(`${planFile}.sha256`, `${h}  ${path.basename(planFile)}\n`);
  return h;
}

/** The approval check: plan.json must match the hash pinned next to it. Returns the parsed plan or throws. */
export function readApproved(planFile) {
  if (!fs.existsSync(planFile)) throw new PlanError(`missing plan ${planFile}`);
  const pin = `${planFile}.sha256`;
  if (!fs.existsSync(pin)) throw new PlanError(`${path.basename(planFile)} has no pin (${path.basename(pin)}); run: ai-video-editor new repin ${planFile}`);
  const want = fs.readFileSync(pin, 'utf8').trim().split(/\s+/)[0];
  const got = sha256File(planFile);
  if (want !== got) throw new PlanError(`${path.basename(planFile)} was edited after it was pinned (sha256 ${got.slice(0, 12)} != pinned ${want.slice(0, 12)}). Review the change, then re-pin it: ai-video-editor new repin ${planFile}`);
  let plan;
  try { plan = JSON.parse(fs.readFileSync(planFile, 'utf8')); } catch (e) { throw new PlanError(`${planFile}: not valid JSON (${e.message})`); }
  return plan;
}

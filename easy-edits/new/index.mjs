// easy-edits new <type> ...: plan -> storyboard -> approval gate -> render -> verify -> deliverables.
// Planning never generates anything. `--approve plan.json` checks the sha256 pin, the generation budget and
// --offline, then renders with the plan's backend and writes report.json, REVIEW.txt, DELIVERY.json (and
// POST_DRAFT.txt with --post-draft) next to the exports.
import fs from 'node:fs';
import path from 'node:path';
import { getBackend } from '../gen/index.mjs';
import { readManifest } from '../gen/host.mjs';
import { TYPES, loadRecipes, getRecipe, listRecipes, mapBrief } from './recipes.mjs';
import { finalizePlan, gateProblems, planText, pinPlan, readApproved, sha256File, PlanError, PLAN_VERSION } from './plan.mjs';
import { storyboard } from './storyboard.mjs';
import { parseFormats, ff } from './assemble.mjs';
import { finishPreset, verifyOutput, probeFile } from './finish.mjs';
import { resolveBackendNames, backendLabel, backendOf, genOpts, generationSession, resetManifest, recordApproval, approvedSha, assetProblems, PendingAssetsError, pendingMessage, EXIT_PENDING } from './hostflow.mjs';
import { CLIP_AUDIO } from './clip-audio.mjs';

export const HELP = `easy-edits new: make a video from a brief, a script or brand assets (plan first, then approve).

usage: easy-edits new <type> -o <out-dir> [options]          plan only: plan.json, PLAN.txt, storyboard.png
       easy-edits new --approve <out-dir>/plan.json [options]  render the pinned plan
       easy-edits new repin <plan.json>                        re-check an edited plan and pin it again
       easy-edits new types                                    list the recipes
       easy-edits resume <out-dir>                              finish an approved plan once its generated assets exist

types
  explainer-cited  --source URL|FILE (repeatable) / --topic: sourced script, citation chips, SOURCES.txt
                   (zero video generations; a plain --script FILE is used as the source document)
  presenter        a synthetic host reads the script, 9:16 15-90 s (fictional; or --likeness self with
                   --consent FILE: your own face / voice, see docs/CONSENT.md)
  podcast          speaker-tagged script ("A: ..." / "B: ...") -> two voices, turn gaps, room tone;
                   waveform video with speaker-named captions, or --audio-only WAV + MP3 (-16 LUFS)
  story            multi-shot story from --brief / --script / --shotlist FILE, --characters FILE (character
                   lock), per-shot QA; --narrate to voice it
  promo            --brand brand.json [--assets DIR]: code-drawn scenes, zero generations
  music-video      --song FILE --i-own-this-music: cuts on the beat, the song sets the length, --lyrics FILE
  other            --brief "...": mapped to the closest recipe by keywords (the mapping is shown in the plan)

options
  -o, --out DIR             where plan.json and the exports go (required for planning)
  --brief "..."             what the video is about (also the narration when there is no --script)
  --script FILE             the script, one line per beat ("Name: text" speaker tags allowed)
  --title "..."             title card / file names
  --format F                9x16 (default) | 16x9 | 1x1 | 4x5 | WxH (custom, e.g. 720x1280) | all; comma list
  --length S | MIN-MAX      target length in seconds; checked at delivery (FAIL outside it)
  --loudness social|podcast|LUFS   finish preset (social -14 LUFS, podcast -16 LUFS; both -1.5 dBTP)
  --backend NAME            generation backend for every kind (EASY_EDITS_BACKEND overrides). Default per kind:
                            video + image host (your assistant's built-in generation), tts + avatar local,
                            llm + search none. One kind: --video-backend, --image-backend, --tts-backend, ...
  --max-generations N       refuse a plan that needs more than N generations
  --offline                 refuse any backend that needs the network
  --approve FILE            render this pinned plan (refused if it was edited without \`new repin\`)
  --post-draft [--hashtags "a,b"]   also write POST_DRAFT.txt (labelled DRAFT; never posted)
  --voice NAME              TTS voice for narration; podcast: --voices "A=name,B=name", --speakers "A=Ana,B=Ben"
  --audio-only              podcast: WAV + MP3 only, no video
  --brand FILE --assets DIR promo: brand.json (name, colors, logo, product, cta) and your images
  --no-music                promo: no music bed
  --song FILE --i-own-this-music   music-video: your own track
  --clip-audio auto|keep|duck|drop  the ambient audio of generated video clips (default auto: dropped under
                            narration or a song, -18 dB under music, as-is when it is the only audio)
  -h, --help

host generation (the default for images and video)
  --approve stops with exit code 3 and writes GENERATION_MANIFEST.json in the output folder: generate each asset
  with your assistant's built-in image/video generation, save it at its "file", then run easy-edits resume <out>.

examples
  easy-edits new promo -o out/promo --brand brand.json --assets brand/ --format 9x16,1x1
  easy-edits new --approve out/promo/plan.json
  easy-edits new podcast -o out/pod --script episode.txt --audio-only
  easy-edits new other -o out/x --brief "a product launch teaser for our app" --brand brand.json
`;

const VALUE = new Set(['-o', '--out', '--brief', '--script', '--title', '--format', '--length', '--loudness', '--backend', '--max-generations', '--approve', '--brand', '--assets', '--voice', '--voices', '--speakers', '--song', '--hashtags', '--style-prompt', '--notes',
  '--video-backend', '--image-backend', '--tts-backend', '--avatar-backend', '--llm-backend', '--search-backend', '--clip-audio',
  '--topic', '--wps', '--style', '--text', '--likeness', '--use', '--consent', '--subject', '--host-image', '--host-license', '--host-prompt',
  '--shotlist', '--characters', '--narration', '--music', '--lyrics', '--shot-sec', '--snap-tolerance', '--transition']);
const REPEAT = new Set(['--source']);
const camel = (a) => a.replace(/^-+/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export function parseNewArgs(argv) {
  const o = { pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (VALUE.has(a)) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); o[camel(a)] = argv[++i]; }
    else if (REPEAT.has(a)) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); (o[camel(a)] ||= []).push(argv[++i]); }
    else if (a.startsWith('--')) o[camel(a)] = true;
    else o.pos.push(a);
  }
  if (o.o) o.out = o.o;
  if (o.maxGenerations != null) {
    o.maxGenerations = Number(o.maxGenerations);
    if (!Number.isInteger(o.maxGenerations) || o.maxGenerations < 0) throw new Error('--max-generations needs a whole number >= 0');
  }
  if (o.length != null) o.length = parseLength(o.length);
  if (o.clipAudio != null && !CLIP_AUDIO.includes(o.clipAudio)) throw new Error(`--clip-audio ${o.clipAudio}: use ${CLIP_AUDIO.join(' | ')}`);
  return o;
}

const secs = (s) => { const p = String(s).split(':').map(Number); return p.reduce((a, b) => a * 60 + b, 0); };
/** --length 30 | 30-60 | 0:30-1:30 -> [min, max] */
export function parseLength(v) {
  const [a, b] = String(v).split('-');
  const r = [secs(a), secs(b ?? a)];
  if (!r.every((x) => Number.isFinite(x) && x > 0) || r[0] > r[1]) throw new Error(`--length ${v}: use seconds (15) or a range (30-60)`);
  return r;
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const log = (m) => process.stderr.write(`easy-edits: ${m}\n`);
const rel = (from, f) => (f ? path.relative(from, f) || path.basename(f) : null);

const canGenWith = (names) => (kind) => { try { return getBackend(kind, { name: names[kind] }).name !== 'none'; } catch { return false; } };
const capsWith = (names) => (kind) => { try { return getBackend(kind, { name: names[kind] }).capabilities; } catch { return { maxClipSeconds: 0 }; } };

/** Plan a type: returns { plan, planFile } (writes plan.json + pin, PLAN.txt, storyboard.png). Throws PlanError on a refusal. */
export async function planNew(type, o) {
  await loadRecipes();
  if (!TYPES.includes(type) && !getRecipe(type)) throw new PlanError(`unknown type "${type}" (${TYPES.join(', ')})`);
  if (!o.out) throw new PlanError('-o <out-dir> is required');
  let recipeName = type, mapping = null;
  if (type === 'other') {
    if (!o.brief) throw new PlanError('new other: needs --brief "..." (it is mapped to the closest recipe)');
    const m = mapBrief(o.brief);
    recipeName = m.recipe;
    mapping = { from: 'other', recipe: m.recipe, matched: m.matched, brief: o.brief };
    log(`other -> ${m.recipe} (${m.matched.length ? `matched: ${m.matched.join(', ')}` : 'no keyword matched; default recipe'})`);
  }
  const recipe = getRecipe(recipeName);
  if (!recipe) throw new PlanError(`no recipe registered for "${recipeName}"`);
  for (const k of ['script', 'brand', 'assets', 'song', 'shotlist', 'characters', 'narration', 'music', 'lyrics', 'consent', 'hostImage']) if (o[k]) { o[k] = path.resolve(o[k]); if (!fs.existsSync(o[k])) throw new PlanError(`missing ${k} ${o[k]}`); }
  if (o.source) o.source = o.source.map((s) => (/^https?:\/\//i.test(s) ? s : path.resolve(s)));
  const out = path.resolve(o.out);
  const backends = resolveBackendNames(o);
  const backend = backendLabel(backends);
  for (const [kind, name] of Object.entries(backends)) getBackend(kind, { name });   // unknown backend -> throws now
  const formats = parseFormats(o.format || '9x16');
  const finish = finishPreset(o.loudness, recipe.defaults?.loudness || 'social');
  const opts = { ...o, out, formats, finish, length: o.length || null, backendName: backend, backends, caps: capsWith(backends), canGen: canGenWith(backends), probeSec: (f) => probeFile(f).duration };
  let p;
  try { p = await recipe.plan(opts); } catch (e) { throw new PlanError(e.message); }
  const plan = {
    version: PLAN_VERSION, type, recipe: recipeName, title: p.title || o.title || null, brief: o.brief || null, mapping,
    formats, fps: 30, length: p.length || o.length || null, defaultLength: recipe.defaults?.length || null,
    finish: p.finish || finish, backend, backends, offline: !!o.offline,
    shots: p.shots, voice: p.voice || [], ...(p.assets?.length ? { assets: p.assets } : {}), notes: p.notes || [],
    options: { ...(p.options || {}), postDraft: !!o.postDraft, hashtags: o.hashtags || null, clipAudio: o.clipAudio || 'auto' },
  };
  finalizePlan(plan);
  const bad = gateProblems(plan, { maxGenerations: o.maxGenerations ?? null, offline: !!o.offline });
  if (bad.length) throw new PlanError(`refused:\n${bad.map((b) => `  - ${b}`).join('\n')}`);
  return { plan, planFile: await writePlanFiles(plan, out, recipe) };
}

async function writePlanFiles(plan, out, recipe) {
  fs.mkdirSync(out, { recursive: true });
  const planFile = path.join(out, 'plan.json');
  pinPlan(plan, planFile);
  const shown = path.relative(process.cwd(), planFile).startsWith('..') ? planFile : path.relative(process.cwd(), planFile);
  fs.writeFileSync(path.join(out, 'PLAN.txt'), planText(plan, { planFile: shown, approveCmd: `easy-edits new --approve ${shown}` }));
  const work = path.join(out, '.work', 'plan');
  fs.mkdirSync(work, { recursive: true });
  const previews = {};
  if (recipe?.preview) for (const s of plan.shots) { try { const f = await recipe.preview(s, plan, path.join(work, `preview_${s.id}.png`), work); if (f) previews[s.id] = f; } catch { /* placeholder cell */ } }
  await storyboard(plan, path.join(out, 'storyboard.png'), { work, previews });
  return planFile;
}

/** `new repin plan.json`: validate an edited plan, recount generations / estimate, rewrite PLAN.txt + storyboard and pin it. */
export async function repin(planFile, o = {}) {
  await loadRecipes();
  let plan;
  try { plan = JSON.parse(fs.readFileSync(planFile, 'utf8')); } catch (e) { throw new PlanError(`${planFile}: ${e.message}`); }
  const recipe = getRecipe(plan.recipe);
  if (!recipe) throw new PlanError(`no recipe registered for "${plan.recipe}"`);
  finalizePlan(plan);
  const bad = gateProblems(plan, { maxGenerations: o.maxGenerations ?? null, offline: !!(o.offline || plan.offline) });
  if (bad.length) throw new PlanError(`refused:\n${bad.map((b) => `  - ${b}`).join('\n')}`);
  await writePlanFiles(plan, path.dirname(path.resolve(planFile)), recipe);
  return plan;
}

/** Render an approved plan. Returns { pass, delivery, report }. */
export async function approveNew(planFile, o = {}) {
  await loadRecipes();
  planFile = path.resolve(planFile);
  const plan = readApproved(planFile);
  const pinned = sha256File(planFile);
  const recipe = getRecipe(plan.recipe);
  if (!recipe) throw new PlanError(`no recipe registered for "${plan.recipe}"`);
  if (o.type && o.type !== plan.type) throw new PlanError(`the plan is a "${plan.type}" plan, not "${o.type}"`);
  if (process.env.EASY_EDITS_BACKEND && process.env.EASY_EDITS_BACKEND !== plan.backend) throw new PlanError(`the plan was approved for backend "${plan.backend}" but EASY_EDITS_BACKEND=${process.env.EASY_EDITS_BACKEND}; re-plan to switch backends`);
  for (const kind of ['video', 'image', 'tts', 'avatar']) { try { getBackend(kind, { name: backendOf(plan, kind) }); } catch (e) { throw new PlanError(`the plan's backend: ${e.message}`); } }
  finalizePlan(plan);   // recount from the pinned shots (never trust stored counts)
  const offline = !!(o.offline || plan.offline);
  const bad = gateProblems(plan, { maxGenerations: o.maxGenerations ?? null, offline });
  if (bad.length) throw new PlanError(`refused:\n${bad.map((b) => `  - ${b}`).join('\n')}`);
  const out = path.resolve(o.out || path.dirname(planFile));
  const name = slug(plan.title) || plan.recipe;
  const work = path.join(out, '.work', `new_${plan.recipe}_${name}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  if (!o.resume) { resetManifest(out); recordApproval(planFile, pinned); }   // the manifest lists this plan's requests only
  const logFile = path.join(work, 'easy-edits.log');
  const t0 = Date.now();
  const session = generationSession({ plan, out, budget: plan.generations.total, offline, PlanError });
  const used = session.used;
  const ctx = {
    out, work, logFile, plan, offline,
    ff: (args, label) => ff(args, label, { logFile }),
    probeSec: (f) => probeFile(f).duration,
    canGen: canGenWith(Object.fromEntries(['video', 'image', 'tts', 'avatar', 'llm', 'search'].map((k) => [k, backendOf(plan, k)]))),
    outName: (fmt, ext) => path.join(out, `easy-edits_${plan.recipe}_${name}${fmt && plan.formats.length > 1 ? `_${fmt.id}` : ''}.${ext}`),
    /** the plan's backend for a kind, through the session (budget, usage, host assets); native pipelines take this */
    getBackend: (kind) => session.backend(kind),
    /** stop here (exit 3) while host assets are pending; recipes call it after their generation calls */
    checkpoint: () => session.checkpoint(),
    async generate(kind, req, { id } = {}) {
      const b = session.backend(kind);
      return b.generate(req, genOpts(b, { out, dir: path.join(work, 'gen'), id, kind, req }));
    },
  };
  log(`new ${plan.recipe}: ${o.resume ? 'resuming' : 'rendering'} ${plan.options?.audioOnly ? 'audio (WAV + MP3)' : plan.formats.map((f) => f.id).join(', ')} with backend "${plan.backend}" (log ${logFile})`);
  const res = await recipe.render(plan, ctx);
  session.checkpoint();   // a recipe that never called it still stops before delivery while assets are pending
  const checks = res.outputs.map((x) => {
    const v = verifyOutput(x.file, { preset: plan.finish, length: plan.length, defaultLength: plan.defaultLength, silent: !!res.silent });
    const extra = (x.extraChecks || []).map((k) => ({ name: k.name, pass: !!k.pass, text: k.text }));
    return { ...x, ...v, checks: [...v.checks, ...extra], pass: v.pass && extra.every((k) => k.pass) };
  });
  const weak = res.weakShots || [];
  const report = {
    type: plan.type, recipe: plan.recipe, mapping: plan.mapping || null, plan: rel(out, planFile), planSha256: pinned,
    backend: plan.backend, offline, seconds: Math.round((Date.now() - t0) / 1000),
    finish: plan.finish,
    generations: { planned: plan.generations, used: used.length, byKind: used.reduce((a, u) => ({ ...a, [u.kind]: (a[u.kind] || 0) + 1 }), {}), cost: used.reduce((a, u) => a + u.cost, 0), cached: used.filter((u) => u.cached).length },
    outputs: checks.map((c) => ({ file: rel(out, c.file), format: c.format, kind: c.kind, pass: c.pass, checks: c.checks.map((k) => k.text), notes: c.notes, measured: c.measured, color: c.color, durationSec: c.duration })),
    WEAK_SHOTS: weak, synthetic: !!plan.options?.synthetic, timeline: res.timeline || null, notes: [...(plan.notes || []), ...(res.notes || [])],
    clipAudio: res.clipAudio || null,
    hostAssets: readManifest(out).assets.map((a) => ({ id: a.id, type: a.type, file: a.file })),
    ...(res.details ? { details: res.details } : {}),
  };
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
  fs.writeFileSync(path.join(out, 'REVIEW.txt'), reviewText(report, checks, weak));
  const credits = res.credits || [];
  if (credits.length) fs.writeFileSync(path.join(out, 'CREDITS.txt'), `${credits.join('\n')}\n`);
  let postDraft = null;
  if (o.postDraft || plan.options?.postDraft) {
    postDraft = path.join(out, 'POST_DRAFT.txt');
    fs.writeFileSync(postDraft, postDraftText(plan, res, { hashtags: o.hashtags || plan.options?.hashtags }));
  }
  const primary = checks[0];
  const delivery = {
    primary: rel(out, primary.file), alternates: checks.slice(1).map((c) => rel(out, c.file)),
    formats: checks.map((c) => ({ file: rel(out, c.file), format: c.format, kind: c.kind, width: c.width || null, height: c.height || null, durationSec: c.duration })),
    captions: (res.captions || []).map((f) => rel(out, f)), sources: res.sources || plan.options?.sources || [],
    ...(res.sourcesFile ? { sourcesFile: rel(out, res.sourcesFile) } : {}), sheets: (res.sheets || []).map((f) => rel(out, f)),
    credits: credits.length ? { file: 'CREDITS.txt', lines: credits } : null, weakShots: weak, postDraft: rel(out, postDraft),
    loudness: { preset: plan.finish.name, target: plan.finish.target, truePeak: plan.finish.truePeak, measured: Object.fromEntries(checks.map((c) => [rel(out, c.file), c.measured ? { I: c.measured.I, TP: c.measured.TP } : null])) },
    color: Object.fromEntries(checks.filter((c) => c.color).map((c) => [rel(out, c.file), c.color])),
    pass: checks.every((c) => c.pass), report: 'report.json', review: 'REVIEW.txt', published: false,
  };
  fs.writeFileSync(path.join(out, 'DELIVERY.json'), `${JSON.stringify(delivery, null, 1)}\n`);
  for (const c of checks) for (const k of c.checks) log(`${k.pass ? 'ok  ' : 'FAIL'} ${path.basename(c.file)} ${k.text}`);
  for (const w of weak) log(`weak shot ${w.shot}: ${w.reason}`);
  log(`done in ${report.seconds} s; ${path.join(out, 'DELIVERY.json')}`);
  return { pass: delivery.pass, delivery, report, out };
}

export function reviewText(report, checks, weak) {
  const L = [`REVIEW (${report.recipe}${report.mapping ? `, mapped from "other"` : ''}; backend ${report.backend})`, ''];
  for (const c of checks) {
    L.push(`${path.basename(c.file)}: ${c.pass ? 'PASS' : 'FAIL'}`);
    for (const k of c.checks) L.push(`  ${k.text}`);
    for (const n of c.notes) L.push(`  note: ${n}`);
  }
  L.push('', 'WEAK SHOTS');
  if (!weak.length) L.push('No weak shots were found. The automatic checks cover generated-clip length, black frames and frozen frames only; watch the video before you share it.');
  for (const w of weak) L.push(`Shot ${w.shot}${w.at != null ? ` (at ${w.at.toFixed(1)} s)` : ''} is weak: ${w.reason}. Suggested fix: ${w.fix}.`);
  if (report.synthetic) L.push('', 'The presenter in this video is synthetic (a generated, fictional host).');
  if (report.notes.length) { L.push('', 'NOTES'); for (const n of report.notes) L.push(`- ${n}`); }
  return `${L.join('\n')}\n`;
}

export function postDraftText(plan, res, { hashtags } = {}) {
  const first = (plan.voice || []).map((v) => v.text).slice(0, 2).join(' ');
  const L = ['DRAFT - suggested post text. Nothing has been posted; review and edit it before you use it.', ''];
  if (plan.title) L.push(plan.title);
  const body = res.postText || first || plan.brief || '';
  if (body) L.push(body);
  const tags = String(hashtags || '').split(',').map((t) => t.trim().replace(/^#/, '').replace(/\s+/g, '')).filter(Boolean);
  if (tags.length) L.push('', tags.map((t) => `#${t}`).join(' '));
  const sources = res.sources || plan.options?.sources || [];
  if (sources.length) { L.push('', 'Sources:'); sources.forEach((s, i) => L.push(`${i + 1}. ${typeof s === 'string' ? s : [s.title, s.url].filter(Boolean).join(' - ')}`)); }
  if (res.credits?.length) { L.push('', 'Credits:'); for (const c of res.credits) L.push(c); }
  return `${L.join('\n')}\n`;
}

/**
 * `easy-edits resume <out>`: finish an approved plan whose host assets have been generated. The plan must still
 * match its pin and the approval record; every asset in GENERATION_MANIFEST.json must exist and be readable.
 */
export async function resumeNew(dir, o = {}) {
  const out = path.resolve(dir);
  const planFile = path.join(out, 'plan.json');
  readApproved(planFile);   // pinned hash still matches
  const sha = sha256File(planFile);
  const ok = approvedSha(planFile);
  if (!ok) throw new PlanError(`${path.relative(process.cwd(), planFile) || planFile} has not been approved; review PLAN.txt and storyboard.png, then run: easy-edits new --approve ${planFile}`);
  if (ok !== sha) throw new PlanError(`plan.json changed after it was approved (sha256 ${sha.slice(0, 12)} != approved ${ok.slice(0, 12)}); approve it again: easy-edits new --approve ${planFile}`);
  const { bad } = assetProblems(out);
  if (bad.length) {
    const e = new PendingAssetsError(out, bad);
    e.message = `still waiting for ${bad.length} asset(s): ${bad.map((a) => `${a.file} (${a.problem})`).join(', ')}`;
    throw e;
  }
  return approveNew(planFile, { ...o, out, resume: true });
}

/** CLI for `easy-edits resume <out-dir>` (exit 0 ok, 1 a delivery FAIL, 2 refused, 3 still waiting for assets). */
export async function resumeMain(argv) {
  let o;
  try { o = parseNewArgs(argv); } catch (e) { console.error(`easy-edits resume: ${e.message}`); return 2; }
  if (o.help || !o.pos[0]) {
    process.stdout.write('usage: easy-edits resume <out-dir>\n\nFinishes an approved `easy-edits new` plan once every asset in <out-dir>/GENERATION_MANIFEST.json\nhas been generated and saved at its "file". Exit 3 (and the list) while any are missing.\n');
    return o.help ? 0 : 2;
  }
  try {
    const r = await resumeNew(o.pos[0], o);
    return r.pass ? 0 : 1;
  } catch (e) {
    if (e instanceof PendingAssetsError) { process.stdout.write(pendingMessage(e)); return EXIT_PENDING; }
    if (e instanceof PlanError) { console.error(`easy-edits resume: ${e.message}`); return 2; }
    throw e;
  }
}

/** CLI: process exit code (0 ok, 1 a delivery FAIL, 2 refused / bad arguments, 3 waiting for host assets). */
export async function newMain(argv) {
  let o;
  try { o = parseNewArgs(argv); } catch (e) { console.error(`easy-edits new: ${e.message}`); return 2; }
  if (o.help || (!o.pos.length && !o.approve)) { process.stdout.write(HELP); return o.help ? 0 : 2; }
  try {
    if (o.pos[0] === 'types') {
      await loadRecipes();
      for (const r of listRecipes()) process.stdout.write(`${r.name.padEnd(16)} ${r.description || ''}\n`);
      return 0;
    }
    if (o.pos[0] === 'repin') {
      if (!o.pos[1]) { console.error('easy-edits new repin: needs the plan.json path'); return 2; }
      const plan = await repin(path.resolve(o.pos[1]), o);
      process.stdout.write(fs.readFileSync(path.join(path.dirname(path.resolve(o.pos[1])), 'PLAN.txt'), 'utf8'));
      log(`re-pinned ${o.pos[1]} (${plan.generations.total} generations)`);
      return 0;
    }
    if (o.approve) {
      const r = await approveNew(o.approve, { ...o, type: o.pos[0] });
      return r.pass ? 0 : 1;
    }
    const { planFile } = await planNew(o.pos[0], o);
    process.stdout.write(fs.readFileSync(path.join(path.dirname(planFile), 'PLAN.txt'), 'utf8'));
    log(`planned; nothing generated. storyboard: ${path.join(path.dirname(planFile), 'storyboard.png')}`);
    return 0;
  } catch (e) {
    if (e instanceof PendingAssetsError) { process.stdout.write(pendingMessage(e)); return EXIT_PENDING; }
    if (e instanceof PlanError || /^(unknown format|custom format|--loudness|--length|unknown backend|--format)/.test(e.message)) { console.error(`easy-edits new: ${e.message}`); return 2; }
    throw e;
  }
}

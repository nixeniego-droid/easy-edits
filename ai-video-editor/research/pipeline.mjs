// Cited explainer pipeline (SPEC recipe 1): plan (sources -> script -> shots) and render, shared by the recipe
// (ai-video-editor/new/recipes/explainer-cited.mjs) and the standalone runner (research/run.mjs).
//   <out>/sources/        the sources store (sources.json, S<n>.txt, S<n>.json)
//   <out>/script.json     claims -> source id -> quoted passage (edit it, then render with --script)
//   <out>/script.txt      readable copy of the narration
//   <out>/plan.json       recipe, formats, shots[], generation count, citation check (paths relative to <out>)
//   <out>/PLAN.txt        the same for a person
import fs from 'node:fs';
import path from 'node:path';
import { getBackend } from '../gen/index.mjs';
import { checkCitations } from './citations.mjs';
import { renderExplainer, FORMATS, timeline } from './render.mjs';
import { scriptTxt, writeScript, DEFAULT_WPS } from './script.mjs';
import { gatherSources, loadSources } from './sources.mjs';

export const RECIPE = 'explainer-cited';
const rel = (out, p) => path.relative(out, p) || '.';

function planTxt(plan, script) {
  const g = plan.generations;
  return [
    `PLAN - ${RECIPE}: ${script.title}`,
    `formats: ${plan.formats.join(', ')}   target ${plan.targetSec} s (${script.targetWords} words at ${script.wordsPerSec} words/s), script ${script.words} words ~${script.estSec} s`,
    `generations: ${g.video} video, ${g.image} image, ${g.tts} TTS   (backends: tts ${plan.backends.tts}, image ${plan.backends.image}, llm ${plan.backends.llm}, search ${plan.backends.search})`,
    `writer: ${script.writer} (${script.writerNote})`,
    plan.citation,
    `sources: ${script.sources.length} in ${plan.sourcesDir}/`, ...script.sources.map((s) => `  ${s.id} ${s.title} <${s.url}> retrieved ${s.retrieved}`),
    '', 'shots:',
    ...plan.shots.map((s) => `  ${s.id} ~${s.durationSec} s  ${s.source.padEnd(5)} ${s.cite}  "${s.text}"`),
    `  end  ${plan.endCardSec} s  code  Sources end card`,
    ...(plan.notes.length ? ['', 'notes:', ...plan.notes.map((n) => `  - ${n}`)] : []),
    '',
  ].join('\n');
}

const backendNames = (b = {}) => {
  const forced = process.env.AI_VIDEO_EDITOR_BACKEND;
  const pick = (k) => forced || b[k] || b.all || 'none';
  return { tts: pick('tts'), image: pick('image'), llm: pick('llm'), search: pick('search') };
};

/**
 * opts: {out, sources:[URL|FILE], topic, title, offline, length (s), wps, formats, backends:{tts,image,llm,search,all},
 *        script (a script.json to use instead of writing one), log}
 * -> plan object (also written to <out>/plan.json + PLAN.txt)
 */
export async function planExplainer(opts) {
  const out = path.resolve(opts.out), log = opts.log || (() => {});
  fs.mkdirSync(out, { recursive: true });
  const formats = opts.formats || ['9x16'];
  const sizes = opts.sizes || {};
  for (const f of formats) if (!FORMATS[f] && !sizes[f]) throw new Error(`explainer-cited renders ${Object.keys(FORMATS).join(' and ')} (got ${f})`);
  const backends = backendNames(opts.backends);
  const sourcesDir = path.join(out, 'sources');
  const notes = [];
  let store;
  if (opts.sources?.length || opts.topic && !opts.script) {
    const g = await gatherSources({ sources: opts.sources || [], topic: opts.topic, dir: sourcesDir, offline: !!opts.offline, backends });
    notes.push(...g.notes);
    store = loadSources(sourcesDir);
    log(`sources: ${store.sources.length} -> ${sourcesDir}`);
  } else if (fs.existsSync(path.join(sourcesDir, 'sources.json'))) store = loadSources(sourcesDir);
  else throw new Error('no sources: give --source URL|FILE (repeatable) or --topic');
  const targetSec = Number(opts.length || 45), wordsPerSec = Number(opts.wps || DEFAULT_WPS);
  let script;
  if (opts.script) {
    script = JSON.parse(fs.readFileSync(opts.script, 'utf8'));
    notes.push(`script from ${path.basename(opts.script)} (not rewritten)`);
  } else {
    script = await writeScript(store.sources, { topic: opts.topic, title: opts.title, targetSec, wordsPerSec, backends, offline: !!opts.offline, outDir: path.join(out, '.work', 'llm') });
    log(`script: ${script.claims.length} claims, ${script.words} words (~${script.estSec} s), writer ${script.writer}`);
  }
  const scriptFile = path.join(out, 'script.json');
  if (!opts.script || path.resolve(opts.script) !== scriptFile) fs.writeFileSync(scriptFile, JSON.stringify(script, null, 1));
  fs.writeFileSync(path.join(out, 'script.txt'), scriptTxt(script));
  const citation = checkCitations(script, store.sources);
  const imageB = getBackend('image', { name: backends.image });
  const wps = script.wordsPerSec || wordsPerSec;
  const est = script.claims.map((c) => Math.round((c.text.split(/\s+/).length / wps) * 10) / 10);
  const tl = timeline(est, new Set(script.claims.map((c) => c.source)).size);
  const order = [];
  for (const c of script.claims) if (!order.includes(c.source)) order.push(c.source);
  const title = (id) => store.sources.find((s) => s.id === id)?.title || 'unknown source';
  const shots = script.claims.map((c, i) => ({
    id: `shot${i + 1}`, claim: c.id, durationSec: Math.round((tl.segs[i].end - tl.segs[i].start) * 10) / 10,
    source: imageB.name === 'none' ? 'code' : 'still', prompt: imageB.name === 'none' ? null : `Editorial illustration, no text: ${c.text}`,
    cite: `[${order.indexOf(c.source) + 1}] ${title(c.source)}`, text: c.text,
  }));
  const plan = {
    recipe: RECIPE, version: 1, title: script.title, formats, targetSec, offline: !!opts.offline, backends,
    voice: opts.voice || null, style: opts.style || null,
    sourcesDir: rel(out, sourcesDir), scriptFile: rel(out, scriptFile),
    ...(Object.keys(sizes).length ? { sizes } : {}),
    generations: { video: 0, image: imageB.name === 'none' ? 0 : shots.length, tts: script.claims.length },
    estimatedSec: tl.duration, endCardSec: Math.round((tl.endCard.end - tl.endCard.start) * 10) / 10,
    shots, citation: citation.text, citationPass: citation.pass, notes,
  };
  fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 1));
  fs.writeFileSync(path.join(out, 'PLAN.txt'), planTxt(plan, script));
  log(citation.text);
  return { ...plan, out };
}

/**
 * Render a plan (planExplainer's result, or a plan.json read back with ctx.out set).
 * ctx: {out, pack (a loaded style pack or null), scale, voice, rate, log, work, getBackend (injected backends)}
 * -> {exports, report, reportFile, sourcesFile}
 */
export async function renderPlan(plan, ctx = {}) {
  const out = path.resolve(ctx.out || plan.out), log = ctx.log || (() => {});
  const script = JSON.parse(fs.readFileSync(path.resolve(out, plan.scriptFile), 'utf8'));
  const store = loadSources(path.resolve(out, plan.sourcesDir));
  const base = `ai-video-editor_${RECIPE}_${(script.title || 'explainer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'explainer'}`;
  const t0 = Date.now();
  const r = await renderExplainer(script, store.sources, {
    out, base, formats: plan.formats, sizes: plan.sizes || {}, work: ctx.work || path.join(out, '.work', RECIPE), backends: plan.backends,
    voice: ctx.voice || plan.voice || undefined, rate: ctx.rate, offline: plan.offline || !!ctx.offline, pack: ctx.pack || null, scale: ctx.scale || 1, log,
    ...(ctx.getBackend ? { getBackend: ctx.getBackend } : {}),
  });
  const report = {
    mode: 'new', recipe: RECIPE, title: script.title, formats: plan.formats, seconds: Math.round((Date.now() - t0) / 1000),
    writer: script.writer, writerNote: script.writerNote, citation: r.citation, sources: r.cited, generations: r.generations,
    citationStyle: { pack: r.look.id, font: r.look.font, chip: r.look.surface, text: r.look.text, accent: r.look.accent },
    notes: [...(plan.notes || []), ...r.notes],
    exports: r.exports.map((e) => ({ format: e.format, file: path.basename(e.file), sheet: path.basename(e.sheet), subtitles: e.subtitles.map((s) => path.basename(s)), width: e.width, height: e.height, duration: e.duration, pass: e.pass, checks: e.checks, visuals: e.visuals, chips: e.chips, captions: e.captions.length, ...(e.pass ? {} : { note: e.checks.filter((c) => !c.pass).map((c) => c.name).join(', ') }) })),
  };
  const reportFile = path.join(out, `${base}.report.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
  return { exports: r.exports, report, reportFile, sourcesFile: r.sourcesFile };
}

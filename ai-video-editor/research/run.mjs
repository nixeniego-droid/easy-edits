#!/usr/bin/env node
// Standalone runner for the cited explainer (until `ai-video-editor new explainer-cited` is wired in):
//   node ai-video-editor/research/run.mjs --source FILE|URL [--source ...] [--topic "..."] -o out/ [options]
// Stops after planning with --plan-only (sources/, script.json, plan.json, PLAN.txt); render a reviewed plan with
// --plan out/plan.json, or an edited script with --script out/script.json. Exit 1 when a delivery check FAILs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack, StyleError } from '../engine/style-pack.mjs';
import { planExplainer, renderPlan } from './pipeline.mjs';
import { PendingAssetsError, pendingMessage, EXIT_PENDING } from '../new/hostflow.mjs';

const HELP = `ai-video-editor research: a cited explainer from sources (topic / links / documents)

usage: node ai-video-editor/research/run.mjs --source URL|FILE [--source ...] [--topic "..."] -o OUT [options]

  --source URL|FILE     a web page, PDF (pdftotext), .txt or .md; repeatable
  --topic "..."         what the video is about: picks the passages; with a search backend also finds sources
  -o, --out DIR         output folder (required)
  --format F            9x16 (default) | 16x9 | all (both)
  --length S            target length in seconds (default 45; the explainer range is 30-120)
  --wps N               narration words per second for length control (default 2.5)
  --title "..."         video title (default: the topic, else the first source's title)
  --offline             provided documents only: no URL fetches, no search, no network backends
  --backend NAME        generation backend for every kind (none | mock | ...); per kind: --tts-backend,
                        --image-backend, --llm-backend, --search-backend. AI_VIDEO_EDITOR_BACKEND overrides all
  --voice V             TTS voice
  --style PACK          citation chip / cards in a style pack's palette and fonts
  --scale F             render size factor for previews / tests (0.5 = half size; default 1)
  --plan-only           stop after planning (review PLAN.txt / script.json)
  --plan FILE           render this plan.json (from --plan-only)
  --script FILE         use this script.json (edited) instead of writing one; sources come from OUT/sources
                        unless --source is given
  -h, --help
`;

const VALUE = new Set(['--source', '--topic', '-o', '--out', '--format', '--length', '--wps', '--title', '--backend', '--tts-backend', '--image-backend', '--llm-backend', '--search-backend', '--voice', '--style', '--plan', '--script', '--scale']);
export function parseResearchArgs(argv) {
  const o = { sources: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (VALUE.has(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      const v = argv[++i];
      if (a === '--source') o.sources.push(v);
      else o[a === '-o' ? 'out' : a.replace(/^-+/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    } else if (a === '--offline' || a === '--plan-only') o[a === '--offline' ? 'offline' : 'planOnly'] = true;
    else throw new Error(`unknown argument ${a}`);
  }
  const f = o.format || '9x16';
  o.formats = f === 'all' ? ['9x16', '16x9'] : f.split(',');
  for (const x of o.formats) if (!['9x16', '16x9'].includes(x)) throw new Error(`unknown format ${x} (9x16, 16x9, all)`);
  o.backends = { all: o.backend, tts: o.ttsBackend, image: o.imageBackend, llm: o.llmBackend, search: o.searchBackend };
  if (o.length != null && !(Number(o.length) > 0)) throw new Error('--length needs seconds > 0');
  return o;
}

const log = (...a) => process.stderr.write(`ai-video-editor: ${a.join(' ')}\n`);

export async function main(argv) {
  let o;
  try { o = parseResearchArgs(argv); } catch (e) { console.error(`ai-video-editor: ${e.message}`); return 2; }
  if (o.help) { process.stdout.write(HELP); return 0; }
  if (!o.out) { console.error('ai-video-editor: -o <out-dir> is required'); return 2; }
  if (!o.plan && !o.sources.length && !o.topic && !o.script) { process.stdout.write(HELP); return 2; }
  o.out = path.resolve(o.out);
  o.sources = o.sources.map((s) => (/^https?:\/\//i.test(s) ? s : path.resolve(s)));
  let pack = null;
  if (o.style) { try { pack = loadPack(o.style); } catch (e) { if (e instanceof StyleError) { console.error(`ai-video-editor: ${e.message}`); return 2; } throw e; } }
  let plan;
  if (o.plan) {
    plan = JSON.parse(fs.readFileSync(path.resolve(o.plan), 'utf8'));
    plan.out = path.dirname(path.resolve(o.plan));
    if (plan.recipe !== 'explainer-cited') { console.error(`ai-video-editor: ${o.plan} is not an explainer-cited plan`); return 2; }
  } else {
    plan = await planExplainer({ ...o, script: o.script && path.resolve(o.script), log });
    log(`plan: ${path.join(o.out, 'PLAN.txt')} (generations: ${plan.generations.video} video, ${plan.generations.image} image, ${plan.generations.tts} TTS)`);
    if (o.planOnly) { log(`stopped after planning; review it, then: node ai-video-editor/research/run.mjs --plan ${path.join(o.out, 'plan.json')}`); return plan.citationPass ? 0 : 1; }
  }
  let r;
  try { r = await renderPlan(plan, { out: plan.out, pack, scale: o.scale ? Number(o.scale) : 1, voice: o.voice, log }); } catch (e) {
    if (e instanceof PendingAssetsError) { process.stdout.write(pendingMessage(e, { resumeCmd: `node ai-video-editor/research/run.mjs --plan ${path.join(plan.out, 'plan.json')}` })); return EXIT_PENDING; }
    throw e;
  }
  for (const e of r.exports) log(`${e.pass ? 'ok' : 'CHECK FAIL'} ${e.file}`);
  log(`sources ${r.sourcesFile}; report ${r.reportFile}`);
  return r.exports.every((e) => e.pass) ? 0 : 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`ai-video-editor: ${e.stack || e.message}`); process.exit(1); });

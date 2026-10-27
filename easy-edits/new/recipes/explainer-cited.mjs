// `easy-edits new explainer-cited` recipe (SPEC recipe 1: R1-R4, S1, C1, L1, L2): sources -> sourced script ->
// TTS narration over stills / code cards with on-screen citation chips, captions, a Sources end card, SOURCES.txt.
// Zero video generations. The work lives in easy-edits/research/ (pipeline.mjs).
//   default export / plan / render   the research pipeline's own interface (standalone runner, its tests):
//     plan(opts)          -> plan object (writes <out>/sources/, script.json, plan.json, PLAN.txt)
//     render(plan, ctx)   -> {exports, report, reportFile, sourcesFile}
//     opts: {out, sources:[URL|FILE], topic, title, offline, length, wps, formats, backends, script, voice, style, log}
//     ctx:  {out, pack, scale, voice, log}
//   `recipe` export                  the `easy-edits new` registry shape (see ../recipes.mjs): plan.json shots[] /
//                                    voice[], the approval gate, the generation session (host flow), DELIVERY.json
import fs from 'node:fs';
import path from 'node:path';
import { planExplainer, renderPlan, RECIPE } from '../../research/pipeline.mjs';
import { loadPack } from '../../engine/style-pack.mjs';

export const name = RECIPE;
export const description = 'Cited explainer: research a topic / links / documents, sourced script, on-screen citations, SOURCES.txt (9:16, 16:9; 30-120 s)';
export const formats = ['9x16', '16x9'];
export const plan = (opts) => planExplainer(opts);
export const render = (p, ctx = {}) => renderPlan(p, ctx);

const KEYWORDS = ['explain', 'explainer', 'how', 'why', 'facts', 'research', 'sources', 'cited', 'citation', 'guide', 'tutorial', 'lesson', 'learn'];

export const recipe = {
  name: RECIPE,
  description: 'cited explainer: --source URL|FILE (repeatable) / --topic -> sourced script, citation chips, SOURCES.txt (zero video generations)',
  keywords: KEYWORDS,
  defaults: { length: [30, 120], loudness: 'social' },
  async plan(o) {
    const sources = [...(o.source || [])];
    let script = null;
    if (o.script) {
      if (/\.json$/i.test(o.script)) script = o.script;
      else sources.push(o.script);   // a plain script / notes file is the source document the claims quote
    }
    if (!sources.length && !o.topic && !o.brief && !script) throw new Error('new explainer-cited: give --source URL|FILE (repeatable), --topic "..." or --script FILE');
    const ids = o.formats.map((f) => f.id);
    const sizes = Object.fromEntries(o.formats.map((f) => [f.id, [f.w, f.h]]));
    const target = o.length ? Math.round((o.length[0] + o.length[1]) / 2) : undefined;
    const native = await planExplainer({
      out: o.out, sources, topic: o.topic || o.brief, title: o.title, offline: !!o.offline, length: target, wps: o.wps,
      formats: ids, sizes, backends: o.backends, script, voice: o.voice, style: o.style,
    });
    delete native.out;
    const shots = native.shots.map((s) => ({
      id: s.id, durationSec: s.durationSec, source: s.source === 'still' ? 'still' : 'code', prompt: s.prompt || s.text,
      refs: [], camera: s.source === 'still' ? 'push' : 'static', transition: 'cut', caption: s.text, cite: s.cite,
      scene: { title: s.cite, subtitle: s.text },
    }));
    shots.push({ id: 'end', durationSec: native.endCardSec, source: 'code', prompt: 'Sources end card', refs: [], camera: 'static', transition: 'cut', scene: { title: 'Sources' } });
    const scriptJson = JSON.parse(fs.readFileSync(path.join(o.out, native.scriptFile), 'utf8'));
    const ttsNone = native.backends.tts === 'none';
    const voice = scriptJson.claims.map((c) => ({ id: c.id, speaker: null, text: c.text, ...(ttsNone ? { silent: true } : {}) }));
    const srcs = (scriptJson.sources || []).map((s) => ({ id: s.id, title: s.title, url: s.url, retrieved: s.retrieved }));
    return {
      title: native.title, shots, voice,
      notes: [native.citation, `writer: ${scriptJson.writer} (${scriptJson.writerNote})`, ...srcs.map((s) => `source ${s.id}: ${s.title} <${s.url}> retrieved ${s.retrieved}`), ...native.notes,
        ...(ttsNone ? ['no TTS backend: the local Kokoro voice is used if it is installed'] : [])],
      options: { native, style: o.style || null, sources: srcs },
    };
  },
  async render(plan, ctx) {
    const pack = plan.options.style ? loadPack(plan.options.style) : null;
    const r = await renderPlan({ ...plan.options.native }, { out: ctx.out, work: path.join(ctx.work, RECIPE), pack, offline: ctx.offline, getBackend: ctx.getBackend, log: (m) => fs.appendFileSync(ctx.logFile, `${m}\n`) });
    const mine = new Set(['citation', 'captions', 'citation-chip', 'sources', 'av']);   // loudness, colour, length: approveNew
    return {
      outputs: r.exports.map((e) => ({ file: e.file, format: e.format, kind: 'video', width: e.width, height: e.height,
        extraChecks: e.checks.filter((c) => mine.has(c.name)).map((c) => ({ name: c.name, pass: c.pass, text: c.text })) })),
      captions: r.exports.flatMap((e) => e.subtitles), sheets: r.exports.map((e) => e.sheet),
      weakShots: [], sources: r.report.sources.map((s) => ({ n: s.n, title: s.title, url: s.url, retrieved: s.retrieved })), sourcesFile: r.sourcesFile,
      notes: r.report.notes || [], details: { report: path.basename(r.reportFile), citation: r.report.citation, writer: r.report.writer, generations: r.report.generations },
      postText: plan.voice.slice(0, 2).map((v) => v.text).join(' '),
    };
  },
};

export default { name, description, formats, plan, render };

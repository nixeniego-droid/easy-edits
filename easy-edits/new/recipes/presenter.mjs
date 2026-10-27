// `easy-edits new presenter` recipe (SPEC recipe 2): a 9:16 15-90 s short read by a synthetic presenter, a
// fictional host (generated or licensed image) or the user's own likeness with a consent record.
// The work lives in ../../presenter/.
//   default export / plan / render   the presenter pipeline's own interface (standalone runner, its tests)
//   `recipe` export                  the `easy-edits new` registry shape (approval gate, generation session,
//                                    host flow, report.json / DELIVERY.json)
import fs from 'node:fs';
import path from 'node:path';
import { planPresenter, renderPresenter, planText, MIN_SEC, MAX_SEC } from '../../presenter/pipeline.mjs';
import { PRESENTER_HELP } from '../../presenter/run.mjs';

export const name = 'presenter';
export const description = 'presenter short: script -> voice -> synthetic host, 9:16, 15-90 s, captions from the script';
export const help = PRESENTER_HELP;

/** opts: see planPresenter (script/text, length, likeness, use, consent, hostImage, hostLicense, backend, ...). */
export function plan(opts) { return planPresenter(opts); }

/** ctx: { out, work?, approved, offline, log } -> { exports, report, reportFile } */
export function render(p, ctx) { return renderPresenter(p, ctx); }

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const recipe = {
  name,
  description: 'presenter short: a synthetic host reads the script, 9:16 15-90 s (fictional, or --likeness self with --consent)',
  keywords: ['presenter', 'host', 'avatar', 'spokesperson', 'anchor', 'talking', 'face'],
  defaults: { length: [MIN_SEC, MAX_SEC], loudness: 'social' },
  plan(o) {
    if (o.formats.length !== 1 || Math.abs(o.formats[0].w / o.formats[0].h - 9 / 16) > 0.01) throw new Error('new presenter: a presenter short is one 9:16 video (--format 9x16, or a 9:16 size such as 720x1280)');
    const f = o.formats[0];
    const native = planPresenter({
      script: o.script, text: o.text || (o.script ? undefined : o.brief), length: o.length ? o.length[1] : undefined,
      likeness: o.likeness, use: o.use, consent: o.consent, subject: o.subject,
      hostImage: o.hostImage, hostLicense: o.hostLicense, hostPrompt: o.hostPrompt, voice: o.voice,
      imageBackend: o.backends.image, ttsBackend: o.backends.tts, avatarBackend: o.backends.avatar,
      disclosure: !o.noDisclosure, name: slug(o.title) || (o.script ? undefined : 'presenter'), width: f.w, height: f.h, offline: !!o.offline,
    });
    const est = native.length.estimate;
    const n = native.generations.avatar;
    const shots = n
      ? Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, durationSec: Number((Math.max(est, MIN_SEC) / n).toFixed(2)), source: 'generate', kind: 'avatar', likeness: native.likeness, prompt: `presenter clip ${i + 1} of ${n} (lip-synced to the narration)`, refs: [], camera: 'static', transition: 'cut' }))
      : [{ id: 'host', durationSec: Number(Math.max(est, MIN_SEC).toFixed(2)), source: 'code', prompt: `${native.backends.avatar.fallback || 'host still'}: ${native.host.source} host`, refs: [], camera: 'static', transition: 'cut' }];
    return {
      title: o.title || null, shots,
      voice: native.script.sentences.map((t, i) => ({ id: `v${i + 1}`, speaker: null, text: t })),
      assets: native.host.source === 'generated' ? [{ id: 'host', kind: 'image', prompt: native.host.prompt }] : [],
      notes: [...planText(native).split('\n').filter((l) => /^(likeness|consent|host|voice|avatar):/.test(l)), ...native.notes],
      options: { native, synthetic: true, consent: native.consent || null },
    };
  },
  async render(plan, ctx) {
    const r = await renderPresenter(plan.options.native, { out: ctx.out, work: path.join(ctx.work, 'presenter'), approved: true, offline: ctx.offline, getBackend: ctx.getBackend, log: (m) => fs.appendFileSync(ctx.logFile, `${m}\n`) });
    const mine = new Set(['aspect', 'length']);   // loudness and colour: approveNew
    return {
      outputs: r.exports.map((e) => ({ file: e.file, format: plan.formats[0].id, kind: 'video', width: plan.formats[0].w, height: plan.formats[0].h,
        extraChecks: e.checks.filter((c) => mine.has(c.id)).map((c) => ({ name: c.id, pass: c.pass, text: `${c.id}: ${c.text} ${c.pass ? 'PASS' : 'FAIL'}` })) })),
      captions: r.exports.flatMap((e) => e.subtitles), sheets: r.exports.map((e) => e.sheet).filter(Boolean), weakShots: [],
      notes: ['the presenter is synthetic (generated or licensed host, generated voice)', ...(r.report.notes || [])],
      details: { report: path.basename(r.reportFile), synthetic: true, likeness: r.report.likeness, disclosure: r.report.disclosure, consent: r.report.consent, avatar: r.report.avatar },
    };
  },
};

export { planText };
export default { name, description, help, plan, render, planText };

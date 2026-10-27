// Cited explainer end to end (SPEC recipe 1, R3, R4, C1, L1, L2): real mp4 renders with the mock backend
// (AI_VIDEO_EDITOR_BACKEND=mock), sources from local files and a local HTTP server only, checked with ffprobe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measure } from '../../audio/master.mjs';
import { captionGroups, timeline } from '../render.mjs';
import recipe from '../../new/recipes/explainer-cited.mjs';
import { writePdf, serve, scratch, BEES_HTML, BEES_MD, PDF_LINES } from './helpers.mjs';

const RUN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'run.mjs');
const hasPdftotext = spawnSync('pdftotext', ['-v']).error == null;

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,color_space,color_primaries,color_transfer', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  return { duration: Number(j.format.duration), v: j.streams.find((s) => s.codec_type === 'video'), a: j.streams.find((s) => s.codec_type === 'audio') };
}
function assertDelivery(file, [w, h]) {
  const p = probe(file);
  assert.equal(p.v.codec_name, 'h264');
  assert.deepEqual([p.v.width, p.v.height], [w, h]);
  assert.deepEqual([p.v.color_primaries, p.v.color_transfer, p.v.color_space], ['bt709', 'bt709', 'bt709']);
  assert.equal(p.a?.codec_name, 'aac');
  const m = measure(file);
  assert.ok(Math.abs(m.I - -14) <= 1, `integrated ${m.I} LUFS`);
  assert.ok(m.TP <= -1.5, `true peak ${m.TP} dBTP`);
  return p;
}
// async: the local HTTP server lives in this process, so the event loop must keep running
function runCli(args, env = {}) {
  return new Promise((ok, fail) => {
    const c = spawn(process.execPath, [RUN, ...args], { env: { ...process.env, AI_VIDEO_EDITOR_BACKEND: 'mock', ...env } });
    let stdout = '', stderr = '';
    c.stdout.on('data', (b) => { stdout += b; }); c.stderr.on('data', (b) => { stderr += b; });
    c.on('error', fail); c.on('close', (status) => ok({ status, stdout, stderr }));
  });
}

test('caption groups and the timeline are deterministic and readable', () => {
  const g = captionGroups('Honeybees communicate the location of food sources, through a behaviour called the waggle dance.', 1, 7);
  assert.deepEqual(g.map((c) => c.text), ['Honeybees communicate the', 'location of food sources,', 'through a behaviour called the', 'waggle dance.']);
  assert.equal(g[0].start, 1); assert.equal(g.at(-1).end, 7);
  for (let i = 1; i < g.length; i++) assert.equal(g[i].start, g[i - 1].end);
  const tl = timeline([4, 2], 2);
  assert.deepEqual(tl.segs[1], { start: 4.6, speechStart: 4.85, speechEnd: 6.85, end: 7.2 });
  assert.deepEqual(tl.endCard, { start: 7.2, end: 11.4 });
});

test('run.mjs renders a cited explainer in 9:16 and 16:9 (mock backend, local server + PDF + md)', { skip: !hasPdftotext && 'pdftotext not installed' }, async (t) => {
  const d = scratch(t, 'e2e');
  const srv = await serve({ '/bees.html': { type: 'text/html; charset=utf-8', body: BEES_HTML } });
  t.after(() => srv.close());
  const md = path.join(d, 'nav.md'); fs.writeFileSync(md, BEES_MD);
  const pdf = writePdf(path.join(d, 'pollination.pdf'), PDF_LINES, { title: 'Pollination report' });
  const out = path.join(d, 'out');
  const r = await runCli(['--source', srv.url('/bees.html'), '--source', md, '--source', pdf, '--topic', 'how honeybees find flowers', '-o', out, '--format', 'all', '--length', '14', '--scale', '0.5']);
  assert.equal(r.status, 0, r.stderr);
  const base = 'ai-video-editor_explainer-cited_how-honeybees-find-flowers';
  const report = JSON.parse(fs.readFileSync(path.join(out, `${base}.report.json`), 'utf8'));
  assert.equal(report.recipe, 'explainer-cited');
  assert.equal(report.citation.pass, true);
  assert.equal(report.generations.video, 0);
  assert.equal(report.generations.tts, JSON.parse(fs.readFileSync(path.join(out, 'script.json'), 'utf8')).claims.length);
  for (const [fmt, dims] of [['9x16', [540, 960]], ['16x9', [960, 540]]]) {
    const file = path.join(out, `${base}_${fmt}.mp4`);
    const p = assertDelivery(file, dims);
    const e = report.exports.find((x) => x.format === fmt);
    assert.equal(e.pass, true, JSON.stringify(e.checks));
    assert.ok(Math.abs(p.duration - e.duration) < 0.2, `${p.duration} vs ${e.duration}`);
    assert.deepEqual(e.checks.map((c) => c.name), ['citation', 'loudness', 'color', 'captions', 'citation-chip', 'sources', 'av', 'length']);
    assert.ok(e.visuals.every((v) => v === 'still'), 'mock image backend gives a still per claim');
    // chips are timed to each claim and name the source by its SOURCES.txt number
    assert.ok(e.chips.length >= 2 && e.chips.every((c) => /^\[\d\] \S/.test(c.text) && c.end > c.start));
    const srt = fs.readFileSync(path.join(out, `${base}_${fmt}.srt`), 'utf8');
    assert.match(srt, /^1\n00:00:00,250 --> /);
    assert.ok(fs.existsSync(path.join(out, `${base}_${fmt}.vtt`)) && fs.existsSync(path.join(out, `${base}_${fmt}_sheet.png`)));
  }
  const sources = fs.readFileSync(path.join(out, 'SOURCES.txt'), 'utf8');
  assert.match(sources, /^\[1\] .+\n {4}\S+\n {4}retrieved \d{4}-\d\d-\d\d$/m);
  for (const s of report.sources) assert.ok(sources.includes(`[${s.n}] ${s.title}\n    ${s.url}\n    retrieved ${s.retrieved}`));
  assert.ok(!sources.includes(d) && !sources.includes(path.sep + 'nav.md'), 'no machine paths in SOURCES.txt');
  assert.ok(fs.existsSync(path.join(out, 'sources', 'sources.json')) && fs.existsSync(path.join(out, 'PLAN.txt')));
});

test('recipe interface: plan() then render() with code cards (no image backend), --offline, a style pack', async (t) => {
  const prev = process.env.AI_VIDEO_EDITOR_BACKEND; delete process.env.AI_VIDEO_EDITOR_BACKEND;
  t.after(() => { if (prev != null) process.env.AI_VIDEO_EDITOR_BACKEND = prev; });
  const d = scratch(t, 'recipe');
  const md = path.join(d, 'nav.md'); fs.writeFileSync(md, BEES_MD);
  const out = path.join(d, 'out');
  assert.equal(recipe.name, 'explainer-cited');
  const plan = await recipe.plan({ out, sources: [md], topic: 'waggle dance', length: 10, offline: true, formats: ['16x9'], backends: { tts: 'mock' } });
  assert.deepEqual(plan.generations, { video: 0, image: 0, tts: plan.shots.length });
  assert.ok(plan.shots.every((s) => s.source === 'code' && /^\[1\] Honeybee navigation$/.test(s.cite)));
  assert.match(fs.readFileSync(path.join(out, 'PLAN.txt'), 'utf8'), /generations: 0 video, 0 image, \d+ TTS/);
  const { loadPack } = await import('../../engine/style-pack.mjs');
  const r = await recipe.render(plan, { scale: 0.5, pack: loadPack('broadsheet') });
  assert.equal(r.exports.length, 1);
  assertDelivery(r.exports[0].file, [960, 540]);
  assert.ok(r.exports[0].visuals.every((v) => v === 'code'));
  assert.equal(r.report.citationStyle.pack, 'broadsheet');
  assert.equal(r.exports[0].pass, true, JSON.stringify(r.exports[0].checks));
});

test('plan-only, then an edited script with an invented quote: rendered but the citation check FAILs (exit 1)', async (t) => {
  const d = scratch(t, 'edit');
  const md = path.join(d, 'nav.md'); fs.writeFileSync(md, BEES_MD);
  const out = path.join(d, 'out');
  const p = await runCli(['--source', md, '-o', out, '--plan-only', '--length', '8', '--offline']);
  assert.equal(p.status, 0, p.stderr);
  assert.ok(fs.existsSync(path.join(out, 'plan.json')) && !fs.readdirSync(out).some((f) => f.endsWith('.mp4')));
  const script = JSON.parse(fs.readFileSync(path.join(out, 'script.json'), 'utf8'));
  script.claims[0].quote = 'Honeybees were first domesticated on the Moon in 1802.';
  const edited = path.join(d, 'edited.json');
  fs.writeFileSync(edited, JSON.stringify(script));
  const r = await runCli(['--script', edited, '-o', out, '--scale', '0.5', '--offline']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /citation: FAIL \d+\/\d+ claims quote their source verbatim; c1: quoted passage not found verbatim in S1/);
  const mp4 = fs.readdirSync(out).find((f) => f.endsWith('.mp4'));
  assert.ok(mp4, 'the export is still written');
  assertDelivery(path.join(out, mp4), [540, 960]);
});

// node --test easy-edits/engine/test/final-output.test.mjs: every run must leave a usable final file in the output
// folder (engine/final-output.mjs): missing / empty / unreadable / work-folder-only output is exit 5 with a clear
// message, never a silent exit 0. Mock backend, ffmpeg-made fixtures, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.EASY_EDITS_BACKEND = 'mock';
process.env.EASY_EDITS_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-final-cache-'));
const { finalOutputProblems, assertFinalOutputs, modeFinalFiles, FinalOutputError, EXIT_NO_OUTPUT } = await import('../final-output.mjs');
const { planNew, newMain, resumeMain } = await import('../../new/index.mjs');
const { loadRecipes, getRecipe } = await import('../../new/recipes.mjs');
const { PY } = await import('../media.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(HERE, '../../cli/main.mjs');
const REPO = path.resolve(HERE, '../../..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ee-final-'));
const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,color_primaries,color_transfer,color_space', '-of', 'json', f], { encoding: 'utf8' }));

test('finalOutputProblems: a real mp4 / wav in the output folder pass; missing, empty, broken, outside or .work fail', () => {
  const out = tmp();
  try {
    const mp4 = path.join(out, 'easy-edits_captions_x.mp4'), wav = path.join(out, 'voice.wav');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=160x288:r=30:d=1', '-f', 'lavfi', '-i', 'sine=d=1', '-shortest', '-pix_fmt', 'yuv420p', mp4]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=d=1', wav]);
    assert.deepEqual(finalOutputProblems([mp4, 'voice.wav'], out), []);
    const empty = path.join(out, 'empty.mp4'); fs.writeFileSync(empty, '');
    const junk = path.join(out, 'junk.mp4'); fs.writeFileSync(junk, 'not a video');
    fs.mkdirSync(path.join(out, '.work'));
    const inWork = path.join(out, '.work', 'clip_tail.mp4'); fs.copyFileSync(mp4, inWork);
    const elsewhere = path.join(tmp(), 'x.mp4'); fs.copyFileSync(mp4, elsewhere);
    const why = (f) => finalOutputProblems([f], out).map((p) => p.problem).join('; ');
    assert.match(why(path.join(out, 'gone.mp4')), /missing/);
    assert.match(why(empty), /empty \(0 bytes\)/);
    assert.match(why(junk), /ffprobe cannot read it/);
    assert.match(why(inWork), /work file \(\.work\/\)/);
    assert.match(why(elsewhere), /not inside the output folder/);
    assert.match(finalOutputProblems([], out).map((p) => p.problem).join(), /expected 1 final file\(s\), the run reported 0/);
    assert.throws(() => assertFinalOutputs([path.join(out, 'gone.mp4')], out), (e) => e instanceof FinalOutputError && /no usable final output in .*\n  - .*gone\.mp4: missing/.test(e.message));
    assert.equal(EXIT_NO_OUTPUT, 5);
    fs.rmSync(path.dirname(elsewhere), { recursive: true, force: true });
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('modeFinalFiles: exports for a render, the plan for --plan-only, PROPOSALS.txt for shorts --propose', () => {
  const o = { mode: 'captions', out: '/o' };
  assert.deepEqual(modeFinalFiles(o, { exports: [{ file: '/o/a.mp4' }, { file: '/o/b.mp4' }] }), { files: ['/o/a.mp4', '/o/b.mp4'], expect: 1 });
  // the failure the one-line install hit: a run that ends without an export must not count as done
  assert.deepEqual(modeFinalFiles(o, {}), { files: [], expect: 1 });
  assert.ok(finalOutputProblems(modeFinalFiles(o, {}).files, tmp()).length);
  assert.deepEqual(modeFinalFiles({ ...o, mode: 'talking-head', planOnly: true }, { plan: '/o/p.json', exports: [] }).files, ['/o/p.json']);
  assert.deepEqual(modeFinalFiles({ ...o, mode: 'shorts', propose: true }, { proposals: [{ preview: '/elsewhere/p.mp4' }], exports: [] }).files, [path.join('/o', 'PROPOSALS.txt')]);
});

test('new / resume: a recipe whose final file vanished exits 5 with the file named; a good render passes', async () => {
  await loadRecipes();
  const dir = tmp();
  const recipe = getRecipe('story'), render = recipe.render;
  try {
    fs.writeFileSync(path.join(dir, 's.txt'), 'A first beat.\nA second beat.\n');
    const { planFile } = await planNew('story', { out: path.join(dir, 'o'), script: path.join(dir, 's.txt'), format: '270x480' });
    // the renderer is killed after the work files but before the final lands: simulate it by removing the outputs
    recipe.render = async (plan, ctx) => { const r = await render.call(recipe, plan, ctx); for (const x of r.outputs) fs.rmSync(x.file, { force: true }); return r; };
    const errs = [], err = console.error;
    console.error = (...a) => errs.push(a.join(' '));
    let code;
    try { code = await newMain(['--approve', planFile]); } finally { console.error = err; }
    assert.equal(code, EXIT_NO_OUTPUT, errs.join('\n'));
    assert.match(errs.join('\n'), /easy-edits new: FAILED: no usable final output in .*\n  - .*easy-edits_story_.*\.mp4: missing/);
    assert.ok(!fs.existsSync(path.join(dir, 'o', 'DELIVERY.json')), 'no DELIVERY.json for a run without a final file');
    recipe.render = render;
    assert.equal(await resumeMain([path.join(dir, 'o')]), 0, 'resume renders it properly');
    const delivery = JSON.parse(fs.readFileSync(path.join(dir, 'o', 'DELIVERY.json'), 'utf8'));
    const final = path.join(dir, 'o', delivery.primary);
    assert.ok(fs.statSync(final).size > 0);
    assert.ok(probe(final).streams.some((s) => s.codec_type === 'video'));
  } finally { recipe.render = render; fs.rmSync(dir, { recursive: true, force: true }); }
});

// the real CLI, end to end: captions on a short synthetic clip (transcript given, so no ASR) must write the final mp4
// into -o and record finalOutput.ok in the report. Needs the installed venv (OpenCV for the face track) + HyperFrames.
const canRender = spawnSync(PY, ['-c', 'import cv2'], { encoding: 'utf8' }).status === 0 && fs.existsSync(path.join(REPO, 'node_modules/.bin/hyperframes'));
test('captions CLI: the final mp4 lands in the output folder (not only .work) and the report says so', { skip: !canRender && 'needs ./install.sh (venv with OpenCV, HyperFrames)', timeout: 600000 }, () => {
  const dir = tmp();
  try {
    const clip = path.join(dir, 'clip.mp4'), tr = path.join(dir, 'clip.words.json'), out = path.join(dir, 'out');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=3', '-f', 'lavfi', '-i', 'sine=f=220:d=3', '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
    fs.writeFileSync(tr, JSON.stringify({ words: [{ text: 'Hello', start: 0.3, end: 0.7 }, { text: 'there,', start: 0.8, end: 1.2 }, { text: 'final', start: 1.5, end: 1.9 }, { text: 'file.', start: 2.0, end: 2.5 }] }));
    const r = spawnSync(process.execPath, [MAIN, 'captions', clip, '-o', out, '--transcript', tr, '--agent', 'none', '--no-music'], { encoding: 'utf8', env: { ...process.env, EASY_EDITS_WORKERS: '2' } });
    assert.ok(r.status === 0 || r.status === 1, `exit ${r.status}\n${r.stderr.slice(-2000)}`);   // 1 = a delivery FAIL on a test tone, the file is still written
    const final = path.join(out, 'easy-edits_captions_clip.mp4');
    assert.ok(fs.existsSync(final) && fs.statSync(final).size > 0, `no final in ${out}: ${fs.readdirSync(out).join(', ')}`);
    const p = probe(final), v = p.streams.find((s) => s.codec_type === 'video');
    assert.ok(v && p.streams.some((s) => s.codec_type === 'audio'));
    assert.deepEqual([v.color_primaries, v.color_transfer, v.color_space], ['bt709', 'bt709', 'bt709']);
    assert.ok(Number(p.format.duration) > 2.5);
    const rep = JSON.parse(fs.readFileSync(path.join(out, 'easy-edits_captions_clip.report.json'), 'utf8'));
    assert.deepEqual(rep.finalOutput, { ok: true, files: [final], problems: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

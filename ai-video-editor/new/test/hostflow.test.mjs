// node --test ai-video-editor/new/test/hostflow.test.mjs: the host generation flow (approve -> exit 3 + GENERATION_MANIFEST.json
// -> the assistant saves each asset -> `ai-video-editor resume` -> final mp4) and the generated-clip audio policy.
// No network: images / video use the `host` adapter (it only writes the manifest; these tests "generate" the assets with
// ffmpeg testsrc), voice and avatar use `mock`. AI_VIDEO_EDITOR_BACKEND is unset here because it forces one backend for
// every kind; --backend mock --video-backend host --image-backend host gives the same mock voice with host pictures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measure } from '../../audio/master.mjs';
import { clipAudioPolicy, DUCK_DB } from '../clip-audio.mjs';
import { hostId, resolveBackendNames, DEFAULT_BACKENDS } from '../hostflow.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(HERE, '../../cli/main.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ee-host-'));
const env = { ...process.env, AI_VIDEO_EDITOR_CACHE: 'off' };
delete env.AI_VIDEO_EDITOR_BACKEND;
const run = (args) => spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8', env });
const HOST = ['--backend', 'mock', '--video-backend', 'host', '--image-backend', 'host', '--format', '270x480'];
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const vstream = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,color_primaries,color_transfer,color_space', '-of', 'json', f], { encoding: 'utf8' })).streams.find((s) => s.codec_type === 'video');

/** What the assistant does: make every manifest asset (a test pattern; video clips carry a 1 kHz sine "ambience"). */
function fillManifest(out, { audio = true } = {}) {
  const m = json(path.join(out, 'GENERATION_MANIFEST.json'));
  for (const a of m.assets) {
    const f = path.join(out, a.file);
    if (a.type === 'image') execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=540x960', '-frames:v', '1', f]);
    else {
      const d = String(a.durationSec || 4);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=540x960:r=24:d=${d}`, ...(audio ? ['-f', 'lavfi', '-i', `sine=f=1000:d=${d}`, '-c:a', 'aac'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', d, f]);
    }
  }
  return m.assets;
}

/** Mean level (dB) of the 1 kHz band: the generated clips' sine, separate from the mock voice (220 / 330 Hz). */
function band1k(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vn', '-af', 'bandpass=f=1000:width_type=q:w=10,bandpass=f=1000:width_type=q:w=10,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/);
  return m && m[1] !== '-inf' ? Number(m[1]) : -120;
}

function checkFinal(out) {
  const d = json(path.join(out, 'DELIVERY.json'));
  const f = path.join(out, d.primary);
  const v = vstream(f);
  assert.deepEqual([v.width, v.height, v.color_primaries, v.color_transfer, v.color_space], [270, 480, 'bt709', 'bt709', 'bt709']);
  const m = measure(f);
  assert.ok(Math.abs(m.I + 14) <= 1 && m.TP <= -1.5, JSON.stringify(m));
  assert.equal(d.published, false);
  return { d, f, report: json(path.join(out, 'report.json')) };
}

test('defaults: image + video go to the host backend, voice + avatar local; AI_VIDEO_EDITOR_BACKEND forces every kind', () => {
  const saved = process.env.AI_VIDEO_EDITOR_BACKEND;
  delete process.env.AI_VIDEO_EDITOR_BACKEND;
  try {
    assert.deepEqual(resolveBackendNames({}), DEFAULT_BACKENDS);
    assert.equal(DEFAULT_BACKENDS.video, 'host'); assert.equal(DEFAULT_BACKENDS.image, 'host');
    assert.deepEqual(resolveBackendNames({ backend: 'mock', videoBackend: 'host' }), { video: 'host', image: 'mock', tts: 'mock', avatar: 'mock', llm: 'mock', search: 'mock' });
    process.env.AI_VIDEO_EDITOR_BACKEND = 'mock';
    assert.equal(new Set(Object.values(resolveBackendNames({ videoBackend: 'host' }))).size, 1);
  } finally { if (saved == null) delete process.env.AI_VIDEO_EDITOR_BACKEND; else process.env.AI_VIDEO_EDITOR_BACKEND = saved; }
  assert.ok(!Object.values(DEFAULT_BACKENDS).some((n) => n !== 'host' && n !== 'local' && n !== 'none'), 'no hosted (network) backend by default');
  assert.equal(hostId('s1', 'video', { prompt: 'a' }), hostId('s1', 'video', { prompt: 'a' }));
  assert.notEqual(hostId('s1', 'video', { prompt: 'a' }), hostId('s1', 'video', { prompt: 'b' }), 'an edited prompt is a new asset');
});

test('clip audio policy: dropped under narration or a song, -18 dB under music, as-is alone; the flag wins', () => {
  assert.equal(clipAudioPolicy('auto', { voice: true }).mode, 'drop');
  assert.equal(clipAudioPolicy('auto', { song: true }).mode, 'drop');
  assert.deepEqual([clipAudioPolicy('auto', { music: true }).mode, clipAudioPolicy('auto', { music: true }).gainDb], ['duck', DUCK_DB]);
  assert.equal(DUCK_DB, -18);
  assert.deepEqual([clipAudioPolicy('auto', {}).mode, clipAudioPolicy('auto', {}).gainDb], ['keep', 0]);
  assert.equal(clipAudioPolicy('keep', { voice: true }).mode, 'keep');
  assert.equal(clipAudioPolicy('duck', {}).gainDb, -18);
  assert.equal(clipAudioPolicy('drop', {}).mode, 'drop');
  assert.equal(run(['new', 'story', '-o', tmp(), '--brief', 'x.', '--clip-audio', 'loud']).status, 2);
});

test('host flow (story): plan writes no manifest; approve -> exit 3 + manifest; resume refuses until every asset exists; then a final mp4', () => {
  const dir = tmp();
  try {
    const out = path.join(dir, 'story');
    const p = run(['new', 'story', '-o', out, '--brief', 'A lighthouse at dusk. Waves hit the rocks. The light turns on.', ...HOST]);
    assert.equal(p.status, 0, p.stderr);
    assert.match(p.stdout, /host generation: 3 asset\(s\) are made by your assistant's built-in image\/video generation/);
    assert.ok(!fs.existsSync(path.join(out, 'GENERATION_MANIFEST.json')), 'nothing before approval');
    assert.equal(run(['resume', out]).status, 2, 'resume needs an approved plan');

    const a = run(['new', '--approve', path.join(out, 'plan.json')]);
    assert.equal(a.status, 3, a.stderr);
    assert.match(a.stdout, /GENERATION_MANIFEST\.json/);
    assert.match(a.stdout, /your assistant's built-in image\/video generation/);
    assert.match(a.stdout, /ai-video-editor resume /);
    const m = json(path.join(out, 'GENERATION_MANIFEST.json'));
    assert.equal(m.assets.length, 3);
    for (const x of m.assets) {
      for (const k of ['id', 'type', 'prompt', 'durationSec', 'aspect', 'referenceImages', 'file']) assert.ok(k in x, `${k} in ${JSON.stringify(x)}`);
      assert.equal(x.type, 'video'); assert.equal(x.aspect, '9:16'); assert.match(x.file, /^assets\/s\d-[0-9a-f]{8}\.mp4$/);
    }
    assert.ok(!fs.readdirSync(out).some((f) => f.endsWith('.mp4')), 'nothing rendered while waiting');

    const r0 = run(['resume', out]);
    assert.equal(r0.status, 3);
    for (const x of m.assets) assert.ok(r0.stdout.includes(x.file), `lists ${x.file}`);

    fillManifest(out);
    fs.writeFileSync(path.join(out, m.assets[0].file), '');   // a broken save is listed, not rendered
    const r1 = run(['resume', out]);
    assert.equal(r1.status, 3); assert.match(r1.stdout, /empty file/);
    fillManifest(out);

    const r = run(['resume', out]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const { report } = checkFinal(out);
    assert.equal(report.generations.used, 3); assert.equal(report.generations.cached, 3);
    assert.equal(report.hostAssets.length, 3);
    assert.equal(report.clipAudio.mode, 'keep', 'no narration or music: the clips\' own audio is the soundtrack');
    assert.ok(fs.existsSync(path.join(out, 'REVIEW.txt')));

    // an edit after approval: resume refuses (exit 2) until the plan is approved again
    const pf = path.join(out, 'plan.json');
    const plan = json(pf); plan.title = 'edited'; fs.writeFileSync(pf, JSON.stringify(plan, null, 2));
    assert.equal(run(['new', 'repin', pf]).status, 0);
    const e = run(['resume', out]);
    assert.equal(e.status, 2); assert.match(e.stderr, /changed after it was approved/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('generated-clip audio: dropped under narration by default; --clip-audio keep mixes it in; both mastered to -14 LUFS / -1.5 dBTP', () => {
  const dir = tmp();
  try {
    const levels = {};
    for (const mode of ['auto', 'keep']) {
      const out = path.join(dir, mode);
      assert.equal(run(['new', 'story', '-o', out, '--brief', 'Rain falls on the old city tonight. A cat watches from a window.', '--narrate', '--clip-audio', mode, ...HOST]).status, 0);
      assert.equal(run(['new', '--approve', path.join(out, 'plan.json')]).status, 3);
      fillManifest(out);
      const r = run(['resume', out]);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const { f, report } = checkFinal(out);
      assert.equal(report.clipAudio.mode, mode === 'auto' ? 'drop' : 'keep');
      assert.equal(report.clipAudio.withAudio, 2);
      levels[mode] = band1k(f);
    }
    assert.ok(levels.keep - levels.auto > 25, `1 kHz clip sine: auto ${levels.auto} dB vs keep ${levels.keep} dB`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('host flow (explainer-cited stills, presenter host image): exit 3, fill, resume -> final mp4', () => {
  const dir = tmp();
  try {
    const notes = path.join(dir, 'notes.md');
    fs.writeFileSync(notes, 'Honeybees share the location of food with a waggle dance on the comb.\nThe angle of the dance points the way relative to the sun.\nThe length of the waggle run tells the other bees how far to fly.\n');
    const script = path.join(dir, 'host.txt');
    fs.writeFileSync(script, 'Three tips for better sleep. Keep the same wake-up time every day. Dim the lights an hour before bed.\n');
    for (const [type, extra, kinds] of [
      ['explainer-cited', ['--source', notes, '--topic', 'the waggle dance', '--length', '10-40'], 'image'],
      ['presenter', ['--script', script], 'image'],
    ]) {
      const out = path.join(dir, type);
      const p = run(['new', type, '-o', out, ...extra, ...HOST]);
      assert.equal(p.status, 0, `${type}: ${p.stderr}`);
      const a = run(['new', '--approve', path.join(out, 'plan.json')]);
      assert.equal(a.status, 3, `${type}: ${a.stderr}`);
      const assets = fillManifest(out);
      assert.ok(assets.length >= 1 && assets.every((x) => x.type === kinds), type);
      if (type === 'presenter') assert.equal(assets.length, 1, 'one fictional host image');
      const r = run(['resume', out]);
      assert.equal(r.status, 0, `${type}: ${r.stderr}${r.stdout}`);
      const { report } = checkFinal(out);
      assert.equal(report.generations.cached, assets.length);
      if (type === 'presenter') assert.equal(report.synthetic, true);
      if (type === 'explainer-cited') assert.ok(fs.existsSync(path.join(out, 'SOURCES.txt')));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

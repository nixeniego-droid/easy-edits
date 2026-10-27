// node --test ai-video-editor/new/test/new.test.mjs: `ai-video-editor new` (plan -> storyboard -> approval gate -> render ->
// verify -> deliverables), the promo and podcast recipes and the generic recipes. Mock backend only, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFormats, captionsFromSegments, voiceTimeline, fitDurations, timelineSec } from '../assemble.mjs';
import { finishPreset, PRESETS } from '../finish.mjs';
import { loadRecipes, mapBrief, parseScript, getRecipe } from '../recipes.mjs';
import { planNew, approveNew, parseLength } from '../index.mjs';
import { readApproved, PlanError } from '../plan.mjs';
import { measure } from '../../audio/master.mjs';
import { registerAdapter } from '../../gen/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(HERE, '../../cli/main.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ee-new-'));
const ee = (args, env = {}) => spawnSync(process.execPath, [MAIN, 'new', ...args], { encoding: 'utf8', env: { ...process.env, AI_VIDEO_EDITOR_BACKEND: 'mock', ...env } });
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,color_primaries,color_transfer,color_space', '-of', 'json', f], { encoding: 'utf8' }));
const vstream = (f) => probe(f).streams.find((s) => s.codec_type === 'video');
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function brandFixture(dir) {
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#FF5A36:s=200x200', '-frames:v', '1', path.join(assets, 'logo.png')]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240', '-frames:v', '1', path.join(assets, 'product.jpg')]);
  const brand = path.join(dir, 'brand.json');
  fs.writeFileSync(brand, JSON.stringify({ name: 'Acme Notes', tagline: 'Your notes, sorted.', colors: { background: '#0E1116', text: '#FFFFFF', accent: '#FF5A36' }, product: { name: 'Acme Pro', price: '$4/mo', features: ['Offline first', 'Fast search'] }, cta: 'Try it free', url: 'acme.example' }));
  return { brand, assets };
}

const SCRIPT = 'A: Welcome back to the show, today we plan first.\nB: Nothing is generated until you approve it.\nA: And podcasts land at minus sixteen.\n';

test('formats: presets, 4:5, custom WxH, all; bad input refused', () => {
  assert.deepEqual(parseFormats('9x16'), [{ id: '9x16', w: 1080, h: 1920 }]);
  assert.deepEqual(parseFormats('4x5,16:9').map((f) => [f.w, f.h]), [[1080, 1350], [1920, 1080]]);
  assert.deepEqual(parseFormats('720x1280')[0], { id: '720x1280', w: 720, h: 1280 });
  assert.deepEqual(parseFormats('all').map((f) => f.id), ['9x16', '1x1', '16x9']);
  assert.throws(() => parseFormats('3x2'), /unknown format/);
  assert.throws(() => parseFormats('721x1280'), /even/);
});

test('finish presets: social -14 / podcast -16, both -1.5 dBTP; --loudness N; --length ranges', () => {
  assert.deepEqual(PRESETS.social, { name: 'social', target: -14, truePeak: -1.5 });
  assert.deepEqual(PRESETS.podcast, { name: 'podcast', target: -16, truePeak: -1.5 });
  assert.equal(finishPreset(null, 'podcast').target, -16);
  assert.equal(finishPreset('-18').target, -18);
  assert.equal(finishPreset('-18').truePeak, -1.5);
  assert.throws(() => finishPreset('loud'), /--loudness/);
  assert.deepEqual(parseLength('15'), [15, 15]);
  assert.deepEqual(parseLength('30-60'), [30, 60]);
  assert.deepEqual(parseLength('0:30-1:30'), [30, 90]);
  assert.throws(() => parseLength('60-30'));
});

test('recipes: every type is registered; other maps a brief by keywords', async () => {
  await loadRecipes();
  for (const t of ['explainer-cited', 'presenter', 'podcast', 'story', 'promo', 'music-video']) {
    const r = getRecipe(t);
    assert.ok(r && typeof r.plan === 'function' && typeof r.render === 'function', t);
  }
  assert.equal(mapBrief('a two person interview episode').recipe, 'podcast');
  assert.equal(mapBrief('launch teaser for our product').recipe, 'promo');
  assert.equal(mapBrief('cut to my song').recipe, 'music-video');
  assert.equal(mapBrief('a bedtime story about a dragon character').recipe, 'story');
  assert.deepEqual(mapBrief('zzz'), { recipe: 'explainer-cited', matched: [] });
});

test('script parsing, caption timing from known text, voice timeline turn gaps, shot fitting', () => {
  assert.deepEqual(parseScript('# c\nA: hi there\n\nplain line\nBen: yo'), [{ speaker: 'A', text: 'hi there' }, { speaker: null, text: 'plain line' }, { speaker: 'Ben', text: 'yo' }]);
  const { segments, end } = voiceTimeline([{ durationSec: 2, speaker: 'A' }, { durationSec: 1, speaker: 'A' }, { durationSec: 1, speaker: 'B' }], { lead: 0.5, gap: 0.2, turnGap: 0.5, tail: 0.5 });
  assert.deepEqual(segments.map((s) => s.start), [0.5, 2.7, 4.2]);
  assert.equal(end, 5.7);
  const caps = captionsFromSegments([{ start: 1, end: 4, text: 'one two three four five six seven eight nine', label: 'Ana' }]);
  assert.ok(caps.length >= 2);
  assert.equal(caps[0].start, 1); assert.ok(Math.abs(caps.at(-1).end - 4) < 1e-9);
  assert.ok(caps.every((c) => c.label === 'Ana' && c.text.split(' ').length <= 6));
  const shots = [{ durationSec: 2, transition: 'cut' }, { durationSec: 3, transition: 'fade' }, { durationSec: 1, transition: 'fade' }];
  const d = fitDurations(shots, 9);
  assert.ok(Math.abs(timelineSec(d, shots) - 9) < 1e-6);
});

test('plan gate: plan.json + sha256 pin + PLAN.txt + storyboard; edits refused until repin', () => {
  const dir = tmp();
  try {
    const { brand, assets } = brandFixture(dir);
    const out = path.join(dir, 'p');
    const r = ee(['promo', '-o', out, '--brand', brand, '--assets', assets, '--format', '9x16', '--length', '6']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^generations: 0 video, 0 image, 0 TTS$/m);
    assert.match(r.stdout, /^estimated cost: \$0\.00/m);
    assert.match(r.stdout, /^estimated wall time: \d+/m);
    assert.match(r.stdout, /^will send: nothing/m);
    for (const f of ['plan.json', 'plan.json.sha256', 'PLAN.txt', 'storyboard.png']) assert.ok(fs.existsSync(path.join(out, f)), f);
    assert.ok(!fs.readdirSync(out).some((f) => f.endsWith('.mp4')), 'planning renders nothing');
    const plan = json(path.join(out, 'plan.json'));
    assert.equal(plan.generations.total, 0);
    assert.ok(plan.shots.every((s) => s.id && s.durationSec > 0 && s.source === 'code' && 'prompt' in s && Array.isArray(s.refs) && s.camera && s.transition));
    const sb = vstream(path.join(out, 'storyboard.png'));
    assert.ok(sb.width >= 360 * 2 && sb.height > 200, 'grid with a cell per shot');
    // edit without re-pin -> refused
    plan.shots[0].durationSec = 9;
    fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 2));
    assert.throws(() => readApproved(path.join(out, 'plan.json')), PlanError);
    const a = ee(['--approve', path.join(out, 'plan.json')]);
    assert.equal(a.status, 2);
    assert.match(a.stderr, /edited after it was pinned/);
    assert.equal(ee(['repin', path.join(out, 'plan.json')]).status, 0);
    assert.doesNotThrow(() => readApproved(path.join(out, 'plan.json')));
    // a pinned plan of another type is refused
    assert.match(ee(['podcast', '--approve', path.join(out, 'plan.json')]).stderr, /is a "promo" plan/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--max-generations refuses an over-budget plan (nothing written)', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 's.txt'), 'One beat here.\nTwo beat here.\nThree beat here.\n');
    const out = path.join(dir, 'o');
    const r = ee(['story', '-o', out, '--script', path.join(dir, 's.txt'), '--max-generations', '2']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /needs 6 generations \(3 video, 0 image, 3 TTS\) but --max-generations is 2/);
    assert.ok(!fs.existsSync(path.join(out, 'plan.json')));
    assert.equal(ee(['story', '-o', out, '--script', path.join(dir, 's.txt'), '--max-generations', '6']).status, 0);
    assert.equal(ee(['--approve', path.join(out, 'plan.json'), '--max-generations', '5']).status, 2, 'the budget is checked again at approval');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('network backends: cost estimate, "will send" lines and --offline refusal', async () => {
  const saved = process.env.AI_VIDEO_EDITOR_BACKEND;
  delete process.env.AI_VIDEO_EDITOR_BACKEND;
  registerAdapter('nettest', (kind) => ({ name: 'nettest', kind, capabilities: { maxClipSeconds: 6, aspects: ['9:16'], references: true, voiceClone: false, costPerCall: 0.25, network: true, secondsPerCall: 10 }, async generate() { throw new Error('no network in tests'); } }));
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 's.txt'), 'A first beat.\nA second beat.\n');
    const { plan, planFile } = await planNew('story', { out: path.join(dir, 'o'), script: path.join(dir, 's.txt'), backend: 'nettest', format: '270x480' });
    assert.equal(plan.generations.total, 4);
    assert.equal(plan.estimate.cost, 1);
    assert.ok(plan.estimate.wallSec >= 40);
    assert.deepEqual(plan.willSend, ['will send: 2 prompt(s) to nettest (video)', 'will send: 2 script line(s) (6 words) to nettest (tts)']);
    const txt = fs.readFileSync(path.join(path.dirname(planFile), 'PLAN.txt'), 'utf8');
    assert.match(txt, /^estimated cost: \$1\.00/m);
    assert.match(txt, /^will send: 2 prompt\(s\) to nettest \(video\)$/m);
    await assert.rejects(planNew('story', { out: path.join(dir, 'o2'), script: path.join(dir, 's.txt'), backend: 'nettest', offline: true }), /--offline: backend "nettest" needs the network/);
    await assert.rejects(approveNew(planFile, { offline: true }), /--offline: backend "nettest" needs the network/);
  } finally {
    if (saved != null) process.env.AI_VIDEO_EDITOR_BACKEND = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('promo renders end to end: zero generations, 4:5 + 1:1, -14 LUFS / -1.5 dBTP, BT.709, deliverables', () => {
  const dir = tmp();
  try {
    const { brand, assets } = brandFixture(dir);
    const out = path.join(dir, 'promo');
    assert.equal(ee(['promo', '-o', out, '--brand', brand, '--assets', assets, '--format', '4x5,1x1', '--length', '6', '--post-draft'], { AI_VIDEO_EDITOR_BACKEND: '' }).status, 0);
    const r = ee(['--approve', path.join(out, 'plan.json')], { AI_VIDEO_EDITOR_BACKEND: '' });
    assert.equal(r.status, 0, r.stderr);
    const files = ['ai-video-editor_promo_acme-notes_4x5.mp4', 'ai-video-editor_promo_acme-notes_1x1.mp4'];
    for (const [f, w, h] of [[files[0], 1080, 1350], [files[1], 1080, 1080]]) {
      const p = probe(path.join(out, f));
      const v = p.streams.find((s) => s.codec_type === 'video');
      assert.equal(v.codec_name, 'h264'); assert.equal(v.width, w); assert.equal(v.height, h);
      assert.deepEqual([v.color_primaries, v.color_transfer, v.color_space], ['bt709', 'bt709', 'bt709']);
      assert.ok(p.streams.some((s) => s.codec_type === 'audio'));
      assert.ok(Math.abs(Number(p.format.duration) - 6) < 0.5, `duration ${p.format.duration}`);
      const m = measure(path.join(out, f));
      assert.ok(Math.abs(m.I + 14) <= 1, `I ${m.I}`); assert.ok(m.TP <= -1.5, `TP ${m.TP}`);
    }
    const rep = json(path.join(out, 'report.json'));
    assert.equal(rep.generations.used, 0);
    assert.ok(Array.isArray(rep.WEAK_SHOTS));
    assert.ok(rep.outputs.every((o) => o.pass));
    const d = json(path.join(out, 'DELIVERY.json'));
    assert.equal(d.primary, files[0]); assert.deepEqual(d.alternates, [files[1]]);
    assert.equal(d.loudness.target, -14); assert.equal(d.loudness.truePeak, -1.5);
    assert.ok(Number.isFinite(d.loudness.measured[files[0]].I) && Number.isFinite(d.loudness.measured[files[0]].TP));
    assert.equal(d.color[files[0]], 'bt709/bt709/bt709');
    assert.equal(d.published, false); assert.equal(d.postDraft, 'POST_DRAFT.txt');
    assert.ok(!JSON.stringify(d).includes(dir), 'DELIVERY.json paths are relative');
    assert.match(fs.readFileSync(path.join(out, 'POST_DRAFT.txt'), 'utf8'), /^DRAFT - /);
    assert.match(fs.readFileSync(path.join(out, 'REVIEW.txt'), 'utf8'), /WEAK SHOTS/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('podcast --audio-only: two voices -> WAV + MP3 at -16 LUFS / -1.5 dBTP, speaker-named captions', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'ep.txt'), SCRIPT);
    const out = path.join(dir, 'pod');
    const p = ee(['podcast', '-o', out, '--script', path.join(dir, 'ep.txt'), '--audio-only', '--speakers', 'A=Host,B=Guest']);
    assert.equal(p.status, 0, p.stderr);
    assert.match(p.stdout, /^generations: 0 video, 0 image, 3 TTS$/m);
    const plan = json(path.join(out, 'plan.json'));
    assert.equal(plan.finish.target, -16);
    assert.deepEqual(plan.voice.map((v) => v.speaker), ['A', 'B', 'A']);
    const r = ee(['--approve', path.join(out, 'plan.json')]);
    assert.equal(r.status, 0, r.stderr);
    for (const [f, codec] of [['ai-video-editor_podcast_podcast.wav', 'pcm_s16le'], ['ai-video-editor_podcast_podcast.mp3', 'mp3']]) {
      const pr = probe(path.join(out, f));
      assert.equal(pr.streams.length, 1); assert.equal(pr.streams[0].codec_name, codec);
      const m = measure(path.join(out, f));
      assert.ok(Math.abs(m.I + 16) <= 1, `${f} I ${m.I}`); assert.ok(m.TP <= -1.5, `${f} TP ${m.TP}`);
    }
    const srt = fs.readFileSync(path.join(out, 'ai-video-editor_podcast_podcast.srt'), 'utf8');
    assert.match(srt, /Host: Welcome back/); assert.match(srt, /Guest: Nothing is generated/);
    const rep = json(path.join(out, 'report.json'));
    const turns = rep.timeline.turns;
    assert.ok(turns[1].at - turns[0].end >= 0.44, 'turn gap between speakers');
    assert.ok(!fs.readdirSync(out).some((f) => f.endsWith('.mp4')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('podcast video: waveform visual with speaker captions, -16 LUFS, BT.709', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'ep.txt'), SCRIPT);
    const out = path.join(dir, 'pod');
    assert.equal(ee(['podcast', '-o', out, '--script', path.join(dir, 'ep.txt'), '--format', '640x360', '--title', 'Plan First']).status, 0);
    const r = ee(['--approve', path.join(out, 'plan.json'), '--post-draft', '--hashtags', 'video,podcast']);
    assert.equal(r.status, 0, r.stderr);
    const f = path.join(out, 'ai-video-editor_podcast_plan-first.mp4');
    const v = vstream(f);
    assert.deepEqual([v.width, v.height, v.color_primaries, v.color_transfer, v.color_space], [640, 360, 'bt709', 'bt709', 'bt709']);
    const m = measure(f);
    assert.ok(Math.abs(m.I + 16) <= 1 && m.TP <= -1.5, JSON.stringify(m));
    const draft = fs.readFileSync(path.join(out, 'POST_DRAFT.txt'), 'utf8');
    assert.match(draft, /^DRAFT - /); assert.match(draft, /#video #podcast/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const NOTES = 'Sunlight is made of many colours that travel together as white light.\nWhen sunlight enters the air, the short blue waves scatter far more than the long red waves.\nThis scattering sends blue light across the whole sky, so the sky looks blue from the ground.\nAt sunset the light crosses much more air, and the scattered blue fades before it reaches us.\n';

test('generic recipes render with the mock backend (explainer-cited, presenter, story, other, music-video)', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 's.txt'), 'Why is the sky blue?\nSunlight scatters off the air.\n');
    fs.writeFileSync(path.join(dir, 'notes.md'), NOTES);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-ar', '48000', path.join(dir, 'song.wav')]);
    const runs = [
      ['explainer-cited', ['--source', path.join(dir, 'notes.md'), '--topic', 'why the sky is blue', '--length', '15-40']],
      ['presenter', ['--script', path.join(dir, 's.txt')]],
      ['story', ['--script', path.join(dir, 's.txt')]],
      ['other', ['--brief', 'An interview episode. Two voices.', '--script', path.join(dir, 's.txt')]],
      ['music-video', ['--song', path.join(dir, 'song.wav'), '--i-own-this-music', '--brief', 'neon city']],
    ];
    for (const [type, extra] of runs) {
      const out = path.join(dir, type);
      const p = ee([type, '-o', out, '--format', '270x480', ...extra]);
      assert.equal(p.status, 0, `${type}: ${p.stderr}`);
      const r = ee(['--approve', path.join(out, 'plan.json')]);
      assert.equal(r.status, 0, `${type}: ${r.stderr}`);
      const d = json(path.join(out, 'DELIVERY.json'));
      const v = vstream(path.join(out, d.primary));
      assert.deepEqual([v.width, v.height, v.color_primaries], [270, 480, 'bt709'], type);
      if (type === 'other') assert.match(p.stdout, /type: other -> podcast \(matched: episode, interview\)/);
      if (type === 'presenter') assert.equal(json(path.join(out, 'report.json')).synthetic, true);
    }
    assert.notEqual(ee(['music-video', '-o', path.join(dir, 'x'), '--song', path.join(dir, 'song.wav')]).status, 0, 'needs --i-own-this-music');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('weak shots: a generated clip shorter than its shot is named in WEAK_SHOTS and REVIEW.txt', () => {
  const dir = tmp();
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=11', '-ar', '48000', path.join(dir, 'song.wav')]);
    const out = path.join(dir, 'mv');
    assert.equal(ee(['music-video', '-o', out, '--song', path.join(dir, 'song.wav'), '--i-own-this-music', '--format', '270x480']).status, 0);
    const pf = path.join(out, 'plan.json');
    const plan = json(pf);
    plan.shots = [{ ...plan.shots[0], id: 'long', durationSec: 11 }];   // mock clips cap at 8 s
    fs.writeFileSync(pf, JSON.stringify(plan, null, 2));
    assert.equal(ee(['repin', pf]).status, 0);
    assert.equal(ee(['--approve', pf]).status, 0);
    const weak = json(path.join(out, 'report.json')).WEAK_SHOTS;
    assert.equal(weak.length, 1); assert.equal(weak[0].shot, 'long');
    assert.match(weak[0].reason, /generated clip is 8\.0 s for a 11\.0 s shot/);
    assert.match(fs.readFileSync(path.join(out, 'REVIEW.txt'), 'utf8'), /Shot long \(at 0\.0 s\) is weak: .* Suggested fix: /);
    assert.equal(json(path.join(out, 'DELIVERY.json')).weakShots.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--length is a delivery check: a render outside the range FAILs (exit 1)', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 's.txt'), NOTES);
    const out = path.join(dir, 'o');
    assert.equal(ee(['explainer-cited', '-o', out, '--script', path.join(dir, 's.txt'), '--format', '270x480', '--length', '1']).status, 0);
    const r = ee(['--approve', path.join(out, 'plan.json')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /FAIL .* length: [\d.]+ s \(target 1 s\) FAIL/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: new --help, types list, unknown type', () => {
  const h = ee(['--help']);
  assert.equal(h.status, 0); assert.match(h.stdout, /ai-video-editor new --approve/);
  assert.match(ee(['types']).stdout, /^promo\s/m);
  assert.equal(ee(['frobnicate', '-o', tmp()]).status, 2);
  assert.match(spawnSync(process.execPath, [MAIN, '--help'], { encoding: 'utf8' }).stdout, /ai-video-editor new <type>/);
});

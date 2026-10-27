// node --test ai-video-editor/story/test/story.test.mjs: multi-shot story + music video on the mock backend (no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.AI_VIDEO_EDITOR_BACKEND = 'mock';
process.env.AI_VIDEO_EDITOR_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-story-cache-'));

const { getBackend } = await import('../../gen/index.mjs');
const { parseAspect } = await import('../ffx.mjs');
const { normaliseShots, loadCharacters, shotsFromBrief } = await import('../shots.mjs');
const { analyseBeats, beatCuts } = await import('../beats.mjs');
const { parseLyrics, planMusicVideo } = await import('../music-video.mjs');
const { RefusalError } = await import('../errors.mjs');
const { flickerScore } = await import('../qa.mjs');
const storyRecipe = (await import('../../new/recipes/story.mjs')).default;
const mvRecipe = (await import('../../new/recipes/music-video.mjs')).default;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, '../run.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-story-'));
const ffmpeg = (args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
function ffprobe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,color_primaries,color_transfer,color_space', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  return { duration: Number(j.format.duration), v: j.streams.find((s) => s.codec_type === 'video'), a: j.streams.find((s) => s.codec_type === 'audio') };
}
function assertDeliverable(file, { w, h, duration }) {
  const p = ffprobe(file);
  assert.equal(p.v.codec_name, 'h264');
  assert.equal(p.v.width, w); assert.equal(p.v.height, h);
  assert.equal(p.v.r_frame_rate, '30/1');
  assert.deepEqual([p.v.color_primaries, p.v.color_transfer, p.v.color_space], ['bt709', 'bt709', 'bt709']);
  assert.ok(p.a, 'has an audio stream');
  assert.ok(Math.abs(p.duration - duration) < 0.1, `duration ${p.duration} vs ${duration}`);
}
/** A mock backend that records every request it gets. */
function recording(kind, name = 'mock') {
  const b = getBackend(kind, { name }), calls = [], gen = b.generate;
  b.generate = async (req, opts) => { calls.push(req); return gen(req, opts); };
  return { b, calls };
}

// fixtures: a reference image for the character, a black user clip, a 120 BPM click-track song (clicks from 0.5 s)
const REF = path.join(TMP, 'mara.png');
ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=160x288', '-frames:v', '1', REF]);
const CHARS = path.join(TMP, 'characters.json');
fs.writeFileSync(CHARS, JSON.stringify([{ name: 'Mara', refs: ['mara.png'], description: 'a tall woman with a red scarf and short silver hair' }]));
const BLACK = path.join(TMP, 'black.mp4');
ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=160x288:r=30:d=2', '-pix_fmt', 'yuv420p', BLACK]);
const OTHER = path.join(TMP, 'other.mp4');   // looks nothing like Mara's reference image
ffmpeg(['-f', 'lavfi', '-i', 'mandelbrot=s=160x288:r=30', '-t', '2', '-pix_fmt', 'yuv420p', OTHER]);
const SONG = path.join(TMP, 'clicks.wav');
const CLICKS = Array.from({ length: 23 }, (_, k) => 0.5 + k * 0.5);   // 0.5 .. 11.5 s
ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.6*sin(2*PI*1500*t)*exp(-80*mod(t-0.5,0.5))*gte(t,0.5)*(1+0.6*eq(mod(floor((t-0.5)/0.5),4),0))+0.08*sin(2*PI*110*t)':s=44100:d=12", '-ac', '2', SONG]);

test('aspects: named, free ratio, exact WxH', () => {
  assert.deepEqual(parseAspect('9:16'), { aspect: '9:16', width: 1080, height: 1920 });
  assert.deepEqual(parseAspect('4:5'), { aspect: '4:5', width: 1080, height: 1350 });
  assert.deepEqual(parseAspect('16x9'), { aspect: '16:9', width: 1920, height: 1080 });
  assert.equal(parseAspect('1080x1350').aspect, '4:5');
  assert.deepEqual(parseAspect('161x287'), { aspect: '9:16', width: 162, height: 288 });
  assert.deepEqual(parseAspect('300x200'), { aspect: '3:2', width: 300, height: 200 });
  assert.equal(parseAspect('2:1').width, 1920);
  assert.throws(() => parseAspect('wide'), /not understood/);
});

test('shots: long beats split at the backend max, character descriptions on every prompt', () => {
  const characters = loadCharacters(CHARS);
  const { shots, splits, total } = normaliseShots([
    { id: 'a', durationSec: 3, prompt: 'Mara opens the door', characters: ['Mara'] },
    { id: 'b', durationSec: 19, prompt: 'Mara walks to the pier', characters: ['mara'], transition: 'crossfade', narration: 'She keeps walking.' },
  ], { characters, maxClipSeconds: 8, source: 'video' });
  assert.deepEqual(shots.map((s) => s.id), ['a', 'b.1', 'b.2', 'b.3']);
  assert.deepEqual(splits, [{ from: 'b', into: ['b.1', 'b.2', 'b.3'], reason: '19 s beat > backend maxClipSeconds 8' }]);
  assert.ok(shots.every((s) => s.durationSec <= 8));
  assert.equal(total, 22);
  assert.deepEqual(shots.map((s) => s.transition), ['cut', 'fade', 'cut', 'cut']);
  assert.equal(shots[1].narration, 'She keeps walking.'); assert.equal(shots[2].narration, undefined);
  for (const s of shots) { assert.match(s.fullPrompt, /Mara: a tall woman with a red scarf and short silver hair/); assert.equal(s.refs.length, 1); }
  assert.throws(() => normaliseShots([{ id: 'x', durationSec: 2, characters: ['Nobody'] }], { characters }), /not in characters\.json/);
  assert.throws(() => normaliseShots([{ id: 'x' }, { id: 'y', transition: 'spin' }], {}), /transition "spin" not supported/);
  const brief = shotsFromBrief('Mara wakes up. The kettle boils.\n\n- Mara drinks tea', { characters, length: 9 });
  assert.equal(brief.length, 3); assert.deepEqual(brief.map((s) => s.characters), [['Mara'], [], ['Mara']]);
  assert.ok(brief.every((s) => s.durationSec === 3));
});

test('story render (mock): character lock, refs passed, auto split, transitions, narration + captions, BT.709, -14 LUFS', async () => {
  const video = recording('video'), image = recording('image');
  const shotlist = { title: 'Pier', shots: [
    { id: 's1', durationSec: 2.5, prompt: 'Mara opens the door', characters: ['Mara'], camera: 'slow push-in', narration: 'Mara leaves at dawn.' },
    { id: 's2', durationSec: 10, prompt: 'Mara walks to the pier', characters: ['Mara'], transition: 'fade', narration: 'The pier is empty.' },
    { id: 's3', durationSec: 2, prompt: 'gulls over the water', transition: 'wipeleft' },
  ] };
  const plan = storyRecipe.plan({ shotlist, characters: CHARS, aspect: '160x288', backends: { video: video.b, image: image.b } });
  assert.equal(plan.recipe, 'story');
  assert.deepEqual(plan.shots.map((s) => s.id), ['s1', 's2.1', 's2.2', 's3']);
  assert.deepEqual(plan.generations, { video: 4, image: 0, tts: 2, estimatedCost: 0 });
  const out = path.join(TMP, 'story-a');
  const r = await storyRecipe.render(plan, { outDir: out, backends: { video: video.b, image: image.b }, log: () => {} });
  assert.equal(r.pass, true, r.report.checks.join('\n'));
  assertDeliverable(r.file, { w: 160, h: 288, duration: 14.5 });
  // character lock: every Mara shot's request carried her description and her reference image
  const mara = video.calls.filter((c) => /Mara opens|Mara walks/.test(c.prompt));
  assert.equal(mara.length, 3);
  for (const c of mara) { assert.match(c.prompt, /red scarf and short silver hair/); assert.deepEqual(c.refs, [REF]); }
  assert.deepEqual(video.calls.find((c) => /gulls/.test(c.prompt)).refs, []);
  assert.ok(video.calls.every((c) => c.durationSec <= 8 && c.width === 160 && c.height === 288));
  const rep = JSON.parse(fs.readFileSync(r.reportFile, 'utf8'));
  assert.deepEqual(rep.splits.map((s) => s.from), ['s2']);
  assert.equal(rep.shots.find((s) => s.id === 's1').refsPassed, 1);
  for (const s of rep.shots.filter((x) => x.characters.length)) assert.ok(s.qa.identity && s.qa.identity.score < rep.qa.limits.drift, `identity ${JSON.stringify(s.qa.identity)}`);
  assert.equal(rep.WEAK_SHOTS.length, 0, JSON.stringify(rep.WEAK_SHOTS));
  assert.ok(Math.abs(rep.loudness.I - -14) <= 1 && rep.loudness.TP <= -1.5, JSON.stringify(rep.loudness));
  assert.equal(rep.narration.length, 2);
  assert.ok(rep.captions.count >= 2 && fs.existsSync(path.join(out, rep.captions.files[0])));
  assert.match(fs.readFileSync(path.join(out, 'ai-video-editor_story_pier.srt'), 'utf8'), /Mara leaves at dawn\./);
  assert.ok(fs.existsSync(path.join(out, rep.sheet)));
  assert.match(fs.readFileSync(path.join(out, 'REVIEW.txt'), 'utf8'), /Weak shots: none/);
});

test('story QA (mock): a deliberately black shot and a drifted shot land in WEAK_SHOTS with timestamp, reason and fix', async () => {
  const shotlist = { title: 'QA', shots: [
    { id: 'ok', durationSec: 2, prompt: 'Mara at the window', characters: ['Mara'] },
    { id: 'dark', durationSec: 2, prompt: 'the hallway', clip: BLACK, transition: 'cut' },
    { id: 'drift', durationSec: 2, prompt: 'Mara on the stairs', characters: ['Mara'], clip: OTHER, transition: 'cut' },
    { id: 'card', durationSec: 1, prompt: 'the end', source: 'card', transition: 'cut' },
  ] };
  const plan = storyRecipe.plan({ shotlist, characters: CHARS, aspect: '160x288' });
  const r = await storyRecipe.render(plan, { outDir: path.join(TMP, 'story-qa'), log: () => {} });
  assertDeliverable(r.file, { w: 160, h: 288, duration: 7 });
  const weak = r.report.WEAK_SHOTS;
  const black = weak.find((w) => w.shot === 'dark' && w.check === 'black');
  assert.ok(black, JSON.stringify(weak));
  assert.equal(black.timestamp, '00:02.0'); assert.equal(black.startSec, 2);
  assert.match(black.reason, /s of black frames/); assert.match(black.fix, /re-generate/);
  assert.ok(weak.some((w) => w.shot === 'dark' && w.check === 'frozen'));
  const drift = weak.find((w) => w.shot === 'drift' && w.check === 'drift');
  assert.ok(drift, JSON.stringify(weak)); assert.match(drift.reason, /identity drift .* of Mara/); assert.equal(drift.timestamp, '00:04.0');
  assert.ok(weak.some((w) => w.shot === 'card' && w.check === 'card' && /configure a video or image backend/.test(w.fix)));
  assert.ok(!weak.some((w) => w.shot === 'ok'), 'the good shot is not flagged');
  assert.ok(r.report.shots.find((s) => s.id === 'dark').qa.blackSec >= 1.9);
  assert.match(fs.readFileSync(path.join(TMP, 'story-qa', 'REVIEW.txt'), 'utf8'), /Shot dark at 00:02\.0: .*black frames/);
});

test('story fallback: no video backend -> generated stills with a Ken Burns move; a failing video backend falls back per shot', async () => {
  const none = getBackend('video', { name: 'mock' });
  none.name = 'none'; none.capabilities = { ...none.capabilities, maxClipSeconds: 0 };
  const image = recording('image');
  const plan = storyRecipe.plan({ brief: 'Mara wakes up. The kettle boils.', characters: CHARS, aspect: '1:1', backends: { video: none, image: image.b } });
  assert.deepEqual(plan.shots.map((s) => s.source), ['still', 'still']);
  assert.deepEqual(plan.generations, { video: 0, image: 2, tts: 0, estimatedCost: 0 });
  plan.width = 192; plan.height = 192;   // keep the test render small
  const r = await storyRecipe.render(plan, { outDir: path.join(TMP, 'story-still'), backends: { video: none, image: image.b }, log: () => {} });
  assertDeliverable(r.file, { w: 192, h: 192, duration: 8 });
  assert.deepEqual(r.report.shots.map((s) => s.source), ['still', 'still']);
  assert.match(image.calls[0].prompt, /red scarf/);
  assert.equal(r.report.WEAK_SHOTS.filter((w) => w.check === 'frozen').length, 0, 'Ken Burns stills move');
  // a video backend that errors falls back per shot and says why
  const broken = getBackend('video', { name: 'mock' });
  broken.generate = async () => { throw new Error('quota exceeded'); };
  const p2 = storyRecipe.plan({ brief: 'The kettle boils.', aspect: '160x288', backends: { video: broken, image: image.b } });
  const r2 = await storyRecipe.render(p2, { outDir: path.join(TMP, 'story-fb'), backends: { video: broken, image: image.b }, log: () => {} });
  assert.equal(r2.report.shots[0].source, 'still');
  assert.match(r2.report.shots[0].fallbacks[0], /quota exceeded/);
  assert.ok(r2.report.WEAK_SHOTS.some((w) => w.check === 'fallback'));
});

test('flicker score: smooth motion ~0, alternating brightness and glitch frames score high', () => {
  const n = 60;
  assert.ok(flickerScore(Array(n).fill(3), Array.from({ length: n }, (_, i) => 100 + i * 0.5)) < 0.1);
  assert.ok(flickerScore(Array(n).fill(40), Array.from({ length: n }, (_, i) => 128 + (i % 2 ? 40 : 0))) > 30);
  assert.ok(flickerScore(Array.from({ length: n }, (_, i) => (i % 10 === 5 ? 60 : 2)), Array(n).fill(100)) > 3);
});

test('beats: click track tempo, beat times and downbeats; cuts snap within tolerance', () => {
  const a = analyseBeats(SONG);
  assert.ok(Math.abs(a.bpm - 120) < 1.5, `bpm ${a.bpm}`);
  assert.ok(a.beats.length >= 20);
  for (const b of a.beats) assert.ok(CLICKS.some((c) => Math.abs(c - b) <= 0.02), `beat ${b} not on a click`);
  for (const d of a.downbeats) assert.ok(CLICKS.some((c, k) => k % 4 === 0 && Math.abs(c - d) <= 0.02), `downbeat ${d}`);
  const { cuts, end } = beatCuts(a, { shotSec: 1.7, tolerance: 0.25, maxSec: 8 });
  assert.equal(end, 12);
  assert.ok(cuts.length >= 5 && cuts.every((c) => c.snapped && c.snapErrorMs <= 20));
  const loose = beatCuts({ durationSec: 6, beats: [], downbeats: [] }, { shotSec: 2 });
  assert.deepEqual(loose.cuts.map((c) => [c.at, c.snapped]), [[2, false], [4, false]]);
});

test('lyrics: LRC and SRT keep their times, plain lines are spread evenly', () => {
  assert.deepEqual(parseLyrics('[00:01.50] hello\n[00:04.00] world\n', 10).cues, [{ start: 1.5, end: 4, text: 'hello' }, { start: 4, end: 10, text: 'world' }]);
  assert.deepEqual(parseLyrics('1\n00:00:01,000 --> 00:00:02,500\nla la\n', 10).cues, [{ start: 1, end: 2.5, text: 'la la' }]);
  const p = parseLyrics('one\ntwo', 10);
  assert.deepEqual(p.cues.map((c) => c.start), [0, 5]); assert.match(p.notes[0], /spread evenly/);
});

test('music video refuses a song without --i-own-this-music (API and CLI; nothing rendered)', () => {
  assert.throws(() => planMusicVideo({ song: SONG }), (e) => e instanceof RefusalError && e.code === 'NO_MUSIC_ATTESTATION' && /--i-own-this-music/.test(e.message));
  assert.throws(() => mvRecipe.render({ recipe: 'music-video', shots: [] }, {}), RefusalError);
  const out = path.join(TMP, 'mv-refused');
  const r = spawnSync(process.execPath, [RUN, 'music-video', '--song', SONG, '-o', out, '--aspect', '160x288'], { encoding: 'utf8', env: { ...process.env, AI_VIDEO_EDITOR_BACKEND: 'mock' } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /refusing to use clicks\.wav: only music you own/);
  assert.equal(fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.endsWith('.mp4')).length : 0, 0);
});

test('music video render (mock, CLI): beat-snapped cuts, length = song, lyrics captions, attestation recorded, -14 LUFS / -1.5 dBTP, BT.709', () => {
  const out = path.join(TMP, 'mv');
  const lyr = path.join(TMP, 'song.lrc');
  fs.writeFileSync(lyr, '[00:00.50] first line\n[00:04.50] second line\n[00:08.50] last line\n');
  const r = spawnSync(process.execPath, [RUN, 'music-video', '--song', SONG, '--i-own-this-music', '-o', out, '--aspect', '4:5', '--shot-sec', '1.9', '--title', 'Clicks',
    '--brief', 'Mara dances in the rain. City lights blur past.', '--characters', CHARS, '--lyrics', lyr], { encoding: 'utf8', env: { ...process.env, AI_VIDEO_EDITOR_BACKEND: 'mock' } });
  assert.equal(r.status, 0, r.stderr);
  const rep = JSON.parse(fs.readFileSync(path.join(out, 'ai-video-editor_music-video_clicks.report.json'), 'utf8'));
  assertDeliverable(path.join(out, rep.file), { w: 1080, h: 1350, duration: 12 });
  assert.equal(rep.aspect, '4:5');
  assert.equal(rep.music.attestation.owned, true); assert.equal(rep.music.attestation.flag, '--i-own-this-music');
  assert.match(rep.music.attestation.sha256, /^[0-9a-f]{64}$/);
  assert.equal(rep.durationSec, 12);
  assert.ok(rep.cuts.length >= 4);
  for (const c of rep.cuts) {
    assert.equal(c.snapped, true);
    assert.ok(CLICKS.some((k) => Math.abs(k - c.at) <= 1 / 30 + 0.005), `cut ${c.at} is not on a click`);
    assert.ok(c.snapErrorMs <= 20);
  }
  const starts = rep.shots.map((s) => s.start).slice(1);
  assert.deepEqual(starts, rep.cuts.map((c) => c.at));
  assert.ok(rep.snap.maxErrorMs <= 20 && rep.snap.snapped === rep.snap.cuts);
  assert.ok(Math.abs(rep.loudness.I - -14) <= 1 && rep.loudness.TP <= -1.5, JSON.stringify(rep.loudness));
  assert.equal(rep.captions.count, 3); assert.match(rep.captions.source, /lyrics/);
  assert.match(fs.readFileSync(path.join(out, 'ai-video-editor_music-video_clicks.srt'), 'utf8'), /00:00:04,500 --> 00:00:08,500\nsecond line/);
  assert.ok(rep.shots.some((s) => s.characters.includes('Mara')));
  assert.match(fs.readFileSync(path.join(out, 'REVIEW.txt'), 'utf8'), /own this music/);
});

test('cleanup', () => { if (!process.env.AI_VIDEO_EDITOR_KEEP_TEST) fs.rmSync(TMP, { recursive: true, force: true }) });

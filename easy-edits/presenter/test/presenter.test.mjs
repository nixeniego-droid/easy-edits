// Presenter + likeness consent (SPEC G4, G5, X1, recipe 2). Mock backend only, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitSentences, timeWords, chunkTimeline, estimateSeconds } from '../script.mjs';
import { createConsent, writeConsent, verifyConsent, normaliseScope, ConsentError } from '../consent.mjs';
import { planPresenter, renderPresenter, planHash, PresenterError } from '../pipeline.mjs';
import { registerAdapter, getBackend } from '../../gen/index.mjs';
import recipe from '../../new/recipes/presenter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, '..', 'run.mjs');
const CLI = path.join(HERE, '..', '..', 'cli', 'main.mjs');
const ENV = { ...process.env, EASY_EDITS_BACKEND: 'mock' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ee-presenter-'));

const SCRIPT = `# Three tips for better sleep
Keep the same wake-up time every day, even on weekends. Your body clock loves a routine.
Dim the lights an hour before bed, and put the phone in another room.
Keep the bedroom cool, dark and quiet. Try it for a week and see how you feel.
`;

function fixtures() {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'script.md'), SCRIPT);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x8a6f5a:s=540x960', '-frames:v', '1', path.join(dir, 'face.png')]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=180:d=3', '-ar', '48000', path.join(dir, 'voice.wav')]);
  return dir;
}
const run = (args, env = ENV) => spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8', env });
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f], { encoding: 'utf8' }));
const loudness = (f) => {
  const s = spawnSync('ffmpeg', ['-nostats', '-i', f, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const sum = s.slice(s.lastIndexOf('Summary:'));
  return { I: Number(sum.match(/I:\s+(-?[\d.]+) LUFS/)[1]), TP: Number(sum.match(/Peak:\s+(-?[\d.]+) dBFS/)[1]) };
};
const mp4s = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(mp4|png|wav)$/.test(f)) : []);

/** ffprobe: 9:16, BT.709 tagged, 15-90 s, audio at -14 LUFS / <= -1.5 dBTP. */
function assertDeliverable(file) {
  const p = probe(file), v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio');
  assert.ok(v && a, 'video + audio streams');
  assert.equal(v.width, 1080); assert.equal(v.height, 1920);
  assert.equal(v.color_primaries, 'bt709'); assert.equal(v.color_transfer, 'bt709'); assert.equal(v.color_space, 'bt709');
  const d = Number(p.format.duration);
  assert.ok(d >= 15 && d <= 90, `duration ${d}`);
  const m = loudness(file);
  assert.ok(Math.abs(m.I + 14) <= 1, `integrated ${m.I}`);
  assert.ok(m.TP <= -1.4, `true peak ${m.TP}`);
}

// --- units ------------------------------------------------------------------------------------------

test('script: headings and bullets are sentences, hard-wrapped prose is not split', () => {
  assert.deepEqual(splitSentences('# Title\nOne line\nwraps here.\n\n[pause]\n- a bullet'), ['Title.', 'One line wraps here.', 'a bullet.']);
  const s = splitSentences(SCRIPT);
  assert.equal(s[0], 'Three tips for better sleep.');
  assert.ok(estimateSeconds(s) > 15 && estimateSeconds(s) < 30);
});

test('script: words are timed inside their sentence, in order', () => {
  const w = timeWords('Keep the bedroom cool.', 2, 2);
  assert.equal(w.length, 4);
  assert.ok(w[0].start >= 2 && w.at(-1).end <= 4);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].start >= w[i - 1].end);
});

test('script: avatar chunks fit the clip limit and cut between sentences', () => {
  const spans = [{ start: 0.3, end: 4 }, { start: 4.3, end: 9 }, { start: 9.3, end: 12 }];
  const c = chunkTimeline(spans, 12.6, 8);
  assert.ok(c.every((x) => x.end - x.start <= 8 + 1e-6));
  assert.equal(c[0].start, 0); assert.equal(c.at(-1).end, 12.6);
  assert.equal(c[0].end, 4.15);
  assert.deepEqual(chunkTimeline(spans, 12.6, 0), [{ start: 0, end: 12.6 }]);
});

test('consent: scope parsing and self-attestation are required', () => {
  assert.equal(normaliseScope('face,voice'), 'both');
  assert.equal(normaliseScope('voice'), 'voice');
  assert.throws(() => normaliseScope('body'), ConsentError);
  const dir = fixtures();
  const base = { subject: 'Test Person', allow: 'face', refs: [path.join(dir, 'face.png')], expires: '2999-01-01' };
  assert.throws(() => createConsent(base), /i-am-the-subject/);
  assert.throws(() => createConsent({ ...base, iAmTheSubject: true, onBehalfOf: 'Someone Else' }), /on behalf/);
  assert.throws(() => createConsent({ ...base, iAmTheSubject: true, allow: 'voice' }), /no reference file covers it/);
  assert.throws(() => createConsent({ ...base, iAmTheSubject: true, expires: '2000-01-01' }), /not in the future/);
  const rec = createConsent({ ...base, iAmTheSubject: true, attestation: { method: 'agent-relay', words: 'Yes, use my face.' } });
  assert.equal(rec.allowed, 'face'); assert.equal(rec.attestation.method, 'agent-relay'); assert.equal(rec.references[0].kind, 'face');
  const f = writeConsent(rec, path.join(dir, 'c.json'));
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(verifyConsent(f, { use: 'face' }).record.subject, 'Test Person');
  assert.throws(() => verifyConsent(f, { use: 'voice' }), /allows face only/);
  assert.throws(() => verifyConsent(f, { use: 'face', subject: 'Other Name' }), /not "Other Name"/);
});

test('consent CLI: create needs --i-am-the-subject; create + verify work', () => {
  const dir = fixtures();
  const bad = spawnSync(process.execPath, [CLI, 'consent', 'create', '--subject', 'Test Person', '--allow', 'face', '--ref', path.join(dir, 'face.png'), '--expires', '2999-01-01', '-o', path.join(dir, 'x.json')], { encoding: 'utf8', env: ENV });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /i-am-the-subject/); assert.ok(!fs.existsSync(path.join(dir, 'x.json')));
  const ok = spawnSync(process.execPath, [CLI, 'consent', 'create', '--subject', 'Test Person', '--allow', 'face,voice', '--ref', path.join(dir, 'face.png'), '--ref', path.join(dir, 'voice.wav'), '--expires', '2999-01-01', '--i-am-the-subject', '-o', path.join(dir, 'c.json')], { encoding: 'utf8', env: ENV });
  assert.equal(ok.status, 0, ok.stderr);
  const v = spawnSync(process.execPath, [CLI, 'consent', 'verify', path.join(dir, 'c.json'), '--use', 'both'], { encoding: 'utf8', env: ENV });
  assert.equal(v.status, 0, v.stderr); assert.match(v.stdout, /consent OK/);
});

test('recipe module exposes { name, plan, render }', () => {
  assert.equal(recipe.name, 'presenter');
  assert.equal(typeof recipe.plan, 'function'); assert.equal(typeof recipe.render, 'function');
});

// --- end-to-end renders and refusals (mock backend) ----------------------------------------------------

test('fictional host: renders a 9:16 synthetic presenter at -14 LUFS / BT.709, labelled synthetic', () => {
  const dir = fixtures(), out = path.join(dir, 'out');
  const r = run(['--script', path.join(dir, 'script.md'), '-o', out, '--length', '30']);
  assert.equal(r.status, 0, r.stderr);
  const mp4 = path.join(out, 'easy-edits_presenter_script.mp4');
  assertDeliverable(mp4);
  const rep = JSON.parse(fs.readFileSync(path.join(out, 'easy-edits_presenter_script.report.json'), 'utf8'));
  assert.equal(rep.synthetic, true);
  assert.equal(rep.likeness, 'fictional');
  assert.equal(rep.host.source, 'generated');
  assert.deepEqual(rep.disclosure, { onScreen: true, text: 'AI-generated presenter' });
  assert.equal(rep.captions.source, 'script');
  assert.ok(rep.avatar.chunks >= 2, 'long reads are several avatar clips');
  assert.ok(rep.exports[0].pass);
  for (const ext of ['.srt', '.vtt', '_sheet.png', '.plan.json']) assert.ok(fs.existsSync(path.join(out, `easy-edits_presenter_script${ext}`)), ext);
  assert.match(fs.readFileSync(path.join(out, 'easy-edits_presenter_script.srt'), 'utf8'), /Keep the same wake-up time/);
  assert.match(fs.readFileSync(path.join(out, '.work', 'presenter_script', 'captions.ass'), 'utf8'), /Disc,,0,0,0,,AI-generated presenter/);
  assert.match(fs.readFileSync(path.join(out, 'PLAN.txt'), 'utf8'), /generations: 0 video, 1 image, \d+ TTS, \d+ avatar/);
});

test('licensed host + local still avatar (avatar backend none), disclosure off', () => {
  const dir = fixtures(), out = path.join(dir, 'out');
  const env = { ...process.env }; delete env.EASY_EDITS_BACKEND;   // per-kind choice: mock voice, no avatar model
  const noLicence = run(['--script', path.join(dir, 'script.md'), '-o', out, '--host-image', path.join(dir, 'face.png'), '--tts-backend', 'mock', '--avatar-backend', 'none'], env);
  assert.equal(noLicence.status, 2); assert.match(noLicence.stderr, /--host-license/);
  const r = run(['--script', path.join(dir, 'script.md'), '-o', out, '--host-image', path.join(dir, 'face.png'), '--host-license', 'Own work, CC0', '--tts-backend', 'mock', '--avatar-backend', 'none', '--no-disclosure'], env);
  assert.equal(r.status, 0, r.stderr);
  assertDeliverable(path.join(out, 'easy-edits_presenter_script.mp4'));
  const rep = JSON.parse(fs.readFileSync(path.join(out, 'easy-edits_presenter_script.report.json'), 'utf8'));
  assert.equal(rep.synthetic, true); assert.equal(rep.disclosure.onScreen, false);
  assert.equal(rep.host.source, 'licensed'); assert.equal(rep.host.license, 'Own work, CC0');
  assert.match(rep.avatar.fallback, /still/);
});

test('refused: --likeness self without a consent record, nothing generated', () => {
  const dir = fixtures(), out = path.join(dir, 'out');
  const r = run(['--script', path.join(dir, 'script.md'), '-o', out, '--likeness', 'self']);
  assert.equal(r.status, 2); assert.match(r.stderr, /refused: --likeness self needs --consent/);
  assert.deepEqual(mp4s(out), []);
});

test('refused: third-party / public-figure likeness', () => {
  const dir = fixtures(), out = path.join(dir, 'out');
  const r = run(['--script', path.join(dir, 'script.md'), '-o', out, '--likeness', 'Famous Person']);
  assert.equal(r.status, 2); assert.match(r.stderr, /never synthesises a third party or a public figure/);
  assert.deepEqual(mp4s(out), []);
});

test('refused: an expired consent record', () => {
  const dir = fixtures(), out = path.join(dir, 'out');
  const rec = createConsent({ subject: 'Test Person', allow: 'both', refs: [path.join(dir, 'face.png'), path.join(dir, 'voice.wav')], expires: '2021-02-01', iAmTheSubject: true, now: new Date('2021-01-01T00:00:00Z') });
  writeConsent(rec, path.join(dir, 'consent.json'));
  const r = run(['--script', path.join(dir, 'script.md'), '-o', out, '--likeness', 'self', '--consent', path.join(dir, 'consent.json')]);
  assert.equal(r.status, 2); assert.match(r.stderr, /expired/);
  assert.deepEqual(mp4s(out), []);
});

test('refused: a reference file changed after consent (sha256 mismatch)', () => {
  const dir = fixtures(), out = path.join(dir, 'out');
  writeConsent(createConsent({ subject: 'Test Person', allow: 'both', refs: [path.join(dir, 'face.png'), path.join(dir, 'voice.wav')], expires: '2999-01-01', iAmTheSubject: true }), path.join(dir, 'consent.json'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=540x960', '-frames:v', '1', path.join(dir, 'face.png')]);
  const r = run(['--script', path.join(dir, 'script.md'), '-o', out, '--likeness', 'self', '--consent', path.join(dir, 'consent.json')]);
  assert.equal(r.status, 2); assert.match(r.stderr, /sha256 mismatch/);
  assert.deepEqual(mp4s(out), []);
});

test('refused: consent scope does not cover the run (face only, voice requested)', () => {
  const dir = fixtures(), out = path.join(dir, 'out');
  writeConsent(createConsent({ subject: 'Test Person', allow: 'face', refs: [path.join(dir, 'face.png')], expires: '2999-01-01', iAmTheSubject: true }), path.join(dir, 'consent.json'));
  const r = run(['--script', path.join(dir, 'script.md'), '-o', out, '--likeness', 'self', '--use', 'both', '--consent', path.join(dir, 'consent.json')]);
  assert.equal(r.status, 2); assert.match(r.stderr, /allows face only/);
});

test('own likeness with valid consent: face + cloned voice render, consent in the report', () => {
  const dir = fixtures(), out = path.join(dir, 'out');
  const c = spawnSync(process.execPath, [CLI, 'consent', 'create', '--subject', 'Test Person', '--allow', 'face,voice', '--ref', path.join(dir, 'face.png'), '--ref', path.join(dir, 'voice.wav'), '--expires', '2999-12-31', '--i-am-the-subject', '-o', path.join(dir, 'consent.json')], { encoding: 'utf8', env: ENV });
  assert.equal(c.status, 0, c.stderr);
  const r = run(['--script', path.join(dir, 'script.md'), '-o', out, '--likeness', 'self', '--subject', 'Test Person', '--consent', path.join(dir, 'consent.json')]);
  assert.equal(r.status, 0, r.stderr);
  assertDeliverable(path.join(out, 'easy-edits_presenter_script.mp4'));
  const rep = JSON.parse(fs.readFileSync(path.join(out, 'easy-edits_presenter_script.report.json'), 'utf8'));
  assert.equal(rep.synthetic, true); assert.equal(rep.likeness, 'self'); assert.equal(rep.use, 'both');
  assert.equal(rep.consent.subject, 'Test Person'); assert.equal(rep.consent.allowed, 'both');
  assert.equal(rep.host.source, 'consent-reference'); assert.equal(rep.voice.mode, 'clone');
  assert.deepEqual(rep.willSend, []);
  assert.ok(!JSON.stringify({ c: rep.consent, h: rep.host, v: rep.voice }).includes(dir), 'report carries reference names, not local paths');
});

test('network backends: listed in willSend, render refuses without approval and under --offline', async () => {
  const prev = process.env.EASY_EDITS_BACKEND;
  delete process.env.EASY_EDITS_BACKEND;
  try {
    registerAdapter('test-net', (kind) => { const b = getBackend(kind, { name: 'mock' }); return { ...b, name: 'test-net', capabilities: { ...b.capabilities, network: true } }; });
    const dir = fixtures();
    writeConsent(createConsent({ subject: 'Test Person', allow: 'both', refs: [path.join(dir, 'face.png'), path.join(dir, 'voice.wav')], expires: '2999-01-01', iAmTheSubject: true }), path.join(dir, 'consent.json'));
    const plan = planPresenter({ text: SCRIPT, likeness: 'self', consent: path.join(dir, 'consent.json'), backend: 'test-net' });
    assert.ok(plan.willSend.some((l) => /voice reference file\(s\) of Test Person/.test(l)));
    assert.ok(plan.willSend.some((l) => /face reference of Test Person/.test(l)));
    await assert.rejects(renderPresenter(plan, { out: path.join(dir, 'out') }), /approval needed/);
    assert.throws(() => planPresenter({ text: SCRIPT, backend: 'test-net', offline: true }), /refused by --offline/);
    assert.deepEqual(mp4s(path.join(dir, 'out')), []);
    const tampered = { ...plan, willSend: [] };
    await assert.rejects(renderPresenter(tampered, { out: path.join(dir, 'out') }), /plan hash mismatch/);
    assert.equal(planHash(plan), plan.planHash);
  } finally { if (prev == null) delete process.env.EASY_EDITS_BACKEND; else process.env.EASY_EDITS_BACKEND = prev; }
});

test('length: a script too long for --length, or --length outside 15-90 s, is refused', () => {
  assert.throws(() => planPresenter({ text: SCRIPT, length: 10 }), PresenterError);
  assert.throws(() => planPresenter({ text: SCRIPT, length: 15 }), /too long for --length 15/);
});

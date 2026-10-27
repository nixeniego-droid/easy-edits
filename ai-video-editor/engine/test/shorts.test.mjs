// shorts picker / dedupe / lower-third logic (no media, no agent)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentLines, snapProposal, estDuration, maxGap, noisyWords, usedReason, markUsed, loadUsed, lowerThirds, slugify, propose, sec, hms, proposalsJson } from '../../modes/shorts.mjs';
import { parseArgs, previewWindow } from '../../cli/main.mjs';

// a talk: 60 sentences of 6 words, 0.4 s per word, 0.5 s between sentences
const talk = [];
let t = 0;
for (let s = 0; s < 60; s++) {
  for (let k = 0; k < 6; k++) { talk.push({ text: k === 5 ? `end${s}.` : (k === 0 ? `Start${s}` : `w${s}_${k}`), start: t, end: t + 0.35 }); t += 0.4; }
  t += 0.5;
}

test('shorts: time helpers', () => {
  assert.equal(sec('22:05'), 1325); assert.equal(sec('1:02:03'), 3723); assert.equal(sec('90'), 90);
  assert.equal(hms(1325), '22:05'); assert.equal(hms(3723), '1:02:03');
  assert.equal(slugify("Don't try, don't hope"), 'dont-try-dont-hope');
});

test('shorts: picker lines are sentences; a proposal snaps to its exact first / last words', () => {
  const L = agentLines(talk);
  assert.equal(L.length, 60);
  const p = { start_line: 2, end_line: 20, first_words: 'w2_2 w2_3 w2_4', last_words: 'w20_4 end20.' };
  const c = snapProposal(talk, L, p, { min: 20, max: 60 });
  assert.equal(c.reject, undefined);
  assert.equal(talk[c.i0].text, 'w2_2'); assert.equal(talk[c.i1].text, 'end20.');
  assert.ok(Math.abs(c.est - estDuration(talk, c.i0, c.i1)) < 1e-9);
  assert.match(snapProposal(talk, L, { start_line: 0, end_line: 2 }, { min: 20, max: 60 }).reject, /too short/);
  assert.match(snapProposal(talk, L, { start_line: 0, end_line: 59 }, { min: 20, max: 60 }).reject, /too long/);
});

test('shorts: transcript holes and garbled words reject a window; a silent gap does not', () => {
  const w = talk.map((x) => ({ ...x }));
  for (let i = 60; i < w.length; i++) { w[i].start += 6; w[i].end += 6; }
  const L = agentLines(w);
  assert.ok(maxGap(w, 0, 100) > 6);
  assert.match(snapProposal(w, L, { start_line: 5, end_line: 15 }, { min: 10, max: 60 }).reject, /hole/);
  assert.equal(snapProposal(w, L, { start_line: 5, end_line: 15 }, { min: 10, max: 60, speechGap: () => false }).reject, undefined);
  const g = talk.map((x, i) => (i > 10 && i < 14 ? { ...x, text: 'với' } : x));
  assert.equal(noisyWords(g, 0, 20), 3);
  assert.match(snapProposal(g, agentLines(g), { start_line: 0, end_line: 10 }, { min: 10, max: 60 }).reject, /garbled/);
});

test('shorts: used-clips log skips > 30 % overlap and repeated quotes; --pick marks used', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-used-'));
  const f = path.join(dir, 'src', 'used_clips.json');
  markUsed(f, 'src', [{ start: 100, end: 160, quote: 'You could teach a man to fish today', hook: 'Start' }]);
  const u = loadUsed(f);
  assert.equal(u.clips.length, 1);
  assert.match(usedReason({ start: 140, end: 200, text: 'x' }, u), /overlaps/);         // 20 / 60 s = 33 %
  assert.equal(usedReason({ start: 150, end: 220, text: 'x' }, u), null);                 // 10 / 70 s
  assert.match(usedReason({ start: 400, end: 450, text: 'and so you could teach a man to fish today right' }, u), /repeats/);
  markUsed(f, 'src', [{ start: 100.2, end: 160.1, quote: 'again' }]);                      // same clip: replaced, not added
  assert.equal(loadUsed(f).clips.length, 1);
});

test('shorts: heuristic proposals (no agent) are ranked, non-overlapping and skip used ranges', () => {
  process.env.AI_VIDEO_EDITOR_AGENT = 'none';
  const r = propose(talk, { n: 3, min: 15, max: 30 });
  assert.equal(r.proposals.length, 3);
  assert.deepEqual(r.proposals.map((p) => p.rank), [1, 2, 3]);
  for (const a of r.proposals) for (const b of r.proposals) if (a !== b) assert.ok(a.end <= b.start || b.end <= a.start);
  const used = { clips: [{ start: r.proposals[0].start, end: r.proposals[0].end }] };
  const r2 = propose(talk, { n: 3, min: 15, max: 30, used });
  assert.ok(r2.proposals.every((p) => !usedReason(p, used)));
});

test('shorts: a lower third starts ~1 s after the named person is first on screen for long enough', () => {
  const S = [];
  for (let k = 0; k < 40; k++) S.push({ t: k * 0.5, who: k < 6 ? 1 : (k < 9 ? 0 : (k < 12 ? 1 : 0)) });
  const L = lowerThirds({ samples: S }, [{ name: 'Ken' }, { name: null }], 20);
  assert.equal(L.length, 1);
  assert.equal(L[0].name, 'Ken');
  assert.equal(L[0].start, 7);        // 3 s - 4 s is too short a run; the run from 6 s gets it at 7 s
  assert.ok(L[0].end - L[0].start >= 2 && L[0].end <= 20);
});

test('CLI: shorts --propose / --pick / --hook [text] / --reset-used', () => {
  assert.equal(parseArgs(['shorts', 'x.mp4', '-o', 'o', '--hook']).hook, true);
  const b = parseArgs(['shorts', '--hook', 'Stop saying try', 'x.mp4', '-o', 'o', '--pick', '1,3', '--reset-used']);
  assert.equal(b.hook, 'Stop saying try'); assert.equal(b.input, 'x.mp4'); assert.equal(b.pick, '1,3'); assert.equal(b.resetUsed, true);
  assert.equal(parseArgs(['shorts', 'x.mp4', '--hook', '-o', 'o', '--propose']).propose, true);
});

test('shorts: proposals.json has id, start, end, durationSec, hook, previewPath per candidate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ave-prop-')), pv = path.join(dir, 'proposal_1_x_preview.mp4');
  fs.writeFileSync(pv, 'x');
  const J = proposalsJson([
    { rank: 1, score: 88, start: 12.3456, end: 41.2, est: 27.84, hook: 'This changed everything.', title: 'IT CHANGED', reason: 'strong claim', preview: pv },
    { rank: 2, score: 70, start: 60, end: 95.5, est: 33.1, hook: 'Wait for it.', title: 'WAIT', reason: 'payoff', preview: path.join(dir, 'gone.mp4') },
  ]);
  assert.deepEqual(Object.keys(J[0]).slice(0, 6), ['id', 'rank', 'score', 'start', 'end', 'durationSec']);
  assert.equal(J[0].id, 1); assert.equal(J[0].start, 12.346); assert.equal(J[0].durationSec, 27.8); assert.equal(J[0].hook, 'This changed everything.');
  assert.equal(J[0].previewPath, pv); assert.equal(J[1].previewPath, null); // a missing preview is null, never a dead path
  fs.rmSync(dir, { recursive: true });
});

test('CLI: --preview [seconds] on captions / clean-cut / talking-head only, first format only', () => {
  assert.equal(parseArgs(['captions', 'x.mp4', '-o', 'o', '--preview']).preview, 20);
  const a = parseArgs(['talking-head', 'x.mp4', '--preview', '30', '-o', 'o', '--format', 'all']);
  assert.equal(a.preview, 30); assert.deepEqual(a.formats, ['9x16']); assert.equal(a.input, 'x.mp4');
  assert.equal(parseArgs(['x.mp4', '--preview', '-o', 'o']).input, 'x.mp4');
  assert.throws(() => parseArgs(['shorts', 'x.mp4', '-o', 'o', '--preview']), /--propose/);
  assert.throws(() => parseArgs(['captions', 'x.mp4', '-o', 'o', '--preview', '2']), /5 seconds/);
});

test('--preview window: skips a leading silence, ends in a pause, never mid-word', () => {
  // the NASA sample: 5.77 s of silence, one sentence, a pause at 20.44 s
  assert.deepEqual(previewWindow([[0.007, 5.766], [20.443, 23.111]], 10), [5.466, 20.643]);
  assert.deepEqual(previewWindow([], 20), [0, 20]);                                  // no audio / no pauses: the first 20 s
  assert.deepEqual(previewWindow([[3, 3.5], [16, 16.4], [40, 41]], 20), [0, 16.2]);   // first pause after 12 s
  assert.deepEqual(previewWindow([[3, 3.5]], 20, 9), [0, 9]);                          // a short source: its length
});

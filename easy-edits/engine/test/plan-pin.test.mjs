// pinned plans (engine/plan-store.mjs): talking-head / explainer motion plans and shorts plans are reused per source
// content hash, --plan FILE wins, --replan plans fresh; shorts clean-ending rule, pinned review patch, EDL check.
// No media decode, no agent (EASY_EDITS_AGENT=none). Real-data checks skip when the private renders are absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceHash, wordsKey, savePin, loadPin, pinPath, stripTimes } from '../plan-store.mjs';
import { makePlan } from '../../modes/talking-head.mjs';
import { endingProblem, snapEnding, snapProposal, agentLines, windowPatch, edlDiff, loadShortsPlan, clipDir, markUsed, loadUsed } from '../../modes/shorts.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-pin-'));
process.env.EASY_EDITS_PLANS = path.join(tmp, 'plans');
process.env.EASY_EDITS_AGENT = 'none';
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const W = (s, t0 = 0, step = 0.3) => s.split(' ').map((text, i) => ({ text, start: +(t0 + i * step).toFixed(3), end: +(t0 + i * step + step * 0.9).toFixed(3) }));
const talk = [...W('Few people end up somewhere on purpose. Vision helps us arrive at a preferred future destination.', 0.1),
  ...W('It gives us direction in Proverbs 29 verse 18. It says, Without vision, the people perish.', 5.2),
  ...W('Mission informs, but vision inspires. In mission, we use our head. But in vision, we use our heart.', 11.6)];

test('sourceHash: content, not path; any changed byte is a new key', () => {
  const a = path.join(tmp, 'a.bin'), b = path.join(tmp, 'b.bin');
  const buf = Buffer.alloc(9 << 20, 7); fs.writeFileSync(a, buf); fs.writeFileSync(b, buf);
  assert.equal(sourceHash(a), sourceHash(b));
  buf[buf.length - 10] = 8; fs.writeFileSync(b, buf);
  assert.notEqual(sourceHash(a), sourceHash(b));
  assert.match(sourceHash(a), /^[0-9a-f]{16}$/);
  assert.notEqual(wordsKey(talk), wordsKey(talk.map((w, i) => (i === 3 ? { ...w, end: w.end + 0.01 } : w))));
});

test('makePlan: the first run pins its plan, a re-run reuses it, --replan plans again, --plan FILE wins', () => {
  const out = path.join(tmp, 'out'), work = path.join(tmp, 'work'); fs.mkdirSync(out); fs.mkdirSync(work);
  const o = { out, work, mode: 'talking-head', clip: 'talk' }, pin = { key: 'feedfacefeedface', source: '/x/talk.mov' };
  const p1 = makePlan(o, talk, 17, 'talking-head', { pin }).plan;
  const f = pinPath('talking-head', pin.key);
  assert.ok(fs.existsSync(f) && fs.existsSync(path.join(out, 'easy-edits_talking-head_talk.plan.json')));
  // a re-run loads the pin, not a fresh plan: mark the pin and see the mark come back
  const pinned = JSON.parse(fs.readFileSync(f, 'utf8')); pinned.title = 'Reviewed title'; fs.writeFileSync(f, JSON.stringify(pinned));
  const p2 = makePlan(o, talk, 17, 'talking-head', { pin }).plan;
  assert.equal(p2.title, 'Reviewed title');
  assert.deepEqual(p2.beats, p1.beats);
  assert.equal(p2.pin, undefined);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).title, 'Reviewed title'); // a reused pin is not rewritten
  assert.notEqual(makePlan({ ...o, replan: true }, talk, 17, 'talking-head', { pin }).plan.title, 'Reviewed title');
  const file = path.join(tmp, 'mine.plan.json'); fs.writeFileSync(file, JSON.stringify({ title: 'From file', beats: [{ type: 'icon', anchor: 'purpose', icon: 'target' }] }));
  const p3 = makePlan({ ...o, plan: file }, talk, 17, 'talking-head', { pin }).plan;
  assert.equal(p3.title, 'From file');
  assert.equal(loadPin('talking-head', pin.key).plan.title, 'From file');           // the plan used is the new pin
});

test('makePlan: a pin made on another cut re-anchors its beats by phrase (no stale times)', () => {
  const work = path.join(tmp, 'w2'); fs.mkdirSync(work);
  const pin = { key: 'abcdabcdabcdabcd', source: '/x/t.mov' };
  savePin('talking-head', pin.key, { title: 'T', beats: [{ type: 'icon', anchor: 'destination.', icon: 'compass', at: 1.0, end: 2.6, i0: 3 }] }, { words: 'not-this-cut' });
  const shifted = talk.map((w) => ({ ...w, start: +(w.start + 2).toFixed(3), end: +(w.end + 2).toFixed(3) }));
  const b = makePlan({ work }, shifted, 20, 'talking-head', { pin }).plan.beats.find((x) => x.anchor === 'destination.');
  assert.equal(b.at, +(shifted.find((w) => w.text === 'destination.').start - 0.05).toFixed(3));
  assert.deepEqual(stripTimes({ beats: [{ type: 'punch', at: 4, untilTime: 6 }] }).beats[0], { type: 'punch', at: 4, untilTime: 6 }); // no anchor: kept
});

// ---------- shorts ----------
// a podcast short_1 ending, synthetic words with the real shapes: an ASR split "They believe." (0.48 s pause), the
// thought ending on "themselves." (2.3 s pause), then a run-on "... persuasiveness." with no pause after it
const ken = [
  ...W('And here\'s the strongest part.', 0), { text: 'They', start: 2.2, end: 2.45 }, { text: 'believe.', start: 2.45, end: 2.97 },
  ...W('That they created the idea themselves.', 3.45, 0.3).map((w, i, a) => (i === a.length - 1 ? { ...w, end: 5.4 } : w)),
  ...W('Na inception mo na sila yung nag', 7.7, 0.2), { text: '-incept.', start: 9.1, end: 9.3 }, ...W('And yun yung mas malakas na persuasiveness.', 9.6, 0.2), ...W('Eee masakit kasi', 11.0, 0.3),
];
const ix = (t) => ken.findIndex((w) => w.text === t);

test('clean ending: sentence end + pause + >= 3 words; never mid-sentence, a run-on or a 2-word ASR split', () => {
  assert.equal(endingProblem(ken, ix('themselves.')), null);
  assert.match(endingProblem(ken, ix('persuasiveness.')), /no pause/);
  assert.match(endingProblem(ken, ix('believe.')), /too short/);
  assert.match(endingProblem(ken, ix('idea')), /mid-sentence/);
  assert.match(endingProblem([...W('so it goes on and on...'), ...W('next', 5)], 5), /mid-sentence/);
  assert.equal(endingProblem(ken, ken.length - 1).startsWith('mid-sentence'), true);
  // a mid-sentence end snaps to the nearest clean one ("the idea" -> "themselves.", not back to "believe.")
  const e = snapEnding(ken, 0, ix('idea'));
  assert.equal(ken[e.i1].text, 'themselves.'); assert.ok(e.moved > 0 && e.moved < 1);
  assert.equal(ken[snapEnding(ken, 0, ix('persuasiveness.')).i1].text, '-incept.'); // nearest: "Na inception ... nag -incept."
  assert.match(snapEnding(ken, 0, ix('persuasiveness.'), { min: 20 }).reject, /no clean ending/); // nothing long enough
});

test('clean ending: the picker snaps every agent proposal ("pattern." running into "You could...")', () => {
  const ws = [...W('I did the swish pattern on the dishes.', 0), ...W('So, gets mo.', 3), ...W("It's called swish pattern.", 4.4), ...W('You could search it online.', 5.65), ...W('Madali lang i -search.', 7.5)];
  const L = agentLines(ws);
  const c = snapProposal(ws, L, { start_line: 0, end_line: 2, last_words: 'swish pattern.' }, {});
  assert.equal(ws[c.i1].text, 'online.');
  assert.match(c.endFix, /end moved \+1\.\d s to a clean ending \(was: no pause after "pattern\."/);
});

test('shorts plan: pinned review -> window patch (merged with --review-patch), its own work dir, EDL check', () => {
  const c = { rank: 1, i0: 100, i1: 140, start: 50, review: { keep: [], remove: [120, 121, 99, 141], text: { 110: 'Yeah.' }, notes: 'cut' } };
  const idx = Array.from({ length: 200 }, (_, k) => k + 3); // transcript index = word index + 3 (non-words dropped)
  const p = windowPatch(c, idx, { keep: [125], remove: [], text: { 133: 'X' } });
  assert.deepEqual(p.remove, [20, 21]); assert.deepEqual(p.keep, [22]); assert.deepEqual(p.text, { 10: 'Yeah.', 30: 'X' });
  assert.equal(windowPatch({ i0: 0, i1: 5 }, idx, null), null);
  assert.notEqual(clipDir('/w', c), clipDir('/w', { ...c, i1: 139 }));
  assert.equal(clipDir('/w', { rank: 1, start: 50.2, i0: 0, i1: 9 }), '/w/clip1_50'); // unedited: the old dir
  const k = [{ sourceStart: 0.067, sourceEnd: 8.3, start: 0, end: 8.233 }, { sourceStart: 8.967, sourceEnd: 27.5, start: 8.233, end: 26.766 }];
  assert.equal(edlDiff(k, k.map((x) => ({ ...x, end: x.end + 0.02 }))), null);
  assert.match(edlDiff(k, [k[0], { ...k[1], sourceEnd: 28 }]), /at keep 1/);
  assert.match(edlDiff(k, [k[0]]), /1 keeps \(pinned 2\)/);
});

test('shorts plan: --plan FILE, then this folder\'s proposals (same source + range), then the pin', () => {
  const out = path.join(tmp, 'sh'), pf = path.join(out, 'src', 'proposals.json'); fs.mkdirSync(path.dirname(pf), { recursive: true });
  const mk = (tag, extra = {}) => ({ words: 10, min: 30, max: 75, proposals: [{ rank: 1, i0: 0, i1: 5, tag }], ...extra });
  savePin('shorts', '1111222233334444', mk('pin'));
  assert.equal(loadShortsPlan({}, pf, '1111222233334444').proposals[0].tag, 'pin');
  fs.writeFileSync(pf, JSON.stringify(mk('folder', { sourceHash: '1111222233334444', range: null })));
  assert.equal(loadShortsPlan({}, pf, '1111222233334444').proposals[0].tag, 'folder');
  assert.equal(loadShortsPlan({}, pf, '1111222233334444_60-120'), null);              // another --range: not this plan
  fs.writeFileSync(pf, JSON.stringify(mk('other source', { sourceHash: '9999222233334444' })));
  assert.equal(loadShortsPlan({}, pf, '1111222233334444').proposals[0].tag, 'pin');
  const f = path.join(tmp, 'given.json'); fs.writeFileSync(f, JSON.stringify(mk('given')));
  assert.equal(loadShortsPlan({ plan: f }, pf, '1111222233334444').proposals[0].tag, 'given');
  fs.writeFileSync(f, JSON.stringify({ title: 'a motion plan' }));
  assert.throws(() => loadShortsPlan({ plan: f }, pf, 'k'), /not a shorts plan/);
});

test('used clips: a re-render of the same file with an edited span replaces its entry', () => {
  const f = path.join(tmp, 'u', 'used_clips.json');
  markUsed(f, 'src', [{ start: 1064, end: 1130, quote: 'q', file: '/o/short_1_x.mp4' }]);
  markUsed(f, 'src', [{ start: 1064, end: 1123.9, quote: 'q', file: '/o/short_1_x.mp4' }]);
  assert.deepEqual(loadUsed(f).clips.map((c) => c.end), [1123.9]);
});

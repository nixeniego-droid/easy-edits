// node --test ai-video-editor/engine/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { locate, heuristicPlan, validatePlan, sentences } from '../plan.mjs';
import { frame, layoutSegments, compose, FORMATS } from '../compose.mjs';
import { candidates, pick } from '../../modes/shorts.mjs';
import { parseArgs } from '../../cli/main.mjs';

// a real edited transcript shape (Clean cut output): one token may hold two words ("Few people")
const W = (s, t0 = 0, step = 0.3) => s.split(' ').map((text, i) => ({ text, start: +(t0 + i * step).toFixed(3), end: +(t0 + i * step + step * 0.9).toFixed(3) }));
const talk = [
  { text: 'Few people', start: 0.1, end: 0.52 }, ...W('end up somewhere on purpose. Vision helps us arrive at a preferred future destination.', 0.52),
  ...W('It gives us direction in Proverbs 29 verse 18. It says, Without vision, the people perish.', 5.2),
  ...W('Mission informs, but vision inspires. In mission, we use our head. But in vision, we use our heart.', 11.6),
];

test('locate: exact phrases, punctuation-insensitive, from an index, multi-word tokens', () => {
  assert.equal(locate(talk, 'without vision').i0, talk.findIndex((w) => w.text === 'Without'));
  assert.equal(locate(talk, 'few people end').i0, 0);
  const v1 = locate(talk, 'vision'), v2 = locate(talk, 'vision', v1.i0 + 1);
  assert.ok(v2.i0 > v1.i0);
  assert.equal(locate(talk, 'not in the talk'), null);
});

test('heuristic plan: scripture quote, X-but-Y compare with the parallel row, no invented numbers', () => {
  const p = heuristicPlan(talk);
  const q = p.beats.find((b) => b.type === 'quote');
  assert.equal(q.cite, 'Proverbs 29:18');
  assert.equal(q.text, 'Without vision, the people perish.');
  const c = p.beats.find((b) => b.type === 'compare');
  assert.deepEqual([c.left.title, c.right.title], ['Mission', 'Vision']);
  assert.deepEqual(c.rows.map((r) => [r.left, r.right]), [['Informs', 'Inspires'], ['Head', 'Heart']]);
  for (const b of p.beats.filter((x) => x.type === 'stat')) assert.ok(talk.some((w) => w.text.includes(b.value)));
});

test('validatePlan: unknown anchors dropped, top boxes never overlap, pops spaced, punches never inside a box', () => {
  const plan = { title: 'T', beats: [
    { type: 'card', anchor: 'Vision helps', until: 'destination', icon: 'pin', title: 'A preferred future' },
    { type: 'card', anchor: 'preferred future', title: 'overlapping box' },
    { type: 'icon', anchor: 'purpose', icon: 'target' }, { type: 'icon', anchor: 'Few people', icon: 'users' },
    { type: 'punch', anchor: 'arrive at' }, { type: 'icon', anchor: 'nowhere to be found', icon: 'eye' },
  ] };
  const { plan: v, dropped } = validatePlan(plan, talk, { duration: 18.5 });
  const boxes = v.beats.filter((b) => b.type === 'card');
  assert.equal(boxes.length, 1);
  assert.ok(dropped.some((d) => d[2] === 'anchor not found'));
  assert.ok(dropped.some((d) => d[2] === 'overlaps a top box'));
  const pops = v.beats.filter((b) => b.type === 'icon').map((b) => b.at);
  for (let i = 1; i < pops.length; i++) assert.ok(pops[i] - pops[i - 1] >= 2.5);
  for (const b of v.beats.filter((x) => x.type === 'punch')) assert.ok(!boxes.some((t) => b.at < t.end && b.end > t.at));
});

test('frame: cover keeps the region filled; contain centres a smaller picture', () => {
  const R = { x: 0, y: 0, w: 1080, h: 1920 };
  const f = frame(1920, 1080, R, { cx: 1500, cy: 400, fw: 200 }, 1);
  assert.ok(f.x <= 0 && f.x + 1920 * f.s >= R.w - 0.01 && f.y <= 0 && f.y + 1080 * f.s >= R.h - 0.01);
  const c = frame(1280, 800, { x: 0, y: 0, w: 1080, h: 675 }, null, 1, 0.5, true);
  assert.ok(Math.abs(c.x) < 0.01 && Math.abs(c.y) < 0.6);
});

test('layoutSegments: face / punch / split tile the timeline without gaps', () => {
  const segs = layoutSegments([{ type: 'punch', at: 2, end: 4 }, { type: 'quote', at: 6, end: 9 }], 12);
  assert.deepEqual(segs.map((s) => s.kind), ['face', 'punch', 'face', 'split', 'face']);
  for (let i = 1; i < segs.length; i++) assert.equal(segs[i].start, segs[i - 1].end);
  assert.equal(segs.at(-1).end, 12);
});

test('compose: every format builds, captions stay inside the frame and off the face', () => {
  const track = { samples: Array.from({ length: 80 }, (_, i) => ({ t: i * 0.25, cx: 300, cy: 650, box: [240, 590, 120, 120] })) };
  const { plan } = validatePlan(heuristicPlan(talk), talk, { duration: 18.5 });
  for (const fmt of Object.keys(FORMATS)) {
    const c = compose({ fmt, clip: { src: 'assets/clip.mp4', w: 1080, h: 1920, duration: 18.5 }, track, words: talk, plan, captions: 'kinetic', intro: 1.7, outro: 2.6, title: 'The Principle of Vision' });
    assert.match(c.html, /window\.__timelines\['main'\]=tl/);
    assert.equal(c.offset, 1.7);
    assert.ok(Math.abs(c.duration - 22.8) < 1e-6);
    assert.deepEqual(c.overlaps, [], `${fmt}: ${JSON.stringify(c.overlaps)}`);
    assert.ok(c.captions.length > 10);
    assert.ok(c.cues.some((q) => q.sfx === 'whoosh' && q.t === 0)); // the intro is in motion from frame 0
  }
});

test('shorts: candidates are sentence-aligned windows; picks never overlap', () => {
  const s = sentences(talk);
  const c = candidates(talk, { min: 4, max: 12 });
  assert.ok(c.length > 0);
  for (const x of c) assert.ok(s.some((y) => y.start === x.start) && s.some((y) => y.end === x.end));
  const p = pick(c, 3);
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) assert.ok(p[i].end <= p[j].start || p[j].end <= p[i].start);
});

test('CLI: mode defaults to clean-cut, --format all expands, bad formats rejected', () => {
  const a = parseArgs(['talk.mp4', '-o', 'out']);
  assert.equal(a.mode, 'clean-cut'); assert.deepEqual(a.formats, ['9x16']);
  const b = parseArgs(['shorts', 'talk.mp4', '-o', 'out', '--format', 'all', '--clips', '5', '--no-music']);
  assert.equal(b.mode, 'shorts'); assert.deepEqual(b.formats, ['9x16', '1x1', '16x9']); assert.equal(b.clips, '5'); assert.equal(b.noMusic, true);
  assert.throws(() => parseArgs(['captions', 'x.mp4', '-o', 'o', '--format', '4x3']));
});

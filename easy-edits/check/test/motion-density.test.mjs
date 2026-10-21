// motion-density: event gaps from a synthetic plan (always), and gen-talk-v3's plain-face stretch 7.5-15 s
// (skipped when the gitignored project is absent; frame diff skipped when its render is absent).
//   node --test easy-edits/check/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventGaps, checkDensity, frameCuts } from '../motion-density.mjs';
// renders that some tests read (skipped when absent): <repo>/../renders, or EASY_EDITS_TEST_RENDERS
const RENDERS = process.env.EASY_EDITS_TEST_RENDERS || new URL('../../../renders', import.meta.url).pathname;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VP = path.join(HERE, '../../../video-projects');

test('synthetic: scene starts and events are the beats; head and tail stretches count', () => {
  const plan = { duration: 10, scenes: [{ start: 0, end: 5 }, { start: 5, end: 10 }], events: [{ time: 2.5 }, { time: 5.01 }, { time: 7.4 }] };
  assert.deepEqual(eventGaps(plan).map((g) => g.dur), [2.5, 2.5, 2.4, 2.6]);
  assert.equal(checkDensity(plan).bad.length, 0);
  plan.events.pop();
  assert.deepEqual(checkDensity(plan).bad.map((g) => [g.start, g.end]), [[5, 10]]);
  assert.equal(checkDensity({ ...plan, events: [] }, { cuts: [7] }).bad[1].confirmed, false);
});

const proj = path.join(VP, 'gen-talk-v3'), render = RENDERS + '/gen_talk_v3.raw.mp4';
test('gen-talk-v3: 7.5-15 s plain face is flagged', { skip: !fs.existsSync(path.join(proj, 'assets/plan.json')) }, () => {
  const plan = JSON.parse(fs.readFileSync(path.join(proj, 'assets/plan.json'), 'utf8'));
  const cuts = fs.existsSync(render) ? frameCuts(render) : null;
  const r = checkDensity(plan, { cuts });
  assert.ok(r.bad.some((g) => g.start <= 8.4 && g.end >= 8.4 - 1e-9 && g.dur > 3), 'gap reaching 8.4 s');
  assert.ok(r.bad.some((g) => g.start >= 8.4 - 1e-9 && g.end <= 12.7 && g.dur > 3), 'gap 8.4-12.67 s');
  if (cuts) {
    for (const t of [8.4, 12.7, 15.6, 17.2, 22.7, 26.4]) assert.ok(cuts.some((c) => Math.abs(c - t) <= 0.15), `layout cut near ${t}`);
    assert.ok(r.bad.every((g) => g.confirmed));
  }
});

// gen-th-style1 assets/plan.json (fixtures/style1.plan.json): passes the 3 s default, FAILS the EMBEDDED 2.0 s.
test('gen-th-style1 plan: 5.86-8.02 and 9.64-11.89 static at --max 2.0', () => {
  const plan = JSON.parse(fs.readFileSync(new URL('fixtures/style1.plan.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkDensity(plan).bad, []);
  assert.deepEqual(checkDensity(plan, { max: 2.0 }).bad.map((g) => `${g.start.toFixed(2)}-${g.end.toFixed(2)}`), ['5.86-8.02', '9.64-11.89']);
});

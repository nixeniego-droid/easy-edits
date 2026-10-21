// A/V timing of the clean-cut build on the EDL / timestamps (no render): at the start of every keep, the picture must
// show the instant the voice plays. cut.mjs puts edits on frame f = round(t * 30) of the AUDIO clock; the old build
// trimmed video by the source's own frame index, then concat + `-r 30` retimed it. The keeps are the real short_1
// (podcast) edit-decisions.json; its window.mov is 30000/1001 fps with the video starting 0.033 s after the audio
// (ffprobe); talk_01.mov (the approved clean cut) is 30/1 from 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGraph, needsResample } from '../clean-cut/build.mjs';

const KEEPS = [{ sourceStart: 0.067, sourceEnd: 8.3, start: 0, end: 8.233 }, { sourceStart: 8.967, sourceEnd: 37.367, start: 8.233, end: 36.633 }, { sourceStart: 37.867, sourceEnd: 50.5, start: 36.633, end: 49.266 }, { sourceStart: 50.9, sourceEnd: 51.633, start: 49.266, end: 49.999 }, { sourceStart: 51.633, sourceEnd: 56.674, start: 49.999, end: 55.033, videoStart: 51.633, videoEnd: 56.667 }, { sourceStart: 57.233, sourceEnd: 60.3, start: 55.033, end: 58.1 }, { sourceStart: 62.3, sourceEnd: 66.8, start: 58.1, end: 62.6 }];
const WINDOW = { rate: 30000 / 1001, avgRate: 30000 / 1001, start: 0.033 }, CHURCH = { rate: 30, avgRate: 30, start: 0 };
const FPS = 30, ms = (x) => Math.round(x * 1e4) / 10;

/** the timing model of a filterGraph on a source clock. trim=start_frame=f takes the f-th frame of the stream it is fed
 * (the source's own frames, or the fps=30 resample's), whose pts is its source instant; concat stacks the segments
 * at their pts spacing; `-r 30` shows at output frame n the latest input frame with pts <= n / 30. Per keep:
 * late = output frames between the keep's place on the audio timeline and the frame where its picture first shows
 * (the cut lands late), offset = (source instant of that first picture) - (the voice's source instant then), ms. */
function timing(graph, video) {
  const resampled = /^\[0:v\]fps=fps=30:start_time=0,split=/.test(graph);
  const clock = resampled ? { start: 0, rate: FPS } : { start: video.start, rate: video.rate };
  const segs = [...graph.matchAll(/trim=start_frame=(\d+):end_frame=(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const audio = [...graph.matchAll(/\[0:a\]atrim=start=([\d.]+)/g)].map((m) => Number(m[1]));
  let grid = 0, inPts = 0;
  return segs.map(([f0, f1], k) => {
    const first = Math.ceil(inPts * FPS - 1e-6);              // first output frame showing this segment
    const i = Math.floor((first / FPS - inPts) * clock.rate + 1e-6);
    const voice = (k ? audio[k] + 0.015 : audio[k]) + (first - grid) / FPS; // atrim starts xf / 2 early (crossfade)
    const r = { late: (first - grid) || 0, offset: ms(clock.start + (f0 + i) / clock.rate - voice) };
    grid += f1 - f0; inPts += (f1 - f0) / clock.rate;
    return r;
  });
}
const FRAME = 1000 / FPS;

test('the bug: on the 29.97 fps window the old graph is off by >= 1 frame at every keep (picture ahead, cuts late)', () => {
  const t = timing(filterGraph(KEEPS, { dur: 66.85 }), WINDOW);  // what build.mjs did: no source clock
  // keep 0: the picture shows 32.7 ms (1 frame) of the future; later keeps: the 0.1 % slow frames push each cut
  // >= 1 output frame late AND the picture runs ahead of the voice once it shows
  assert.ok(t.every((x) => x.late >= 1 || Math.abs(x.offset) >= FRAME - 1), JSON.stringify(t));
  assert.ok(t.every((x) => x.offset > 0), JSON.stringify(t));
  assert.ok(t.slice(1).every((x) => x.late >= 1), JSON.stringify(t));
});

test('the fix: the window is resampled to 30 fps on the audio clock first, every keep within 1 ms of its voice', () => {
  assert.equal(needsResample(WINDOW), true);
  const g = filterGraph(KEEPS, { video: WINDOW, dur: 66.85 });
  assert.match(g, /^\[0:v\]fps=fps=30:start_time=0,split=7\[s0\]\[s1\]\[s2\]\[s3\]\[s4\]\[s5\]\[s6\];/);
  for (let i = 0; i < 7; i++) assert.match(g, new RegExp(`\\[s${i}\\]trim=start_frame=\\d+:end_frame=\\d+,setpts=PTS-STARTPTS`));
  assert.ok(!/\[0:v\]trim/.test(g));
  const t = timing(g, WINDOW);
  // every cut on its frame, picture = voice (the slipped keep #4 keeps the approved <= 20 ms audio slip)
  t.forEach((x, k) => { assert.equal(x.late, 0, `keep ${k}`); assert.ok(Math.abs(x.offset) <= (KEEPS[k].videoStart != null ? 20 : 1), `keep ${k}: ${x.offset} ms`); });
  // same cut points as before: the fix changes which picture a frame holds, not where the edits are
  assert.deepEqual([...g.matchAll(/trim=start_frame=(\d+):end_frame=(\d+)/g)].map((m) => m.slice(1)), [...filterGraph(KEEPS, { dur: 66.85 }).matchAll(/trim=start_frame=(\d+):end_frame=(\d+)/g)].map((m) => m.slice(1)));
});

test('a 30/1 source from 0 (talk_01, the approved clean cut) keeps the frame-exact graph byte for byte', () => {
  assert.equal(needsResample(CHURCH), false);
  assert.equal(needsResample(null), false);
  const g = filterGraph(KEEPS, { video: CHURCH, dur: 66.85 });
  assert.equal(g, filterGraph(KEEPS, { dur: 66.85 }));
  timing(g, CHURCH).forEach((x, k) => { assert.equal(x.late, 0); assert.ok(Math.abs(x.offset) <= (KEEPS[k].videoStart != null ? 20 : 1), `keep ${k}: ${x.offset} ms`); });
  assert.equal(needsResample({ rate: 30, avgRate: 29.97, start: 0 }), true);     // VFR phone footage
  assert.equal(needsResample({ rate: 30, avgRate: 30, start: 0.021 }), true);     // video starts after the audio
  assert.equal(needsResample({ rate: 30, avgRate: 30, start: 0 }, 25), true);     // another grid
});

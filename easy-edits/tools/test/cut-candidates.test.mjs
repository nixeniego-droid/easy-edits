// cut-candidates on saved 4 s window words (fixtures/cut-candidates-windows.json, cut from the full --all-windows
// medium runs on test-media/talk_30s.mp4 and test-media/nasa2_30s.mp4) -> talk "a a" 3.30-3.60, nasa2 "i i" 15.42-16.06.
//   node --test easy-edits/tools/test/*.test.mjs   (no ASR; the cache is checked in a temp dir)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cutCandidates, suspectWindows, windows, run, cachePath } from '../cut-candidates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/cut-candidates-windows.json'), 'utf8'));

for (const [name, [s, e]] of [['talk', [3.3, 3.6]], ['nasa2', [15.42, 16.06]]]) {
  test(`${name}: stutter cut ${s}-${e} s, later instance kept`, () => {
    const r = cutCandidates(FX[name].spans, FX[name].words);
    assert.ok(r.cuts.some((c) => c.start === s && c.end === e), JSON.stringify(r.cuts));
    for (const c of r.candidates) assert.ok(c.cutEnd > c.cutStart && c.windows >= 2);
  });
}

test('suspect windows: every grid window covering a whole-file repeat', () => {
  const whole = [{ text: 'really', start: 2.9, end: 3.2 }, { text: 'a,', start: 3.3, end: 3.4 }, { text: 'a', start: 3.6, end: 3.7 }, { text: 'gigantic', start: 3.8, end: 4.3 }];
  const { suspects, spans } = suspectWindows(whole, 30);
  assert.equal(suspects.length, 1);
  assert.deepEqual(spans, windows(30).filter(([a, b]) => a <= 3.1 && b - 0.15 > 3.9));
  assert.ok(spans.length >= 2);
});

test('cache hit by source sha1 skips the decode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-cutcand-test-'));
  process.env.EASY_EDITS_CUTCAND_CACHE = path.join(dir, 'cache');
  const src = path.join(dir, 'x.mp4'); fs.writeFileSync(src, 'not a video');
  fs.mkdirSync(path.dirname(cachePath(src)), { recursive: true });
  fs.writeFileSync(cachePath(src), JSON.stringify({ candidates: [], cuts: [{ start: 1, end: 1.2, because: ['a a'] }] }));
  const j = run(src);
  assert.equal(j.cache, 'hit');
  assert.equal(j.cuts[0].end, 1.2);
});

// Fillers and "a another" restarts from the whole-file disfluent decode of test-media/talk_30s.mp4 (the gen-th-style2b
// source; fixtures/talk_30s.whole-disfluent.json). The window candidates (a a, a gigantic) missed the "uh" at 6.86 s
// that the style2b final kept ("a very large, uh, importance" ~0:02).
import { wholeExtras, withExtras } from '../cut-candidates.mjs';
test('talk_30s whole-file: the filler "uh" at 6.86 s becomes a cut; the window cuts stay', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures/talk_30s.whole-disfluent.json'), 'utf8'));
  assert.deepEqual(wholeExtras(fx.whole).map((c) => [c.kind, c.removed, c.cutStart, c.cutEnd]), [['filler', 'uh', 6.86, 7.38]]);
  const r = withExtras({ candidates: fx.candidates, whole: fx.whole });
  assert.deepEqual(r.cuts.map((c) => [c.start, c.end]), [[3.44, 3.62], [4.04, 4.64], [6.86, 7.38]]);
});
test('restart: "a another" cuts the "a"; "a big", "an apple" and "to today" do not', () => {
  const W = (s, t0 = 0) => s.split(' ').map((text, i) => ({ text, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.2 }));
  assert.deepEqual(wholeExtras(W('from a another area', 12)).map((c) => [c.kind, c.text, c.cutStart, c.cutEnd]), [['restart', 'a another', 12.3, 12.6]]);
  assert.deepEqual(wholeExtras(W('a big an apple went to today')), []);
  assert.deepEqual(wholeExtras(W('large um, importance')).map((c) => c.kind), ['filler']);
});

test('merged-repeat suspects: a short word with a long span AND two voiced islands split by quiet; not a plain absorbed pause', async () => {
  const { mergedSuspects, suspectWindows } = await import('../cut-candidates.mjs');
  const runs = (...r) => r.flatMap(([d, s]) => Array(Math.round(s * 100)).fill(d));
  // "only a [0.2 s] a greater" -> "a" 1.0-1.6 holds two islands; "is" 2.5-3.3 is voice then an absorbed pause
  const win = runs([-90, 0.5], [-20, 0.8], [-90, 0.2], [-20, 0.1], [-90, 0.1], [-20, 0.5], [-20, 0.3], [-90, 0.5], [-20, 0.5], [-90, 1]);
  const whole = [{ text: 'only', start: 0.5, end: 1.0 }, { text: 'a', start: 1.0, end: 1.6 }, { text: 'greater', start: 1.6, end: 2.1 },
    { text: 'is', start: 2.5, end: 3.3 }, { text: 'big.', start: 3.4, end: 3.9 }];
  const s = mergedSuspects(whole, 4.5, win);
  assert.deepEqual(s.map((x) => x.removed), ['a']);
  assert.deepEqual(mergedSuspects(whole, 4.5, null), [], 'no band windows -> no merged suspects');
  assert.ok(suspectWindows(whole, 4.5, win).spans.length > 0);
  assert.equal(suspectWindows(whole, 4.5, null).spans.length, 0);
});

test('the whole disfluent decode is chunked (10 s + 1 s context) and stitched by word start, no word twice', async () => {
  const { chunkSpans, stitchChunks } = await import('../cut-candidates.mjs');
  const ch = chunkSpans(25);
  assert.deepEqual(ch.map((c) => c.span), [[0, 11], [9, 21], [19, 25]]);
  const words = [[{ text: 'a', start: 1 }, { text: 'b', start: 9.5 }, { text: 'c', start: 10.2 }],
    [{ text: 'b', start: 9.5 }, { text: 'c', start: 10.21 }, { text: 'd', start: 19.9 }, { text: 'e', start: 20.4 }],
    [{ text: 'd', start: 19.9 }, { text: 'e', start: 20.41 }, { text: 'f', start: 24 }]];
  assert.deepEqual(stitchChunks(ch, words).map((w) => w.text).join(''), 'abcdef');
});

test('uncovered: voiced stretches with no word are found, covered ones are not; spans merge; fill dedupes', async () => {
  const { uncovered, gapSpans, fillUncovered } = await import('../cut-candidates.mjs');
  // 10 s of 10 ms windows: noise -70 dB; speech -20 dB at 1-3 s (no words) and 5-7 s (words)
  const win = Array.from({ length: 1000 }, (_, i) => ((i >= 100 && i < 300) || (i >= 500 && i < 700) ? -20 : -70));
  const words = [{ text: 'hi', start: 5, end: 6 }, { text: 'there', start: 6, end: 7 }];
  assert.deepEqual(uncovered(words, win), [[1, 3]]);
  assert.deepEqual(uncovered([...words, { text: 'x', start: 1, end: 3 }], win), []);
  assert.deepEqual(gapSpans([[1, 3], [4.5, 6], [9, 9.9]], 10), [[0, 7], [8, 10]]);
  const filled = fillUncovered(words, [[0, 4]], [[{ text: 'a', start: -0.2, end: 0.3 }, { text: 'b', start: 1, end: 2 }, { text: 'dup', start: 5.1, end: 5.5 }]]);
  assert.deepEqual(filled.map((w) => w.text), ['a', 'b', 'hi', 'there']);
  assert.equal(filled[0].start, 0);
});

test('two chunk grids: each 5 s cell takes the denser (verbatim) decode', async () => {
  const { pickDenser, chunkSpansShifted } = await import('../cut-candidates.mjs');
  const clean = [{ text: 'really', start: 3 }, { text: 'a', start: 3.5 }, { text: 'very', start: 4 }, { text: 'nation', start: 7 }];
  const verb = [{ text: 'really', start: 3 }, { text: 'a', start: 3.4 }, { text: 'a', start: 3.6 }, { text: 'a', start: 3.8 }, { text: 'very', start: 4 }];
  assert.deepEqual(pickDenser(clean, verb, 10).map((w) => w.text), ['really', 'a', 'a', 'a', 'very', 'nation']);
  assert.deepEqual(chunkSpansShifted(35).map((c) => c.core), [[0, 5], [5, 15], [15, 25], [25, 35]]);
});

test('pickDenser drops the same word taken from both grids at a cell edge', async () => {
  const { pickDenser } = await import('../cut-candidates.mjs');
  const a = [{ text: 'group', start: 4.5 }, { text: 'because', start: 4.98 }], b = [{ text: 'because,', start: 5.02 }, { text: 'we', start: 6 }, { text: 'x', start: 6.5 }];
  assert.deepEqual(pickDenser(a, b, 10).map((w) => w.text), ['group', 'because', 'we', 'x']);
});

test('fillerCuts: a filler heard by 2 windows becomes a cut timed by the median', async () => {
  const { fillerCuts } = await import('../cut-candidates.mjs');
  const c = fillerCuts([[{ text: 'uh,', start: 6.86, end: 7.2 }], [{ text: 'Uh', start: 6.9, end: 7.3 }, { text: 'so', start: 8, end: 8.2 }], [{ text: 'um', start: 12, end: 12.3 }]]);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].because, c[0].from], [['uh'], 'filler-windows']);
  assert.ok(c[0].start >= 6.86 && c[0].end <= 7.3);
});

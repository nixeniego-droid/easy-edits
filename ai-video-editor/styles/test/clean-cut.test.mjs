// Clean cut deterministic cut list + build helpers on frozen word lists (no media, no ASR).
//   node --test ai-video-editor/styles/test/clean-cut.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanCut, markRemovals, quietRuns, splitMerged, deepLevel, GUARD, SLIP_MAX } from '../clean-cut/cut.mjs';
import { checkCuts } from '../../tools/cut-guard.mjs';
import { captionBand, captions, filterGraph, html, preset, tailHold, roomTone, TAIL_HOLD } from '../clean-cut/build.mjs';
import { checkCaptionSize } from '../../check/caption-size.mjs';

// "So, uh, I I think the the plan is a gigan- a gigantic, a very large win. [1.2 s pause] (breath pause 0.25 s) we
// we ship it. we ship it." -> fillers, token repeats, a false start, a repeated phrase and a long pause.
const W = (spec) => { let t = 0.5; return spec.map(([text, d = 0.3, gap = 0.05]) => { const w = { text, start: +t.toFixed(3), end: +(t + d).toFixed(3) }; t += d + gap; return w; }); };
const words = W([['So,'], ['uh,', 0.3, 0.1], ['I', 0.15], ['I', 0.15], ['think'], ['the', 0.15], ['the', 0.15], ['plan'], ['is'],
  ['a', 0.1], ['gigan-', 0.3], ['a', 0.1], ['gigantic,', 0.4, 0.1], ['a', 0.1], ['very'], ['large'], ['win.', 0.3, 1.2],
  ['Now', 0.3, 0.25], ['we'], ['ship'], ['it.', 0.3, 0.1], ['We'], ['ship'], ['it.']]);
const text = (r) => r.words.map((w) => w.text).join(' ');

test('fillers, repeats, false starts and repeated phrases go; the last take stays', () => {
  const why = markRemovals(words, { mode: 'strict' });
  const gone = words.filter((_, i) => why[i]).map((w, k) => `${w.text}`);
  assert.deepEqual(gone, ['uh,', 'I', 'the', 'a', 'gigan-', 'a', 'gigantic,', 'we', 'ship', 'it.']);
  const r = cleanCut(words, { mode: 'strict', duration: 12 });
  assert.equal(text(r), 'So, I think the plan is a very large win. Now We ship it.');
  assert.ok(r.removed.some((x) => x.reason === 'filler' && x.text === 'uh,'));
  assert.ok(r.removed.some((x) => x.reason === 'false-start' && x.text === 'gigan-'));
  assert.ok(r.removed.some((x) => /repeat-phrase/.test(x.reason)));
});

test('a long pause is trimmed, a breath-length pause (<= 0.3 s) is kept', () => {
  const r = cleanCut(words, { mode: 'strict', duration: 12 });
  const win = r.words.find((w) => w.text === 'win.'), now = r.words.find((w) => w.text === 'Now'), we = r.words.find((w) => w.text === 'we' || w.text === 'We');
  assert.ok(now.start - win.end <= 0.3, `pause after "win." ${now.start - win.end}`);
  // "Now" -> "we" (0.25 s) is a natural pause inside one keep: same gap as in the source
  const sNow = words.find((w) => w.text === 'Now');
  assert.ok(r.removed.every((x) => !(x.sourceStart >= sNow.end - 0.01 && x.sourceEnd <= sNow.end + 0.26 && /dead-air/.test(x.reason))));
  assert.ok(we);
});

test('no kept word is clipped: every keep holds its words >= 30 ms clear; keeps are retimed contiguously', () => {
  const r = cleanCut(words, { mode: 'strict', duration: 12 });
  const kept = words.filter((_, i) => !markRemovals(words, { mode: 'strict' })[i]);
  for (const w of kept) {
    const k = r.keeps.find((k) => w.start >= k.sourceStart && w.end <= k.sourceEnd);
    assert.ok(k, `${w.text} not inside one keep`);
    assert.ok(w.start - k.sourceStart >= GUARD - 1e-6 || k.sourceStart === 0, `${w.text} start too close`);
    assert.ok(k.sourceEnd - w.end >= GUARD - 1e-6, `${w.text} end too close`);
  }
  r.keeps.forEach((k, i) => { assert.ok(k.sourceEnd > k.sourceStart); if (i) assert.equal(k.start, r.keeps[i - 1].end); });
  // head pad ~0.15 s, tail pad ~0.25 s (edit points on the 30 fps frame grid: +- 1 frame)
  assert.ok(words[0].start - r.keeps[0].sourceStart <= 0.15 + 1 / 30);
  assert.ok(r.keeps.at(-1).sourceEnd - words.at(-1).end <= 0.25 + 0.04);
});

test('review patch: force-keep an intentional repeat, fix a spelling', () => {
  const v = W([['very'], ['very'], ['good']]);
  assert.equal(text(cleanCut(v, { mode: 'strict', duration: 3 })), 'very good');
  assert.equal(text(cleanCut(v, { mode: 'strict', duration: 3, patch: { keep: [0], text: { 2: 'Good' } } })), 'very very Good');
});

test('quiet runs: windows under the band floor longer than 0.3 s', () => {
  const win = [...Array(50).fill(-20), ...Array(40).fill(-70), ...Array(50).fill(-20), ...Array(20).fill(-70), ...Array(50).fill(-20)];
  assert.deepEqual(quietRuns(win), [[0.5, 0.9]]);
});

test('build: audio crossfades keep the audio length equal to the video; one grade', () => {
  const g = filterGraph([{ sourceStart: 0, sourceEnd: 1 }, { sourceStart: 2, sourceEnd: 3 }, { sourceStart: 4, sourceEnd: 5 }]);
  assert.equal((g.match(/acrossfade=d=0.03/g) || []).length, 2);
  assert.match(g, /atrim=start=1.985:end=3.015/);
  assert.match(g, /trim=start_frame=60:end_frame=90/);
  assert.equal((g.match(/eq=/g) || []).length, 1);
});

test('captions-minimal: sentence case, 1-2 lines, lower band unless the face reaches it; passes caption-size with its preset only', () => {
  const caps = captions(cleanCut(words, { mode: 'strict', duration: 12 }).words, { duration: 12 });
  assert.ok(caps.every((c) => c.text === c.text.replace(/[,.;:]$/, '') && c.text !== c.text.toUpperCase()));
  const page = html({ duration: 12, caps, cover: { scale: 1, x: 0, y: 0 }, src: { width: 1080, height: 1920 } });
  assert.doesNotMatch(page, /text-transform:uppercase|tl\.(to|fromTo)/);
  assert.deepEqual(checkCaptionSize(page, preset).bad, []);
  assert.ok(checkCaptionSize(page).bad.some((b) => b.kind === 'size'), 'the default 100 px preset still applies to other styles');
  // 1280x720 cover 2.673: a face at y 145 h 188 ends ~ chin 966 px -> lower band; a low face (y 420) -> upper
  assert.equal(captionBand([712, 145, 188, 188], { scale: 2.673, x: -1614, y: 0 }), 'lower');
  assert.equal(captionBand([712, 420, 188, 188], { scale: 2.673, x: -1614, y: 0 }), 'upper');
  assert.equal(JSON.parse(fs.readFileSync(new URL('../clean-cut/captions.json', import.meta.url))).name, 'captions-minimal');
});

test('a cut candidate with no word in the plain transcript still removes its audio', () => {
  // plain pass: "really [gap: 'a a gigantic,' heard only by the disfluent windows] a very large"
  const v = [{ text: 'really', start: 0.5, end: 0.9 }, { text: 'a', start: 2.0, end: 2.1 }, { text: 'very', start: 2.15, end: 2.4 }, { text: 'large', start: 2.45, end: 2.8 }];
  const r = cleanCut(v, { mode: 'strict', duration: 3.5, candidates: [{ start: 0.95, end: 1.95, because: ['a gigantic, a very'] }] });
  assert.equal(text(r), 'really a very large');
  assert.ok(r.keeps.every((k) => k.sourceEnd <= 1.0 || k.sourceStart >= 1.9), JSON.stringify(r.keeps));
  assert.ok(r.removed.some((x) => /candidate: a gigantic/.test(x.reason) && x.index === null));
});

test('tail pad is measured from the voice, not the ASR word end', () => {
  // voice runs to 2.0 s, ASR says the last word ends at 1.6 s; quiet afterwards (10 ms windows)
  const win = [...Array(50).fill(-90), ...Array(150).fill(-20), ...Array(150).fill(-90)];
  const r = cleanCut([{ text: 'hello', start: 0.55, end: 1.0 }, { text: 'world.', start: 1.05, end: 1.6 }], { mode: 'strict', win });
  assert.ok(r.keeps.at(-1).sourceEnd >= 2.0 + 0.25 - 1e-6, JSON.stringify(r.keeps));
});

test('a filler glued to its neighbours (no quiet frame to cut at) is kept rather than clipping a word', () => {
  // "large uh importance" voiced end to end (10 ms windows), quiet before and after
  const win = [...Array(50).fill(-90), ...Array(150).fill(-20), ...Array(100).fill(-90)];
  const v = [{ text: 'large,', start: 0.5, end: 0.95 }, { text: 'uh,', start: 0.95, end: 1.4 }, { text: 'importance', start: 1.4, end: 2.0 }];
  const r = cleanCut(v, { mode: 'strict', win });
  assert.equal(text(r), 'large, uh, importance');
  assert.equal(r.keeps.length, 1);
});

// 10 ms band windows from [dB, seconds] runs
const runs = (...r) => r.flatMap(([d, s]) => Array(Math.round(s * 100)).fill(d));

test('a filler glued to the kept word inside its ASR span: the end moves back into the pause, the filler goes', () => {
  // ASR "large" 0.5-1.0 ends where "uh" starts, but the voice of "large" stops at 0.8 and 50 ms of quiet sit before "uh"
  const win = runs([-90, 0.5], [-20, 0.3], [-90, 0.05], [-25, 0.25], [-90, 0.1], [-20, 0.6], [-90, 1.0]);
  const v = [{ text: 'large,', start: 0.5, end: 1.0 }, { text: 'uh,', start: 1.0, end: 1.3 }, { text: 'importance', start: 1.4, end: 2.0 }];
  const r = cleanCut(v, { mode: 'strict', win });
  assert.equal(text(r), 'large, importance');
  assert.ok(r.removed.some((x) => x.reason === 'filler'));
  assert.ok(checkCuts(r.keeps, v, { win, sourceEnd: 2.8 }).rows.every((x) => !x.fail), JSON.stringify(r.keeps));
});

test('audio edges may slip <= 20 ms off the frame grid into the quiet; video stays on frames, timeline = video', () => {
  // 65 ms of quiet after "one" (0.95-1.015): no frame (0.967, 1.0) has 30 ms clear on both sides, 0.983 does
  const w2 = runs([-90, 0.5], [-20, 0.45], [-90, 0.065], [-20, 0.285], [-90, 0.065], [-20, 0.495], [-90, 0.6]);
  const v = [{ text: 'one', start: 0.5, end: 0.95 }, { text: 'um', start: 1.015, end: 1.3 }, { text: 'two', start: 1.365, end: 1.86 }];
  const r = cleanCut(v, { mode: 'strict', win: w2 });
  assert.equal(text(r), 'one two');
  for (const k of r.keeps) {
    const vs = k.videoStart ?? k.sourceStart, ve = k.videoEnd ?? k.sourceEnd;
    assert.ok(Math.abs(vs * 30 - Math.round(vs * 30)) < 0.02 && Math.abs(ve * 30 - Math.round(ve * 30)) < 0.02, `video on frames ${JSON.stringify(k)}`);
    assert.ok(Math.abs(k.sourceStart - vs) <= SLIP_MAX + 1e-9 && Math.abs(k.sourceEnd - ve) <= SLIP_MAX + 1e-9);
    assert.ok(Math.abs((k.end - k.start) - (ve - vs)) < 1e-3);
  }
  assert.ok(checkCuts(r.keeps, v, { win: w2, sourceEnd: 2.5 }).rows.every((x) => !x.fail), JSON.stringify(r.keeps));
});

test('a repeat merged into one ASR word ("a" holding "a, a") is split at its quiet and the second take goes', () => {
  // "only a [0.2 s quiet] a greater": ASR "a" 1.0-1.5 holds both; cut-candidates heard "a a"
  const win = runs([-90, 0.5], [-20, 0.7], [-90, 0.2], [-20, 0.1], [-90, 0.08], [-20, 0.5], [-90, 0.6]);
  const v = [{ text: 'only', start: 0.5, end: 1.0 }, { text: 'a', start: 1.0, end: 1.5 }, { text: 'greater', start: 1.58, end: 2.08 }];
  const c = [{ start: 1.0, end: 1.5, because: ['a a'] }];
  const sp = splitMerged(v, c, win, deepLevel(win));
  assert.equal(sp.extra.length, 1);
  assert.ok(sp.words[1].end <= 1.21 && sp.extra[0].start >= 1.39, JSON.stringify(sp));
  const r = cleanCut(v, { mode: 'strict', win, candidates: c });
  assert.equal(text(r), 'only a greater');
  assert.ok(r.removed.some((x) => x.reason === 'repeat (merged)'));
  assert.ok(r.keeps.every((k) => k.sourceEnd <= 1.42 || k.sourceStart >= 1.5), JSON.stringify(r.keeps));
  // no candidate -> no split (a long span alone is just an absorbed pause)
  assert.equal(splitMerged(v, [], win, deepLevel(win)).extra.length, 0);
});

test('tail hold: a source that ends on speech gets a held last frame + room tone; a padded one does not', () => {
  const keeps = [{ sourceStart: 0, sourceEnd: 2 }, { sourceStart: 3, sourceEnd: 9.95 }];
  assert.equal(tailHold(keeps, 10), TAIL_HOLD);
  assert.equal(tailHold([{ sourceStart: 0, sourceEnd: 9 }], 10), 0);
  const room = roomTone([{ sourceStart: 2, sourceEnd: 3, reason: 'dead-air 1.00 s' }, { sourceStart: 5, sourceEnd: 5.2, reason: 'filler' }]);
  assert.deepEqual(room, [2, 3]);
  const g = filterGraph(keeps, { dur: 10, tail: TAIL_HOLD, room });
  assert.match(g, /fps=30,tpad=stop_mode=clone:stop_duration=0.4\[v1\]/);
  assert.match(g, /\[rt\]acrossfade/);
  assert.match(g, /apad,atrim=end=9.367,afade=t=out:st=8.967:d=0.4:curve=cub\[aout\]/); // 269 frames + 0.4 s, faded
});

test('light: fillers and long dead air go; repeats, self-corrections and breathing pauses stay', () => {
  const W = (spec) => spec.map(([text, start, end]) => ({ text, start, end }));
  // "Proverbs 30, 29 says, uh, where there is no vision, vision" with a 0.5 s breath and a 1.6 s dead pause
  const v = W([['Proverbs', 0.5, 1.0], ['30,', 1.1, 1.4], ['29', 1.5, 1.9], ['says,', 2.0, 2.4], ['uh,', 2.6, 2.9],
    ['where', 3.4, 3.6], ['there', 3.65, 3.9], ['is', 3.95, 4.1], ['no', 4.15, 4.4], ['vision,', 4.5, 5.0], ['vision.', 6.6, 7.1]]);
  const r = cleanCut(v, { duration: 8, mode: 'light' });
  assert.equal(r.words.map((w) => w.text).join(' '), 'Proverbs 30, 29 says, where there is no vision, vision.');
  assert.deepEqual(r.removed.filter((x) => x.text).map((x) => x.reason), ['filler']);
  const strict = cleanCut(v, { duration: 8, mode: 'strict' });
  assert.ok(strict.words.length < r.words.length);
  // a window-confirmed stutter candidate is ignored in light mode; a filler-only one is used
  assert.equal(cleanCut(v, { duration: 8, mode: 'light', candidates: [{ start: 4.4, end: 5.05, because: ['vision vision'] }] }).words.length, 10);
});

test('captions: a stutter group shorter than 0.35 s joins the next caption', async () => {
  const { captions } = await import('../clean-cut/build.mjs');
  const W = (spec) => spec.map(([text, start, end]) => ({ text, start, end }));
  const caps = captions(W([['really', 2.98, 3.4], ['a,', 3.46, 3.6], ['a,', 3.64, 3.66], ['a', 3.66, 4.0], ['gigantic,', 4.1, 4.5], ['a', 4.56, 4.7], ['very', 4.76, 5.0], ['large.', 5.06, 5.6]]), { duration: 6 });
  assert.ok(caps.every((c) => c.end - c.start >= 0.35), JSON.stringify(caps.map((c) => [c.text, c.start, c.end])));
  assert.equal(caps.map((c) => c.text).join(' ').replace(/,/g, ''), 'really a a a gigantic a very large');
});

test('light: a filler-window cut glued to a kept word span still removes the filler audio', () => {
  const v = [{ text: 'very', start: 5.9, end: 6.3 }, { text: 'large', start: 6.36, end: 7.0 }, { text: 'importance', start: 7.3, end: 7.9 }];
  const r = cleanCut(v, { duration: 9, mode: 'light', candidates: [{ start: 6.86, end: 7.2, because: ['uh'], from: 'filler-windows' }] });
  assert.ok(r.removed.some((x) => x.reason === 'filler' && x.sourceStart >= 6.8), JSON.stringify(r.removed));
  assert.equal(r.words.map((w) => w.text).join(' '), 'very large importance');
});

test('tail hold when less than 0.6 s of source follows the last keep (talk_01: 0.23 s)', () => {
  assert.equal(tailHold([{ sourceStart: 0, sourceEnd: 53.97 }], 54.2), TAIL_HOLD);
  assert.equal(tailHold([{ sourceStart: 0, sourceEnd: 9.3 }], 10), 0);
});

test('review patch text is caption-only: a blank keeps the audio, no text fix moves a cut', () => {
  const plain = cleanCut(words, { duration: 14 });
  const fixed = cleanCut(words, { duration: 14, patch: { text: { 4: 'thought', 18: '', 19: 'Ship' } } });
  assert.deepEqual(fixed.keeps.map((k) => [k.sourceStart, k.sourceEnd]), plain.keeps.map((k) => [k.sourceStart, k.sourceEnd]));
  assert.ok(!fixed.words.some((w) => w.sourceIndex === 18), 'blank word not captioned');
  assert.ok(fixed.words.some((w) => w.sourceIndex === 19 && w.text === 'Ship'));
  assert.ok(fixed.words.some((w) => w.text === 'thought'));
  assert.equal(fixed.words.length, plain.words.length - 1);
});

test('a review removal is never played back: the edit point stays out of the removed word (talk_01 "Proverbs 30, 29")', () => {
  // real speech-band windows of talk_01 (loud PA room: no deep quiet between "Proverbs" and "30,"); the old fallback
  // reached forward to the first deep window AFTER "30," (keep 15.9-19.7) and so played the removed word back
  const f = JSON.parse(fs.readFileSync(new URL('./fixtures/talk01-proverbs.json', import.meta.url), 'utf8'));
  const r = cleanCut(f.words, { win: f.win, patch: { remove: [3] } });
  assert.equal(text(r), 'direction in Proverbs 29 verse 18.');
  const cut = f.words[3];
  assert.ok(r.keeps.every((k) => k.sourceEnd <= cut.start + 1e-9 || k.sourceStart >= cut.end - 1e-9), JSON.stringify(r.keeps));
  assert.ok(checkCuts(r.keeps, f.words, { win: f.win, sourceEnd: f.win.length / 100 }).rows.every((x) => !x.fail), JSON.stringify(r.keeps));
});

test('clean (default) mode: stutters / repeats / false starts and fillers go, breathing pauses and sentence-end repeats stay', () => {
  const r = cleanCut(words, { duration: 14 });
  // the restart "a gigantic, a very large" goes; the repeated sentence stays (a first take ending a sentence)
  assert.equal(text(r), 'So, I think the plan is a very large win. Now we ship it. We ship it.');
  const v = W([['the'], ['people'], ['with'], ['vision.', 0.3, 0.4], ['Vision'], ['helps'], ['us']]);
  assert.equal(text(cleanCut(v, { duration: 4 })), 'the people with vision. Vision helps us');
  assert.equal(text(cleanCut(v, { duration: 4, mode: 'strict' })), 'the people with Vision helps us');
  assert.throws(() => cleanCut(v, { mode: 'tidy' }), /cut mode/);
});

test('burn.mjs reads the composition it burns: cover transform, duration, caption windows; refuses tweens', async () => {
  const { parseComposition } = await import('../clean-cut/burn.mjs');
  const caps = [{ text: 'Few people end', start: 0.033, end: 1.62, band: 'lower' }, { text: 'up there', start: 1.62, end: 2.5, band: 'upper' }];
  const cover = { scale: 2.673, x: -1609.31, y: 0 };
  const h = html({ duration: 30.867, caps, cover, src: { width: 1280, height: 720 } });
  const c = parseComposition(h);
  assert.deepEqual([c.width, c.height, c.duration], [1080, 1920, 30.867]);
  assert.deepEqual(c.cover, { x: -1609.31, y: 0, w: 3421.44, h: 1924.56 });
  assert.deepEqual(c.caps.map((k) => [k.id, k.start, Number(k.end.toFixed(3))]), [['cap0', 0.033, 1.62], ['cap1', 1.62, 2.5]]);
  assert.throws(() => parseComposition(h.replace('tl.set({}, {}, 30.867);', 'tl.to("#cap0", {opacity: 0}, 1);')), /tweens/);
});

test('talk_30s "a, a, a gigantic, a very large, a very large, uh, uh, importance": one copy kept, importance never dropped', () => {
  // the whole-file decode of talk_30s (fresh-user run, 2026-10-19): Whisper gave "importance" no duration (8.10-8.10,
  // stacked on "for") and its audio to a second "uh," (7.40-7.64); the window grid confirmed only the first "uh"
  const words = [['Relationship', 0.36, 1.02], ['building', 1.02, 1.38], ['is', 1.38, 2.98], ['really', 2.98, 3.46], ['a,', 3.46, 3.64],
    ['a,', 3.64, 3.64], ['a', 3.64, 4.1], ['gigantic,', 4.1, 4.4], ['a', 4.56, 4.76], ['very', 4.76, 5.06], ['large,', 5.08, 5.62],
    ['a', 6.04, 6.1], ['very', 6.1, 6.42], ['large,', 6.42, 6.86], ['uh,', 6.86, 7.38], ['uh,', 7.4, 7.64], ['importance', 8.1, 8.1],
    ['for', 8.1, 9.1], ['our', 9.1, 9.3]].map(([text, start, end]) => ({ text, start, end, type: 'word' }));
  const candidates = [{ start: 3.46, end: 4.64, because: ['a gigantic, a very'] }, { start: 6.9, end: 7.42, because: ['uh'], from: 'filler-windows', windows: 3 }];
  const r = cleanCut(words, { duration: 9.6, candidates });
  const kept = r.words.filter((w) => !w.pseudo).map((w) => w.text.toLowerCase().replace(/[^a-z]/g, ''));
  const s = kept.join(' ');
  assert.match(s, /importance for our$/, s);
  assert.equal((s.match(/very large/g) || []).length, 1, `exactly one copy of the repeat: ${s}`);
  assert.ok(!/\ba a\b/.test(s), s);
  // the audio Whisper labelled "uh," (7.40-7.64, really "importance") plays: a keep covers it
  const src = (t) => r.keeps.some((k) => k.sourceStart <= t + 1e-6 && k.sourceEnd >= t - 1e-6);
  assert.ok(src(7.45) && src(7.6), JSON.stringify(r.keeps));
  // the window-confirmed "uh" (6.86-7.38) still goes
  assert.ok(!src(7.1), JSON.stringify(r.keeps));
});

test('talk_30s importance, end to end from the real cut-candidates cache: no whole-decode filler cut swallows the zero-length word', async () => {
  const { withExtras } = await import('../../tools/cut-candidates.mjs');
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/talk30-importance.json', import.meta.url), 'utf8'));
  const r0 = withExtras(fx);
  // the window-confirmed "uh" survives the re-merge; no cut runs to "importance"'s 8.10 start
  assert.ok(r0.cuts.some((c) => c.from === 'filler-windows'), JSON.stringify(r0.cuts));
  assert.ok(!r0.cuts.some((c) => c.start < 7.5 && c.end > 7.7), JSON.stringify(r0.cuts));
  const words = fx.whole.map((w) => ({ ...w, type: 'word' }));
  const r = cleanCut(words, { duration: 9.6, candidates: r0.cuts });
  const s = r.words.filter((w) => !w.pseudo).map((w) => w.text.toLowerCase().replace(/[^a-z]/g, '')).join(' ');
  assert.match(s, /importance for our$/, s);
  assert.equal((s.match(/very large/g) || []).length, 1, s);
  const src = (t) => r.keeps.some((k) => k.sourceStart <= t + 1e-6 && k.sourceEnd >= t - 1e-6);
  assert.ok(src(7.45) && src(7.6), JSON.stringify(r.keeps));
});

// verbatim-final --swaps on gen_th_style2b: the 0:09 caption "AND BE ABLE" (transcript "be") vs the final audio
// "and being able" is a MISHEARD FAIL; Whisper drops ("A VERY LARGE" heard "very large") are WARN; TRUST IN US
// (confirmed by the reviewer, Whisper hears "trusted us") is exempt. Heard strings = verbatim-final's excerpt decodes of
// renders/gen_th_style2b.mp4 (faster-whisper medium); the live run is skipped without the final.
//   node --test easy-edits/check/test/verbatim-final.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { misheard, swapsOnly } from '../verbatim-final.mjs';
// renders that some tests read (skipped when absent): <repo>/../renders, or EASY_EDITS_TEST_RENDERS
const RENDERS = process.env.EASY_EDITS_TEST_RENDERS || new URL('../../../renders', import.meta.url).pathname;

const fails = [
  { kind: 'cap', text: 'A VERY LARGE', at: 2.2, end: 3.5, heard: 'building is very large importance for', missing: ['a'] },
  { kind: 'cap', text: "WE'RE FROM", at: 5.3, end: 5.6, heard: 'for our group or from another area', missing: ['were'] },
  { kind: 'cap', text: 'AND BE ABLE', at: 9.2, end: 9.9, heard: 'to the philippines and being able to be a part of that culture', missing: [] },
  { kind: 'other', text: 'NEXT STOP', at: 8.5, end: 10.8, heard: 'the philippines and being able', missing: ['next', 'stop'] },
  { kind: 'cap', text: 'TRUST IN US', at: 22.7, end: 23.8, heard: 'a greater trusted us to go outside of', missing: ['trust', 'in'] },
  { kind: 'cap', text: 'TRUST', at: 22.7, end: 23.8, heard: 'a greater trusted us to go outside of', missing: ['trust'] },
];
test('misheard: inflected swaps only', () => {
  assert.equal(misheard(['and', 'be', 'able'], 'the philippines and being able to'.split(' ')), 'and being able');
  assert.equal(misheard(['trust'], 'a greater trusted us'.split(' ')), 'trusted');
  assert.equal(misheard(['a', 'very', 'large'], 'is very large importance'.split(' ')), null);
  assert.equal(misheard(['were', 'from'], 'group or from another'.split(' ')), null);
});
test('gen_th_style2b --swaps: AND BE ABLE FAILs, drops WARN, labels ignored, TRUST IN US confirmed', () => {
  const r = swapsOnly(fails, ['trust in us']);
  assert.deepEqual(r.fails.map((f) => [f.text, f.misheard]), [['AND BE ABLE', 'and being able']]);
  assert.deepEqual(r.warns.map((f) => f.text), ['A VERY LARGE', "WE'RE FROM"]);
  // without the confirmation the key word TRUST (heard "trusted") would fail
  assert.ok(swapsOnly(fails).fails.some((f) => f.text === 'TRUST'));
});
const proj = path.resolve(import.meta.dirname, 'fixtures/style2b'), final = RENDERS + '/gen_th_style2b.mp4';
test('gen_th_style2b final: verbatim-final --swaps FAILs at 0:09 only', { skip: !fs.existsSync(final), timeout: 600000 }, () => {
  const r = spawnSync('node', [path.resolve(import.meta.dirname, '../verbatim-final.mjs'), proj, final, '--swaps', '--confirmed', 'trust in us'], { encoding: 'utf8' });
  if (r.status === 2) return;
  console.log(r.stdout.split('\n').filter((l) => /FAIL/.test(l)).join('\n'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL MISHEARD 0:09\.\d-0:09\.\d cap "AND BE ABLE": the audio says "and being able"/);
  assert.equal((r.stdout.match(/FAIL MISHEARD/g) || []).length, 1);
});

// gen_th_style2c ~0:03 caption "FOR" (DOM run 2.867-3.333 s, composition time). Heard = faster-whisper medium
// of renders/gen_th_style2c.raw.mp4 (no lead-in), 1.8-5.1 s, as cached by final-asr: it says
// "for" (p 0.96-0.99, excerpts too), as did the ElevenLabs transcript, so the caption passed every tier. the reviewer
// hears "to our group" (presets/verbatim-heard.json verbatim.heard); with the hearing it FAILs as a misheard preposition.
import { verbatimFinal, applyHeard } from '../verbatim-final.mjs';
const s2c = [{ text: 'very', start: 1.84, end: 2.12 }, { text: 'large', start: 2.12, end: 2.6 }, { text: 'importance', start: 2.6, end: 3.16 }, { text: 'for', start: 3.16, end: 3.52 }, { text: 'our', start: 3.52, end: 3.72 }, { text: 'group', start: 3.72, end: 3.84 }, { text: 'because', start: 3.84, end: 4.24 }, { text: "we're", start: 4.24, end: 4.46 }, { text: 'from', start: 4.46, end: 4.58 }, { text: 'another', start: 4.58, end: 4.74 }, { text: 'nation.', start: 4.74, end: 5.06 }];
const s2cRuns = [{ kind: 'cap', text: 'FOR', start: 2.867, end: 3.333 }, { kind: 'cap', text: 'OUR GROUP', start: 3.333, end: 3.8 }];
test('gen_th_style2c FOR: Whisper hears "for" (why it passed); with the reviewer hearing it is a MISHEARD FAIL', () => {
  assert.equal(verbatimFinal(s2cRuns, s2c).fails.length, 0);
  const heard = applyHeard(s2c, ['for our group=to our group']);
  assert.deepEqual(heard.slice(3, 6).map((w) => w.text), ['to', 'our', 'group']);
  const v = verbatimFinal(s2cRuns, heard), r = swapsOnly(v.fails, ['trust in us']);
  assert.deepEqual(r.fails.map((f) => [f.text, f.misheard]), [['FOR', 'to']]);
  assert.equal(misheard(['for'], ['importance', 'to', 'our']), 'to');
  assert.equal(misheard(['a', 'very', 'large'], 'is very large importance'.split(' ')), null); // article drop stays WARN
  // TRUST IN US still exempt with the hearing applied
  assert.equal(swapsOnly(fails, ['trust in us']).fails.some((f) => /TRUST/.test(f.text)), false);
});

// gen_th_style2d 0:18.5-0:19.1 caption "GREATER": the 2 s-context excerpt glued two words, heard "greatertalked".
// An ASR concatenation artifact, not a swap: it matches. BE -> "being" (an inflection) and FOR -> "to" still FAIL.
import { glued } from '../verbatim-final.mjs';
test('gen_th_style2d GREATER vs heard "greatertalked": glued token matches, never a MISHEARD FAIL', () => {
  assert.equal(glued('greater', 'greatertalked'), true);
  assert.equal(glued('greater', 'agreater'), false); // < 3 extra letters
  assert.equal(glued('talked', 'greatertalked'), true);
  assert.equal(glued('be', 'being'), false); // inflection suffix
  assert.equal(glued('great', 'greater'), false);
  const f = { kind: 'cap', text: 'GREATER', at: 18.5, end: 19.1, heard: 'a greatertalked trust in us', missing: ['greater'] };
  assert.deepEqual(swapsOnly([f]), { fails: [], warns: [] });
  assert.equal(misheard(['greater'], ['a', 'greatertalked', 'trust']), null);
  assert.equal(misheard(['and', 'be', 'able'], 'and being able'.split(' ')), 'and being able');
  assert.equal(misheard(['for'], ['importance', 'to', 'our']), 'to');
});

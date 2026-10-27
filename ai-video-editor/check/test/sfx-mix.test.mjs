// sfx-mix on the real style1 final (fixtures/style1.sfxmix.json: measureCues rows of renders/gen_th_style1.mp4 by
// matched filter against video-projects/gen-th-style1/assets/sfx/*.wav, + its plan.json scenes / events). style1
// FAILS: SFX on kinetic words (0.19 s 'Relationship') and cues -21 to -29 dB re the voice peak (whoosh_low
// -29.4 dB at 8.02 s). Clean: the same cues on card/graphic entries at -19 dB with an undisturbed voice PASS.
//   node --test ai-video-editor/check/test/sfx-mix.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSfxMix, entryTimes, isEntryType } from '../sfx-mix.mjs';
import { HOUSE, houseDb } from '../../audio/sfx-synth.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'style1.sfxmix.json'), 'utf8'));

test('entry types: cards and graphics, not kinetic words or camera moves', () => {
  for (const t of ['paper-in', 'chip-pop', 'card-in', 'icon-pop', 'lower-third-pop', 'underline-draw', 'panel-in', 'keyword-pop']) assert.ok(isEntryType(t), t);
  for (const t of ['kinetic-word', 'word-pop', 'punch-in', 'zoom-in', 'cut-to-face', 'cut-to-punch']) assert.ok(!isEntryType(t), t);
});
test('style1 final: every cue detected by the matched filter', () => {
  assert.equal(fx.rows.length, 20);
  assert.ok(fx.rows.every((r) => r.detected && r.ncc >= 0.5));
});
test('style1 final FAILS: SFX on kinetic words and cues too soft', () => {
  const bad = checkSfxMix(fx.rows, entryTimes(fx.plan));
  assert.ok(bad.length >= 15);
  assert.match(bad.find((b) => b.time === 0.193).why.join(), /on a kinetic-word/);
  assert.equal(bad.filter((b) => /kinetic-word/.test(b.why.join())).length, 8);
  assert.match(bad.find((b) => b.time === 8.017).why.join(), /-29\.4 dB re voice peak \(want -15\.\.-12\)/);
});
test('the style1 cues on card/graphic entries at -19 dB, voice not ducked, PASS; ducking, missing, loud FAIL', () => {
  const entries = entryTimes(fx.plan);
  const ok = fx.rows.filter((r) => isEntryType(r.type) && entries.some((t) => Math.abs(t - r.time) <= 0.1)).map((r) => ({ ...r, level: -13.5, duck: 0 }));
  assert.ok(ok.length >= 10);
  assert.deepEqual(checkSfxMix(ok, entries), []);
  assert.match(checkSfxMix([{ ...ok[0], duck: -4 }], entries)[0].why.join(), /voice ducked/);
  assert.match(checkSfxMix([{ ...ok[0], detected: false, ncc: 0.1 }], entries)[0].why.join(), /not detected/);
  assert.match(checkSfxMix([{ ...ok[0], level: -10 }], entries)[0].why.join(), /-10 dB re voice peak/);
});
test('mixer house level: every class -13.5 dB re the voice peak, clamped to -15..-12', () => {
  for (const h of Object.values(HOUSE)) { assert.equal(h.db, -13.5); assert.deepEqual(h.range, [-15, -12]); }
  assert.equal(houseDb({ sfx: 'click2', db: -6 }), -12);
  assert.equal(houseDb({ sfx: 'whoosh', db: -30 }), -15);
});

// gen_th_style2b final (fixtures/style2b.sfxmix.json: its 23 sfx-mix rows from renders/gen_th_style2b.edit.log, all
// detected on card / key-word entries at -18.9..-20 dB) FAILS the 12-15 dB-under target (it passed at -20..-18).
test('gen_th_style2b final FAILS: every cue ~-19 dB re the voice peak, want -15..-12', () => {
  const s2 = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'style2b.sfxmix.json'), 'utf8'));
  const bad = checkSfxMix(s2.rows, s2.rows.map((r) => r.time));
  for (const b of bad) console.log(`  FAIL ${b.time.toFixed(2)} s ${b.sfx} ${b.why.join('; ')}`);
  assert.equal(bad.length, 23);
  assert.ok(bad.every((b) => /re voice peak \(want -15\.\.-12\)/.test(b.why.join())));
  assert.deepEqual(checkSfxMix(s2.rows.map((r) => ({ ...r, level: -13.5 })), s2.rows.map((r) => r.time)), []);
});

// The delivery check's repeat gate against the reference transcript (check/lib/repeats.mjs): talk_01's phantom
// "misha we use our" x2 (the small model hears "mission" and "vision" as "Misha") is a mishearing, not a repeat;
// a phrase said twice, a duplicated splice and a looped invented outro are real. No media, no ASR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repeatFindings, alignWords, normWord } from '../lib/repeats.mjs';

const toks = (s) => s.split(/\s+/).filter(Boolean);
// the talk_01 talking-head final, as the delivery check heard it (report.json) and as the edit captioned it
const HEARD = 'people end up somewhere on purpose and these are the people with vision. Vision helps us arrive at the preferred future destination. So the principle of vision is it gives us direction. In Proverbs 29 verse 18 it says without vision the people perish. Vision is a feature or a snapshot what it will be in the future. Misha informs, but Misha inspires. Me and Misha, we use our head, but in Misha, we use our heart.';
const REF = 'Few people end up somewhere on purpose. And these are the people with vision. Vision helps us arrive at a preferred future destination. So the principle of vision is, it gives us direction. In Proverbs 29 verse 18, it says, Without vision, the people perish. Vision is a picture or a snapshot of what it will be in the future. Mission informs, but vision inspires. In mission, we use our head. But in vision, we use our heart.';

test('talk_01: "misha we use our" x2 is a mishearing of mission / vision, not a repeat', () => {
  const r = repeatFindings(toks(HEARD), toks(REF));
  assert.equal(r.length, 1);
  assert.equal(r[0].key, 'misha we use our');
  assert.equal(r[0].verdict, 'misheard');
  assert.equal(r[0].real, false);
  assert.deepEqual(r[0].refs, ['mission we use our', 'vision we use our']);
  assert.deepEqual(repeatFindings(toks(HEARD), null).map((x) => x.verdict), ['unchecked']); // no reference: a FAIL as before
});

test('a phrase said twice in the reference is a real (spoken) repeat', () => {
  const ref = 'I told you to stop it now and I told you to stop it now please';
  const r = repeatFindings(toks(ref), toks(ref));
  assert.ok(r.length && r.every((x) => x.verdict === 'spoken' && x.real));
});

test('a phrase reused far apart in the reference is a note (reused), a retake close together stays spoken', () => {
  // NASA public-domain sample: the phrase is said twice, 6 words apart, in two different clauses
  const ref = 'Last year was the sixth warmest year on record, which is slightly down from the warmest year on record that we had last year';
  const r = repeatFindings(toks(ref), toks(ref));
  assert.deepEqual(r.map((x) => [x.key, x.verdict, x.real]), [['warmest year on record', 'reused', false]]);
  const kids = 'I saw a lot of kids get bullied at school, and like a lot of kids I often stood by';
  assert.ok(repeatFindings(toks(kids), toks(kids)).every((x) => x.verdict === 'reused' && !x.real));
  const retake = 'we launched it in May uh I mean we launched it in May';
  assert.ok(repeatFindings(toks(retake), toks(retake)).some((x) => x.verdict === 'spoken' && x.real));
});

test('a duplicated splice (said once, heard twice) and a looped outro are real (extra audio)', () => {
  const said = 'Europa Clipper is a massive spacecraft and it is kind of pretty.';
  const r = repeatFindings(toks('Europa Clipper is a massive spacecraft Europa Clipper is a massive spacecraft and it is kind of pretty.'), toks(said));
  assert.ok(r.length && r.every((x) => x.verdict === 'extra' && x.real), JSON.stringify(r));
  const loop = repeatFindings(toks(`${said} Have a great week. Have a great week. Have a great week.`), toks(said));
  assert.ok(loop.some((x) => x.key === 'have a great week' && x.real));
});

test('a mishearing elsewhere does not hide a real repeat, nor a real repeat elsewhere turn a mishearing into a FAIL', () => {
  const ref = `${REF} So stop, stop it now. So stop, stop it now.`;
  const heard = `${HEARD} So stop, stop it now. So stop, stop it now.`;
  const r = Object.fromEntries(repeatFindings(toks(heard), toks(ref)).map((x) => [x.key, x.verdict]));
  assert.equal(r['misha we use our'], 'misheard');
  assert.equal(r['so stop stop it'], 'spoken');
});

test('alignment: substitutions map, insertions do not', () => {
  const m = alignWords(['me', 'and', 'misha', 'we'], ['in', 'mission', 'we']);
  assert.equal(m.filter((j) => j < 0).length, 1);
  assert.equal(m[3], 2);
  assert.equal(normWord('Misha,'), 'misha');
});

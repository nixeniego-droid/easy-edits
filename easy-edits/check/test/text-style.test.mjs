// text-style: the real dom-sample elements of gen-talk-v5 and gen-nasa2-v3 (fixtures/text-style.elements.json).
// Both keep captions at one Montserrat 100 px but vary kinetic sizes (v5 70/110/124/150/170) -> FAIL; with the
// kinetic words set to one or two preset sizes (150 / 110 px) they pass; a third size or an off-preset size fails;
// a caption in another family fails.
//   node --test easy-edits/check/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkTextStyle } from '../text-style.mjs';

const fx = JSON.parse(fs.readFileSync(new URL('fixtures/text-style.elements.json', import.meta.url), 'utf8'));
const sizes = (els) => Object.keys(checkTextStyle(els).groups.kinetic.sizes).map(Number).sort((a, b) => a - b);

test('gen-talk-v5: kinetic sizes 70/110/124/150/170 fail, captions alone pass', () => {
  const r = checkTextStyle(fx['gen-talk-v5']);
  assert.deepEqual(r.bad.map((b) => `${b.kind} ${b.what}`), ['kinetic sizes']);
  assert.deepEqual(sizes(fx['gen-talk-v5']), [70, 110, 124, 150, 170]);
  assert.deepEqual(Object.keys(r.groups.cap.sizes), ['100']);
});

test('gen-nasa2-v3: kinetic sizes fail', () => {
  assert.deepEqual(checkTextStyle(fx['gen-nasa2-v3']).bad.map((b) => `${b.kind} ${b.what}`), ['kinetic sizes']);
});

test('kinetic: two preset sizes pass, an off-preset size or a third size fails', () => {
  let n = 0;
  const two = fx['gen-talk-v5'].map((e) => (e.kind === 'kinetic' ? { ...e, size: n++ % 2 ? 110 : 150 } : e));
  assert.deepEqual(checkTextStyle(two).bad, []);
  assert.deepEqual(sizes(two), [110, 150]);
  const off = two.map((e) => (e.kind === 'kinetic' && e.size === 110 ? { ...e, size: 124 } : e));
  assert.deepEqual(checkTextStyle(off).bad.map((b) => `${b.kind} ${b.what}`), ['kinetic sizes']);
  n = 0;
  const three = fx['gen-talk-v5'].map((e) => (e.kind === 'kinetic' ? { ...e, size: [150, 110, 70][n++ % 3] } : e));
  assert.deepEqual(checkTextStyle(three).bad.map((b) => `${b.kind} ${b.what}`), ['kinetic sizes']);
  // one off-preset size alone also fails
  assert.deepEqual(checkTextStyle(fx['gen-talk-v5'].map((e) => (e.kind === 'kinetic' ? { ...e, size: 124 } : e))).bad.map((b) => b.what), ['sizes']);
});

test('one kinetic size passes; a serif caption fails on family', () => {
  const one = fx['gen-talk-v5'].map((e) => (e.kind === 'kinetic' ? { ...e, size: 150 } : e));
  assert.deepEqual(checkTextStyle(one).bad, []);
  one[one.findIndex((e) => e.kind === 'cap')] = { ...one.find((e) => e.kind === 'cap'), family: '"Times New Roman", serif', drawn: 'Times New Roman' };
  assert.deepEqual(checkTextStyle(one).bad.map((b) => `${b.kind} ${b.what}`), ['cap families', 'cap drawn']);
});

test('--kinetic-free: any kinetic size in 120-160 px passes, a second kinetic family or caption size still fails', () => {
  const v5 = fx['gen-talk-v5'].map((e) => (e.kind === 'kinetic' ? { ...e, size: Math.min(160, Math.max(120, e.size)) } : e));
  assert.deepEqual(checkTextStyle(v5, { kineticFree: true }).bad, []);
  // the raw v5 sizes 70 / 110 (below the floor) and 170 (above the ceiling) fail
  assert.deepEqual(Object.keys(checkTextStyle(fx['gen-talk-v5'], { kineticFree: true }).bad.find((b) => b.what === 'range').values).sort(), ['110', '170', '70']);
  const fam = v5.map((e, i) => (e.kind === 'kinetic' && i === v5.findIndex((x) => x.kind === 'kinetic') ? { ...e, family: 'Georgia, serif' } : e));
  assert.deepEqual(checkTextStyle(fam, { kineticFree: true }).bad.map((b) => `${b.kind} ${b.what}`), ['kinetic families']);
  const cap = v5.map((e, i) => (e.kind === 'cap' && i === v5.findIndex((x) => x.kind === 'cap') ? { ...e, size: 80 } : e));
  assert.deepEqual(checkTextStyle(cap, { kineticFree: true }).bad.map((b) => `${b.kind} ${b.what}`), ['cap sizes']);
});

// gen-th-style1 (fixtures 'gen-th-style1'): the cached dom-sample cap / chip elements with the box styles Chrome
// computes from its index.html CSS (.cap span, .chip, .label.clab).
test('gen-th-style1 --one-caption: white shadowed captions, navy-on-yellow chips, navy-on-white labels fail', () => {
  const els = fx['gen-th-style1'];
  assert.deepEqual(checkTextStyle(els).bad, []);
  const r = checkTextStyle(els, { oneCaption: true });
  assert.deepEqual(r.bad.map((b) => `${b.kind} ${b.what}`), ['caption box styles']);
  assert.equal(Object.keys(r.bad[0].values).length, 3);
  const one = els.map((e) => ({ ...e, ...els.find((c) => c.kind === 'cap'), id: e.id, text: e.text, kind: e.kind }));
  assert.deepEqual(checkTextStyle(one, { oneCaption: true }).bad, []);
});

// look-bright (gen-th-style2b): one yellow key word per caption group is the caption style; 2+ fail; label pills
// per cards.pill / pill.onScene (ink on a white pill, white on an ink pill) are the sanctioned pill style.
test('--one-caption: one key-colour word is the caption style, 2+ in a group fail, sanctioned pills pass', () => {
  const cap = { kind: 'cap', family: 'Montserrat', size: 100, color: 'rgb(255, 255, 255)', background: 'none', padding: '0px', radius: '0px', border: 'none', textShadow: 'rgba(0, 0, 0, 0.6) 0px 4px 0px', boxShadow: 'none' };
  const key = { ...cap, color: 'rgb(255, 214, 10)' };
  const pill = { ...cap, kind: 'chip', color: 'rgb(14, 17, 22)', background: 'rgb(255, 255, 255)', textShadow: 'none', radius: '75px' };
  const els = [{ ...cap, id: 'g', text: 'A VERY LARGE' }, { ...key, id: 'k', parent: 'g', text: 'LARGE' }, { ...pill, id: 'p', text: 'AMERICANS' }];
  assert.deepEqual(checkTextStyle(els, { oneCaption: true }).bad, []);
  const two = [...els, { ...key, id: 'k2', parent: 'g', text: 'VERY' }];
  assert.deepEqual(checkTextStyle(two, { oneCaption: true }).bad.map((b) => `${b.kind} ${b.what}`), ['caption key words']);
  const inkOnInk = [...els, { ...pill, id: 'q', text: 'FILIPINOS', background: 'rgb(14, 17, 22)' }];
  assert.deepEqual(checkTextStyle(inkOnInk, { oneCaption: true }).bad.map((b) => `${b.kind} ${b.what}`), ['caption box styles']);
});

// One caption treatment: kinetic words (over footage or an ink idea panel) wear the caption family / weight / shadow.
test('--one-caption: kinetic text without the caption shadow / weight or in ink fails; caption-styled kinetic passes', () => {
  const cap = { kind: 'cap', family: 'Montserrat', size: 100, weight: '900', color: 'rgb(255, 255, 255)', background: 'none', padding: '0px', radius: '0px', border: 'none', textShadow: 'rgba(0, 0, 0, 0.6) 0px 4px 0px', boxShadow: 'none' };
  const ok = [{ ...cap, id: 'c', text: 'WITH OUR GUYS' }, { ...cap, kind: 'kinetic', size: 140, id: 'k', text: 'BUILDING', color: 'rgb(255, 214, 10)' }];
  assert.deepEqual(checkTextStyle(ok, { oneCaption: true, kineticFree: true }).bad, []);
  for (const diff of [{ textShadow: 'none' }, { weight: '700' }, { color: 'rgb(14, 17, 22)' }]) {
    const r = checkTextStyle([...ok, { ...cap, kind: 'kinetic', size: 140, id: 'p', text: 'FOR OUR GROUP', ...diff }], { oneCaption: true, kineticFree: true });
    assert.deepEqual(r.bad.map((b) => `${b.kind} ${b.what}`), ['kinetic treatment'], JSON.stringify(diff));
  }
});

// frozen copy of video-projects/gen-th-style2b at the gen_th_style2b final
const S2 = new URL('fixtures/style2b/', import.meta.url).pathname;
test('gen-th-style2b: kinetic words on the ink idea panels have no caption shadow -> FAIL', { skip: !fs.existsSync(S2 + 'index.html') }, async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('node', [new URL('../text-style.mjs', import.meta.url).pathname, S2, '--kinetic-free', '--one-caption'], { encoding: 'utf8' });
  if (r.status === 2) return;
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL KINETIC TREATMENT montserrat 900; shadow none != caption montserrat 900; shadow rgba\(0, 0, 0, 0\.6\) 0px 4px 0px {2}\("IMPORTANCE", "FOR OUR GROUP"/);
});

test('gen-th-style2b --kinetic-free: kinetic words at 84-110 px are below the 120 px floor -> FAIL KINETIC SIZE', { skip: !fs.existsSync(S2 + 'index.html') }, async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('node', [new URL('../text-style.mjs', import.meta.url).pathname, S2, '--kinetic-free'], { encoding: 'utf8' });
  if (r.status === 2) return;
  assert.equal(r.status, 1, r.stdout + r.stderr);
  for (const px of [84, 100, 110]) assert.match(r.stdout, new RegExp(`FAIL KINETIC SIZE ${px}px outside 120-160 px`));
  assert.doesNotMatch(r.stdout, /KINETIC SIZE 1[2-5]0px/);
});

test('kineticSizes false (--no-kinetic-size): off-preset kinetic sizes pass, a second caption family still fails', () => {
  assert.deepEqual(checkTextStyle(fx['gen-talk-v5'], { kineticSizes: false }).bad, []);
  const cap = fx['gen-talk-v5'].find((e) => e.kind === 'cap');
  const two = fx['gen-talk-v5'].map((e) => (e === cap ? { ...e, family: 'Georgia' } : e));
  assert.deepEqual(checkTextStyle(two, { kineticSizes: false }).bad.map((b) => `${b.kind} ${b.what}`), ['cap families']);
});

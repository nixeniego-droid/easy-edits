// node --test ai-video-editor/styles/test/style-render.test.mjs: what a style pack changes in the composition (engine/compose.mjs
// + engine/theme.mjs): fonts, palette, captions, transitions, number treatment, signature move, sound policy
import test from 'node:test';
import assert from 'node:assert/strict';
import { compose, numberFrames } from '../../engine/compose.mjs';
import { themeOf, HOUSE } from '../../engine/theme.mjs';
import { loadPack, stylePlan } from '../../engine/style-pack.mjs';
import { validatePlan } from '../../engine/plan.mjs';

const words = ('We grew revenue to 1,200 dollars and 40% more users in three months. Then we doubled the team and ' +
  'shipped twice as fast. That is the whole story of how a tiny team beat the giants.').split(' ')
  .map((text, k) => ({ text, start: +(k * 0.4).toFixed(2), end: +(k * 0.4 + 0.35).toFixed(2) }));
const D = words.at(-1).end + 0.5;
const track = { samples: Array.from({ length: Math.ceil(D * 4) }, (_, i) => ({ t: i * 0.25, cx: 540, cy: 600, box: [440, 500, 200, 200], seen: true })) };
const clip = { src: 'assets/clip.mp4', w: 1080, h: 1920, duration: D };
const plan = validatePlan({ title: 'Story', beats: [
  { type: 'stat', anchor: '1,200', value: '1,200', label: 'dollars' },
  { type: 'quote', anchor: 'Then we doubled', until: 'as fast', text: 'We doubled the team and shipped twice as fast' },
  { type: 'punch', anchor: 'story of how', until: 'tiny team', zoom: 1.9 },
  { type: 'icon', anchor: 'giants', icon: 'users', label: 'giants' },
] }, words, { duration: D }).plan;
const build = (id, extra = {}) => {
  const S = id ? loadPack(id) : null;
  return compose({ fmt: '9x16', clip, track, words, plan: stylePlan(plan, S).plan, captions: 'kinetic', intro: 1.5, outro: 2, title: 'Story', lowerThird: false, style: S, ...extra });
};

test('themeOf: no pack = the house look; a pack maps palette, fonts and motion', () => {
  assert.equal(themeOf(null).A, HOUSE.A);
  assert.equal(themeOf(null, '#123456').A, '#123456');
  assert.equal(themeOf(null).transition, 'cut');
  const t = themeOf(loadPack('terminal'));
  assert.equal(t.bg, '#05070D'); assert.equal(t.A, '#00E5FF');
  assert.match(t.font.display.stack, /JetBrains Mono/);
  assert.equal(t.transition, 'glitch'); assert.equal(t.numbers, 'scramble'); assert.equal(t.signature, 'hud');
  assert.equal(t.cap.family, 'JetBrains Mono');
});

test('house compose (no pack) is unchanged: hard cuts, no signature, Montserrat, every sfx', () => {
  const c = build(null);
  assert.equal(c.style, null); assert.equal(c.transitions, 0); assert.equal(c.signatures, 0);
  assert.doesNotMatch(c.html, /JetBrains|Playfair/);
  assert.match(c.html, /class="cap clip kin ink-light/);
  assert.ok(c.cues.some((q) => q.sfx === 'click'));
});

test('each preset draws its own fonts, palette and caption look', () => {
  const p = build('punch'), b = build('broadsheet'), t = build('terminal');
  assert.match(p.html, /text-transform:uppercase;color:var\(--ink\)/);
  assert.match(p.html, /class="cap clip sp one hl-color/);
  assert.match(b.html, /'Playfair Display',Georgia,serif/);
  assert.match(b.html, /class="cap clip sp wrap hl-underline/);
  assert.match(b.html, /background:#F4EFE6/);
  assert.match(t.html, /'JetBrains Mono',ui-monospace,monospace/);
  assert.match(t.html, /text-transform:lowercase/);
  assert.match(t.html, /class="cap clip sp one hl-glow type/);
  // grouping follows the pack: Punch's 2-word captions are many more than Broadsheet's phrases
  assert.ok(p.captions.length > b.captions.length * 1.8, `${p.captions.length} vs ${b.captions.length}`);
  assert.ok(p.captions.every((c) => c.text.split(' ').length <= 2));
});

test('transitions differ: whip smear + blur, dip through the background, RGB glitch', () => {
  const p = build('punch'), b = build('broadsheet'), t = build('terminal');
  for (const c of [p, b, t]) assert.ok(c.transitions >= 3, `${c.style}: ${c.transitions}`);
  assert.match(p.html, /skewX\(-16deg\)/); assert.match(p.html, /filter:'blur\(14px\)'/);
  assert.match(b.html, /id="tx0" class="clip"[^>]*background:#F4EFE6;opacity:0/);
  assert.match(t.html, /mix-blend-mode:screen/); assert.match(t.html, /hue-rotate\(150deg\)/);
  assert.doesNotMatch(b.html, /skewX|hue-rotate/);
});

test('number treatments differ: slam, count-up, scramble', () => {
  const p = build('punch'), b = build('broadsheet'), t = build('terminal');
  assert.match(p.html, /\.num',\{scale:3,opacity:0\}/);
  const cu = numberFrames('1,200', 'count-up');
  assert.equal(cu.frames.at(-1).text, '1,200');
  assert.equal(cu.frames[0].text, '0');
  assert.ok(cu.frames.every((f) => /^[\d,]+$/.test(f.text)));
  for (let k = 1; k < cu.frames.length; k++) assert.ok(Number(cu.frames[k].text.replace(/,/g, '')) >= Number(cu.frames[k - 1].text.replace(/,/g, '')));
  assert.equal(numberFrames('40%', 'count-up').frames.at(-1).text, '40%');
  assert.ok(numberFrames('3.5x', 'count-up').frames.every((f) => /^\d+\.\dx$/.test(f.text))); // one decimal and the suffix kept
  assert.equal(numberFrames('$12', 'count-up').frames.at(-1).text, '$12');
  const sc = numberFrames('29:18', 'scramble', 3);
  assert.equal(sc.frames.length, 10); assert.equal(sc.frames.at(-1).text, '29:18');
  assert.ok(sc.frames.every((f) => /^\d\d:\d\d$/.test(f.text)));
  assert.deepEqual(numberFrames('29:18', 'scramble', 3), sc); // seeded: re-renders are identical
  assert.deepEqual(numberFrames('five', 'count-up').frames, []);
  assert.deepEqual(numberFrames('5', 'slam').frames, []);
  // Broadsheet counts up and Terminal scrambles (frames swapped by visibility); Punch draws the value once
  assert.match(b.html, /class="nv"/);
  assert.match(t.html, /class="nv"/);
  assert.doesNotMatch(p.html, /class="nv"/);
});

test('signature moves differ: punch-shake, letterbox, HUD brackets', () => {
  const p = build('punch'), b = build('broadsheet'), t = build('terminal');
  for (const c of [p, b, t]) assert.equal(c.signatures, 1, c.style);
  assert.match(p.html, /box-shadow:inset 0 0 0 14px #FFD400/);
  assert.match(b.html, /id="sg0t"[^>]*border-bottom:4px solid #C8102E/);
  assert.match(t.html, /● LOCK/);
});

test('pacing, scenes and sound policy come from the pack', () => {
  // Broadsheet: no icon scene, so the icon beat is gone; soft sound keeps whooshes only
  const b = build('broadsheet');
  assert.doesNotMatch(b.html, /class="pop clip"[^>]*>.*<svg[^]*users/);
  assert.ok(b.cues.length > 0 && b.cues.every((q) => /^(whoosh|whoosh_low|shimmer)$/.test(q.sfx)), JSON.stringify(b.cues));
  // Punch: full sound
  assert.ok(build('punch').cues.some((q) => q.sfx === 'tap'));
  // punch-in zoom clamped into the pack's range
  assert.equal(stylePlan(plan, loadPack('broadsheet')).plan.beats.find((x) => x.type === 'punch').zoom, 1.25);
});

test('auto contrast with a pack: dark ink on bright footage, and an accent that would vanish becomes a box', () => {
  const g = { fps: 2, w: 8, h: 14, n: Math.ceil(D * 2) + 2, srcW: 1080, srcH: 1920 };
  g.data = Buffer.alloc(g.n * g.w * g.h, 250);
  const p = build('punch', { luma: g });
  const caps = p.captions.filter((c) => c.layout !== 'split');
  assert.ok(caps.length && caps.every((c) => c.ink === 'dark'));
  assert.ok(caps.every((c) => c.highlight === 'box'), JSON.stringify(caps.map((c) => c.highlight))); // yellow on white
  const t = build('terminal', { luma: { ...g, data: Buffer.alloc(g.n * g.w * g.h, 8) } });
  assert.ok(t.captions.filter((c) => c.layout !== 'split').every((c) => c.ink === 'light' && c.highlight === 'glow'));
});

test('every preset builds in every format without caption overlaps', () => {
  for (const id of ['punch', 'broadsheet', 'terminal']) for (const fmt of ['9x16', '1x1', '16x9']) {
    const S = loadPack(id);
    const c = compose({ fmt, clip, track, words, plan: stylePlan(plan, S).plan, captions: 'kinetic', intro: 1.5, outro: 2, title: 'Story', style: S });
    assert.match(c.html, /window\.__timelines\['main'\]=tl/);
    assert.deepEqual(c.overlaps, [], `${id} ${fmt}: ${JSON.stringify(c.overlaps)}`);
    assert.equal(c.style, id);
  }
});

test('letterbox: captions during the bars sit above the bottom bar; a signature holds 4 s at most', () => {
  for (const fmt of ['9x16', '1x1', '16x9']) {
    const S = loadPack('broadsheet');
    const c = compose({ fmt, clip, track, words, plan: stylePlan(plan, S).plan, captions: 'kinetic', intro: 1.5, outro: 2, title: 'Story', lowerThird: false, style: S });
    const m = /id="sg0b" class="clip" data-start="([\d.]+)" data-duration="([\d.]+)"[^>]*height:(\d+)px/.exec(c.html);
    assert.ok(m, `${fmt}: no letterbox`);
    const [s, d, bh] = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert.ok(d <= 4 + 1e-6, `${fmt}: bars for ${d} s`);
    const H = { '9x16': 1920, '1x1': 1080, '16x9': 1080 }[fmt];
    const during = c.captions.filter((x) => x.start < s + d && x.end > s);
    assert.ok(during.length > 0, `${fmt}: no caption during the bars`);
    for (const x of during) assert.ok(x.rect.y + x.rect.h <= H - bh, `${fmt}: "${x.text}" bottom ${x.rect.y + x.rect.h} under the bar at ${H - bh}`);
  }
});

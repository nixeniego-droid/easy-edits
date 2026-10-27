// node --test ai-video-editor/styles/test/style-pack.test.mjs: style packs (engine/style-pack.mjs + styles/pack.schema.json)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SCHEMA, PACK_DIR, validatePack, loadPack, listPacks, resolvePack, checkRequest, stylePlan, missingFonts, installedFonts, fontsInDirs, FONT_FAMILIES, FONT_FILES, builtinIds, StyleError } from '../../engine/style-pack.mjs';
import { contrastRatio } from '../../engine/contrast.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (id) => JSON.parse(fs.readFileSync(path.join(PACK_DIR, `${id}.json`), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const errsOf = (p) => validatePack(p).errors;

test('the three built-in packs exist, validate, and their ids match the file names', () => {
  assert.deepEqual(builtinIds(), ['broadsheet', 'punch', 'terminal']);
  for (const id of builtinIds()) {
    const p = read(id);
    assert.equal(p.id, id);
    assert.deepEqual(validatePack(p), { ok: true, errors: [] }, id);
    assert.equal(loadPack(id).builtin, true);
  }
});

test('the presets are different styles, not recolours: transitions, numbers, signature move and captions all differ', () => {
  const P = builtinIds().map(read);
  for (const k of ['transition', 'numbers', 'signature', 'entrance']) assert.equal(new Set(P.map((p) => p.motion[k])).size, 3, `motion.${k}`);
  for (const k of ['animation', 'case', 'highlightStyle']) assert.equal(new Set(P.map((p) => p.captions[k])).size, 3, `captions.${k}`);
  assert.equal(new Set(P.map((p) => p.fonts[p.captions.font].family)).size, 3, 'caption font family');
  assert.equal(new Set(P.map((p) => p.palette.accent)).size, 3);
  assert.equal(new Set(P.map((p) => p.pacing.minBeatGap)).size, 3);
  assert.equal(new Set(P.map((p) => p.scenes.join())).size, 3, 'allowed scenes');
  // none of them is a cut-only style: each has a visible transition
  assert.ok(P.every((p) => p.motion.transition !== 'cut'));
});

test('schema: every key a built-in pack uses is declared, and every pack has the required keys', () => {
  const walk = (obj, sch, at) => {
    const s = sch.$ref ? SCHEMA.$defs[sch.$ref.split('/').pop()] : sch;
    if (!s.properties || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const k of s.required || []) assert.ok(k in obj, `${at}.${k} required`);
    for (const [k, v] of Object.entries(obj)) { assert.ok(s.properties[k], `${at}.${k} not in the schema`); walk(v, s.properties[k], `${at}.${k}`); }
  };
  for (const id of builtinIds()) walk(read(id), SCHEMA, id);
  assert.equal(SCHEMA.additionalProperties, false);
});

test('validatePack: clear errors for unknown keys, unsupported values, types, ranges, colours', () => {
  const p = clone(read('punch'));
  p.glow = true;
  p.motion.transition = 'fade';
  p.captions.size = 200;
  p.captions.maxWords = 2.5;
  p.captions.color = 'red';
  p.palette.text = 'white';
  p.scenes = ['punch', 'punch', 'confetti'];
  delete p.sound;
  const e = errsOf(p);
  const has = (re) => assert.ok(e.some((x) => re.test(x)), `${re} in\n${e.join('\n')}`);
  has(/^glow: unknown key: packs don't support it \(allowed here: schemaVersion, id/);
  has(/^motion\.transition: "fade" is not supported \(supported: cut, whip, dip, glitch\)/);
  has(/^captions\.size: 200 is above the maximum 120/);
  has(/^captions\.maxWords: must be a whole number/);
  has(/^captions\.color: must be "auto" or a #RRGGBB colour/);
  has(/^palette\.text: must be a #RRGGBB colour/);
  has(/^scenes: has duplicate items/);
  has(/^scenes\[2\]: "confetti" is not supported/);
  has(/^sound: is required/);
});

test('validatePack: rules beyond the schema (font weights, readable palette, punchZoom order)', () => {
  const p = clone(read('broadsheet'));
  p.fonts.display.weight = 200; // Playfair Display starts at 400
  p.captions.weight = 300;      // captions use display = Playfair Display
  p.palette.text = '#E8E2D8';   // near the paper background
  p.palette.onAccent = '#D02030';
  p.pacing.punchZoom = [1.4, 1.2];
  const e = errsOf(p);
  assert.ok(e.some((x) => /^fonts\.display\.weight: Playfair Display has weights 400-900 \(got 200\)/.test(x)), e.join('\n'));
  assert.ok(e.some((x) => /^captions\.weight: the caption font Playfair Display/.test(x)));
  assert.ok(e.some((x) => /^palette\.text: text #E8E2D8 on background #F4EFE6 has contrast \d\.\d\d:1, below 4\.5:1/.test(x)));
  assert.ok(e.some((x) => /^palette\.onAccent:/.test(x)));
  assert.ok(e.some((x) => /^pacing\.punchZoom: \[min, max\]: 1\.4 is above 1\.2/.test(x)));
  // and the built-ins pass these rules with room to spare
  for (const id of builtinIds()) { const q = read(id); assert.ok(contrastRatio(q.palette.text, q.palette.background) >= 4.5); assert.ok(contrastRatio(q.palette.onAccent, q.palette.accent) >= 4.5); }
});

test('loadPack / resolvePack: unknown ids, missing files, broken JSON, invalid packs, user packs', () => {
  assert.throws(() => loadPack('vaporwave'), (e) => e instanceof StyleError && /unknown style "vaporwave" \(built-in: broadsheet, punch, terminal/.test(e.message));
  assert.throws(() => loadPack('/nope/pack.json'), /style pack file not found/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-styles-'));
  try {
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ "id": ');
    assert.throws(() => loadPack(path.join(dir, 'broken.json')), /is not valid JSON/);
    const bad = clone(read('terminal')); bad.motion.numbers = 'odometer';
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(bad));
    assert.throws(() => loadPack(path.join(dir, 'bad.json')), (e) => /is invalid \(1 problem\):\n {2}- motion\.numbers: "odometer" is not supported/.test(e.message) && e.errors.length === 1);
    // a user pack by id (AI_VIDEO_EDITOR_STYLES), shadowing nothing, listed as yours
    const mine = { ...clone(read('punch')), id: 'mine', name: 'Mine' };
    fs.writeFileSync(path.join(dir, 'mine.json'), JSON.stringify(mine));
    process.env.AI_VIDEO_EDITOR_STYLES = dir;
    assert.equal(resolvePack('mine').file, path.join(dir, 'mine.json'));
    assert.equal(loadPack('mine').builtin, false);
    const L = listPacks();
    assert.ok(L.find((x) => x.id === 'mine' && !x.builtin && x.ok));
    assert.ok(L.find((x) => x.file.endsWith('bad.json') && !x.ok && x.errors.length === 1));
    assert.ok(L.find((x) => x.file.endsWith('broken.json') && !x.ok));
  } finally { delete process.env.AI_VIDEO_EDITOR_STYLES; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkRequest: the renderer refuses what the pack does not support, with the reason', () => {
  const b = loadPack('broadsheet'), p = loadPack('punch');
  assert.deepEqual(checkRequest(p, { mode: 'shorts', formats: ['9x16', '1x1', '16x9'], hook: true, graphics: true, lowerThirds: true }), []);
  assert.match(checkRequest(p, { mode: 'clean-cut', formats: ['9x16'] })[0], /clean-cut keeps the approved caption look/);
  assert.match(checkRequest(b, { mode: 'shorts', formats: ['9x16'], hook: true })[0], /style "broadsheet" has no hook card/);
  const e = checkRequest(b, { mode: 'talking-head', formats: ['9x16'], planBeats: [{ type: 'quote', anchor: 'a' }, { type: 'icon', anchor: 'eye' }] });
  assert.equal(e.length, 1);
  assert.match(e[0], /the --plan has beat\(s\) style "broadsheet" doesn't allow: #1 icon \("eye"\)/);
  const narrow = { ...p, id: 'narrow', modes: ['captions'], formats: ['9x16'], scenes: ['progress'] };
  const n = checkRequest(narrow, { mode: 'talking-head', formats: ['9x16', '16x9'], speaker: 'Ana', graphics: false });
  assert.ok(n.some((x) => /doesn't support mode talking-head \(it supports: captions\)/.test(x)));
  assert.ok(n.some((x) => /doesn't support format 16x9/.test(x)));
  assert.ok(n.some((x) => /has no lower third/.test(x)));
  assert.match(checkRequest(narrow, { mode: 'captions', formats: ['9x16'], graphics: true }).join(), /allows no graphics beats/);
});

test('stylePlan: beats the pack does not allow are left out, pacing spaces pops and punches, zooms clamped', () => {
  const plan = { title: 'T', beats: [
    { type: 'icon', at: 1, end: 3 }, { type: 'punch', at: 3.5, end: 5, zoom: 1.9 }, { type: 'stat', at: 8, end: 10, value: '5' },
    { type: 'quote', at: 12, end: 18 }, { type: 'punch', at: 20, end: 22, zoom: 1.05 }, { type: 'punch', at: 30, end: 32 },
  ] };
  const b = stylePlan(plan, loadPack('broadsheet'));
  assert.deepEqual(b.plan.beats.map((x) => `${x.type}@${x.at}`), ['punch@3.5', 'quote@12', 'punch@20', 'punch@30']);
  assert.ok(b.dropped.some((d) => d[0] === 'icon' && /doesn't use icon/.test(d[2])));
  assert.ok(b.dropped.some((d) => d[0] === 'stat' && d[1] === 8 && /under 6 s after the last pop \/ punch/.test(d[2])));
  assert.equal(b.plan.beats[0].zoom, 1.25); // 1.9 clamped to Broadsheet's [1.1, 1.25]
  assert.equal(b.plan.beats[2].zoom, 1.1);  // 1.05 raised to its minimum
  assert.equal(b.plan.beats[3].zoom, undefined); // no zoom: compose's auto zoom is clamped instead
  const p = stylePlan(plan, loadPack('punch'));
  assert.equal(p.plan.beats.length, 6);
  assert.equal(p.plan.beats.find((x) => x.at === 20).zoom, 1.25);
  // per-minute cap
  const many = { beats: Array.from({ length: 30 }, (_, k) => ({ type: 'punch', at: k * 2, end: k * 2 + 1 })) };
  const capped = stylePlan(many, { ...loadPack('punch'), pacing: { minBeatGap: 1, maxBeatsPerMinute: 10, punchZoom: [1.2, 1.5] } });
  assert.equal(capped.plan.beats.length, 10);
  assert.ok(capped.dropped.every((d) => /over 10 beats a minute/.test(d[2])));
  // no pack: untouched
  assert.equal(stylePlan(plan, null).plan, plan);
});

test('missingFonts: every family a pack uses must be installed', () => {
  const t = loadPack('terminal'), b = loadPack('broadsheet');
  assert.deepEqual(missingFonts(t, new Set(['Montserrat'])), ['JetBrains Mono']);
  assert.deepEqual(missingFonts(b, new Set(['Montserrat'])), ['Playfair Display']);
  assert.deepEqual(missingFonts(b, new Set(['Montserrat', 'Playfair Display'])), []);
  assert.deepEqual(missingFonts(b, null), []); // fontconfig absent: not checkable here
});

test('install.sh installs the fonts the packs use (pinned, checksummed) and the doctor checks them', () => {
  const sh = fs.readFileSync(path.join(HERE, '../../../install.sh'), 'utf8');
  const fams = new Set(builtinIds().flatMap((id) => Object.values(read(id).fonts).map((f) => f.family)));
  for (const f of fams) if (f !== 'Montserrat') assert.match(sh, new RegExp(`^(STYLE_FONTS=")?${f}\\|[a-z]+\\|[A-Za-z]+\\[wght\\]\\.ttf\\|[0-9a-f]{64}"?$`, 'm'), f);
  assert.match(sh, /check style-fonts c_sfonts/);
  // under pipefail, `fc-list | grep -q` can report a found font as missing (SIGPIPE): the font checks read all input
  assert.doesNotMatch(sh, /fc-list[^\n]*\|[^\n]*grep -q/);
  assert.deepEqual([...SCHEMA.$defs.font.properties.family.enum].sort(), ['JetBrains Mono', 'Montserrat', 'Playfair Display']);
});

const INSTALL_SH = path.join(HERE, '../../../install.sh');
/** run `script` in bash after sourcing install.sh (its source guard defines the functions and runs nothing) */
const withInstallSh = (script, env = {}) => spawnSync('bash', ['-c', `set -euo pipefail\n. "$1"\n${script}`, 'bash', INSTALL_SH],
  { encoding: 'utf8', env: { ...process.env, ...env } });

test('macOS: the exact installed font files count as installed, even when fc-list does not list them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-fonts-'));
  // look-alikes that must not count: another family with the same prefix, other cuts, the licence text
  for (const f of ['PlayfairDisplay[wght].ttf', 'MontserratAlternates-Bold.otf', 'Montserrat-Bold.otf', 'JetBrainsMono-OFL.txt']) fs.writeFileSync(path.join(dir, f), '');
  assert.deepEqual([...fontsInDirs(FONT_FAMILIES, [dir, '/nonexistent'])], ['Playfair Display']);
  assert.ok(installedFonts({ platform: 'darwin', dirs: [dir] }).has('Playfair Display')); // plus whatever this machine's fc-list has
  fs.writeFileSync(path.join(dir, 'Montserrat[wght].ttf'), '');
  const found = fontsInDirs(FONT_FAMILIES, [dir]);
  assert.deepEqual([...found].sort(), ['Montserrat', 'Playfair Display']);
  assert.deepEqual(missingFonts(loadPack('terminal'), found), ['JetBrains Mono']);
  assert.deepEqual(missingFonts(loadPack('broadsheet'), found), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('install.sh and style-pack.mjs look for the same font files', () => {
  const r = withInstallSh('echo "Montserrat|$MONTSERRAT_FILE"; while IFS="|" read -r fam dir file sha; do echo "$fam|$file"; done <<< "$STYLE_FONTS"');
  assert.equal(r.status, 0, r.stderr);
  const sh = Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split('|')));
  assert.deepEqual(sh, FONT_FILES);
  assert.deepEqual(Object.keys(FONT_FILES).sort(), [...FONT_FAMILIES].sort());
});

test('install.sh doctor on macOS finds the exact font files in ~/Library/Fonts when fc-list does not list them', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-doctor-'));
  const bin = path.join(tmp, 'bin'), fonts = path.join(tmp, 'Library/Fonts');
  fs.mkdirSync(bin); fs.mkdirSync(fonts, { recursive: true });
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\necho Darwin\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'fc-list'), '#!/bin/sh\necho "DejaVu Sans"\n', { mode: 0o755 }); // a Homebrew fc-list that skips ~/Library/Fonts
  const run = () => {
    const r = withInstallSh('have_montserrat && echo M=1 || echo M=0\nhave_family "Playfair Display" "PlayfairDisplay[wght].ttf" && echo P=1 || echo P=0',
      { HOME: tmp, AI_VIDEO_EDITOR_HOME: path.join(tmp, '.ai-video-editor'), PATH: `${bin}:${process.env.PATH}` });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  fs.writeFileSync(path.join(fonts, 'MontserratAlternates-Bold.otf'), ''); // not Montserrat, for the shell either
  assert.match(run(), /M=0[\s\S]*P=0/);
  for (const f of ['Montserrat[wght].ttf', 'PlayfairDisplay[wght].ttf']) fs.writeFileSync(path.join(fonts, f), '');
  assert.match(run(), /M=1[\s\S]*P=1/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('install.sh py_ok decides on the Python version only', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-py-'));
  // fake pythons without venv/ensurepip: py_ok must pass the 3.12 one and refuse the 3.15 one on the version alone
  const fake = (name, ok) => { const f = path.join(tmp, name); fs.writeFileSync(f, `#!/bin/sh\ncase "$2" in *ensurepip*) exit 1 ;; esac\nexit ${ok ? 0 : 1}\n`, { mode: 0o755 }); return f; };
  const r = withInstallSh(`py_ok "$PY12" && echo ok12; py_ok "$PY15" || echo no15`, { PY12: fake('py12', true), PY15: fake('py15', false) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok12[\s\S]*no15/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('sourcing install.sh runs no install step', () => {
  const r = withInstallSh('echo sourced', { AI_VIDEO_EDITOR_HOME: path.join(os.tmpdir(), 'ee-none-' + process.pid) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'sourced\n');
});

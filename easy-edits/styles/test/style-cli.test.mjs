// node --test easy-edits/styles/test/style-cli.test.mjs: `easy-edits style list | validate | skill` (cli/style.mjs) and the
// --style checks in cli/main.mjs, run through the real bin/easy-edits entry point
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { skillMarkdown, styleRef } from '../../cli/style.mjs';
import { loadPack, PACK_DIR } from '../../engine/style-pack.mjs';
import { styleProblems, parseArgs } from '../../cli/main.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(HERE, '../../cli/main.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ee-style-'));
const ee = (args, { env = {}, cwd } = {}) => spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8', cwd, env: { ...process.env, ...env } });

test('style --help / no command / unknown command', () => {
  const h = ee(['style', '--help']);
  assert.equal(h.status, 0); assert.match(h.stdout, /easy-edits style skill <pack>/);
  assert.equal(ee(['style']).status, 2);
  const u = ee(['style', 'frobnicate']);
  assert.equal(u.status, 2); assert.match(u.stderr, /unknown style command "frobnicate"/);
  assert.match(ee(['--help']).stdout, /easy-edits style list \| validate <pack> \| skill <pack>/);
});

test('style list: the three built-ins plus user packs, invalid ones flagged', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'oops.json'), JSON.stringify({ ...loadPack('punch'), id: 'oops', file: undefined, builtin: undefined, motion: { ...loadPack('punch').motion, signature: 'spin' } }));
    const r = ee(['style', 'list'], { env: { EASY_EDITS_STYLES: dir } });
    assert.equal(r.status, 0, r.stderr);
    for (const id of ['punch', 'broadsheet', 'terminal']) assert.match(r.stdout, new RegExp(`^\\s+${id}\\s+\\w`, 'm'));
    assert.match(r.stdout, /oops\s+Punch\s+\(yours\)\s+INVALID \(1 problem; easy-edits style validate /);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('style validate: OK for each built-in, exit 1 with every problem for a broken pack, 2 for an unknown one', () => {
  for (const id of ['punch', 'broadsheet', 'terminal']) {
    const r = ee(['style', 'validate', id]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^OK ${id} `));
  }
  const dir = tmp();
  try {
    const p = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'broadsheet.json'), 'utf8'));
    p.motion.transition = 'star-wipe'; p.captions.size = 300; p.confetti = true;
    const f = path.join(dir, 'b.json'); fs.writeFileSync(f, JSON.stringify(p));
    const r = ee(['style', 'validate', f]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /INVALID style pack .* is invalid \(3 problems\)/);
    assert.match(r.stderr, /motion\.transition: "star-wipe" is not supported \(supported: cut, whip, dip, glitch\)/);
    assert.match(r.stderr, /captions\.size: 300 is above the maximum 120/);
    assert.match(r.stderr, /confetti: unknown key: packs don't support it/);
    fs.writeFileSync(f, '{ nope');
    assert.equal(ee(['style', 'validate', f]).status, 2);
    const u = ee(['style', 'validate', 'nosuchstyle']);
    assert.equal(u.status, 2); assert.match(u.stderr, /unknown style "nosuchstyle"/);
    assert.equal(ee(['style', 'validate']).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('style skill: writes a Claude Code skill (frontmatter, --style on every command, the look, the rules)', () => {
  const dir = tmp();
  try {
    const r = ee(['style', 'skill', 'terminal', '-o', dir]);
    assert.equal(r.status, 0, r.stderr);
    const f = path.join(dir, 'easy-edits-style-terminal', 'SKILL.md');
    assert.equal(r.stdout.trim(), f);
    const md = fs.readFileSync(f, 'utf8');
    const fm = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(md);
    assert.ok(fm, 'frontmatter');
    assert.equal(fm[1], 'easy-edits-style-terminal');
    const desc = JSON.parse(fm[2]);
    assert.match(desc, /^Use when the user wants a video edited in the "Terminal" style/);
    assert.ok(desc.length < 1024, `description ${desc.length} chars`);
    for (const m of ['captions', 'talking-head', 'explainer', 'shorts']) assert.match(md, new RegExp(`easy-edits ${m} VIDEO\\.mp4 -o OUT.*--style terminal`));
    assert.match(md, /an RGB-split glitch/); assert.match(md, /decode through random numbers/); assert.match(md, /HUD corner brackets/);
    assert.match(md, /JetBrains Mono/); assert.match(md, /#00E5FF/);
    assert.match(md, /Never write `quote` beats for this style/); // Terminal has no quote scene
    assert.match(md, /Never upload, post or publish anything/);
    assert.match(md, /Never guess a person's name/);
    // a built-in pack is referenced by id: no machine path (checkout, home) leaks into the skill
    assert.ok(!md.includes(path.resolve(HERE, '../../..')) && !md.includes(os.homedir()), 'no local paths');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('style skill: the three skills differ in their moves; --print; --project; default ~/.claude/skills', () => {
  const md = Object.fromEntries(['punch', 'broadsheet', 'terminal'].map((id) => [id, skillMarkdown(loadPack(id))]));
  assert.match(md.punch, /whip-pan smear/); assert.match(md.punch, /slams in/); assert.match(md.punch, /camera shake/);
  assert.match(md.broadsheet, /dip through the background/); assert.match(md.broadsheet, /counts up from zero/); assert.match(md.broadsheet, /letterbox bars/);
  assert.match(md.broadsheet, /Not in this style: icon pops, hook card/);
  assert.doesNotMatch(md.broadsheet, /--style broadsheet --hook/); // no hook scene: never suggested in a command,
  assert.match(md.broadsheet, /a --plan beat it doesn't\s+allow, --hook\)/); // and named as refused
  assert.match(md.punch, /--pick 1,3 --style punch --hook --graphics/);
  for (const [id, m] of Object.entries(md)) { const d = JSON.parse(/\ndescription: (.+)\n/.exec(m)[1]); assert.ok(d.length <= 1024, `${id}: description ${d.length} chars`); }
  const p = ee(['style', 'skill', 'punch', '--print']);
  assert.equal(p.status, 0); assert.equal(p.stdout, md.punch);
  const dir = tmp();
  try {
    assert.equal(ee(['style', 'skill', 'broadsheet', '--project'], { cwd: dir }).status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.claude/skills/easy-edits-style-broadsheet/SKILL.md')));
    const home = path.join(dir, 'home');
    assert.equal(ee(['style', 'skill', 'punch'], { env: { HOME: home } }).status, 0);
    assert.ok(fs.existsSync(path.join(home, '.claude/skills/easy-edits-style-punch/SKILL.md')));
    assert.equal(ee(['style', 'skill', 'punch', '-o']).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('style skill: a user pack by path is referenced by its absolute path; an invalid pack gets no skill', () => {
  const dir = tmp();
  try {
    const p = { ...JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'punch.json'), 'utf8')), id: 'my-brand', name: 'My Brand' };
    const f = path.join(dir, 'my brand.json'); fs.writeFileSync(f, JSON.stringify(p));
    const pack = loadPack(f);
    assert.equal(styleRef(pack), f);
    assert.match(skillMarkdown(pack), new RegExp(`--style "${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    p.palette.text = '#222222';
    fs.writeFileSync(f, JSON.stringify(p));
    const r = ee(['style', 'skill', f, '-o', dir]);
    assert.equal(r.status, 1); assert.match(r.stderr, /no skill written: .*palette\.text: text #222222 on background #111111/s);
    assert.ok(!fs.existsSync(path.join(dir, 'easy-edits-style-my-brand')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--style on a render: refused before any work when the pack does not support the request', () => {
  const dir = tmp();
  try {
    const vid = path.join(dir, 'v.mp4'); fs.writeFileSync(vid, 'not really a video');
    const cc = ee(['clean-cut', vid, '-o', path.join(dir, 'o'), '--style', 'punch']);
    assert.equal(cc.status, 2); assert.match(cc.stderr, /style "punch" can't render this run:\n {2}- clean-cut keeps the approved caption look/);
    const hk = ee(['shorts', vid, '-o', path.join(dir, 'o'), '--style', 'broadsheet', '--pick', '1', '--hook']);
    assert.equal(hk.status, 2); assert.match(hk.stderr, /style "broadsheet" has no hook card/);
    const plan = path.join(dir, 'plan.json'); fs.writeFileSync(plan, JSON.stringify({ title: 'x', beats: [{ type: 'quote', anchor: 'a', text: 'b' }] }));
    const pl = ee(['talking-head', vid, '-o', path.join(dir, 'o'), '--style', 'terminal', '--plan', plan]);
    assert.equal(pl.status, 2); assert.match(pl.stderr, /the --plan has beat\(s\) style "terminal" doesn't allow: #0 quote/);
    const un = ee(['captions', vid, '-o', path.join(dir, 'o'), '--style', 'vapor']);
    assert.equal(un.status, 2); assert.match(un.stderr, /unknown style "vapor"/);
    assert.ok(!fs.existsSync(path.join(dir, 'o', '.work')), 'nothing was started');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('styleProblems: speaker / people only count where a lower third would show', () => {
  const b = loadPack('broadsheet'), t = loadPack('terminal');
  assert.deepEqual(styleProblems(parseArgs(['talking-head', 'x.mp4', '-o', 'o', '--speaker', 'Ana']), b), []);
  assert.deepEqual(styleProblems(parseArgs(['shorts', 'x.mp4', '-o', 'o', '--hook', '--graphics']), t), []);
  assert.equal(styleProblems(parseArgs(['captions', 'x.mp4', '-o', 'o', '--format', 'all']), b).length, 0);
});

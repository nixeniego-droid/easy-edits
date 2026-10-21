// look-bright.json is palette, grade and type guidance only: no layout, placement, pacing, rate or size-floor rules.
// The archived full style2 spec lives in look-strict.json (used only with --strict-look); reviewer hearings in verbatim-heard.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const P = path.join(HERE, '../../presets'), EDIT = path.join(HERE, '../edit.sh'), FAKE = path.join(HERE, 'fake-claude.mjs');
const read = (f) => JSON.parse(fs.readFileSync(path.join(P, f), 'utf8'));
const keys = (o, p = '') => (o && typeof o === 'object' && !Array.isArray(o)) ? Object.entries(o).flatMap(([k, v]) => [p + k, ...keys(v, p + k + '.')]) : [];
const strings = (o) => typeof o === 'string' ? [o] : (o && typeof o === 'object') ? Object.values(o).flatMap(strings) : [];

test('look-bright: only palette, grade and type', () => {
  const o = read('look-bright.json');
  assert.deepEqual(Object.keys(o).filter((k) => !['name', 'description'].includes(k)).sort(), ['grade', 'palette', 'type']);
  const bad = keys(o).filter((k) => /punchIn|motion|scenes|iconFrame|width|placement|position|band|shot|linger|maxHold|maxItems|atOnce|stack|settledLife|icons|minPx|maxPx|words|grouping|stagger|enter|exit|pop|cuts|chinClear|whenCardLow|depth|pushIn|verbatim|passCheck/i.test(k));
  assert.deepEqual(bad, []);
  const rules = strings(o).filter((s) => /top.?split|1(\.0)?\s*-\s*1\.5\s*s|every\s+[\d.]+\s*s|cadence|float|drift|at least|>=|minimum|never|exactly|must/i.test(s));
  assert.deepEqual(rules, []);
  for (const c of ['ink', 'white', 'yellow', 'coral']) assert.match(o.palette[c], /^#[0-9A-F]{6}$/i);
  assert.ok(o.grade.ffmpeg && o.type.captions.fontFamily && o.type.display.fontFamily);
});

test('look-strict keeps the archived spec; verbatim-heard ships empty hearing lists', () => {
  const s = read('look-strict.json');
  assert.ok(s.punchIn && s.cards.width && s.scenes.panel.icons && s.motion.settledLife);
  assert.equal(s.verbatim, undefined);
  const v = read('verbatim-heard.json');
  // per-project hearings go in the user's own --heard-file; the shipped default is empty
  assert.deepEqual([v.verbatim.confirmed, v.verbatim.heard], [[], []]);
});

test('edit.sh: look-bright by default, look-strict with --strict-look, --look overrides', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-look-'));
  try {
    const src = path.join(dir, 'clip.mp4'), tr = path.join(dir, 'clip.words.json'), vp = path.join(dir, 'video-projects'), proj = path.join(vp, 't'), out = path.join(dir, 'out/e.mp4');
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', src]).status, 0);
    fs.writeFileSync(tr, JSON.stringify({ words: [{ text: 'hello', start: 0.2, end: 0.6, type: 'word' }] }));
    fs.mkdirSync(proj, { recursive: true });
    const env = { ...process.env, EASY_EDITS_CUTCAND: '0', EASY_EDITS_CUTCAND_CACHE: path.join(dir, 'cc'), EASY_EDITS_HOME: path.join(dir, 'home'), EASY_EDITS_VIDEO_PROJECTS: vp, EASY_EDITS_PREP_FACES: '0', FAKE_MODE: 'edit', FAKE_PROJECTS: vp, FAKE_LS: path.join(dir, 'ls.jsonl') };
    const brief = (args) => { const r = spawnSync('bash', [EDIT, src, tr, proj, out, '--claude', FAKE, '--dry-run', ...args], { encoding: 'utf8', env }); assert.equal(r.status, 0, r.stderr); return fs.readFileSync(path.join(dir, 'out/e.run/brief.md'), 'utf8'); };
    assert.match(brief([]), /look-bright\.json/);
    assert.match(brief(['--strict-look']), /look-strict\.json/);
    assert.match(brief(['--strict-look', '--look', path.join(P, 'look-bright.json')]), /look-bright\.json/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtElapsed, startProgress, ingestProgressLine } from '../progress.mjs';

test('fmtElapsed', () => {
  assert.equal(fmtElapsed(5), '5 s');
  assert.equal(fmtElapsed(65), '1:05');
});

test('startProgress emits and end reaches 100%', () => {
  const lines = [];
  const err = process.stderr.write;
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  process.env.AI_VIDEO_EDITOR_PROGRESS = 'plain';
  try {
    const p = startProgress('clean-cut', 'Cleaning up your video…', { everySec: 0 });
    p.tick(40);
    ingestProgressLine(p, 'clean-cut: render 6 s');
    p.end();
  } finally { process.stderr.write = err; delete process.env.AI_VIDEO_EDITOR_PROGRESS; }
  assert.ok(lines.some((l) => /Cleaning up/.test(l)));
  assert.ok(lines.some((l) => /100%/.test(l)));
  assert.ok(lines.some((l) => /Rendering your video/.test(l)));
});

test('json progress is machine-readable', () => {
  const lines = [];
  const err = process.stderr.write;
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  process.env.AI_VIDEO_EDITOR_PROGRESS = 'json';
  try {
    const p = startProgress('x', 'Working…', { everySec: 0 });
    p.tick(10);
    p.end();
  } finally { process.stderr.write = err; delete process.env.AI_VIDEO_EDITOR_PROGRESS; }
  const rows = lines.filter((l) => l.startsWith('ai-video-editor-progress:')).map((l) => JSON.parse(l.slice('ai-video-editor-progress:'.length)));
  assert.ok(rows.length >= 2);
  assert.equal(rows.at(-1).done, true);
  assert.equal(rows.at(-1).percent, 100);
});

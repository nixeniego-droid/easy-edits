import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtElapsed, startProgress } from '../progress.mjs';

test('fmtElapsed', () => {
  assert.equal(fmtElapsed(9), '9 s');
  assert.equal(fmtElapsed(65), '1:05');
});

test('startProgress throttles ticks and emits json when asked', () => {
  const chunks = [];
  const w = process.stderr.write;
  process.stderr.write = (s) => { chunks.push(String(s)); return true; };
  try {
    process.env.AI_VIDEO_EDITOR_PROGRESS = 'json';
    const p = startProgress('t', 'Testing…', { everySec: 60 });
    p.tick(10);
    p.tick(20); // throttled
    p.end();
    const lines = chunks.map((c) => c.trim()).filter(Boolean);
    assert.ok(lines.length >= 2);
    assert.ok(lines.every((l) => l.startsWith('ai-video-editor-progress: ')));
    const last = JSON.parse(lines.at(-1).slice('ai-video-editor-progress: '.length));
    assert.equal(last.done, true);
    assert.equal(last.stage, 't');
  } finally {
    process.stderr.write = w;
    delete process.env.AI_VIDEO_EDITOR_PROGRESS;
  }
});

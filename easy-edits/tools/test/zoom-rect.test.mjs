// zoomRect: recommended crop-zoom per screen-recording event (source-prep events[].zoom).
//   node --test easy-edits/tools/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomRect } from '../zoom-rect.mjs';

test('small change near the top: source aspect, margin, capped at 2.5x, inside the frame', () => {
  const z = zoomRect([264, 16, 408, 36], 1280, 800);
  assert.deepEqual(z, { x: 162, y: 0, w: 612, h: 383, scale: 2.09 });
  assert.ok(Math.abs(z.w / z.h - 1.6) < 0.01);
  const tiny = zoomRect([1890, 1065, 20, 10], 1920, 1080);
  assert.equal(tiny.scale, 2.5); assert.equal(tiny.x + tiny.w, 1920); assert.equal(tiny.y + tiny.h, 1080);
});
test('page-sized change: whole frame, no zoom', () => assert.deepEqual(zoomRect([40, 16, 1240, 784], 1280, 800), { x: 0, y: 0, w: 1280, h: 800, scale: 1 }));

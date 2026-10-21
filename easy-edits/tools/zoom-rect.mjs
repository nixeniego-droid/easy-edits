// Recommended crop-zoom for a screen-recording event: the region of change (the event box) plus a margin, grown to
// the source's own aspect so it fills a browser / laptop frame's screen without distortion, never zoomed in past
// maxScale (min width W / maxScale), clamped inside the frame.
//   zoomRect([x, y, w, h], W, H) -> { x, y, w, h, scale }   (source px; scale = W / w, the zoom factor)
export function zoomRect(box, W, H, { margin = 0.25, maxScale = 2.5 } = {}) {
  const [bx, by, bw, bh] = box, ar = W / H;
  let w = bw * (1 + 2 * margin), h = bh * (1 + 2 * margin);
  if (w / h < ar) w = h * ar; else h = w / ar;
  if (w < W / maxScale) { w = W / maxScale; h = w / ar; }
  if (w > W) { w = W; h = H; }
  const cx = bx + bw / 2, cy = by + bh / 2;
  const x = Math.min(Math.max(0, cx - w / 2), W - w), y = Math.min(Math.max(0, cy - h / 2), H - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), scale: Math.round((W / w) * 100) / 100 };
}

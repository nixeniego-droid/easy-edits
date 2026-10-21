// Per-layout placement for the default caption preset (captions-default.*).
// Style is untouched; this only (1) splits caption groups at layout cuts so a
// caption never runs across a cut, and (2) puts each group at its layout's
// safe-zone Y (face/punch: on the jacket, split: on the seam), and (3) checks
// every caption box against the layout's keep-out rects (graphics, face).
import { preset, captionGroups, captionY } from './captions-default.mjs';

const r3 = (t) => Math.round(t * 1000) / 1000;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** scenes [{start,end,layout}] (edited time) -> caps [{text,start,end,layout,y}] */
export function layoutCaptions(words, scenes, { fps = 30, p = preset, lead = 2 / 30 } = {}) {
  const caps = [];
  for (const s of scenes) {
    const ws = words.filter((w) => w.start >= s.start - lead && w.start < s.end - lead);
    if (!ws.length) continue;
    const y = captionY(s.layout, p);
    for (const c of captionGroups(ws, { duration: s.end, fps, p })) {
      caps.push({ ...c, start: r3(Math.max(c.start, s.start)), end: r3(Math.min(c.end, s.end)), layout: s.layout, y });
    }
  }
  return caps;
}

/** Caption box estimate (Montserrat 900 uppercase ~0.78 em average advance). */
export function captionBox(c, p = preset) {
  const f = p.font, h = f.size * f.lineHeight;
  const w = Math.min(p.box.width, c.text.length * f.size * 0.78 + (c.text.length - 1) * f.letterSpacing);
  return { x0: 540 - w / 2, x1: 540 + w / 2, y0: c.y - h / 2, y1: c.y + h / 2 };
}

/** keepOut: {layout: [{name,x0,y0,x1,y1}]} -> [{cap, rect}] overlaps (empty = pass). */
export function captionOverlaps(caps, keepOut, p = preset) {
  const bad = [];
  for (const c of caps) {
    const b = captionBox(c, p);
    for (const r of keepOut[c.layout] || []) {
      if (b.x0 < r.x1 && b.x1 > r.x0 && b.y0 < r.y1 && b.y1 > r.y0) bad.push({ cap: c.text, at: c.start, layout: c.layout, rect: r.name });
    }
    if (b.y0 < p.safeZone.top - 60 || b.y1 > p.safeZone.bottom + 60) bad.push({ cap: c.text, at: c.start, layout: c.layout, rect: 'safeZone' });
  }
  return bad;
}

/** HTML for #caps (captionCss puts #caps at the face Y; each cap is offset to its own Y). */
export function layoutCaptionHtml(caps, { track = 4, p = preset } = {}) {
  const base = captionY('face', p);
  return `<div id="caps">
${caps.map((c, i) => `<div id="cap${i}" class="cap clip" style="top:${c.y - base}px" data-start="${c.start}" data-duration="${r3(c.end - c.start)}" data-track-index="${track}"><span>${esc(c.text)}</span></div>`).join('\n')}
</div>`;
}

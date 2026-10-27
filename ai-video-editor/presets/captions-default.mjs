// AI Video Editor default caption preset (data in captions-default.json). Logic moved
// verbatim from ai-video-editor/smoke/build.mjs, which mirrors the stock
// porter-clipper-short build script (Herk Edit Kit, Nate Herk).
import fs from 'node:fs';
import { joinHyphenWords } from '../engine/words.mjs';

export const preset = JSON.parse(fs.readFileSync(new URL('./captions-default.json', import.meta.url), 'utf8'));
const r3 = (t) => Math.round(t * 1000) / 1000;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Words [{text,start,end}] -> captions [{text,start,end,lastEnd,words}] (1-2 word groups). */
export function captionGroups(wordsIn, { duration, fps = 30, p = preset } = {}) {
  const words = joinHyphenWords(wordsIn);
  const G = p.grouping, T = p.timing, brk = new RegExp(G.breakAfter);
  const groups = [];
  for (let i = 0; i < words.length; ) {
    const g = [words[i]];
    while (g.length < G.maxWords) {
      const a = g.at(-1), b = words[i + g.length];
      if (!b || brk.test(a.text) || b.start - a.end >= G.maxGap || (g.map((w) => w.text).join('') + b.text).length > G.maxChars) break;
      g.push(b);
    }
    groups.push(g);
    i += g.length;
  }
  const caps = groups.map((g, i) => {
    const prevEnd = i ? groups[i - 1].at(-1).end : 0;
    return { text: g.map((w) => w.text).join(' '), words: g, start: r3(Math.max(0, g[0].start - T.leadFrames / fps, prevEnd)), lastEnd: g.at(-1).end };
  });
  caps.forEach((c, i) => {
    const next = caps[i + 1];
    c.end = next ? (next.start - c.lastEnd > T.pauseGap ? r3(c.lastEnd + T.holdAfterPause) : next.start) : r3(Math.min(duration, c.lastEnd + T.tailHold));
  });
  return caps;
}

/** Caption centre y for a layout; throws if outside the safe zone. */
export function captionY(layout = 'face', p = preset) {
  const y = p.safeY[layout];
  if (y == null) throw new Error(`captions-default: unknown layout "${layout}"`);
  if (y < p.safeZone.top || y > p.safeZone.bottom) throw new Error(`captions-default: y=${y} outside safe zone`);
  return y;
}

export function captionCss({ layout = 'face', p = preset } = {}) {
  const f = p.font;
  return `#caps{position:absolute;left:0;top:${captionY(layout, p)}px;width:1080px;height:0;z-index:20}
.cap{position:absolute;left:${p.box.left}px;width:${p.box.width}px;top:0;display:flex;justify-content:center;transform:translateY(-50%)}
.cap span{display:inline-block;font:${f.weight} ${f.size}px/${f.lineHeight} '${f.family}',sans-serif;text-transform:${f.transform};color:${f.color};letter-spacing:${f.letterSpacing}px;text-align:center;white-space:nowrap;transform-origin:50% 50%;text-shadow:${p.shadow}}`;
}

export function captionHtml(caps, { track = 4 } = {}) {
  return `<div id="caps">
${caps.map((c, i) => `<div id="cap${i}" class="cap clip" data-start="${c.start}" data-duration="${r3(c.end - c.start)}" data-track-index="${track}"><span>${esc(c.text)}</span></div>`).join('\n')}
</div>`;
}

/** GSAP spring pop per caption (scale 0 -> overshoot -> 1) on timeline `tl`. */
export function captionTweens(caps, p = preset) {
  const P = p.pop;
  return caps.map((c, i) => `tl.fromTo('#cap${i} span',{scale:0},{scale:${P.overshoot},duration:${P.inDuration},ease:'${P.inEase}',immediateRender:${c.start <= 0}},${c.start});tl.to('#cap${i} span',{scale:1,duration:${P.settleDuration},ease:'${P.settleEase}'},${r3(c.start + P.settleAt)});`).join('\n');
}

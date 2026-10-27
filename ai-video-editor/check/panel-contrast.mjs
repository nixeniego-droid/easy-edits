// AI Video Editor panel text contrast on the FINAL video frames (embedded brief, presets/look-bright.json `scenes.panel.contrast`).
//   node ai-video-editor/check/panel-contrast.mjs <project-dir> <final.mp4> [--lead s] [--min 4.5] [--json]
// The DOM locates every visible white / yellow text whose box centre lies on an ink panel (panel-through's panel
// classes; panel SVG labels and captions / kinetic words over it) and its box
// at mid window (computed colour); the judgement is on pixels. Per text, SAMPLES frames inside the panel window
// (past the 0.3 s slide-in, + the post lead-in): the background is the ring of pixels in the text box grown by RING
// px that are not glyph pixels (RGB distance > GLYPH from the text colour, white and #FFD60A; the stroke / anti-alias edge is dropped
// with them by a 2 px dilation). Local background = the 90th-percentile relative luminance of the ring (the bright
// footage showing through the 72% ink is the worst case), contrast = WCAG (Lt + 0.05) / (Lb + 0.05). FAIL < 4.5.
// The fix is local (reviewer): a soft ink gradient behind that text zone only, up to 85%; never raise the whole panel.
// Exit 1 on FAIL, 2 on usage / no browser.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromePath, launch, leadOffset } from '../tools/dom-sample.mjs';
import { frameAt } from './frame-measure.mjs';
import { probe } from './card-final.mjs';

export const TEXT = [[255, 255, 255], [255, 214, 10]], MIN = 4.5, RING = 10, GLYPH = 90, SAMPLES = 3, ENTRY = 0.4;
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const relLum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** frame + text box [x, y, w, h] + text rgb -> {bg: rgb at p90 luminance, ratio, n} */
export function textContrast({ w, h, data }, [bx, by, bw, bh], rgb, { ring = RING, glyph = GLYPH, inks = TEXT } = {}) {
  const x0 = Math.max(0, bx - ring), y0 = Math.max(0, by - ring), x1 = Math.min(w, bx + bw + ring), y1 = Math.min(h, by + bh + ring);
  const px = (x, y) => { const i = 3 * (y * w + x); return [data[i], data[i + 1], data[i + 2]]; };
  // a neighbouring white / yellow word is text, not background
  const cols = [rgb, ...inks], isGlyph = (x, y) => { const q = px(x, y); return cols.some((c) => Math.hypot(...q.map((v, k) => v - c[k])) <= glyph); };
  const bg = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) { const u = x + dx, v = y + dy; if (u >= 0 && v >= 0 && u < w && v < h && isGlyph(u, v)) { near = true; break; } }
    if (!near) { const p = px(x, y); bg.push([relLum(p), p]); }
  }
  if (!bg.length) return { bg: null, ratio: null, n: 0 };
  bg.sort((a, b) => a[0] - b[0]);
  const p = bg[Math.min(bg.length - 1, Math.floor(bg.length * 0.9))][1];
  return { bg: p, ratio: +ratio(rgb, p).toFixed(2), n: bg.length };
}

/** composition -> [{id, panel, text, rgb, s, e, x, y, w, h}] white / yellow texts inside ink panels */
export async function panelTexts(proj) {
  const exe = chromePath();
  if (!exe) throw new Error('panel-contrast: no chrome-headless-shell (run `npx hyperframes browser ensure`)');
  const browser = await launch(exe, ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-features=PointerLockOptions', '--mute-audio']);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.goto(pathToFileURL(path.resolve(proj, 'index.html')).href, { waitUntil: 'load', timeout: 60000 });
    return await page.evaluate(() => {
      const root = document.querySelector('[data-composition-id]'), cid = root?.getAttribute('data-composition-id');
      const out = [];
      for (const el of document.querySelectorAll('[data-start][data-duration]')) {
        if (el === root || ![...el.classList].some((c) => /(^|-)panel($|-)/i.test(c))) continue;
        const s = +el.getAttribute('data-start'), d = +el.getAttribute('data-duration');
        window.__timelines?.[cid]?.seek(s + d / 2, false);
        const pb = el.getBoundingClientRect();
        // any visible text whose box centre lies on the panel (inside it, SVG labels, or captions over it)
        for (const t of document.querySelectorAll('body *')) {
          const own = [...t.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
          if (!own || t.closest('script,style')) continue;
          let hidden = false;
          for (let a = t; a && a !== document.body; a = a.parentElement) { const c = getComputedStyle(a); if (+c.opacity === 0 || c.visibility === 'hidden' || c.display === 'none') { hidden = true; break; } }
          if (hidden) continue;
          // on screen with the panel: every timed ancestor's window overlaps the panel's (captions are timed chunks)
          let ts = s, te = s + d;
          for (let a = t; a && a !== root; a = a.parentElement) if (a.hasAttribute?.('data-start') && a.hasAttribute('data-duration')) { const as = +a.getAttribute('data-start'); ts = Math.max(ts, as); te = Math.min(te, as + +a.getAttribute('data-duration')); }
          if (te - ts < 0.2) continue;
          const r = t.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
          const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
          if (cx < pb.left || cx > pb.right || cy < Math.max(0, pb.top) || cy > Math.min(1920, pb.bottom)) continue;
          const cs = getComputedStyle(t), col = t instanceof SVGElement && cs.fill && cs.fill !== 'none' ? cs.fill : cs.color;
          const rgb = (col.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
          // white or yellow text (R, G high); ink text on a white pill is not panel text
          if (rgb.length < 3 || rgb[0] < 200 || rgb[1] < 180) continue;
          out.push({ id: t.id || String(t.className?.baseVal ?? t.className) || t.tagName.toLowerCase(), panel: el.id, text: own.slice(0, 40), rgb, s: ts, e: te, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
      return out;
    });
  } finally { await browser.close(); }
}

async function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 2) { console.error('usage: panel-contrast.mjs <project-dir> <final.mp4> [--lead s] [--min 4.5] [--json]'); return 2; }
  const [proj, video] = pos, min = o.min != null ? +o.min : MIN;
  let texts;
  try { texts = await panelTexts(proj); } catch (e) { console.error(String(e.message || e)); return 2; }
  const html = fs.readFileSync(path.join(proj, 'index.html'), 'utf8');
  const comp = +(/data-composition-id[^>]*data-duration="([\d.]+)"|data-duration="([\d.]+)"[^>]*data-composition-id/.exec(html)?.slice(1).find(Boolean) || 0);
  const lead = o.lead != null ? +o.lead : leadOffset(probe(video).dur, comp);
  let bad = 0; const frames = new Map();
  for (const x of texts) {
    let worst = null;
    for (let k = 0; k < SAMPLES; k++) {
      const pad = Math.min(ENTRY, (x.e - x.s) / 4), a = x.s + pad, b = x.e - pad, t = +(a + (b - a) * (k + 0.5) / SAMPLES + lead).toFixed(3);
      if (!frames.has(t)) frames.set(t, frameAt(video, t));
      const c = textContrast(frames.get(t), [x.x, x.y, x.w, x.h], x.rgb);
      if (c.ratio != null && (!worst || c.ratio < worst.ratio)) worst = { ...c, t };
    }
    const ok = worst && worst.ratio >= min; if (!ok) bad++;
    if (o.json) console.log(JSON.stringify({ ...x, ...worst, ok }));
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} PANEL CONTRAST #${x.panel} "${x.text}" rgb(${x.rgb.join(',')}) ${worst ? `${worst.ratio}:1 vs bg rgb(${worst.bg.join(',')}) at ${worst.t.toFixed(2)} s` : 'no background ring'}${ok ? '' : ` < ${min}:1: add a soft ink gradient behind this text zone only (up to 85%), never raise the whole panel`}`);
  }
  console.log(`panel-contrast: ${bad ? 'FAIL' : 'PASS'} ${bad} of ${texts.length} panel text(s) below ${min}:1 (WCAG, worst of ${SAMPLES} frames, lead ${lead} s)`);
  return bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });

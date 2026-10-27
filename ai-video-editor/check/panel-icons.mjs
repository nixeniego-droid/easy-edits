// AI Video Editor panel icon size / placement on the FINAL video frames (embedded brief, presets/look-bright.json `scenes.panel.icons`).
//   node ai-video-editor/check/panel-icons.mjs <project-dir> <final.mp4> [--lead s] [--min 100] [--off 0.05] [--json]
// The DOM gives each ink panel's box and window (panel-through's panel classes) and the boxes of the white / yellow
// texts on it (panel-contrast's panelTexts); the judgement is on pixels. Per panel, SAMPLES frames inside its window
// (past the 0.4 s entry, + the post lead-in): inside the panel box (top INSET px dropped for the rounded corners),
// white / #FFD60A pixels (RGB distance <= GLYPH) that are not in a text box on screen then (grown PAD px) form
// connected components; components within GAP px of each other merge into one icon (a pin's head and body).
// Specks under SPECK px are dropped. Icon size = sqrt(w * h) of its box (a 80 x 106 pin is 92 px).
// FAIL: any icon < 100 px, the icon row centre off the panel centre by > 5% of the panel width, or the icon row
// not above the panel's word (its lowest icon bottom below the top of the panel text). Exit 1 on FAIL, 2 on usage / no browser.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromePath, launch, leadOffset } from '../tools/dom-sample.mjs';
import { frameAt } from './frame-measure.mjs';
import { probe } from './card-final.mjs';
import { TEXT, panelTexts } from './panel-contrast.mjs';

export const MIN = 100, OFF = 0.05, GLYPH = 90, GAP = 14, PAD = 8, INSET = 30, SPECK = 120, SAMPLES = 3, ENTRY = 0.4;

/** frame + panel box [x, y, w, h] + text boxes to mask -> [{x, y, w, h, size, n}] icon glyphs, left to right */
export function panelIcons({ w, h, data }, [px, py, pw, ph], masks = [], { glyph = GLYPH, gap = GAP, pad = PAD, inset = INSET, speck = SPECK, inks = TEXT } = {}) {
  const x0 = Math.max(0, px), y0 = Math.max(0, py + inset), x1 = Math.min(w, px + pw), y1 = Math.min(h, py + ph);
  if (x1 <= x0 || y1 <= y0) return [];
  const W = x1 - x0, H = y1 - y0, on = new Uint8Array(W * H);
  const masked = (x, y) => masks.some(([mx, my, mw, mh]) => x >= mx - pad && x < mx + mw + pad && y >= my - pad && y < my + mh + pad);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = 3 * (y * w + x), q = [data[i], data[i + 1], data[i + 2]];
    if (inks.some((c) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) <= glyph) && !masked(x, y)) on[(y - y0) * W + (x - x0)] = 1;
  }
  // connected components (4-neighbour flood fill)
  const lab = new Int32Array(W * H), comps = [];
  for (let s = 0; s < W * H; s++) {
    if (!on[s] || lab[s]) continue;
    const c = { x0: W, y0: H, x1: -1, y1: -1, n: 0 }, st = [s]; lab[s] = comps.length + 1;
    while (st.length) {
      const k = st.pop(), x = k % W, y = (k - x) / W;
      c.n++; c.x0 = Math.min(c.x0, x); c.y0 = Math.min(c.y0, y); c.x1 = Math.max(c.x1, x); c.y1 = Math.max(c.y1, y);
      for (const [u, v] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (u >= 0 && v >= 0 && u < W && v < H) { const j = v * W + u; if (on[j] && !lab[j]) { lab[j] = lab[s]; st.push(j); } }
    }
    comps.push(c);
  }
  // merge boxes within gap px (head + body of a pin), until stable
  let gs = comps.map((c) => ({ ...c }));
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < gs.length && !changed; i++) for (let j = i + 1; j < gs.length; j++) {
      const a = gs[i], b = gs[j];
      if (a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1) {
        gs[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), n: a.n + b.n };
        gs.splice(j, 1); changed = true; break;
      }
    }
  }
  return gs.filter((g) => g.n >= speck).map((g) => {
    const gw = g.x1 - g.x0 + 1, gh = g.y1 - g.y0 + 1;
    return { x: g.x0 + x0, y: g.y0 + y0, w: gw, h: gh, size: Math.round(Math.sqrt(gw * gh)), n: g.n };
  }).sort((a, b) => a.x - b.x);
}

/** icons + panel box + panel text boxes -> FAIL reasons (empty = ok) */
export function iconFaults(icons, [px, , pw], texts = [], { min = MIN, off = OFF } = {}) {
  if (!icons.length) return [];
  const out = [];
  for (const i of icons) if (i.size < min) out.push(`icon ${i.w}x${i.h} px at (${i.x},${i.y}) is ${i.size} px < ${min}`);
  const l = Math.min(...icons.map((i) => i.x)), r = Math.max(...icons.map((i) => i.x + i.w)), d = ((l + r) / 2 - (px + pw / 2)) / pw;
  if (Math.abs(d) > off) out.push(`icon row centre ${Math.round((l + r) / 2)} px is ${(d * 100).toFixed(1)}% of the panel width off its centre ${Math.round(px + pw / 2)} (> ${off * 100}%)`);
  const word = texts.length ? Math.min(...texts.map((t) => t[1])) : null, low = Math.max(...icons.map((i) => i.y + i.h));
  if (word != null && low > word) out.push(`icon row bottom ${low} px is below the panel word top ${word} px (icons sit above the word)`);
  return out;
}

/** composition -> [{id, s, e, x, y, w, h}] ink panels (box at mid window) */
async function panelBoxes(proj) {
  const exe = chromePath();
  if (!exe) throw new Error('panel-icons: no chrome-headless-shell (run `npx hyperframes browser ensure`)');
  const browser = await launch(exe, ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-features=PointerLockOptions', '--mute-audio']);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.goto(pathToFileURL(path.resolve(proj, 'index.html')).href, { waitUntil: 'load', timeout: 60000 });
    return await page.evaluate(() => {
      const root = document.querySelector('[data-composition-id]'), cid = root?.getAttribute('data-composition-id'), out = [];
      for (const el of document.querySelectorAll('[data-start][data-duration]')) {
        if (el === root || ![...el.classList].some((c) => /(^|-)panel($|-)/i.test(c))) continue;
        const s = +el.getAttribute('data-start'), d = +el.getAttribute('data-duration');
        window.__timelines?.[cid]?.seek(s + d / 2, false);
        const r = el.getBoundingClientRect(), top = Math.max(0, r.top), bot = Math.min(1920, r.bottom);
        out.push({ id: el.id, s, e: s + d, x: Math.round(Math.max(0, r.left)), y: Math.round(top), w: Math.round(Math.min(1080, r.right) - Math.max(0, r.left)), h: Math.round(bot - top) });
      }
      return out;
    });
  } finally { await browser.close(); }
}

async function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 2) { console.error('usage: panel-icons.mjs <project-dir> <final.mp4> [--lead s] [--min 100] [--off 0.05] [--json]'); return 2; }
  const [proj, video] = pos, min = o.min != null ? +o.min : MIN, off = o.off != null ? +o.off : OFF;
  let panels, texts;
  try { panels = await panelBoxes(proj); texts = await panelTexts(proj); } catch (e) { console.error(String(e.message || e)); return 2; }
  const html = fs.readFileSync(path.join(proj, 'index.html'), 'utf8');
  const comp = +(/data-composition-id[^>]*data-duration="([\d.]+)"|data-duration="([\d.]+)"[^>]*data-composition-id/.exec(html)?.slice(1).find(Boolean) || 0);
  const lead = o.lead != null ? +o.lead : leadOffset(probe(video).dur, comp);
  let bad = 0, seen = 0;
  for (const p of panels) {
    for (let k = 0; k < SAMPLES; k++) {
      const pad = Math.min(ENTRY, (p.e - p.s) / 4), a = p.s + pad, b = p.e - pad, tc = a + (b - a) * (k + 0.5) / SAMPLES, t = +(tc + lead).toFixed(3);
      // texts on this panel on screen at tc (captions / kinetic words change within the panel window)
      const tb = texts.filter((x) => x.panel === p.id && x.s <= tc + 0.25 && x.e >= tc - 0.25).map((x) => [x.x, x.y, x.w, x.h]);
      const icons = panelIcons(frameAt(video, t), [p.x, p.y, p.w, p.h], tb), faults = iconFaults(icons, [p.x, p.y, p.w, p.h], tb, { min, off });
      if (icons.length) seen++;
      if (faults.length) bad++;
      if (o.json) console.log(JSON.stringify({ panel: p.id, t, icons, faults }));
      const desc = icons.map((i) => `${i.size}px@${i.x + Math.round(i.w / 2)}`).join(' ') || 'no icons';
      if (faults.length) for (const f of faults) console.log(`  FAIL PANEL ICONS #${p.id} at ${t.toFixed(2)} s: ${f}; centre the icon row in the panel, each >= ${min} px (default ~120), above the word`);
      else console.log(`  ok   PANEL ICONS #${p.id} at ${t.toFixed(2)} s: ${desc}`);
    }
  }
  console.log(`panel-icons: ${bad ? 'FAIL' : 'PASS'} ${bad} of ${panels.length * SAMPLES} panel frame(s) (${seen} with icons; size >= ${min} px, row centre within ${off * 100}% of the panel centre, above the word; lead ${lead} s)`);
  return bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });

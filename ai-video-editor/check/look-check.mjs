// AI Video Editor look check (style 2, presets/look-bright.json) on the composition DOM, in headless Chrome.
//   node ai-video-editor/check/look-check.mjs <project-dir> [--step 0.25] [--final final.mp4] [--json]
// --final: card width comes from the encoded frames (card-final.mjs, same measurement as card-fill), not the DOM.
// Loads <project>/index.html like tools/dom-sample.mjs (clip windows emulated, root GSAP timeline seeked per step)
// and checks every visible element (opacity >= 0.3 up the ancestors):
//   light frame  a full-frame graphic scene (element >= 90% of the frame area) whose background (color with
//               alpha >= 0.5, or the mean of a gradient's color stops) has relative luminance >= 0.15. Full-screen
//               scenes are INK (#0E1116) with white + yellow elements (reviewer, style2b notes).
//   opaque frame a fully opaque full-frame graphic (fill alpha >= 0.95 at cumulative opacity >= 0.95), any color:
//               an idea beat is an ink panel at ~80% OVER the blurred, dimmed live footage, never a solid slate
//               (supersedes the full-screen ink scene; layout-jump.mjs checks the same on the final frames).
//   white flash  a sample with no full-frame video and no full-frame filled element on screen while the root /
//               body background is light (luminance >= 0.15): the page shows through between clips.
//   card width   a UI card (own class token `card`, `*-card`, `card-*` except idea / full / fs / inner / body /
//               back; not full-frame) measured SETTLED only (cumulative opacity >= 0.99, rendered / layout width
//               0.97-1.03, i.e. after its entry tween) outside 55-65% of the frame width (594-702 px at 1080).
//   card corner  a settled UI card in a top corner (centre above 33% height and > 15% of the width off centre).
//   caption bg   a caption (class token `cap` / `caption` / `*-cap`) whose text color equals its local background
//               (RGB distance < 40): the last visible filled element before it in DOM order that contains the
//               caption centre (footage = no check). Catches white on white.
// Exit 1 on FAIL, 2 on usage / no browser.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromePath, launch } from '../tools/dom-sample.mjs';

export const LIGHT = 0.15, OPAQUE = 0.95, FULL = 0.9, CARD_W = [0.55, 0.65], SAME_RGB = 40;

/** 'rgb(a)(r, g, b[, a])' -> {lum 0-1, a, rgb} (sRGB relative luminance) | null. */
export function parseColor(s) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/.exec(s || '');
  if (!m) return null;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  return { lum: 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]), a, rgb: [+m[1], +m[2], +m[3]] };
}

/** computed backgroundColor + backgroundImage -> luminance of the opaque-ish fill, or null (transparent / image). */
export function fillLum(color, image) {
  const f = fillColor(color, image);
  return f ? f.lum : null;
}

/** -> {lum, rgb} of the opaque-ish fill (gradient: mean of the stops) | null. */
export function fillColor(color, image) {
  const stops = [...(image || '').matchAll(/rgba?\([^)]*\)/g)].map((x) => parseColor(x[0])).filter((c) => c && c.a >= 0.5);
  if (/gradient/.test(image || '') && stops.length) {
    const n = stops.length, mean = (k) => stops.reduce((s, c) => s + c.rgb[k], 0) / n;
    return { lum: stops.reduce((s, c) => s + c.lum, 0) / n, rgb: [mean(0), mean(1), mean(2)] };
  }
  const c = parseColor(color);
  return c && c.a >= 0.5 ? { lum: c.lum, rgb: c.rgb } : null;
}

const isCardCls = (cls) => cls.some((c) => /(^|-)card($|-)/i.test(c)) && !cls.some((c) => /idea|full|^fs|inner|body|back/i.test(c));
export const isCapCls = (cls) => cls.some((c) => /^(cap|caption)$|-(cap|caption)$/i.test(c));

/** samples [{t, videoFull, bg, items: [{id, cls, x, y, w, h, lw, op, sw, color, image, text}]}] (DOM order)
 *  -> {light, opaque, flash, cards, corner, capbg}: first hit per element (flash: per run of samples). */
export function checkLook(samples, W = 1080, H = 1920) {
  const light = new Map(), opaque = new Map(), cards = new Map(), corner = new Map(), capbg = new Map(), flash = [];
  let inFlash = false;
  for (const s of samples) {
    let fullFill = false;
    for (const it of s.items) {
      const full = it.w * it.h >= FULL * W * H && it.x <= 0.05 * W && it.y <= 0.05 * H;
      const f = fillColor(it.color, it.image);
      if (full && f) fullFill = true;
      const fa = parseColor(it.color)?.a ?? (f ? 1 : 0);
      if (full && f && fa >= OPAQUE && (it.op ?? 1) >= OPAQUE && !opaque.has(it.id)) opaque.set(it.id, { id: it.id, t: s.t, color: it.color, image: it.image });
      if (full && f && f.lum >= LIGHT && !light.has(it.id)) light.set(it.id, { id: it.id, t: s.t, lum: +f.lum.toFixed(3), color: it.color, image: it.image });
      const settled = (it.op ?? 1) >= 0.99 && Math.abs((it.sw ?? 1) - 1) <= 0.03;
      if (isCardCls(it.cls) && !full && settled) {
        const w = it.lw;
        if ((w < CARD_W[0] * W || w > CARD_W[1] * W) && !cards.has(it.id)) cards.set(it.id, { id: it.id, t: s.t, w, pct: +(100 * w / W).toFixed(1) });
        const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
        if (cy < 0.33 * H && Math.abs(cx - W / 2) > 0.15 * W && !corner.has(it.id)) corner.set(it.id, { id: it.id, t: s.t, x: it.x, y: it.y });
      }
    }
    for (const [i, it] of s.items.entries()) {
      if (!isCapCls(it.cls) || !it.text || capbg.has(it.id)) continue;
      const tc = parseColor(it.text); if (!tc || tc.a < 0.5) continue;
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      let bg = null;
      for (let j = i - 1; j >= 0; j--) {
        const o = s.items[j];
        if (isCapCls(o.cls)) continue;
        const f = fillColor(o.color, o.image);
        if (f && cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h) { bg = { ...f, id: o.id }; break; }
      }
      if (bg && Math.hypot(...tc.rgb.map((v, k) => v - bg.rgb[k])) < SAME_RGB) capbg.set(it.id, { id: it.id, t: s.t, text: it.text, bg: bg.id });
    }
    const bgc = parseColor(s.bg);
    const fl = s.videoFull === false && !fullFill && bgc && bgc.a >= 0.5 && bgc.lum >= LIGHT;
    if (fl && !inFlash) flash.push({ t: s.t, bg: s.bg });
    inFlash = !!fl;
  }
  return { light: [...light.values()], opaque: [...opaque.values()], flash, cards: [...cards.values()], corner: [...corner.values()], capbg: [...capbg.values()] };
}

export async function sampleLook(proj, { step = 0.25 } = {}) {
  const exe = chromePath();
  if (!exe) throw new Error('look-check: no chrome-headless-shell (run `npx hyperframes browser ensure`)');
  const browser = await launch(exe, ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-features=PointerLockOptions', '--mute-audio']);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.goto(pathToFileURL(path.resolve(proj, 'index.html')).href, { waitUntil: 'load', timeout: 60000 });
    const meta = await page.evaluate(() => {
      const root = document.querySelector('[data-composition-id]');
      document.querySelectorAll('video,audio').forEach((m) => { m.pause?.(); });
      window.__gcClips = [...document.querySelectorAll('[data-start][data-duration]')].filter((e) => e !== root && !/^(video|audio)$/i.test(e.tagName))
        .map((e) => [e, +e.getAttribute('data-start'), +e.getAttribute('data-duration')]);
      let n = 0; for (const el of document.querySelectorAll('body *')) if (!el.id) el.id = `__gl${n++}`;
      return { id: root?.getAttribute('data-composition-id'), rootId: root?.id, duration: +(root?.getAttribute('data-duration') || 0) };
    });
    const samples = [];
    for (let t = 0; t < meta.duration - 1e-6; t += step) {
      const items = await page.evaluate(([t, cid, rootId]) => {
        for (const [e, s, d] of window.__gcClips) e.style.visibility = t >= s && t < s + d ? '' : 'hidden';
        const tl = window.__timelines?.[cid]; if (tl) tl.seek(t, false);
        const out = [];
        const opOf = (el) => { let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= +getComputedStyle(e).opacity; return op; };
        let videoFull = false;
        for (const v of document.querySelectorAll('video')) {
          const c = getComputedStyle(v), r = v.getBoundingClientRect();
          if (c.visibility !== 'hidden' && c.display !== 'none' && r.width * r.height >= 0.9 * 1080 * 1920 && opOf(v) >= 0.3) videoFull = true;
        }
        const solid = (e) => { const b = e && getComputedStyle(e).backgroundColor; return b && b !== 'rgba(0, 0, 0, 0)' ? b : null; };
        const bg = solid(document.getElementById(rootId)) || solid(document.body) || solid(document.documentElement) || 'rgb(255, 255, 255)';
        for (const el of document.querySelectorAll('body *')) {
          if (el.id === rootId || /^(script|style|video|audio|source|g|path|text|tspan)$/i.test(el.tagName)) continue;
          const c = getComputedStyle(el);
          if (c.visibility === 'hidden' || c.display === 'none') continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          const op = opOf(el);
          if (op < 0.3) continue;
          const cls = [...el.classList];
          const card = cls.some((x) => /(^|-)card($|-)/i.test(x));
          const cap = cls.some((x) => /^(cap|caption)$|-(cap|caption)$/i.test(x)) && el.textContent.trim();
          const fill = c.backgroundColor !== 'rgba(0, 0, 0, 0)' || c.backgroundImage !== 'none';
          if (!card && !fill && !cap) continue;
          const lw = el.offsetWidth || Math.round(r.width);
          const x = Math.max(0, r.left), y = Math.max(0, r.top), w = Math.min(1080, r.right) - x, h = Math.min(1920, r.bottom) - y;
          out.push({ id: el.id, cls, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), lw, op: +op.toFixed(3), sw: +(r.width / (lw || 1)).toFixed(3), color: c.backgroundColor, image: c.backgroundImage === 'none' ? '' : c.backgroundImage.slice(0, 400), text: cap ? c.color : '' });
        }
        return { items: out, videoFull, bg };
      }, [+t.toFixed(4), meta.id, meta.rootId]);
      samples.push({ t: +t.toFixed(3), ...items });
    }
    return { duration: meta.duration, step, samples };
  } finally { await browser.close(); }
}

async function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 1) { console.error('usage: look-check.mjs <project-dir> [--step 0.25] [--json]'); return 2; }
  let s;
  try { s = await sampleLook(pos[0], { step: +(o.step || 0.25) }); } catch (e) { console.error(String(e.message || e)); return 2; }
  const r = checkLook(s.samples);
  if (o.final) {
    const { finalCards, judgeWidth } = await import('./card-final.mjs');
    const fc = await finalCards(pos[0], o.final);
    r.cards = fc.cards.filter((c) => c.box && !judgeWidth(c).ok).map((c) => ({ id: c.id, t: c.tf, w: c.box.w, pct: judgeWidth(c).pct, final: true }));
  }
  if (o.json) console.log(JSON.stringify(r, null, 1));
  for (const d of r.light) console.log(`  LIGHT FRAME ${d.t.toFixed(2)} s #${d.id} luminance ${d.lum} >= ${LIGHT} (${d.image || d.color}; full-screen scenes are ink #0E1116)`);
  for (const d of r.opaque) console.log(`  OPAQUE FRAME ${d.t.toFixed(2)} s #${d.id} fully opaque full-frame graphic (${d.image || d.color}; use an ~80% ink panel over the live footage)`);
  for (const f of r.flash) console.log(`  WHITE FLASH ${f.t.toFixed(2)} s no full-frame video or scene, page background ${f.bg}`);
  for (const c of r.cards) console.log(`  CARD WIDTH ${c.t.toFixed(2)} s #${c.id} ${c.w} px = ${c.pct}% ${c.final ? 'on the final frame' : 'settled'} (want 55-65%, 594-702 px)`);
  for (const c of r.corner) console.log(`  CARD CORNER ${c.t.toFixed(2)} s #${c.id} at ${c.x},${c.y} (top corner; want lower-middle or beside the face)`);
  for (const c of r.capbg) console.log(`  CAPTION BG ${c.t.toFixed(2)} s #${c.id} text ${c.text} on #${c.bg} of the same color`);
  const bad = r.light.length + r.opaque.length + r.flash.length + r.cards.length + r.corner.length + r.capbg.length;
  console.log(`look-check: ${bad ? 'FAIL' : 'PASS'} ${r.light.length} light full frame(s), ${r.opaque.length} opaque full frame(s), ${r.flash.length} white flash(es), ${r.cards.length} UI card(s) outside 55-65% width, ${r.corner.length} card(s) in a top corner, ${r.capbg.length} caption(s) on own color (${s.samples.length} samples)`);
  return bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2)).then((c) => { process.exitCode = c; }); // not awaited: card-final <-> card-fill <-> look-check import each other

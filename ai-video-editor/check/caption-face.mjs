// AI Video Editor face-safe caption check: no caption box may cover the speaker's face (chin included).
//   node ai-video-editor/check/caption-face.mjs <project-dir> [--prep source-prep.json] [--json]
// Layout math, not pixels: Haar on rendered frames fires on badges, kinetic type and panel art (all six hits on
// gen-talk-v3 / gen-nasa2-v2 / confirm-30s finals were false), so the face comes from the speaker media instead.
// Captions = <project>/index.html `.cap` clips: font px, box left/width and Y from the composition (`#caps` top +
// each clip's inline `top` offset), width estimated like captions-layout.captionBox (~0.78 em per uppercase char).
// Face (media px) per caption, sampled at start + 0.15 s (settled pop), mid and end:
//   - source-prep.json scene face box (--prep), mapped edited -> source time by assets/edit-decisions.json keeps,
//     when the speaker media (`#spk` src) has the source's size;
//   - else OpenCV Haar (tools/source-prep-faces.py) on the speaker media itself at 5 fps (no graphics on it), the
//     largest face >= 6% of the frame that a neighbouring frame also sees.
// Media px -> output px through `#spk` CSS (left/top/width/height, or object-fit: cover) and the `#spkwrap` GSAP
// set / to / fromTo x, y, scale, transformOrigin at that time (linear in-tween). Face rect = box grown 10% each
// side and 15% below (chin). Only plan.json scenes with layout face / punch / split are checked (others cover
// the speaker). FAIL when any caption box intersects the face rect. Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { aiVideoEditorPython } from './lib/python.mjs';
import { pathToFileURL } from 'node:url';

const FACES = new URL('../tools/source-prep-faces.py', import.meta.url).pathname;
const SPEAKER_LAYOUTS = new Set(['face', 'punch', 'split']);
const num = (s, re, d) => { const m = s.match(re); return m ? +m[1] : d; };

/** index.html -> {font, lh, left, width, caps: [{id, text, start, end, y}]} */
export function readCaptions(html) {
  const span = html.match(/\.cap span\{[^}]*\}/)?.[0] || '';
  const font = num(span, /font:\s*\d+\s+([\d.]+)px/, 84), lh = num(span, /font:\s*\d+\s+[\d.]+px\/([\d.]+)/, 1.05);
  const cap = html.match(/\.cap\{[^}]*\}/)?.[0] || '';
  const left = num(cap, /left:(-?[\d.]+)px/, 90), width = num(cap, /width:([\d.]+)px/, 900);
  const top = num(html, /#caps\{[^}]*top:(-?[\d.]+)px/, 0);
  const caps = [];
  for (const m of html.matchAll(/<div id="(cap\d+)" class="cap clip"([^>]*)><span[^>]*>([^<]*)<\/span>/g)) {
    const a = m[2], start = num(a, /data-start="([\d.]+)"/, 0);
    caps.push({ id: m[1], text: m[3].replace(/&amp;/g, '&').replace(/&lt;/g, '<'), start, end: start + num(a, /data-duration="([\d.]+)"/, 0), y: top + num(a, /top:(-?[\d.]+)px/, 0), style: a });
  }
  return { font, lh, left, width, caps };
}

export function capBox(c, { font, lh, left, width }) {
  const w = Math.min(width, c.text.length * font * 0.78), cx = left + width / 2, h = font * lh;
  return { x0: cx - w / 2, x1: cx + w / 2, y0: c.y - h / 2, y1: c.y + h / 2 };
}
export const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
/** Haar box [x,y,w,h] -> keep-out rect with the chin. */
export const faceRect = ([x, y, w, h]) => ({ x0: x - 0.1 * w, x1: x + 1.1 * w, y0: y, y1: y + 1.15 * h });

/** index.html -> {src, spk: {left, top, w, h, cover}, origin: [ox, oy], tweens: [{t, dur, kind, props}]} */
export function readSpeaker(html) {
  const spk = html.match(/#spk\{[^}]*\}/)?.[0] || '', wrap = html.match(/#spkwrap\{[^}]*\}/)?.[0] || '';
  const ww = num(wrap, /width:([\d.]+)px/, 1080), wh = num(wrap, /height:([\d.]+)px/, 1920);
  const to = wrap.match(/transform-origin:\s*(-?[\d.]+)(?:px)?\s+(-?[\d.]+)/);
  const tweens = [];
  for (const m of html.matchAll(/tl\.(set|to|fromTo)\('#spkwrap',(\{[^}]*\})(?:,(\{[^}]*\}))?,([\d.]+)\)/g)) {
    const obj = (s) => {
      const o = {};
      for (const k of ['x', 'y', 'scale', 'duration']) { const v = s?.match(new RegExp(`(?:^|[{,])${k}:(-?[\\d.]+)`)); if (v) o[k] = +v[1]; }
      const tor = s?.match(/transformOrigin:'(-?[\d.]+)px (-?[\d.]+)px'/); if (tor) o.origin = [+tor[1], +tor[2]];
      return o;
    };
    const kind = m[1], a = obj(m[2]), b = m[3] ? obj(m[3]) : null;
    tweens.push(kind === 'fromTo' ? { t: +m[4], kind, from: a, props: b, dur: b.duration || 0 } : { t: +m[4], kind, props: a, dur: kind === 'to' ? a.duration || 0 : 0 });
  }
  tweens.sort((a, b) => a.t - b.t);
  return {
    src: html.match(/<video id="spk"[^>]*src="([^"]+)"/)?.[1],
    spk: { left: num(spk, /left:(-?[\d.]+)px/, 0), top: num(spk, /top:(-?[\d.]+)px/, 0), w: num(spk, /width:([\d.]+)px/, ww), h: num(spk, /height:([\d.]+)px/, wh), cover: /object-fit:\s*cover/.test(spk) },
    origin: to ? [+to[1], +to[2]] : [ww / 2, wh / 2],
    tweens,
  };
}

/** GSAP state of #spkwrap at t: {x, y, scale, origin}. */
export function wrapAt(sp, t) {
  const st = { x: 0, y: 0, scale: 1, origin: sp.origin };
  const keys = ['x', 'y', 'scale'];
  for (const w of sp.tweens) {
    if (w.t > t + 1e-6) break;
    if (w.props.origin) st.origin = w.props.origin;
    if (w.from) for (const k of keys) if (w.from[k] != null) st[k] = w.from[k];
    const f = w.dur ? Math.min(1, (t - w.t) / w.dur) : 1;
    for (const k of keys) if (w.props[k] != null) st[k] += (w.props[k] - st[k]) * f;
  }
  return st;
}

/** media px box [x,y,w,h] (media W x H) -> output rect at wrap state. */
export function mediaToOut([x, y, w, h], W, H, sp, st) {
  let k1 = sp.spk.w / W, k2 = sp.spk.h / H, ox = sp.spk.left, oy = sp.spk.top;
  if (sp.spk.cover) { k1 = k2 = Math.max(sp.spk.w / W, sp.spk.h / H); ox += (sp.spk.w - W * k1) / 2; oy += (sp.spk.h - H * k2) / 2; }
  const P = (px, py) => {
    const ex = ox + px * k1, ey = oy + py * k2;
    return [st.origin[0] + (ex - st.origin[0]) * st.scale + st.x, st.origin[1] + (ey - st.origin[1]) * st.scale + st.y];
  };
  const [x0, y0] = P(x, y), [x1, y1] = P(x + w, y + h);
  return [x0, y0, x1 - x0, y1 - y0];
}

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return (ix * iy) / (a[2] * a[3] + b[2] * b[3] - ix * iy);
};
/** Haar frames -> faces that a neighbouring frame also sees (IoU >= 0.3) and >= minW wide. */
export function stableFaces(frames, i, minW) {
  const nb = [frames[i - 1], frames[i + 1]].filter(Boolean);
  return frames[i].faces.filter((b) => b[2] >= minW && nb.some((n) => n.faces.some((o) => iou(b, o) >= 0.3)));
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return { w, h };
}

/** (t) -> media box [x,y,w,h] | null, from source-prep (same-size media) or Haar on the media. */
export function faceSource({ media, size, prep, decisions }) {
  if (prep && prep.source.width === size.w && prep.source.height === size.h) {
    return {
      from: 'source-prep',
      at: (t) => {
        const k = (decisions?.keeps || []).find((k) => t >= k.start && t < k.end);
        const s = k ? k.sourceStart + (t - k.start) : t;
        return prep.scenes.find((c) => s >= c.start && s < c.end)?.face?.box || null;
      },
    };
  }
  const r = spawnSync(aiVideoEditorPython(), [FACES, media, '5', '960'], { maxBuffer: 1 << 28, encoding: 'utf8' });
  if (r.status) throw new Error(`face detector exit ${r.status}: ${r.stderr}`);
  const frames = JSON.parse(r.stdout).frames, minW = 0.06 * Math.min(size.w, size.h);
  const best = frames.map((_, i) => stableFaces(frames, i, minW).sort((a, b) => b[2] * b[3] - a[2] * a[3])[0] || null);
  return { from: 'haar on speaker media', at: (t) => best[Math.min(best.length - 1, Math.max(0, Math.round(t * 5)))] };
}

/** -> {rows, bad, unknown} */
export function checkCaptionFaces({ geo, sp, plan, face, size }) {
  const layoutAt = (t) => (plan?.scenes || []).find((s) => t >= s.start && t < s.end)?.layout;
  const rows = [], bad = [], unknown = [];
  for (const c of geo.caps) {
    const box = capBox(c, geo);
    let over = null, checked = 0;
    for (const t of [c.start + 0.15, (c.start + c.end) / 2, c.end - 0.04].filter((t) => t >= c.start && t <= c.end)) {
      const lay = layoutAt(t);
      if (plan?.scenes && !SPEAKER_LAYOUTS.has(lay)) continue;
      const fb = face.at(t);
      if (!fb) continue;
      checked++;
      const rect = faceRect(mediaToOut(fb, size.w, size.h, sp, wrapAt(sp, t)));
      if (hit(box, rect)) { over = { t: +t.toFixed(3), layout: lay, face: rect }; break; }
    }
    const row = { cap: c.text, id: c.id, at: c.start, box, checked, over };
    rows.push(row);
    if (over) bad.push(row);
    else if (!checked && (!plan?.scenes || SPEAKER_LAYOUTS.has(layoutAt(c.start)))) unknown.push(row);
  }
  return { rows, bad, unknown };
}

function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 1) { console.error('usage: caption-face.mjs <project-dir> [--prep source-prep.json] [--json]'); return 2; }
  const proj = pos[0], html = fs.readFileSync(path.join(proj, 'index.html'), 'utf8');
  const rd = (f) => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  const geo = readCaptions(html), sp = readSpeaker(html);
  if (!sp.src) { console.log('caption-face: PASS (no #spk speaker video)'); return 0; }
  const media = path.join(proj, sp.src), size = probe(media);
  const face = faceSource({ media, size, prep: rd(o.prep), decisions: rd(path.join(proj, 'assets/edit-decisions.json')) });
  const r = checkCaptionFaces({ geo, sp, plan: rd(path.join(proj, 'assets/plan.json')), face, size });
  if (o.json) console.log(JSON.stringify(r, null, 1));
  for (const b of r.bad) {
    const f = b.over.face;
    console.log(`  OVER FACE  ${b.at.toFixed(2)} s "${b.cap}" (${b.over.layout}) caption y ${b.box.y0.toFixed(0)}-${b.box.y1.toFixed(0)} x ${b.box.x0.toFixed(0)}-${b.box.x1.toFixed(0)} vs face+chin y ${f.y0.toFixed(0)}-${f.y1.toFixed(0)} x ${f.x0.toFixed(0)}-${f.x1.toFixed(0)} @${b.over.t}`);
  }
  console.log(`caption-face: ${r.bad.length ? 'FAIL' : 'PASS'} ${r.rows.length - r.bad.length}/${r.rows.length} captions clear of the face (face from ${face.from}${r.unknown.length ? `; ${r.unknown.length} on speaker layouts with no face found` : ''})`);
  return r.bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));

// Easy Edits composer: plan + edited clip + transcript -> one HyperFrames composition (index.html) per format.
// Layers: intro title card, the speaker video (face-tracked framing, punch-ins, split layout under a top box),
// top-box panels (quote / list / compare / card), icon and stat pops, lower third, progress bar, kinetic or
// minimal captions, end card, optional watermark. Hard cuts between layouts (Herk playbook house style); the
// camera follows the smoothed face track between cuts. Audio is mixed outside the composition (engine/audio.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captionGroups } from '../presets/captions-default.mjs';
import { icon, iconFor } from './icons.mjs';
import { TOPBOX, norm, locate } from './plan.mjs';
import { themeOf, fontCss } from './theme.mjs';
import { regionStats, blendBackdrop, pickInk, isBusy, contrastRatio, relLum, rgba, INK } from './contrast.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const r3 = (v) => Math.round(v * 1000) / 1000;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const FORMATS = {
  '9x16': { w: 1080, h: 1920 },
  '1x1': { w: 1080, h: 1080 },
  '16x9': { w: 1920, h: 1080 },
};

/** per-format layout geometry: regions are output px. */
export function geometry(fmt) {
  const { w, h } = FORMATS[fmt];
  if (fmt === '9x16') return {
    w, h, full: { x: 0, y: 0, w, h },
    panel: { x: 0, y: 0, w, h: 790 }, seamY: 862, split: { x: 0, y: 930, w, h: h - 930 },
    capY: 1290, capMinY: 1180, capMaxY: 1480, safeTop: 250, capSize: 96, capBox: 960, minSize: 66, minBox: 900, minY: 1400,
    lower: { x: 60, y: 1030 }, popZone: { x0: 120, x1: 960, y0: 300, y1: 1080 }, faceY: 0.36,
  };
  if (fmt === '1x1') return {
    w, h, full: { x: 0, y: 0, w, h },
    panel: { x: 0, y: 0, w: 560, h }, seamY: null, split: { x: 560, y: 0, w: w - 560, h },
    capY: 900, capMinY: 760, capMaxY: 990, safeTop: 60, capSize: 78, capBox: 980, minSize: 56, minBox: 960, minY: 930,
    lower: { x: 50, y: 690 }, popZone: { x0: 110, x1: 970, y0: 110, y1: 640 }, faceY: 0.36,
  };
  return {
    w, h, full: { x: 0, y: 0, w, h },
    panel: { x: 0, y: 0, w: 1000, h }, seamY: null, split: { x: 1000, y: 0, w: w - 1000, h },
    capY: 900, capMinY: 780, capMaxY: 990, safeTop: 60, capSize: 80, capBox: 1500, minSize: 56, minBox: 1500, minY: 950,
    lower: { x: 80, y: 700 }, popZone: { x0: 120, x1: 1800, y0: 100, y1: 660 }, faceY: 0.38,
  };
}

/** face track sample at clip time t (nearest). */
export function faceAt(track, t) {
  const S = track.samples; if (!S?.length) return null;
  let lo = 0, hi = S.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (S[m].t < t) lo = m + 1; else hi = m; }
  // the sample at or before t (a sample after a camera cut belongs to the next shot)
  const s = S[lo].t > t && lo > 0 ? S[lo - 1] : S[lo];
  return s.box ? { cx: s.cx, cy: s.cy, fw: s.box[2] } : null;
}

/** framing of the source (W x H) into region R at zoom z, face centred at (fx, fyFrac): {x, y, s} relative to R. */
export function frame(W, H, R, face, z = 1, fyFrac = 0.36, contain = false) {
  const s = (contain ? Math.min(R.w / W, R.h / H) : Math.max(R.w / W, R.h / H)) * z;
  const cx = face ? face.cx : W / 2, cy = face ? face.cy : H * 0.4;
  let x = R.w / 2 - cx * s, y = R.h * fyFrac - cy * s;
  // smaller than the region on an axis (contain): centred on it; else clamped so the picture covers the region
  x = W * s <= R.w ? (R.w - W * s) / 2 : clamp(x, R.w - W * s, 0);
  y = H * s <= R.h ? (R.h - H * s) / 2 : clamp(y, R.h - H * s, 0);
  return { x: r3(x), y: r3(y), s: r3(s) };
}

/** face box in output px for a framing. */
const faceOut = (R, f, face) => face && { cx: R.x + f.x + face.cx * f.s, cy: R.y + f.y + face.cy * f.s, fw: face.fw * f.s };

/** layout segments over the edited timeline: [{start, end, kind: face|punch|split, zoom}] */
export function layoutSegments(beats, duration) {
  const cuts = [];
  for (const b of beats) {
    if (TOPBOX.has(b.type)) cuts.push({ start: b.at, end: b.end, kind: 'split', beat: b });
    else if (b.type === 'punch') cuts.push({ start: b.at, end: b.end, kind: 'punch', zoom: b.zoom });
  }
  cuts.sort((a, b) => a.start - b.start);
  const segs = []; let t = 0;
  for (const c of cuts) {
    const s = Math.max(c.start, t);
    if (s - t > 0.01) segs.push({ start: r3(t), end: r3(s), kind: 'face' });
    if (c.end - s > 0.3) segs.push({ ...c, start: r3(s), end: r3(c.end) });
    t = Math.max(t, c.end);
  }
  if (duration - t > 0.01) segs.push({ start: r3(t), end: r3(duration), kind: 'face' });
  return segs;
}

const CSS_BASE = (G, Th) => { const A = Th.A; return `*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${G.w}px;height:${G.h}px;overflow:hidden;background:${Th.bg}}
#root{position:relative;width:${G.w}px;height:${G.h}px;overflow:hidden;background:${Th.bg};font-family:${Th.house ? "'Montserrat',sans-serif" : Th.font.body.stack};color:${Th.text}}
#spkbox{position:absolute;left:0;top:0;width:${G.w}px;height:${G.h}px;overflow:hidden;z-index:1;background:${Th.bg}}
#spk{position:absolute;left:0;top:0;transform-origin:0 0}
.panel{position:absolute;overflow:hidden;z-index:5;background:${Th.panelBg}}
.panel .grid{position:absolute;inset:0;background-image:linear-gradient(${Th.grid} 1px,transparent 1px),linear-gradient(90deg,${Th.grid} 1px,transparent 1px);background-size:54px 54px}
.panel .edge{position:absolute;left:0;bottom:0;width:100%;height:6px;background:${A}}
.seam{position:absolute;left:0;width:100%;z-index:4;background:${Th.bg}}
.chip{display:inline-flex;align-items:center;gap:.4em;padding:.28em .8em;border-radius:999px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
#prog{position:absolute;left:0;top:0;height:8px;width:${G.w}px;background:${A};transform-origin:0 50%;z-index:30;box-shadow:0 0 12px rgba(0,0,0,.35)}
#progbg{position:absolute;left:0;top:0;height:8px;width:${G.w}px;background:rgba(255,255,255,.18);z-index:29}
.pop{position:absolute;z-index:12;display:flex;flex-direction:column;align-items:center;gap:14px}
.pop .disc{border-radius:50%;background:${A};display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,.45),0 0 0 6px ${Th.ring}}
.pop .lab{font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:${Th.labFg};background:${Th.labBg};border-radius:12px;padding:6px 16px;box-shadow:0 6px 18px rgba(0,0,0,.35)}
.pop .numbox{position:relative;display:inline-block}
.pop .numbox .sizer{visibility:hidden}
.pop .numbox .nv{position:absolute;left:0;right:0;top:0;text-align:center;visibility:hidden;white-space:nowrap}
.lower{position:absolute;z-index:14;display:flex;align-items:stretch;gap:0}
.lower .bar{width:12px;background:${A};border-radius:3px}
.lower .txt{background:${Th.ltBg};padding:16px 26px 16px 22px;border-radius:0 10px 10px 0}
.lower .n{font-weight:900;letter-spacing:.02em}
.lower .r{font-weight:600;opacity:.85;margin-top:4px}
.card{position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:${Th.cardBg}}
.card .grid{position:absolute;inset:0;background-image:linear-gradient(${Th.cardGrid} 1px,transparent 1px),linear-gradient(90deg,${Th.cardGrid} 1px,transparent 1px);background-size:60px 60px}
.card .ttl{position:relative;font-weight:900;text-transform:uppercase;line-height:1.02;letter-spacing:.01em}
.card .ttl .w{display:inline-block;margin:0 .14em}
.card .sub{position:relative;font-weight:600;opacity:.9;margin-top:28px}
.card .bar{position:relative;height:10px;background:${A};border-radius:5px;margin:34px auto 0;transform-origin:50% 50%}
.wm{position:absolute;z-index:4;font-weight:800;letter-spacing:.04em;color:rgba(255,255,255,.78);text-shadow:0 1px 4px rgba(0,0,0,.6)}
.cap{position:absolute;display:flex;justify-content:center;transform:translateY(-50%);z-index:20}
.cap span.l{display:inline-block;text-align:center;transform-origin:50% 50%}
.kin span.l{font-weight:900;text-transform:uppercase;letter-spacing:1px;line-height:1.05;white-space:nowrap;color:#fff;text-shadow:0 3px 4px rgba(0,0,0,.85),0 0 12px rgba(0,0,0,.5);-webkit-text-stroke:3px rgba(0,0,0,.35);paint-order:stroke fill}
.kin span.l em{font-style:normal;color:${A}}
.min span.l{font-weight:700;line-height:1.18;white-space:normal;color:#fff;-webkit-text-stroke:4px rgba(0,0,0,.55);paint-order:stroke fill;text-shadow:0 0 2px rgba(0,0,0,.8),0 2px 4px rgba(0,0,0,.55),0 3px 12px rgba(0,0,0,.45)}
.kin.busy span.l{-webkit-text-stroke:5px rgba(0,0,0,.55)}
.min.busy span.l{-webkit-text-stroke:6px rgba(0,0,0,.7)}
.kin.ink-dark span.l{color:${INK.dark};-webkit-text-stroke:3px rgba(255,255,255,.6);text-shadow:0 0 3px rgba(255,255,255,.75),0 2px 10px rgba(255,255,255,.45)}
.kin.ink-dark span.l em{color:${Th.onA};background:${A};border-radius:.12em;padding:0 .1em;-webkit-text-stroke:0;text-shadow:none}
.min.ink-dark span.l{color:${INK.dark};-webkit-text-stroke:4px rgba(255,255,255,.7);text-shadow:0 0 2px rgba(255,255,255,.8),0 2px 6px rgba(255,255,255,.5),0 3px 14px rgba(255,255,255,.35)}
.ink-dark.busy span.l{-webkit-text-stroke-color:rgba(255,255,255,.85)}${Th.house ? '' : PACK_CSS(Th)}${Th.cap ? PACK_CAP_CSS(Th) : ''}`; };

/** caption css of a style pack: one class per ink (auto contrast), per highlight style, busy backgrounds. */
const SHADOWS = {
  soft: ['0 2px 4px rgba(0,0,0,.55),0 4px 14px rgba(0,0,0,.4)', '0 0 3px rgba(255,255,255,.7),0 2px 10px rgba(255,255,255,.45)'],
  hard: ['0 5px 0 rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.6)', '0 4px 0 rgba(255,255,255,.85),0 0 2px rgba(255,255,255,.6)'],
  none: ['none', 'none'],
};
function PACK_CAP_CSS(Th) {
  const C = Th.cap, A = Th.A, e = C.edge;
  const sh = C.shadow === 'glow' ? [`0 0 2px rgba(0,0,0,.9),0 0 14px ${rgba(A, 0.55)}`, `0 0 2px rgba(255,255,255,.9),0 0 14px ${rgba(A, 0.5)}`] : SHADOWS[C.shadow];
  const tf = { upper: 'uppercase', lower: 'lowercase', 'as-spoken': 'none' }[C.case];
  return `
.sp span.l{font-family:${C.stack};font-weight:${C.weight};letter-spacing:${C.letterSpacing || 0}px;line-height:1.12;text-transform:${tf};color:var(--ink);-webkit-text-stroke:${e}px var(--edge);paint-order:stroke fill;text-shadow:var(--shadow)}
.sp.one span.l{white-space:nowrap}
.sp.wrap span.l{white-space:normal}
.sp.ink-light{--ink:${INK.light};--edge:rgba(0,0,0,.6);--shadow:${sh[0]}}
.sp.ink-dark{--ink:${INK.dark};--edge:rgba(255,255,255,.78);--shadow:${sh[1]}}
.sp.busy span.l{-webkit-text-stroke-width:${Math.max(2, Math.round(e * 1.7))}px}
.sp.ink-light.busy{--edge:rgba(0,0,0,.78)}
.sp.ink-dark.busy{--edge:rgba(255,255,255,.9)}
.sp .w{display:inline-block;margin:0 .1em}
.sp.hl-color .w.on{color:${A}}
.sp.hl-glow .w.on{text-shadow:0 0 2px rgba(0,0,0,.9),0 0 12px ${A},0 0 26px ${rgba(A, 0.75)}}
.sp.hl-glow.ink-light .w.on{color:${A}}
.sp.hl-box .w{padding:0 .12em;border-radius:.14em}
.sp.hl-box .w.on{background:${A};color:${Th.onA};-webkit-text-stroke-width:0;text-shadow:none}
.sp.hl-underline .w{background-image:linear-gradient(${A},${A});background-repeat:no-repeat;background-position:0 96%;background-size:0% .12em}
.sp.hl-underline .w.on{background-size:100% .12em}
.sp.type .w{opacity:0}`;
}
/** a style pack's fonts on the house elements (titles, lower third, labels, chips). */
const PACK_CSS = (Th) => `
.card .ttl,.lower .n{font-family:${Th.font.display.stack};font-weight:${Th.font.display.weight}}
.lower .r,.chip,.card .sub,.pop .lab,.wm{font-family:${Th.font.body.stack}}
.pop .lab{font-weight:${Math.max(600, Th.font.body.weight)}}
.card .ttl{text-transform:${Th.font.display.family === 'Playfair Display' ? 'none' : 'uppercase'}}`;

/**
 * Number treatment frames for a stat value ("29:18", "$1,200", "40%", "3.5x"): {frames: [{t, text}]} where t is the
 * offset from the pop's start. count-up: 14 steps over 0.9 s from zero, eased out, same decimals and separators;
 * scramble: every digit runs through 9 random frames 50 ms apart (seeded, so a re-render is identical), then the
 * value; slam / pop: no frames (the value is drawn once). count-up moves the first number; text around it stays.
 */
export function numberFrames(value, mode, seed = 0) {
  const v = String(value ?? '');
  const m = /^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s.exec(v);
  if (!m || (mode !== 'count-up' && mode !== 'scramble')) return { frames: [] };
  const [, pre, num, post] = m;
  if (mode === 'count-up') {
    const n = Number(num.replace(/,/g, '')), dec = (num.split('.')[1] || '').length, commas = num.includes(',');
    const fmt = (x) => { const s = x.toFixed(dec); if (!commas) return s; const [i, d] = s.split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? `.${d}` : ''); };
    const K = 14;
    return { frames: Array.from({ length: K + 1 }, (_, k) => ({ t: r3(0.08 + (0.9 * k) / K), text: `${pre}${fmt(k === K ? n : n * (1 - (1 - k / K) ** 3))}${post}` })) };
  }
  let x = (seed * 7919 + v.length * 104729 + 17) % 2147483647;
  const rnd = () => { x = (x * 48271) % 2147483647; return x / 2147483647; };
  const frames = Array.from({ length: 9 }, (_, k) => ({ t: r3(0.06 + k * 0.05), text: v.replace(/\d/g, () => String(Math.floor(rnd() * 10))) }));
  frames.push({ t: r3(0.06 + 9 * 0.05), text: v });
  return { frames };
}

/**
 * Build the composition. opts:
 *  fmt '9x16'|'1x1'|'16x9'; clip {file, w, h, duration}; track (facetrack json of the clip); words (edited timeline);
 *  plan (validated); captions 'kinetic'|'minimal'|'none'; intro seconds (0 = none); outro seconds; title; subtitle;
 *  speaker {name, role}; accent; watermark; cta; progress bool; lowerThird bool; style (a validated style pack,
 *  engine/style-pack.mjs: palette, fonts, caption look, transitions, number treatment, signature move);
 *  luma (engine/contrast.mjs lumaGrid of the clip: captions pick light / dark text from the footage behind them);
 *  ink 'auto' (default) | 'light' | 'dark' | '#RRGGBB' (caption text colour; auto needs luma, else light)
 * Returns { html, duration, offset, cues:[{t, sfx}], captions:[...], style, transitions, signatures, ink }.
 */
export function compose(o) {
  const G = geometry(o.fmt), Th = o.theme || themeOf(o.style, o.accent), A = Th.A;
  const W = o.clip.w, H = o.clip.h, D = o.clip.duration;
  const SCREEN = !!o.screen; // a screen recording: letterboxed (contain) on the card background, zooms follow activity
  if (SCREEN) {
    const sh = Math.round(G.w * H / W);
    // phones: a taller screen window with a base zoom that follows the activity, so screen text stays readable
    G.screen = o.fmt === '16x9' ? { ...G.full } : (o.fmt === '9x16' ? { x: 0, y: 400, w: G.w, h: 920 } : { x: 0, y: 40, w: G.w, h: Math.max(sh, 800) });
    G.screenBase = o.fmt === '16x9' ? 1 : (o.fmt === '9x16' ? Math.max(1, 920 / sh) * 1.02 : Math.max(1, 800 / sh) * 1.02);
    G.screenCapY = o.fmt === '9x16' ? G.screen.y + G.screen.h + 130 : (o.fmt === '1x1' ? Math.min(G.h - 70, G.screen.y + G.screen.h + 70) : G.h - 110);
  }
  const I = o.intro ?? 0, O = o.outro ?? 0, T = r3(I + D + O);
  const beats = o.plan?.beats || [];
  const segs = layoutSegments(beats, D);
  const cues = [];
  const tw = []; // GSAP timeline lines
  const el = []; // DOM
  const at = (t) => r3(I + t);
  // ---------- speaker framing ----------
  const regionOf = (seg) => (seg.kind === 'split' ? G.split : (SCREEN ? G.screen : G.full));
  const baseZoomFace = 1;
  const autoPunch = (face, R) => {
    if (SCREEN) return clamp(face ? (W * 0.5) / Math.max(1, face.fw) : 1.6, 1.35, 1.8);
    if (!face) return 1.3;
    const s0 = Math.max(R.w / W, R.h / H);
    const want = (o.fmt === '9x16' ? 0.15 : 0.24) * R.h; // face height target on screen
    return clamp(want / (face.fw * s0), 1.2, 1.9);
  };
  const camCuts = (o.track?.samples || []).filter((x) => x.cut).map((x) => x.t);
  const framings = []; // per segment: [{t, x, y, s}] + region
  for (const seg of segs) {
    const R = regionOf(seg);
    const fy = SCREEN ? 0.5 : (seg.kind === 'split' ? 0.42 : G.faceY);
    const keys = [];
    const step = 0.5;
    const f0 = faceAt(o.track, seg.start + 0.1);
    let z = seg.kind === 'punch' ? (seg.zoom || autoPunch(f0, R)) : baseZoomFace;
    if (seg.kind === 'punch' && Th.punchZoom) z = clamp(z, Th.punchZoom[0], Th.punchZoom[1]);
    if (seg.kind === 'split' && o.fmt !== '9x16') z = 1;
    if (SCREEN) z *= seg.kind === 'split' ? (o.fmt === '9x16' ? Math.max(1, (R.h / R.w) * (W / H)) * 1.02 : 1) : G.screenBase;
    for (let t = seg.start; t < seg.end - 1e-6; t += step) {
      const face = faceAt(o.track, Math.min(t + step / 2, D));
      const push = seg.kind === 'split' ? 1 : 1 + Th.drift * ((t - seg.start) / Math.max(1, seg.end - seg.start));
      keys.push({ t: r3(t), ...frame(W, H, R, face, z * push, fy, SCREEN) });
    }
    const face = faceAt(o.track, seg.end);
    keys.push({ t: seg.end, ...frame(W, H, R, face, z * (seg.kind === 'split' ? 1 : 1 + Th.drift), fy, SCREEN) });
    framings.push({ seg, R, keys });
  }
  // steady (shorts / podcasts, no layout beats): one framing per camera shot or speaker turn, held still; it only
  // re-centres (eased) when the face leaves a deadzone; wide shots get a modest zoom; the clean cut's jump cuts
  // inside one shot alternate 1x / 1.12x so a join reads as a punch-in, not a jump
  const steady = o.steady && !SCREEN && segs.every((sg) => sg.kind === 'face');
  const steadyCams = [], steadyPunches = [];
  if (steady) {
    framings.length = 0;
    const R = G.full, s0 = Math.max(R.w / W, R.h / H), med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const bounds = [...new Set([0, ...camCuts.filter((t) => t > 0.05 && t < D - 0.05), ...(o.joins || []).filter((t) => t > 0.05 && t < D - 0.05), D].map(r3))].sort((a, b) => a - b)
      .filter((t, k, a) => k === 0 || k === a.length - 1 || (t - a[k - 1] >= 0.4)); // a sliver under 0.4 s joins its neighbour
    let alt = 0;
    for (let k = 0; k + 1 < bounds.length; k++) {
      const a = bounds[k], b = bounds[k + 1];
      const cam = k === 0 || camCuts.some((c) => Math.abs(c - a) < 0.3);
      alt = cam ? 0 : 1 - alt;
      if (k > 0) (cam ? steadyCams : steadyPunches).push({ start: a, end: b });
      const fs_ = []; for (let t = a; t < b; t += 0.25) { const f = faceAt(o.track, t + 0.01); if (f) fs_.push(f); }
      const fw = fs_.length ? med(fs_.map((f) => f.fw)) : null;
      const zWide = fw ? clamp((o.fmt === '9x16' ? 0.13 : 0.2) * R.h / (fw * s0), 1, 1.35) : 1;
      const z = zWide * (alt ? 1.12 : 1);
      const cropW = R.w / (s0 * z), cropH = R.h / (s0 * z);
      const at0 = (t) => { const w = fs_.filter((_, j) => a + j * 0.25 >= t - 0.01 && a + j * 0.25 < t + 1); return w.length ? { cx: med(w.map((f) => f.cx)), cy: med(w.map((f) => f.cy)), fw } : null; };
      let cur = at0(a) || fs_[0] || null;
      const keys = [{ t: r3(a), ...frame(W, H, R, cur, z, G.faceY), hold: true }];
      for (let t = a + 0.5; t < b - 0.8; t += 0.5) {
        const f = at0(t);
        if (!f || !cur) continue;
        if (Math.abs(f.cx - cur.cx) > 0.12 * cropW || Math.abs(f.cy - cur.cy) > 0.1 * cropH) {
          const d = Math.min(0.7, b - t - 0.05);
          keys.push({ t: r3(t), ...keys.at(-1), hold: true, from: true });
          cur = f;
          keys.push({ t: r3(t + d), ...frame(W, H, R, cur, z, G.faceY), ease: d });
          t += d;
        }
      }
      framings.push({ seg: { start: a, end: b, kind: 'face' }, R, keys, steady: true });
    }
  }
  // the video element at its natural size; GSAP drives x / y / scale
  el.push(`<div id="spkbox"><video id="spk" src="${o.clip.src}" muted playsinline width="${W}" height="${H}" style="width:${W}px;height:${H}px" data-start="${I}" data-duration="${r3(D)}" data-track-index="0"></video></div>`);
  for (const { seg, R, keys, steady: st } of framings) {
    if (st) { // hard cut in, held; eased re-centres only
      if (seg.start === 0) tw.push(`tl.set('#spkbox',{left:${R.x},top:${R.y},width:${R.w},height:${R.h}},${at(0)});`);
      tw.push(`tl.set('#spk',{x:${keys[0].x},y:${keys[0].y},scale:${keys[0].s}},${at(seg.start)});`);
      for (const k of keys) if (k.ease) tw.push(`tl.to('#spk',{x:${k.x},y:${k.y},scale:${k.s},duration:${r3(k.ease)},ease:'sine.inOut'},${at(r3(k.t - k.ease))});`);
      continue;
    }
    tw.push(`tl.set('#spkbox',{left:${R.x},top:${R.y},width:${R.w},height:${R.h}},${at(seg.start)});`);
    tw.push(`tl.set('#spk',{x:${keys[0].x},y:${keys[0].y},scale:${keys[0].s}},${at(seg.start)});`);
    for (let k = 1; k < keys.length; k++) {
      const a = keys[k - 1], b = keys[k];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.s - b.s) < 0.0005) continue;
      // a camera cut in the source between two keys: the framing cuts with it (no pan across the cut)
      const cut = camCuts.find((c) => c > a.t && c <= b.t);
      if (cut != null) { tw.push(`tl.set('#spk',{x:${b.x},y:${b.y},scale:${b.s}},${at(cut)});`); continue; }
      tw.push(`tl.to('#spk',{x:${b.x},y:${b.y},scale:${b.s},duration:${r3(b.t - a.t)},ease:'none'},${at(a.t)});`);
    }
  }
  // framing lookup (region + the camera key at or before t) and the face in output px at time t (overlay placement)
  const framingAt = (t) => {
    const fr = framings.find((f) => t >= f.seg.start && t < f.seg.end) || framings.at(-1);
    if (!fr) return null;
    return { fr, R: fr.R, k: fr.keys.reduce((p, c) => (c.t <= t ? c : p), fr.keys[0]) };
  };
  const faceOutAt = (t) => {
    const F = framingAt(t);
    if (!F) return null;
    return { ...faceOut(F.R, F.k, faceAt(o.track, t)), kind: F.fr.seg.kind, R: F.R };
  };
  // ---------- entrances (style motion.entrance; house: drop) ----------
  // drop: the house slide from the panel's edge; slide: from the left; fade: a slow fade with a slight settle;
  // flicker: on / off for three frames, then on (a CRT / terminal feel)
  const enter = (sel, s, dropFrom, slideFrom) => {
    if (Th.entrance === 'fade') return `tl.from('${sel}',{opacity:0,scale:1.02,duration:.5,ease:'sine.out'},${s});`;
    if (Th.entrance === 'flicker') return [[0, 0], [1, 1], [2, 0.2], [3, 1], [4, 0.55], [5, 1]].map(([f, v]) => `tl.set('${sel}',{opacity:${v}},${r3(s + f / 30)});`).join('');
    return `tl.from('${sel}',{${Th.entrance === 'slide' ? slideFrom : dropFrom},opacity:0,duration:.28,ease:'power3.out'},${s});`;
  };
  // ---------- top-box panels ----------
  const P = G.panel, pw = P.w, ph = P.h;
  const pid = (i) => `pn${i}`;
  let pnI = 0;
  const wordTime = (phrase, from = 0) => { const l = locate(o.words, phrase, from); return l ? l.start : null; };
  for (const b of beats.filter((x) => TOPBOX.has(x.type))) {
    const id = pid(pnI++), s = at(b.at), e = at(b.end), d = r3(e - s);
    const big = Math.round(Math.min(pw, ph * 1.4) * 0.085);
    let inner = '';
    if (b.type === 'quote') {
      const qWords = String(b.text).split(/\s+/);
      // each quote word appears when it is spoken (from the anchor on), else staggered
      let from = b.i0 ?? 0; const times = qWords.map((qw) => { const l = locate(o.words, qw, from); if (l && l.start <= b.end + 0.5) { from = l.i0 + 1; return l.start; } return null; });
      inner = `<div style="position:absolute;left:${Math.round(pw * 0.08)}px;top:${Math.round(ph * 0.1)}px;color:${A};opacity:.95" id="${id}q">${icon('quote', { size: Math.round(big * 1.6), stroke: 1.4, color: A })}</div>
<div style="position:absolute;left:${Math.round(pw * 0.1)}px;right:${Math.round(pw * 0.1)}px;top:${Math.round(ph * 0.3)}px;${fontCss(Th, 'display', 800)};font-size:${Math.round(big * 1.05)}px;line-height:1.18">${qWords.map((w, k) => `<span id="${id}w${k}" style="display:inline-block;margin-right:.28em">${esc(w)}</span>`).join('')}</div>
${b.cite ? `<div id="${id}c" style="position:absolute;left:${Math.round(pw * 0.1)}px;bottom:${Math.round(ph * 0.12)}px"><span class="chip" style="background:${A};color:${Th.onA};font-size:${Math.round(big * 0.5)}px">${icon('book', { size: Math.round(big * 0.6), stroke: 2.2, color: Th.onA })}${esc(b.cite)}</span></div>` : ''}`;
      tw.push(`tl.from('#${id}q',{scale:0,rotation:-20,duration:.35,ease:'back.out(2)'},${r3(s + 0.05)});`);
      let last = s + 0.1;
      qWords.forEach((_, k) => { const t = times[k] != null ? Math.max(at(times[k]) - 0.05, last) : last + 0.12; last = r3(t); tw.push(`tl.from('#${id}w${k}',{opacity:0,y:${Math.round(big * 0.5)},duration:.22,ease:'power2.out'},${last});`); });
      if (b.cite) { tw.push(`tl.from('#${id}c',{opacity:0,x:-40,duration:.3,ease:'power2.out'},${r3(s + 0.35)});`); }
    } else if (b.type === 'compare') {
      const rows = b.rows || [];
      const colW = Math.round(pw * 0.38), gx = Math.round(pw * 0.08), top0 = Math.round(ph * 0.12);
      // fit: headers on one line in their column, rows shrink with their count and longest text
      const fitW = (txt, size) => Math.min(size, Math.floor(colW / Math.max(1, String(txt || '').length * 0.68)));
      const hsz = Math.min(fitW(b.left?.title, Math.round(big * 0.95)), fitW(b.right?.title, Math.round(big * 0.95)));
      const longest = Math.max(...rows.flatMap((r) => [String(r.left || '').length, String(r.right || '').length]), 4);
      const rsz0 = Math.round(big * 1.05) * Math.min(1, 3 / Math.max(3, rows.length + 1));
      // <= 2 rows: a cell may wrap to two lines; more rows: one line each
      const rsz = Math.max(Math.round(big * 0.6), Math.min(Math.round(rsz0), Math.floor(colW / ((rows.length > 2 ? longest : Math.ceil(longest / 2) + 2) * 0.62))));
      const rowsTop = top0 + hsz * 3.6, rowsSpan = ph * 0.9 - rowsTop;
      const rowH = Math.round(Math.min(rsz * (rows.length > 2 ? 1.7 : 2.6), rowsSpan / Math.max(1, rows.length)));
      const rows0 = Math.round(rowsTop + (rowsSpan - rowH * rows.length) / 2);
      const head = (side, h) => `<div id="${id}h${side}" style="position:absolute;top:${top0}px;${side === 'L' ? `left:${gx}px` : `right:${gx}px`};width:${colW}px;display:flex;flex-direction:column;align-items:center;gap:12px">
<div style="width:${Math.round(hsz * 2)}px;height:${Math.round(hsz * 2)}px;border-radius:50%;background:${side === 'L' ? Th.A2 : A};display:flex;align-items:center;justify-content:center">${icon(h.icon || iconFor(h.title) || 'sparkles', { size: Math.round(hsz * 1.25), stroke: 2, color: Th.onA })}</div>
<div style="${fontCss(Th, 'display', 900)};font-size:${hsz}px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap">${esc(h.title)}</div></div>`;
      inner = head('L', b.left || {}) + head('R', b.right || {}) +
        `<div id="${id}div" style="position:absolute;left:${Math.round(pw / 2 - 2)}px;top:${top0}px;width:4px;height:${Math.round(ph * 0.76)}px;background:${Th.line(0.35)};transform-origin:50% 0"></div>
<div style="position:absolute;left:${Math.round(pw / 2 - big * 0.55)}px;top:${Math.round(top0 + hsz * 0.55)}px;width:${Math.round(big * 1.1)}px;height:${Math.round(big * 1.1)}px;border-radius:50%;background:${Th.bg};border:3px solid ${Th.line(0.5)};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${Math.round(big * 0.42)}px" id="${id}vs">VS</div>` +
        rows.map((r, k) => {
          const y = rows0 + k * rowH;
          const cell = (side, txt, ic) => `<div id="${id}r${k}${side}" style="position:absolute;top:${y}px;${side === 'L' ? `left:${gx}px` : `right:${gx}px`};width:${colW}px;text-align:center;${fontCss(Th, 'body', 800)};font-size:${rsz}px;line-height:1.1;display:flex;flex-direction:${rows.length > 2 ? 'row' : 'column'};justify-content:center;align-items:center;gap:${rows.length > 2 ? 14 : 6}px;white-space:${rows.length > 2 ? 'nowrap' : 'normal'}">${ic ? icon(ic, { size: Math.round(rsz * (rows.length > 2 ? 1 : 1.3)), stroke: 1.8, color: side === 'L' ? Th.A2 : A }) : ''}<span>${esc(txt)}</span></div>`;
          return cell('L', r.left, r.icons?.[0]) + cell('R', r.right, r.icons?.[1]);
        }).join('');
      tw.push(`tl.from('#${id}hL',{x:-${Math.round(pw * 0.3)},opacity:0,duration:.35,ease:'power3.out'},${r3(s + 0.05)});`);
      tw.push(`tl.from('#${id}hR',{x:${Math.round(pw * 0.3)},opacity:0,duration:.35,ease:'power3.out'},${r3(s + 0.15)});`);
      tw.push(`tl.from('#${id}div',{scaleY:0,duration:.4,ease:'power2.out'},${r3(s + 0.1)});tl.from('#${id}vs',{scale:0,duration:.3,ease:'back.out(2.2)'},${r3(s + 0.3)});`);
      let from = b.i0 ?? 0;
      rows.forEach((r, k) => {
        const lt = Math.max(at(r.at) - 0.05, s + 0.35);
        const rl = locate(o.words, r.right, o.words.findIndex((w) => w.start >= r.at - 0.01));
        const rt = rl && rl.start < b.end ? Math.max(at(rl.start) - 0.05, lt + 0.2) : lt + 0.35;
        from = rl ? rl.i0 : from;
        tw.push(`tl.from('#${id}r${k}L',{opacity:0,y:30,scale:.85,duration:.28,ease:'back.out(1.8)'},${r3(lt)});`);
        tw.push(`tl.from('#${id}r${k}R',{opacity:0,y:30,scale:.85,duration:.28,ease:'back.out(1.8)'},${r3(rt)});`);
        cues.push({ t: r3(lt), sfx: 'click2' }, { t: r3(rt), sfx: 'click2' });
      });
    } else if (b.type === 'list') {
      const items = b.items || [], isz = Math.round(big * 0.95), tsz = Math.round(big * 0.8);
      const gy = Math.round((ph * 0.62) / Math.max(3, items.length));
      inner = `<div id="${id}t" style="position:absolute;left:${Math.round(pw * 0.08)}px;top:${Math.round(ph * 0.1)}px"><span class="chip" style="background:${A};color:${Th.onA};font-size:${tsz}px">${esc(b.title || '')}</span></div>` +
        items.map((it, k) => `<div id="${id}i${k}" style="position:absolute;left:${Math.round(pw * 0.08)}px;right:${Math.round(pw * 0.06)}px;top:${Math.round(ph * 0.28 + k * gy)}px;display:flex;align-items:center;gap:22px;${fontCss(Th, 'body', 800)};font-size:${isz}px">${icon('check', { size: Math.round(isz * 1.2), stroke: 2, color: A })}<span>${esc(it.text)}</span></div>`).join('');
      tw.push(`tl.from('#${id}t',{opacity:0,x:-60,duration:.3,ease:'power2.out'},${r3(s + 0.05)});`);
      items.forEach((it, k) => { const t = r3(Math.max(at(it.at) - 0.05, s + 0.2 + k * 0.15)); tw.push(`tl.from('#${id}i${k}',{opacity:0,x:-80,duration:.3,ease:'power3.out'},${t});`); cues.push({ t, sfx: 'click2' }); });
    } else { // card
      const tsz = Math.round(big * 1.05);
      inner = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(big * 0.6)}px;padding:0 ${Math.round(pw * 0.08)}px;text-align:center">
<div id="${id}ic" style="width:${Math.round(big * 3)}px;height:${Math.round(big * 3)}px;border-radius:50%;background:${A};display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 10px ${Th.line(0.12)}">${icon(b.icon || 'sparkles', { size: Math.round(big * 1.9), stroke: 1.8, color: Th.onA })}</div>
<div id="${id}tt" style="${fontCss(Th, 'display', 900)};font-size:${tsz}px;line-height:1.08;text-transform:uppercase">${String(b.title || '').split(/\s+/).map((w, k) => `<span id="${id}tw${k}" style="display:inline-block;margin:0 .15em">${esc(w)}</span>`).join('')}</div>
${b.sub ? `<div id="${id}sb" style="font-weight:600;font-size:${Math.round(big * 0.6)}px;opacity:.88">${esc(b.sub)}</div>` : ''}</div>`;
      tw.push(`tl.from('#${id}ic',{scale:0,rotation:-25,duration:.45,ease:'back.out(2)'},${r3(s + 0.05)});`);
      String(b.title || '').split(/\s+/).forEach((_, k) => tw.push(`tl.from('#${id}tw${k}',{opacity:0,y:50,duration:.3,ease:'power3.out'},${r3(s + 0.25 + k * 0.09)});`));
      if (b.sub) tw.push(`tl.from('#${id}sb',{opacity:0,duration:.4},${r3(s + 0.7)});`);
    }
    el.push(`<div id="${id}" class="panel clip" data-start="${s}" data-duration="${d}" data-track-index="2" style="left:${P.x}px;top:${P.y}px;width:${pw}px;height:${ph}px"><div class="grid"></div>${inner}<div class="edge"></div></div>`);
    if (G.seamY) el.push(`<div id="${id}s" class="seam clip" data-start="${s}" data-duration="${d}" data-track-index="3" style="top:${P.y + ph}px;height:${G.split.y - (P.y + ph)}px"></div>`);
    tw.push(enter(`#${id}`, s, o.fmt === '9x16' ? `y:-${Math.round(ph * 0.25)}` : `x:-${Math.round(pw * 0.25)}`, `x:-${Math.round(pw * 0.25)}`));
    cues.push({ t: r3(s - 0.08), sfx: 'whoosh_low' });
  }
  // ---------- icon / stat pops ----------
  let popI = 0; const boxes = [];
  // the lower third owns the opening seconds: a pop that would overlap it is skipped
  const ltOn = o.lowerThird !== false && (o.speaker?.name || o.title);
  for (const b of beats.filter((x) => x.type === 'icon' || x.type === 'stat')) {
    if (ltOn && b.at < 4.4 && b.end > 0.5) continue;
    const id = `pp${popI++}`, s = at(b.at), e = at(b.end), f = faceOutAt(b.at + 0.2);
    const disc = o.fmt === '9x16' ? 190 : 150;
    const Z = G.popZone;
    // beside the head, on the side with more room; vertically at eye level
    let side = 1, cx = G.w * 0.75, cy = Z.y0 + 120;
    if (SCREEN) { cx = G.w * 0.8; cy = o.fmt === '9x16' ? 380 : 150; }
    else if (f && f.cx != null) {
      side = f.cx < G.w / 2 ? 1 : -1;
      cx = f.cx + side * (f.fw * 0.75 + disc * 0.85);
      cy = f.cy - f.fw * 0.2;
      if (cx < Z.x0 + disc / 2 || cx > Z.x1 - disc / 2) { side = -side; cx = f.cx + side * (f.fw * 0.75 + disc * 0.85); }
    }
    cx = clamp(cx, Z.x0 + disc / 2, Z.x1 - disc / 2); cy = clamp(cy, Z.y0 + disc / 2, Z.y1 - disc / 2);
    const labSize = o.fmt === '9x16' ? 40 : 32;
    // stat value: the style's number treatment (house: static in the disc)
    const nf = b.type === 'stat' ? numberFrames(b.value, Th.numbers, popI) : null;
    const statLook = { 'count-up': `background:${Th.hookBg};color:${A};border-bottom:8px solid ${A};box-shadow:0 10px 30px rgba(0,0,0,.35)`, scramble: `background:${Th.hookBg};color:${A};border:3px solid ${A};box-shadow:0 0 26px ${rgba(A, 0.45)};text-shadow:0 0 14px ${rgba(A, 0.7)}` }[Th.numbers] || `color:${Th.onA}`;
    const numHtml = nf?.frames.length
      ? `<span class="numbox"><span class="sizer">${esc(b.value)}</span>${nf.frames.map((fr, k) => `<span class="nv" id="${id}v${k}">${esc(fr.text)}</span>`).join('')}</span>`
      : `<span class="num" style="display:inline-block">${esc(b.value)}</span>`;
    const body = b.type === 'stat'
      ? `<div class="disc" style="width:${Math.round(disc * 1.25)}px;height:${Math.round(disc * 1.25)}px;border-radius:28px;${statLook};${fontCss(Th, 'numbers', 900)};font-size:${Math.round(disc * 0.42)}px">${numHtml}</div>`
      : `<div class="disc" style="width:${disc}px;height:${disc}px">${icon(b.icon, { size: Math.round(disc * 0.62), stroke: 1.9, color: Th.onA })}</div>`;
    const label = b.label ? `<div class="lab" style="font-size:${labSize}px">${esc(b.label)}</div>` : '';
    boxes.push({ kind: b.type, s, e, x: cx - disc * 0.7, y: cy - disc / 2, w: disc * 1.4, h: disc + (b.label ? labSize + 30 : 0) });
    el.push(`<div id="${id}" class="pop clip" data-start="${s}" data-duration="${r3(e - s)}" data-track-index="7" style="left:${Math.round(cx - disc)}px;top:${Math.round(cy - disc / 2)}px;width:${disc * 2}px">${body}${label}</div>`);
    if (Th.entrance === 'slide' || Th.entrance === 'fade') tw.push(`tl.from('#${id}',{${Th.entrance === 'slide' ? `x:${side * 140}` : 'y:30'},opacity:0,duration:${Th.entrance === 'fade' ? '.45' : '.3'},ease:'power3.out'},${s});`);
    else if (Th.entrance === 'flicker') tw.push(enter(`#${id}`, s));
    else tw.push(`tl.fromTo('#${id}',{scale:0,rotation:${side * -18}},{scale:1.12,rotation:0,duration:.2,ease:'power2.out'},${s});tl.to('#${id}',{scale:1,duration:.12,ease:'power1.inOut'},${r3(s + 0.2)});`);
    tw.push(`tl.to('#${id}',{y:-14,duration:${r3(Math.max(0.3, e - s - 0.5))},ease:'sine.inOut'},${r3(s + 0.32)});tl.to('#${id}',{scale:0,opacity:0,duration:.16,ease:'power2.in'},${r3(e - 0.16)});`);
    if (nf?.frames.length) nf.frames.forEach((fr, k) => { tw.push(`tl.set('#${id}v${k}',{visibility:'visible'},${r3(s + fr.t)});`); if (k) tw.push(`tl.set('#${id}v${k - 1}',{visibility:'hidden'},${r3(s + fr.t)});`); });
    if (b.type === 'stat' && Th.numbers === 'slam') {
      // slam: the value drops in from 3x, then the whole pop takes the hit (a 4-frame shake)
      tw.push(`tl.fromTo('#${id} .num',{scale:3,opacity:0},{scale:1,opacity:1,duration:.16,ease:'power4.in',immediateRender:false},${r3(s + 0.06)});`);
      [[12, 0], [-9, 1], [5, 2], [0, 3]].forEach(([x, f]) => tw.push(`tl.set('#${id}',{x:${x}},${r3(s + 0.22 + f / 30)});`));
      cues.push({ t: r3(s + 0.2), sfx: 'tap' });
    }
    cues.push({ t: s, sfx: b.type === 'stat' ? 'click' : 'tap' });
  }
  // ---------- lower third ----------
  const lt = o.lowerThird !== false && (o.speaker?.name || o.title);
  if (lt) {
    const name = o.speaker?.name || o.title, role = o.speaker?.name ? (o.speaker.role || '') : (o.subtitle || '');
    const firstSplit = segs.find((s) => s.kind === 'split');
    let ls = 0.6, le = Math.min(D - 0.5, 4.2);
    if (firstSplit && firstSplit.start < le) le = Math.max(ls + 1.5, firstSplit.start - 0.1);
    if (le - ls >= 1.5) {
      const nsz = o.fmt === '9x16' ? 54 : 44, rsz = o.fmt === '9x16' ? 34 : 28;
      const f = faceOutAt(ls + 0.5);
      // under the face, clear of the caption band (captions sit lower)
      let ly = G.lower.y; if (f?.cy) ly = clamp(f.cy + f.fw * 1.4, G.lower.y - 200, G.lower.y);
      boxes.push({ kind: 'lower-third', s: at(ls), e: at(le), x: G.lower.x, y: ly, w: G.w * 0.6, h: nsz * 1.3 + (role ? rsz * 1.4 : 0) + 32 });
      el.push(`<div id="lt" class="lower clip" data-start="${at(ls)}" data-duration="${r3(le - ls)}" data-track-index="8" style="left:${G.lower.x}px;top:${Math.round(ly)}px"><div class="bar" id="ltb"></div><div class="txt" id="ltt"><div class="n" style="font-size:${nsz}px">${esc(name)}</div>${role ? `<div class="r" style="font-size:${rsz}px">${esc(role)}</div>` : ''}</div></div>`);
      tw.push(`tl.from('#ltb',{scaleY:0,duration:.25,ease:'power2.out'},${at(ls)});tl.from('#ltt',{clipPath:'inset(0 100% 0 0)',duration:.4,ease:'power3.out'},${r3(at(ls) + 0.12)});tl.to('#lt',{opacity:0,x:-40,duration:.25,ease:'power2.in'},${r3(at(le) - 0.25)});`);
      cues.push({ t: at(ls), sfx: 'whoosh' });
    }
  }
  // ---------- lower thirds for named people (shorts: when each is first on screen; [{name, role, start, end}]) ----------
  (o.lowerThirds || []).forEach((L, k) => {
    const ls = Math.max(0.2, L.start), le = Math.min(D - 0.3, L.end);
    if (le - ls < 1.5) return;
    const nsz = o.fmt === '9x16' ? 54 : 44, rsz = o.fmt === '9x16' ? 34 : 28;
    const f = faceOutAt(ls + 0.3);
    let ly = G.lower.y; if (f?.cy) ly = clamp(f.cy + f.fw * 1.3, G.lower.y - 200, G.lower.y + 120);
    boxes.push({ kind: 'lower-third', s: at(ls), e: at(le), x: G.lower.x, y: ly, w: G.w * 0.7, h: nsz * 1.3 + (L.role ? rsz * 1.4 : 0) + 32 });
    el.push(`<div id="lt${k}" class="lower clip" data-start="${at(ls)}" data-duration="${r3(le - ls)}" data-track-index="8" style="left:${G.lower.x}px;top:${Math.round(ly)}px"><div class="bar" id="lt${k}b"></div><div class="txt" id="lt${k}t"><div class="n" style="font-size:${nsz}px">${esc(L.name)}</div>${L.role ? `<div class="r" style="font-size:${rsz}px">${esc(L.role)}</div>` : ''}</div></div>`);
    tw.push(`tl.from('#lt${k}b',{scaleY:0,duration:.25,ease:'power2.out'},${at(ls)});tl.from('#lt${k}t',{clipPath:'inset(0 100% 0 0)',duration:.4,ease:'power3.out'},${r3(at(ls) + 0.12)});tl.to('#lt${k}',{opacity:0,x:-40,duration:.25,ease:'power2.in'},${r3(at(le) - 0.25)});`);
  });
  // ---------- style signature moves: which punch-ins get one (spaced by minBeatGap; drawn after the captions) ----------
  const sigHits = [];
  if (Th.signature) {
    let last = -Infinity;
    for (const sg of [...segs.filter((x) => x.kind === 'punch'), ...steadyPunches].sort((a, b) => a.start - b.start)) {
      if (sg.start - last < Math.max(Th.minGap, 1.5) || sg.end - sg.start < 0.6) continue;
      last = sg.start;
      sigHits.push({ start: sg.start, end: Math.min(sg.end, sg.start + 4) }); // a signature holds 4 s at most
    }
  }
  // letterbox bars: captions in their window sit above the bottom bar, never across its edge
  const LB = Th.signature === 'letterbox' ? { h: Math.round(G.h * (o.fmt === '16x9' ? 0.11 : 0.085)), wins: sigHits } : null;
  const underBar = (t0, t1) => LB && LB.wins.some((w) => t0 < w.end && t1 > w.start);
  // ---------- captions ----------
  // house: kinetic (1-2 word pops, key words in the accent) or minimal (the clean-cut look); a style pack: its own
  // font, case, grouping, highlight and animation. Every caption picks light or dark text from the footage behind
  // it (auto contrast: o.luma), unless o.ink / the pack fixes the colour.
  const capStyle = o.captions || 'kinetic';
  const capsOut = [], inkCount = { light: 0, dark: 0 };
  // what is behind a caption rect (output px) from t0 to t1 (clip time): footage stats blended with the backdrop
  // colour for the part of the rect that is not over the picture; null = unknown (no luma grid)
  const behind = (t0, t1, rect) => {
    const fr = framingAt((t0 + t1) / 2);
    if (!fr) return { lum: relLum(Th.house ? '#0b1020' : Th.bg), std: 0 };
    const { R, k } = fr;
    const vx0 = Math.max(R.x, R.x + k.x), vy0 = Math.max(R.y, R.y + k.y), vx1 = Math.min(R.x + R.w, R.x + k.x + W * k.s), vy1 = Math.min(R.y + R.h, R.y + k.y + H * k.s);
    const ix0 = Math.max(rect.x, vx0), iy0 = Math.max(rect.y, vy0), ix1 = Math.min(rect.x + rect.w, vx1), iy1 = Math.min(rect.y + rect.h, vy1);
    const share = ix1 > ix0 && iy1 > iy0 ? ((ix1 - ix0) * (iy1 - iy0)) / Math.max(1, rect.w * rect.h) : 0;
    const back = Th.house ? '#0b1020' : Th.bg;
    if (share < 0.05) return blendBackdrop(null, back, 0);
    if (!o.luma) return null;
    const st = regionStats(o.luma, t0, t1, { x: (ix0 - R.x - k.x) / k.s, y: (iy0 - R.y - k.y) / k.s, w: (ix1 - ix0) / k.s, h: (iy1 - iy0) / k.s });
    return st ? blendBackdrop(st, back, share) : null;
  };
  const inkMode = o.ink || 'auto';
  const inkFor = (bg, prev) => {
    const fixed = /^#/.test(inkMode) ? inkMode : (inkMode === 'auto' && Th.cap && Th.cap.color !== 'auto' ? Th.cap.color : null);
    if (fixed) return { kind: relLum(fixed) > 0.18 ? 'light' : 'dark', fill: fixed };
    if (inkMode === 'light' || inkMode === 'dark') return { kind: inkMode };
    return { kind: pickInk(bg?.lum ?? null, { prev }) };
  };
  if (capStyle !== 'none') {
    const C = Th.cap;
    const kin = !C && capStyle === 'kinetic';
    const base = JSON.parse(fs.readFileSync(path.join(REPO, kin || C ? 'easy-edits/presets/captions-default.json' : 'easy-edits/styles/clean-cut/captions.json'), 'utf8'));
    if (C) base.grouping = { ...base.grouping, maxWords: C.maxWords, maxChars: C.maxChars, maxGap: C.maxWords > 3 ? 0.5 : base.grouping.maxGap };
    const one = C ? C.maxChars <= 18 : kin; // one line in the kinetic band, else up to two lines in the lower band
    // never let a caption group straddle a layout cut
    const cutsAt = segs.map((s) => s.start).filter((t) => t > 0);
    let caps = captionGroups(o.words, { duration: D, p: base });
    caps = caps.flatMap((c) => {
      const cut = cutsAt.find((t) => t > c.words[0].start + 0.01 && t < c.words.at(-1).end - 0.01 && c.words.some((w) => w.start >= t));
      if (!cut || c.words.length < 2) return [c];
      const a = c.words.filter((w) => w.start < cut), b = c.words.filter((w) => w.start >= cut);
      return [{ ...c, words: a, text: a.map((w) => w.text).join(' '), end: r3(cut), lastEnd: a.at(-1).end }, { ...c, words: b, text: b.map((w) => w.text).join(' '), start: r3(cut), lastEnd: b.at(-1).end }];
    });
    const trim = new RegExp(base.trimPunctuation || '[,.;:]+$');
    const emph = new Set();
    for (const b of beats) { for (const k of ['anchor']) if (b[k] && (b.type === 'icon' || b.type === 'stat')) norm(b[k]).split(' ').forEach((x) => emph.add(x)); if (b.type === 'compare') { emph.add(norm(b.left?.title || '')); emph.add(norm(b.right?.title || '')); } }
    const key = (w) => emph.has(norm(w.text)) || /\d/.test(w.text);
    let prevInk = null;
    caps.forEach((c, i) => {
      const t0 = c.words[0].start + 0.02; // the spoken start: a caption leads its word by 2 frames, never into another layout
      const lay = segs.find((s) => t0 >= s.start && t0 < s.end) || segs.at(-1);
      const f = faceOutAt(t0);
      let y, size = C ? Math.round((C.size * G.capSize) / 96) : (kin ? G.capSize : G.minSize), box = one ? G.capBox : G.minBox, left = Math.round((G.w - box) / 2);
      if (lay?.kind === 'split') {
        if (G.seamY) y = G.seamY;
        else { y = G.h - 150; box = Math.min(box, G.split.w - 40); left = Math.round(G.split.x + (G.split.w - box) / 2); size = Math.round(size * 0.85); }
      } else {
        y = one ? G.capY : G.minY;
        if (SCREEN) y = G.screenCapY;
        else if (f?.cy) { const chin = f.cy + f.fw * 0.8; if (chin + size * 0.9 > y) y = chin + size * 0.9; }
        if (!SCREEN) y = clamp(y, G.capMinY, G.capMaxY);
      }
      const lines = one ? 1 : Math.max(1, Math.ceil((c.text.length * size * 0.55) / box));
      const ch = size * (one ? 1.05 : 1.18) * lines;
      if (underBar(c.start, c.end)) y = Math.min(y, G.h - LB.h - 16 - ch / 2);
      // auto contrast: what the text will sit on (its estimated width, not the whole caption box)
      const tw0 = Math.min(box, (c.text.length * size * ((C ? C.case === 'upper' : kin) ? 0.72 : 0.58)) / lines);
      const bg = behind(c.start, c.end, { x: left + (box - tw0) / 2, y: y - ch / 2, w: tw0, h: ch });
      const ink = inkFor(bg, prevInk); prevInk = ink.kind; inkCount[ink.kind]++;
      const busy = isBusy(bg);
      let hl = null;
      if (C) {
        hl = C.highlight === 'none' ? null : C.highlightStyle;
        // the accent would vanish into this background (yellow on a white wall): the accent box instead
        if ((hl === 'color' || hl === 'glow') && bg && contrastRatio(A, bg.lum) < 3) hl = 'box';
      }
      const cls = ['cap', 'clip', C ? `sp ${one ? 'one' : 'wrap'}${hl ? ` hl-${hl}` : ''}${C.animation === 'type' ? ' type' : ''}` : (kin ? 'kin' : 'min'), `ink-${ink.kind}`, busy ? 'busy' : ''].filter(Boolean).join(' ');
      const wt = (w, k) => { let t = w.text; if (k === c.words.length - 1) t = t.replace(trim, ''); return t; };
      let txt;
      if (C) txt = c.words.map((w, k) => `<span class="w" id="cap${i}w${k}">${esc(wt(w, k))}</span>`).join(' ');
      else txt = c.words.map((w, k) => { const e = esc(wt(w, k)); return kin && emph.has(norm(w.text)) ? `<em>${e}</em>` : e; }).join(' ');
      const fill = ink.fill ? (C ? `--ink:${ink.fill};` : '') : '';
      el.push(`<div id="cap${i}" class="${cls}" data-start="${at(c.start)}" data-duration="${r3(c.end - c.start)}" data-track-index="4" style="left:${left}px;width:${box}px;top:${Math.round(y)}px;${fill}"><span class="l" style="font-size:${size}px;max-width:${box}px${ink.fill && !C ? `;color:${ink.fill}` : ''}">${txt}</span></div>`);
      if (kin || C?.animation === 'pop') tw.push(`tl.fromTo('#cap${i} span.l',{scale:0},{scale:1.1,duration:.12,ease:'power2.out',immediateRender:${c.start <= 0}},${at(c.start)});tl.to('#cap${i} span.l',{scale:1,duration:.08,ease:'power1.inOut'},${r3(at(c.start) + 0.125)});`);
      else if (C?.animation === 'fade-up') tw.push(`tl.fromTo('#cap${i} span.l',{opacity:0,y:${Math.round(size * 0.35)}},{opacity:1,y:0,duration:.22,ease:'power2.out',immediateRender:${c.start <= 0}},${at(c.start)});`);
      if (C) {
        // word timing on the caption: typed on, lit while spoken (active-word) or from when spoken (keywords)
        const wOn = (k) => r3(Math.max(at(c.start), at(c.words[k].start) - 0.03));
        c.words.forEach((w, k) => {
          if (C.animation === 'type') tw.push(`tl.to('#cap${i}w${k}',{opacity:1,duration:.05},${wOn(k)});`);
          if (C.highlight === 'active-word') {
            tw.push(`tl.set('#cap${i}w${k}',{attr:{class:'w on'}},${wOn(k)});`);
            if (k + 1 < c.words.length) tw.push(`tl.set('#cap${i}w${k}',{attr:{class:'w'}},${wOn(k + 1)});`);
          } else if (C.highlight === 'keywords' && key(w)) {
            if (hl === 'underline') tw.push(`tl.to('#cap${i}w${k}',{backgroundSize:'100% .12em',duration:.3,ease:'power2.out'},${wOn(k)});`);
            else tw.push(`tl.set('#cap${i}w${k}',{attr:{class:'w on'}},${wOn(k)});`);
          }
        });
      }
      capsOut.push({ i, start: at(c.start), end: at(c.end), text: c.words.map((w) => w.text).join(' '), y: Math.round(y), size, box, left, layout: lay?.kind, ink: ink.kind, ...(ink.fill ? { fill: ink.fill } : {}), bgLum: bg ? r3(bg.lum) : null, busy, ...(hl ? { highlight: hl } : {}), rect: { x: left, y: y - ch / 2, w: box, h: ch }, face: !SCREEN && f?.cy ? { x: f.cx - f.fw / 2, y: f.cy - f.fw * 0.6, w: f.fw, h: f.fw * 1.35 } : null });
    });
  }
  // ---------- hook title (shorts): the opener as a headline for the first seconds ----------
  if (o.hook) {
    const hd = r3(Math.min(3.2, D - 0.2)), hs = o.fmt === '9x16' ? 64 : 52;
    const hy = o.fmt === '9x16' ? 300 : 70;
    el.push(`<div id="hook" class="clip" data-start="${I}" data-duration="${hd}" data-track-index="13" style="position:absolute;z-index:25;left:${Math.round(G.w * 0.07)}px;width:${Math.round(G.w * 0.86)}px;top:${hy}px;display:flex;justify-content:center"><div id="hookb" style="background:${A};color:${Th.onA};${fontCss(Th, 'display', 900)};font-size:${hs}px;line-height:1.1;text-transform:uppercase;text-align:center;padding:18px 30px;border-radius:18px;box-shadow:0 12px 30px rgba(0,0,0,.45)">${esc(o.hook)}</div></div>`);
    tw.push(`tl.fromTo('#hookb',{scale:.6,opacity:0,rotation:-3},{scale:1,opacity:1,rotation:0,duration:.3,ease:'back.out(2)'},${r3(I + 0.02)});tl.to('#hookb',{scale:.85,opacity:0,y:-30,duration:.22,ease:'power2.in'},${r3(I + hd - 0.22)});`);
    cues.push({ t: r3(I + 0.02), sfx: 'whoosh' });
  }
  // ---------- hook card (shorts --hook): big text over the first 3 s, in the caption family (Montserrat), in the
  // band above the face (else between chin and captions), never over the face; words rise in, the card lifts out
  if (o.hookCard) {
    const hd = r3(Math.min(3.0, D - 0.3)), bw = Math.round(G.w * 0.86);
    const words = String(o.hookCard).trim().split(/\s+/);
    // the largest size (104 -> 60 px) whose greedy wrap fits 3 lines AND the band above the face (from y 150, under
    // the platform's top bar, to 40 px over the hair); no size fits there: the largest one, under the chin
    const f = faceOutAt(0.6), top = f?.cy ? f.cy - f.fw * 0.75 : G.h * 0.3, chin = f?.cy ? f.cy + f.fw * 0.85 : G.h * 0.45;
    const band0 = o.fmt === '9x16' ? 150 : 40, bandH = top - 40 - band0;
    const wrap = (hs) => { const per = Math.floor((bw - 80) / (hs * 0.62)), L = []; for (const w of words) { const l = L.at(-1); if (l && (l + ' ' + w).length <= per) L[L.length - 1] = l + ' ' + w; else L.push(w); } return L.length <= 3 && L.every((l) => l.length <= per) ? L : null; };
    const fits = [];
    for (let z = o.fmt === '9x16' ? 104 : 80; z >= 60; z -= 4) { const L = wrap(z); if (L) fits.push({ hs: z, lines: L, ch: Math.round(L.length * z * 1.08 + 70) }); }
    const pickF = fits.find((x) => x.ch <= bandH) || fits[0] || { hs: 60, lines: [words.join(' ')], ch: 135 };
    const { hs, lines, ch } = pickF;
    let hy = pickF.ch <= bandH ? Math.round(Math.max(band0, top - 40 - ch)) : Math.round(Math.min(chin + 40, (o.fmt === '9x16' ? G.minY - 110 : G.h - 160) - ch));
    boxes.push({ kind: 'hook', s: I, e: r3(I + hd), x: (G.w - bw) / 2, y: hy, w: bw, h: ch });
    let wi = 0;
    const html = lines.map((l) => `<div>${l.split(' ').map((w) => `<span class="hw" id="hw${wi++}" style="display:inline-block;margin:0 .13em">${esc(w)}</span>`).join('')}</div>`).join('');
    el.push(`<div id="hookc" class="clip" data-start="${I}" data-duration="${hd}" data-track-index="13" style="position:absolute;z-index:25;left:${Math.round((G.w - bw) / 2)}px;width:${bw}px;top:${hy}px;display:flex;justify-content:center"><div id="hookcb" style="position:relative;background:${Th.hookBg};border-radius:26px;padding:30px 36px 34px;text-align:center;${fontCss(Th, 'display', 800)};font-size:${hs}px;line-height:1.08;color:${Th.hookFg};letter-spacing:-.01em;box-shadow:0 18px 40px rgba(0,0,0,.45)">${html}<div id="hookcu" style="position:absolute;left:36px;right:36px;bottom:16px;height:8px;border-radius:4px;background:${A};transform-origin:0 50%"></div></div></div>`);
    tw.push(`tl.fromTo('#hookcb',{opacity:0,y:40,scale:.94},{opacity:1,y:0,scale:1,duration:.32,ease:'back.out(1.6)'},${r3(I + 0.02)});`);
    for (let k = 0; k < wi; k++) tw.push(`tl.fromTo('#hw${k}',{opacity:0,y:${Math.round(hs * 0.35)}},{opacity:1,y:0,duration:.24,ease:'power3.out'},${r3(I + 0.08 + k * 0.06)});`);
    tw.push(`tl.fromTo('#hookcu',{scaleX:0},{scaleX:1,duration:.45,ease:'power2.out'},${r3(I + 0.2 + wi * 0.06)});tl.to('#hookcb',{opacity:0,y:-36,duration:.28,ease:'power2.in'},${r3(I + hd - 0.3)});`);
  }
  // ---------- topic header over a 9:16 screen recording (the band above the screen window) ----------
  if (SCREEN && o.fmt === '9x16' && o.title) {
    el.push(`<div id="topic" class="clip" data-start="${I}" data-duration="${r3(D)}" data-track-index="14" style="position:absolute;z-index:3;left:0;width:${G.w}px;top:${G.screen.y - 170}px;display:flex;justify-content:center"><span class="chip" style="background:${Th.line(0.1)};border:2px solid ${A};color:${Th.text};font-size:44px">${esc(o.title)}</span></div>`);
    tw.push(`tl.from('#topic',{opacity:0,y:-20,duration:.35,ease:'power2.out'},${r3(I + 0.1)});`);
  }
  // ---------- progress bar ----------
  if (o.progress !== false) {
    el.push(`<div id="progbg" class="clip" data-start="${I}" data-duration="${r3(D)}" data-track-index="9"></div><div id="prog" class="clip" data-start="${I}" data-duration="${r3(D)}" data-track-index="10"></div>`);
    tw.push(`tl.fromTo('#prog',{scaleX:0},{scaleX:1,duration:${r3(D)},ease:'none'},${I});`);
  }
  // ---------- intro / end cards ----------
  const tsz = o.fmt === '16x9' ? 120 : (o.fmt === '1x1' ? 104 : 118);
  const titleWords = String(o.title || '').split(/\s+/).filter(Boolean);
  if (I > 0) {
    el.push(`<div id="intro" class="card clip" data-start="0" data-duration="${I}" data-track-index="11"><div class="grid"></div>
<div class="ttl" style="font-size:${tsz}px;max-width:${G.w * 0.86}px">${titleWords.map((w, k) => `<span class="w" id="it${k}">${esc(w)}</span>`).join(' ')}</div>
<div class="bar" id="ib" style="width:${Math.round(G.w * 0.3)}px"></div>
${o.subtitle ? `<div class="sub" id="is" style="font-size:${Math.round(tsz * 0.36)}px;max-width:${G.w * 0.8}px">${esc(o.subtitle)}</div>` : ''}</div>`);
    // frame 0 is already in motion: the words start mid-rise, the grid drifts
    titleWords.forEach((_, k) => tw.push(`tl.fromTo('#it${k}',{y:${Math.round(tsz * 0.9)},opacity:0.15,scale:.92},{y:0,opacity:1,scale:1,duration:.42,ease:'power3.out'},${r3(k * 0.08)});`));
    tw.push(`tl.fromTo('#ib',{scaleX:0.05},{scaleX:1,duration:.5,ease:'power3.out'},0.12);`);
    if (o.subtitle) tw.push(`tl.fromTo('#is',{opacity:0,y:20},{opacity:.9,y:0,duration:.35},${r3(Math.min(I - 0.5, 0.45))});`);
    tw.push(`tl.fromTo('#intro .grid',{backgroundPosition:'0px 0px'},{backgroundPosition:'0px -60px',duration:${I},ease:'none'},0);`);
    tw.push(`tl.to('#intro .ttl',{scale:1.06,duration:${r3(I - 0.5)},ease:'none'},0.5);`);
    cues.push({ t: 0, sfx: 'whoosh' }, { t: r3(I - 0.2), sfx: 'whoosh' });
  }
  if (O > 0) {
    const os = at(D);
    el.push(`<div id="outro" class="card clip" data-start="${os}" data-duration="${O}" data-track-index="11"><div class="grid"></div>
<div class="ttl" style="font-size:${Math.round(tsz * 0.82)}px;max-width:${G.w * 0.86}px">${titleWords.map((w, k) => `<span class="w" id="ot${k}">${esc(w)}</span>`).join(' ')}</div>
<div class="bar" id="ob" style="width:${Math.round(G.w * 0.22)}px"></div>
<div class="sub" id="oc" style="font-size:${Math.round(tsz * 0.4)}px;font-weight:800">${esc(o.cta || 'Thanks for watching')}</div>
${o.watermark ? `<div class="sub" id="oh" style="font-size:${Math.round(tsz * 0.34)}px;color:${A};font-weight:800;margin-top:18px">${esc(o.watermark)}</div>` : ''}</div>`);
    tw.push(`tl.from('#outro',{opacity:0,duration:.25},${os});`);
    titleWords.forEach((_, k) => tw.push(`tl.from('#ot${k}',{y:60,opacity:0,duration:.4,ease:'power3.out'},${r3(os + 0.1 + k * 0.07)});`));
    tw.push(`tl.from('#ob',{scaleX:0,duration:.45,ease:'power3.out'},${r3(os + 0.25)});tl.from('#oc',{opacity:0,y:24,duration:.35},${r3(os + 0.45)});`);
    if (o.watermark) tw.push(`tl.from('#oh',{opacity:0,duration:.35},${r3(os + 0.7)});`);
    tw.push(`tl.to('#outro .ttl',{scale:1.04,duration:${r3(O - 0.3)},ease:'none'},${r3(os + 0.3)});`);
    cues.push({ t: r3(os - 0.15), sfx: 'whoosh' }, { t: r3(os + 0.45), sfx: 'shimmer' });
  }
  if (o.watermark && o.watermarkCorner !== false) {
    const wsz = o.fmt === '9x16' ? 30 : 26;
    el.push(`<div class="wm clip" data-start="${I}" data-duration="${r3(D)}" data-track-index="12" style="right:${o.fmt === '9x16' ? 40 : 34}px;top:${o.fmt === '9x16' ? 150 : 30}px;font-size:${wsz}px">${esc(o.watermark)}</div>`);
  }
  // ---------- style transitions: at every layout change, speaker / camera change and card edge ----------
  // whip: a skewed accent smear crosses the frame while the picture blurs; dip: through the background colour;
  // glitch: RGB slices, a jitter and a colour shift for a few frames. House: hard cuts (none of this).
  let txN = 0, sgN = 0;
  if (Th.transition !== 'cut' && Th.tDur > 0) {
    const tts = [...segs.slice(1).map((sg) => at(sg.start)), ...steadyCams.map((sg) => at(sg.start)), ...(I > 0 ? [I] : []), ...(O > 0 ? [at(D)] : [])]
      .filter((t) => t > 0.15 && t < T - 0.15).sort((a, b) => a - b).filter((t, k, a) => k === 0 || t - a[k - 1] > 0.6);
    let seed = 7;
    const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    if (Th.transition === 'whip' && tts.length) tw.push(`tl.set('#spkbox',{filter:'blur(0px)'},0);`);
    for (const t of tts) {
      const d = Th.tDur, t0 = r3(Math.max(0, t - d / 2)), id = `tx${txN++}`;
      if (Th.transition === 'whip') {
        el.push(`<div id="${id}" class="clip" data-start="${t0}" data-duration="${r3(d)}" data-track-index="15" style="position:absolute;z-index:35;left:0;top:-10%;width:${G.w * 2}px;height:120%;background:linear-gradient(90deg,transparent 0%,${rgba(A, 0)} 15%,${rgba(A, 0.9)} 42%,${rgba(Th.bg, 0.95)} 58%,transparent 85%);transform:skewX(-16deg)"></div>`);
        tw.push(`tl.fromTo('#${id}',{x:${-G.w * 2}},{x:${G.w},duration:${r3(d)},ease:'power2.inOut',immediateRender:false},${t0});`);
        tw.push(`tl.to('#spkbox',{filter:'blur(14px)',duration:${r3(d / 2)},ease:'power1.in'},${t0});tl.to('#spkbox',{filter:'blur(0px)',duration:${r3(d / 2)},ease:'power1.out'},${r3(t0 + d / 2)});`);
        cues.push({ t: r3(Math.max(0, t0 - 0.05)), sfx: 'whoosh' });
      } else if (Th.transition === 'dip') {
        el.push(`<div id="${id}" class="clip" data-start="${t0}" data-duration="${r3(d)}" data-track-index="15" style="position:absolute;inset:0;z-index:18;background:${Th.bg};opacity:0"></div>`);
        tw.push(`tl.to('#${id}',{opacity:1,duration:${r3(d / 2)},ease:'sine.in'},${t0});tl.to('#${id}',{opacity:0,duration:${r3(d / 2)},ease:'sine.out'},${r3(t0 + d / 2)});`);
      } else {
        const ys = [0.16, 0.39, 0.61, 0.83], n = Math.max(3, Math.round(d * 30));
        el.push(`<div id="${id}" class="clip" data-start="${t0}" data-duration="${r3(n / 30 + 0.02)}" data-track-index="15" style="position:absolute;inset:0;z-index:35">${ys.map((y, q) => `<div id="${id}s${q}" style="position:absolute;left:0;width:100%;top:${Math.round(G.h * y)}px;height:${Math.round(G.h * (0.025 + 0.015 * q))}px;background:${q % 2 ? Th.A2 : A};mix-blend-mode:screen;opacity:0"></div>`).join('')}</div>`);
        for (let j = 0; j < n; j++) {
          const tj = r3(t0 + j / 30);
          ys.forEach((_, q) => tw.push(`tl.set('#${id}s${q}',{opacity:${rnd() > 0.35 ? 0.85 : 0},x:${Math.round((rnd() - 0.5) * G.w * 0.12)}},${tj});`));
          tw.push(`tl.set('#spkbox',{x:${Math.round((rnd() - 0.5) * 28)},filter:'${j % 2 ? 'hue-rotate(150deg) saturate(2.2) contrast(1.2)' : 'saturate(1.7) contrast(1.15)'}'},${tj});`);
        }
        tw.push(`tl.set('#spkbox',{x:0,filter:'none'},${r3(t0 + n / 30)});`);
        cues.push({ t: t0, sfx: 'click' });
      }
    }
  }
  // ---------- style signature move: on every punch-in (and every zoom-in of a short), spaced by minBeatGap ----------
  // punch-shake: a zoom hit, a 5-frame shake and an accent frame flash; letterbox: bars in the background colour
  // with an accent rule slide in for the punch; hud: corner brackets lock onto the face, with faint scanlines.
  if (Th.signature) {
    for (const sg of sigHits) {
      const t = at(sg.start), e = at(sg.end), id = `sg${sgN++}`;
      if (Th.signature === 'punch-shake') {
        tw.push(`tl.set('#spkbox',{scale:1.07},${t});tl.to('#spkbox',{scale:1,duration:.24,ease:'power2.out'},${r3(t + 0.01)});`);
        [[16, -10], [-12, 8], [8, -5], [-4, 2], [0, 0]].forEach(([x, y], f) => tw.push(`tl.set('#spkbox',{x:${x},y:${y}},${r3(t + f / 30)});`));
        el.push(`<div id="${id}" class="clip" data-start="${t}" data-duration="0.3" data-track-index="16" style="position:absolute;inset:0;z-index:16;box-shadow:inset 0 0 0 14px ${A}"></div>`);
        tw.push(`tl.to('#${id}',{opacity:0,duration:.3,ease:'power2.in'},${t});`);
        cues.push({ t, sfx: 'tap' });
      } else if (Th.signature === 'letterbox') {
        const bh = LB.h, dd = r3(e - t);
        el.push(`<div id="${id}t" class="clip" data-start="${t}" data-duration="${dd}" data-track-index="16" style="position:absolute;left:0;top:0;width:100%;height:${bh}px;z-index:15;background:${Th.bg};border-bottom:4px solid ${A}"></div><div id="${id}b" class="clip" data-start="${t}" data-duration="${dd}" data-track-index="17" style="position:absolute;left:0;bottom:0;width:100%;height:${bh}px;z-index:15;background:${Th.bg};border-top:4px solid ${A}"></div>`);
        tw.push(`tl.from('#${id}t',{yPercent:-100,duration:.45,ease:'power3.out'},${t});tl.from('#${id}b',{yPercent:100,duration:.45,ease:'power3.out'},${t});`);
        if (dd > 1.2) tw.push(`tl.to('#${id}t',{yPercent:-100,duration:.35,ease:'power2.in'},${r3(e - 0.35)});tl.to('#${id}b',{yPercent:100,duration:.35,ease:'power2.in'},${r3(e - 0.35)});`);
        cues.push({ t, sfx: 'whoosh_low' });
      } else {
        const f = faceOutAt(sg.start + 0.15), fw = f?.fw || G.w * 0.25;
        const bw = Math.round(Math.min(G.w - 40, fw * 1.8)), bhh = Math.round(Math.min(G.h - 40, fw * 2.1));
        const bx = Math.round(clamp((f?.cx ?? G.w / 2) - bw / 2, 20, G.w - 20 - bw)), by = Math.round(clamp((f?.cy ?? G.h * 0.38) + fw * 0.1 - bhh / 2, 20, G.h - 20 - bhh));
        const c = Math.round(Math.min(bw, bhh) * 0.2), line = `${Math.max(4, Math.round(G.w / 200))}px solid ${A}`, dd = r3(e - t);
        const corner = (k, css) => `<div id="${id}c${k}" style="position:absolute;width:${c}px;height:${c}px;${css}"></div>`;
        el.push(`<div id="${id}" class="clip" data-start="${t}" data-duration="${dd}" data-track-index="16" style="position:absolute;inset:0;z-index:15;pointer-events:none">
<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0 2px,transparent 2px 6px)"></div>
<div id="${id}k" style="position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bhh}px;filter:drop-shadow(0 0 8px ${rgba(A, 0.8)})">${corner(0, `left:0;top:0;border-top:${line};border-left:${line}`)}${corner(1, `right:0;top:0;border-top:${line};border-right:${line}`)}${corner(2, `left:0;bottom:0;border-bottom:${line};border-left:${line}`)}${corner(3, `right:0;bottom:0;border-bottom:${line};border-right:${line}`)}
<div style="position:absolute;left:0;top:-${Math.round(G.w / 28)}px;font-family:${Th.font.body.stack};font-weight:700;font-size:${Math.round(G.w / 40)}px;letter-spacing:.14em;color:${A}">● LOCK</div></div></div>`);
        tw.push(`tl.from('#${id}k',{scale:1.4,opacity:0,duration:.25,ease:'expo.out'},${t});tl.set('#${id}k',{opacity:.3},${r3(t + 0.28)});tl.set('#${id}k',{opacity:1},${r3(t + 0.31)});tl.to('#${id}',{opacity:0,duration:.2},${r3(t + dd - 0.2)});`);
        cues.push({ t, sfx: 'click2' });
      }
    }
  }
  // self-check: caption over the face, over a pop / lower third, or outside the frame
  const hit = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const overlaps = [];
  for (const c of capsOut) {
    if (hit(c.rect, c.face)) overlaps.push({ t: c.start, caption: c.text, with: 'face' });
    for (const b of boxes) if (c.start < b.e && b.s < c.end && hit(c.rect, b)) overlaps.push({ t: c.start, caption: c.text, with: b.kind });
    if (c.rect.y < 0 || c.rect.y + c.rect.h > G.h) overlaps.push({ t: c.start, caption: c.text, with: 'frame edge' });
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Easy Edits ${esc(o.title || '')}</title>
<script src="assets/gsap.min.js"></script>
<style>${CSS_BASE(G, Th)}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${T}" data-width="${G.w}" data-height="${G.h}">
${el.join('\n')}
</div>
<script>
const tl=gsap.timeline({paused:true});
${tw.join('\n')}
tl.set({}, {}, ${T});
window.__timelines=window.__timelines||{};window.__timelines['main']=tl;
</script></body></html>`;
  // the style's sound policy: soft keeps the whooshes and the shimmer, none drops every effect
  const sfxOk = (c) => Th.sfx === 'full' || (Th.sfx === 'soft' && /^(whoosh|whoosh_low|shimmer)$/.test(c.sfx));
  return { html, duration: T, offset: I, cues: cues.filter((c) => c.t >= 0 && c.t < T && sfxOk(c)).sort((a, b) => a.t - b.t), captions: capsOut, segments: segs, overlaps, style: Th.id, transitions: txN, signatures: sgN, ink: inkCount };
}

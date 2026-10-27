// promo (SPEC P1): product details + brand assets -> code-drawn scenes only, zero generations by construction.
//   ai-video-editor new promo -o out/ --brand brand.json [--assets DIR] [--length 15] [--format 9x16,1x1,16x9] [--no-music]
// brand.json: { "name", "tagline", "colors": { "background", "text", "accent" }, "logo": "logo.png",
//               "product": { "name", "price", "features": ["..."] }, "cta", "url" }
// File paths in brand.json are relative to brand.json (then --assets). --assets DIR: logo.* is the logo, the other
// images (png / jpg / webp, sorted, up to 3) become product scenes. Colours go through the WCAG contrast checker
// (engine/contrast.mjs): text under 4.5:1 on the background is swapped for white / near-black, an accent under 3:1
// falls back to the text colour; both are noted in the plan.
import fs from 'node:fs';
import path from 'node:path';
import { contrastRatio, INK } from '../../engine/contrast.mjs';
import { codeCard, synthBed, ff } from '../assemble.mjs';
import { renderShots } from '../render.mjs';

const IMG = /\.(png|jpe?g|webp)$/i;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Brand colours checked for readability; returns { colors, notes } or throws on invalid values. */
export function brandColors(brand) {
  const c = { background: '#0E1116', text: '#FFFFFF', accent: '#FFD60A', ...(brand.colors || {}) };
  for (const k of ['background', 'text', 'accent']) if (!HEX.test(c[k])) throw new Error(`brand.json colors.${k} "${c[k]}" is not a #RRGGBB colour`);
  const notes = [];
  const tr = contrastRatio(c.text, c.background);
  if (tr < 4.5) {
    const alt = contrastRatio(INK.light, c.background) >= contrastRatio(INK.dark, c.background) ? INK.light : INK.dark;
    notes.push(`brand text ${c.text} on ${c.background} is ${tr.toFixed(2)}:1 (< 4.5:1); using ${alt} for text`);
    c.text = alt;
  }
  const ar = contrastRatio(c.accent, c.background);
  if (ar < 3) { notes.push(`brand accent ${c.accent} on ${c.background} is ${ar.toFixed(2)}:1 (< 3:1); accent text uses ${c.text}`); c.accentText = c.text; } else c.accentText = c.accent;
  return { colors: c, notes };
}

function findFile(ref, dirs) {
  if (!ref) return null;
  for (const d of dirs) { const f = path.resolve(d, ref); if (fs.existsSync(f)) return f; }
  throw new Error(`brand.json: missing file ${ref}`);
}

export const recipe = {
  name: 'promo',
  description: 'promo from brand.json + your images: code-drawn scenes, zero generations',
  keywords: ['promo', 'promotion', 'ad', 'advert', 'commercial', 'product', 'launch', 'brand', 'sale', 'offer', 'teaser', 'app'],
  defaults: { length: [6, 60] },
  plan(o) {
    if (!o.brand) throw new Error('new promo: needs --brand brand.json (name, colors, logo, product, cta). Make a starter one: ai-video-editor new promo --init-brand brand/');
    let brand;
    try { brand = JSON.parse(fs.readFileSync(o.brand, 'utf8')); } catch (e) { throw new Error(`--brand ${o.brand}: ${e.message}`); }
    if (!brand.name) throw new Error('brand.json needs "name"');
    const dirs = [path.dirname(o.brand), ...(o.assets ? [o.assets] : [])];
    const { colors, notes } = brandColors(brand);
    let logo = findFile(brand.logo, dirs);
    let images = [];
    if (o.assets) {
      const files = fs.readdirSync(o.assets).filter((f) => IMG.test(f)).sort().map((f) => path.join(o.assets, f));
      if (!logo) logo = files.find((f) => /^logo\./i.test(path.basename(f))) || null;
      images = files.filter((f) => f !== logo).slice(0, 3);
    }
    const product = brand.product || {};
    const features = (product.features || []).slice(0, 3);
    const scenes = [{ kind: 'intro', title: brand.name, subtitle: brand.tagline || null, logo }];
    if (product.name) scenes.push({ kind: 'product', title: product.name, subtitle: brand.tagline && scenes[0].subtitle !== brand.tagline ? brand.tagline : product.price ? `${product.price}` : null, image: images[0] || null });
    features.forEach((f, i) => { scenes.push({ kind: 'feature', n: i + 1, title: f, image: images[i + (product.name ? 1 : 0)] || null }); });
    for (const img of images.slice(features.length + (product.name ? 1 : 0))) scenes.push({ kind: 'image', title: product.name || brand.name, image: img });
    scenes.push({ kind: 'cta', title: brand.cta || 'Learn more', subtitle: [product.price, brand.url].filter(Boolean).join('  |  ') || null, logo });
    const total = o.length ? o.length[0] : 15;
    const per = Math.max(1.2, (total + 0.4 * (scenes.length - 1)) / scenes.length);
    const shots = scenes.map((sc, i) => ({
      id: `s${i + 1}`, durationSec: Number(per.toFixed(2)), source: 'code',
      prompt: `${sc.kind}: ${sc.title}${sc.subtitle ? ` / ${sc.subtitle}` : ''}${sc.image || sc.logo ? ` [${path.basename(sc.image || sc.logo)}]` : ''}`,
      refs: [sc.image, sc.logo].filter(Boolean), camera: 'static', transition: i === 0 ? 'cut' : sc.kind === 'cta' ? 'fadeblack' : i % 2 ? 'slideleft' : 'fade',
      scene: { ...sc, image: sc.image || null, logo: sc.logo || null },
    }));
    return {
      title: o.title || brand.name, shots, voice: [], length: o.length || [total, total],
      notes: [...notes, 'zero generations: every scene is code-drawn from brand.json and your images'],
      options: { brand: { name: brand.name, colors, font: brand.font || null }, music: !o.noMusic, postText: [brand.tagline, brand.cta, brand.url].filter(Boolean).join(' ') },
    };
  },
  preview(shot, plan, out, work) {
    const tmp = `${out}.mp4`;
    drawScene(shot, plan, { w: 360, h: Math.round(360 * plan.formats[0].h / plan.formats[0].w / 2) * 2 }, tmp, 1.2, work);
    ff(['-sseof', '-0.1', '-i', tmp, '-frames:v', '1', '-update', '1', out], 'promo preview');
    fs.rmSync(tmp, { force: true });
    return out;
  },
  async render(plan, ctx) {
    if (plan.generations.total !== 0) throw new Error('promo plans are zero-generation by construction; this plan was edited to need generations');
    const music = plan.options?.music !== false;
    const res = await renderShots(plan, ctx, {
      bed: music ? (total) => ({ file: synthBed(`${ctx.work}/bed.wav`, { dur: total, logFile: ctx.logFile }), db: 0 }) : null,
      silent: !music,
      drawCode: (s, fmt, out, dur) => drawScene(s, plan, fmt, out, dur, path.dirname(out), ctx.logFile),
    });
    res.silent = !music;
    res.postText = plan.options?.postText || null;
    res.notes = ['music: code-synthesised bed (no samples, no download)'].filter(() => music);
    return res;
  },
};

/** One promo scene, laid out for the frame's aspect. */
export function drawScene(shot, plan, { w, h }, out, dur, work, logFile) {
  const c = plan.options.brand.colors, sc = shot.scene || {};
  const portrait = h > w * 1.1;
  const bars = [{ x: 0, y: 0.94, w: 1, h: 0.012, color: c.accent }];
  const L = [];
  let image = null;
  if (sc.kind === 'intro' || sc.kind === 'cta') {
    if (sc.logo) image = { file: sc.logo, height: portrait ? 0.16 : 0.24, y: portrait ? 0.33 : 0.3 };
    L.push({ text: sc.title, size: sc.kind === 'intro' ? 0.11 : 0.09, y: sc.logo ? (portrait ? 0.52 : 0.58) : 0.45, color: sc.kind === 'cta' ? c.accentText : c.text });
    if (sc.subtitle) L.push({ text: sc.subtitle, size: 0.05, y: sc.logo ? (portrait ? 0.62 : 0.74) : 0.58, color: sc.kind === 'cta' ? c.text : c.accentText, delay: 0.4 });
  } else if (sc.image) {
    image = { file: sc.image, height: portrait ? 0.42 : 0.55, y: portrait ? 0.36 : 0.4 };
    if (sc.kind === 'feature') L.push({ text: String(sc.n).padStart(2, '0'), size: 0.06, y: portrait ? 0.64 : 0.76, color: c.accentText });
    L.push({ text: sc.title, size: 0.065, y: portrait ? 0.73 : 0.86, color: c.text, delay: 0.3 });
  } else {
    if (sc.kind === 'feature') { L.push({ text: String(sc.n).padStart(2, '0'), size: 0.14, y: 0.34, color: c.accentText }); bars.push({ x: 0.42, y: 0.43, w: 0.16, h: 0.008, color: c.accent }); }
    L.push({ text: sc.title, size: 0.08, y: sc.kind === 'feature' ? 0.54 : 0.45, color: c.text, delay: 0.3 });
    if (sc.subtitle) L.push({ text: sc.subtitle, size: 0.05, y: 0.6, color: c.accentText, delay: 0.5 });
  }
  return codeCard(out, { w, h, dur, bg: c.background, layers: L, image, bars, work, logFile });
}

export default recipe;

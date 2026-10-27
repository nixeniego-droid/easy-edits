// AI Video Editor aspect check (fault-only): source footage is only ever scaled uniformly (no horizontal / vertical squeeze).
//   node ai-video-editor/check/aspect.mjs <project-dir> [<final.mp4>] [--source FILE] [--json] [--no-pixels]
// (a) COMPOSITION (index.html): every <video> and its ancestor chain. FAIL ASPECT when
//   - a scale on the chain is non-uniform, |sx/sy - 1| > 0.01: CSS / inline transform scale(a,b), scaleX(), scaleY(),
//     scale3d(), matrix() (|col x| / |col y|), or a GSAP set / to / from / fromTo whose vars give scaleX / scaleY
//     apart from scale (a lone scaleX or scaleY is judged against 1); any skew;
//   - the video box (CSS / inline / attribute px width + height, GSAP width / height tweens) differs from the clip's
//     display aspect by > 1% with object-fit fill or unset (a renderer that paints frames into the box stretches it;
//     cover / contain mismatches are a uniform crop / letterbox and pass);
//   - the clip's display aspect (ffprobe w x SAR / h) differs from the raw source's (prep stretched the footage).
// (b) PIXELS (needs <final.mp4>, python3 + opencv; lib/aspect_fit.py): two frames per plan.json scene (35% / 65%;
//   every 2 s without a plan), each mapped to its source frame through assets/edit-decisions.json keeps (+ the
//   post lead-in = final duration - composition duration). ORB + RANSAC affine and an NCC grid fit give sx / sy of
//   source -> final; FAIL SQUEEZE when both put |sx/sy - 1| > 0.03 (ORB alone when the NCC fit is unavailable).
//   Frames where the source is not identifiable (cards, other footage) are reported "no footage", not failed.
// Reported per scene. Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { aiVideoEditorPython } from './lib/python.mjs';
import { pathToFileURL } from 'node:url';

export const COMP_TOL = 0.01, PIX_TOL = 0.03;
const HERE = path.dirname(new URL(import.meta.url).pathname), FIT = path.join(HERE, 'lib/aspect_fit.py');
const num = (v) => { const m = String(v ?? '').trim().replace(/^['"]|['"]$/g, '').match(/^(-?[\d.]+)(px)?$/); return m ? +m[1] : null; };
const VOID = new Set(['img', 'br', 'hr', 'meta', 'link', 'input', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param']);

/** html -> {rules: [{sel, decl}], videos: [{id, classes, style, attrs, chain: [el...]}], scripts} */
export function parseHtml(html) {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const rules = [];
  for (const m of styles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)) for (const sel of m[1].split(',')) rules.push({ sel: sel.trim(), decl: m[2] });
  const body = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const stack = [], videos = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag0, rest, selfClose] = m, tag = tag0.toLowerCase();
    if (close) { const i = stack.map((e) => e.tag).lastIndexOf(tag); if (i >= 0) stack.length = i; continue; }
    const attrs = {};
    for (const a of rest.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? a[5];
    const el = { tag, id: attrs.id || '', classes: (attrs.class || '').split(/\s+/).filter(Boolean), style: attrs.style || '', attrs };
    if (tag === 'video') videos.push({ ...el, chain: [el, ...[...stack].reverse()] });
    if (!VOID.has(tag) && !selfClose) stack.push(el);
  }
  return { rules, videos, scripts };
}

/** does a CSS / GSAP selector's last compound match the element (descendant context ignored: conservative) */
export function matches(sel, el) {
  const last = String(sel).trim().split(/[\s>+~]+/).pop() || '';
  const m = last.match(/^([a-zA-Z][\w-]*|\*)?((?:[#.][\w-]+)*)$/);
  if (!m || !last) return false;
  if (m[1] && m[1] !== '*' && m[1].toLowerCase() !== el.tag) return false;
  for (const p of m[2].match(/[#.][\w-]+/g) || []) if (p[0] === '#' ? p.slice(1) !== el.id : !el.classes.includes(p.slice(1))) return false;
  return !!(m[1] || m[2]);
}

const declOf = (decl, prop) => { const m = [...String(decl).matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'gi'))].pop(); return m ? m[1].trim() : null; };

/** CSS transform string -> [{sx, sy, skew, what}] */
export function transformScales(t) {
  const out = [];
  for (const f of String(t || '').matchAll(/(scale3d|scaleX|scaleY|scale|matrix3d|matrix|skewX|skewY|skew)\(([^)]*)\)/gi)) {
    const fn = f[1].toLowerCase(), a = f[2].split(',').map((x) => parseFloat(x));
    if (fn === 'scale') out.push({ sx: a[0], sy: a.length > 1 ? a[1] : a[0], what: f[0] });
    else if (fn === 'scalex') out.push({ sx: a[0], sy: 1, what: f[0] });
    else if (fn === 'scaley') out.push({ sx: 1, sy: a[0], what: f[0] });
    else if (fn === 'scale3d') out.push({ sx: a[0], sy: a[1], what: f[0] });
    else if (fn === 'matrix') out.push({ sx: Math.hypot(a[0], a[1]), sy: Math.hypot(a[2], a[3]), what: f[0] });
    else if (fn === 'matrix3d') out.push({ sx: Math.hypot(a[0], a[1]), sy: Math.hypot(a[4], a[5]), what: f[0] });
    else if (a.some((x) => Math.abs(x) > 1e-6)) out.push({ skew: true, what: f[0] });
  }
  return out;
}

/** GSAP calls in the scripts: [{method, sel, vars: [{prop: value}]}] (flat object literals) */
export function gsapCalls(scripts) {
  const out = [], obj = (s) => { const v = {}; if (s) for (const p of s.matchAll(/([\w$]+)\s*:\s*('[^']*'|"[^"]*"|[^,}]+)/g)) v[p[1]] = p[2].trim(); return v; };
  for (const m of scripts.matchAll(/\.(set|to|from|fromTo)\(\s*(['"`])(.*?)\2\s*,\s*(\{[^{}]*\})(?:\s*,\s*(\{[^{}]*\}))?/g)) {
    const vars = [obj(m[4])]; if (m[1] === 'fromTo' && m[5]) vars.push(obj(m[5]));
    out.push({ method: m[1], sel: m[3], vars });
  }
  return out;
}

/** parsed html + {src -> display aspect} + raw source aspect -> {elements: [{id, src, issues: [...], notes: [...]}]} */
export function analyzeComposition(parsed, aspects = {}, sourceAspect = null) {
  const { rules, videos, scripts } = parsed, calls = gsapCalls(scripts), elements = [];
  for (const v of videos) {
    const issues = [], notes = [], name = (e) => (e.id ? `#${e.id}` : e.classes.length ? `.${e.classes[0]}` : e.tag);
    const clipA = aspects[v.attrs.src] ?? null;
    if (clipA && sourceAspect && Math.abs(clipA / sourceAspect - 1) > COMP_TOL) issues.push(`clip ${v.attrs.src} display aspect ${clipA.toFixed(4)} vs source ${sourceAspect.toFixed(4)} (prep stretched the footage)`);
    for (const e of v.chain) {
      const css = rules.filter((r) => matches(r.sel, e)).map((r) => r.decl).concat(e.style);
      for (const d of css) for (const s of transformScales(declOf(d, 'transform'))) {
        if (s.skew) issues.push(`${name(e)} CSS ${s.what}: skew distorts the footage`);
        else if (Math.abs(s.sx / s.sy - 1) > COMP_TOL) issues.push(`${name(e)} CSS ${s.what}: sx/sy ${(s.sx / s.sy).toFixed(3)}`);
      }
      for (const c of calls.filter((c) => c.sel.split(',').some((s) => matches(s, e)))) for (const vars of c.vars) {
        const sc = num(vars.scale), sx = num(vars.scaleX) ?? sc, sy = num(vars.scaleY) ?? sc;
        if (vars.scaleX != null || vars.scaleY != null) {
          const r = (sx ?? 1) / (sy ?? 1);
          if (!Number.isFinite(r) || Math.abs(r - 1) > COMP_TOL) issues.push(`${name(e)} GSAP ${c.method}('${c.sel}') scaleX ${sx ?? '-'} scaleY ${sy ?? '-'}: sx/sy ${Number.isFinite(r) ? r.toFixed(3) : 'inf'}`);
        }
        for (const k of ['skewX', 'skewY']) if (vars[k] != null && Math.abs(parseFloat(String(vars[k]).replace(/['"]/g, ''))) > 1e-6) issues.push(`${name(e)} GSAP ${c.method}('${c.sel}') ${k} ${vars[k]}: skew distorts the footage`);
        if (vars.transform) for (const s of transformScales(vars.transform)) if (s.skew || Math.abs(s.sx / s.sy - 1) > COMP_TOL) issues.push(`${name(e)} GSAP ${c.method}('${c.sel}') transform ${s.what}`);
        if (e === v.chain[0] && (vars.width != null || vars.height != null)) v.tweens = [...(v.tweens || []), vars];
      }
    }
    // the video box vs the clip aspect
    const css = rules.filter((r) => matches(r.sel, v)).map((r) => r.decl).concat(v.style);
    const pick = (p) => css.map((d) => declOf(d, p)).filter((x) => x != null).pop();
    const fit = (pick('object-fit') || '').toLowerCase() || null;
    const w = num(pick('width')) ?? num(v.attrs.width), h = num(pick('height')) ?? num(v.attrs.height);
    const boxes = [{ w, h, at: 'box' }, ...(v.tweens || []).map((t) => ({ w: num(t.width) ?? w, h: num(t.height) ?? h, at: `GSAP width/height ${t.width ?? ''}${t.width && t.height ? ' x ' : ''}${t.height ?? ''}` }))];
    for (const b of boxes) {
      if (!b.w || !b.h || !clipA) { if (b.at === 'box') notes.push(`box ${b.w ?? 'auto'} x ${b.h ?? 'auto'} (aspect follows the clip)`); continue; }
      const r = b.w / b.h / clipA, msg = `${b.at} ${b.w} x ${b.h} = ${(b.w / b.h).toFixed(4)} vs clip ${clipA.toFixed(4)} (x/y ${r.toFixed(4)}), object-fit ${fit || 'unset'}`;
      if (Math.abs(r - 1) <= COMP_TOL) notes.push(msg);
      else if (fit === 'cover' || fit === 'contain' || fit === 'scale-down' || fit === 'none') notes.push(`${msg}: uniform ${fit === 'cover' ? 'crop' : 'letterbox'}`);
      else issues.push(`${msg}: the clip is stretched to the box`);
    }
    elements.push({ id: v.id || null, src: v.attrs.src || null, issues, notes });
  }
  return { elements, bad: elements.reduce((n, e) => n + e.issues.length, 0) };
}

/** composition time -> source time through keeps (tail hold -> the last kept frame) */
export function toSource(keeps, t) {
  if (!keeps?.length) return t;
  const k = keeps.find((x) => t >= x.start && t < x.end) || (t >= keeps.at(-1).end ? { ...keeps.at(-1), start: keeps.at(-1).end - 1 / 30, sourceStart: keeps.at(-1).sourceEnd - 1 / 30 } : keeps[0]);
  return Math.max(0, k.sourceStart + Math.min(t - k.start, k.end - k.start - 1 / 60));
}

/** run lib/aspect_fit.py on [{t, srcT}] -> fits | {error} */
export function pixelFits(final, source, pairs) {
  const r = spawnSync(aiVideoEditorPython(), ['-P', FIT, final, source, pairs.map((p) => `${p.t.toFixed(3)}:${p.srcT.toFixed(4)}`).join(',')], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) return { error: (r.stderr || '').trim().split('\n').pop() || 'aspect_fit.py failed' };
  return JSON.parse(r.stdout);
}

/** a fit -> {ratio, squeeze}: FAIL when ORB and NCC (if present) both exceed tol */
export function judgeFit(f, tol = PIX_TOL) {
  if (!f.ok) return { measured: false };
  const ro = f.orb.ratio, rn = f.ncc?.ratio, off = (r) => Math.abs(r - 1) > tol;
  return { measured: true, ratio: rn ?? ro, orb: ro, ncc: rn ?? null, squeeze: off(ro) && (rn == null || off(rn)) };
}

/** plan scenes (or 2 s windows) -> sample times (composition s) */
export function samplePlan(plan, dur) {
  const sc = (plan?.scenes || []).filter((s) => +s.end > +s.start);
  const scenes = sc.length ? sc : Array.from({ length: Math.max(1, Math.ceil(dur / 2)) }, (_, i) => ({ id: `w${i}`, start: i * 2, end: Math.min(dur, i * 2 + 2) }));
  return scenes.map((s) => ({ id: s.id, layout: s.layout || '', start: +s.start, end: +s.end, ts: [0.35, 0.65].map((p) => +(+s.start + p * (s.end - s.start)).toFixed(3)) }));
}

const probe = (f) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,sample_aspect_ratio:format=duration', '-of', 'json', f], { encoding: 'utf8' });
  try { const j = JSON.parse(r.stdout), s = j.streams[0], [a, b] = String(s.sample_aspect_ratio || '1:1').split(':').map(Number); return { aspect: (s.width * (a && b ? a / b : 1)) / s.height, dur: +j.format.duration }; } catch { return null; }
};

function main(argv) {
  const json = argv.includes('--json'), noPix = argv.includes('--no-pixels'), si = argv.indexOf('--source');
  const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--source'), [proj, final] = pos;
  if (!proj || !fs.existsSync(path.join(proj, 'index.html')) || (final && !fs.existsSync(final))) { console.error('usage: aspect.mjs <project-dir> [<final.mp4>] [--source FILE] [--json] [--no-pixels]'); return 2; }
  const html = fs.readFileSync(path.join(proj, 'index.html'), 'utf8'), parsed = parseHtml(html);
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(proj, f), 'utf8')); } catch { return null; } };
  const ed = read('assets/edit-decisions.json'), plan = read('assets/plan.json');
  const source = si >= 0 ? argv[si + 1] : ed?.source ? path.resolve(proj, ed.source) : null;
  const src = source && fs.existsSync(source) ? probe(source) : null, aspects = {};
  for (const v of parsed.videos) { const p = v.attrs.src && probe(path.resolve(proj, v.attrs.src)); if (p) aspects[v.attrs.src] = p.aspect; }
  const comp = analyzeComposition(parsed, aspects, src?.aspect ?? null);
  const res = { composition: comp, pixels: null };
  console.log(`  composition: ${parsed.videos.length} footage element(s)`);
  for (const e of comp.elements) {
    for (const n of e.notes) console.log(`    ok   #${e.id || '?'} ${n}`);
    for (const i of e.issues) console.log(`    FAIL ASPECT #${e.id || '?'} ${i}`);
    if (!e.issues.length) console.log(`    ok   #${e.id || '?'} (${e.src}): every scale on the element and its wrappers uniform (|sx/sy-1| <= ${COMP_TOL})`);
  }
  let pixBad = 0;
  if (final && !noPix) {
    const footage = parsed.videos[0]?.attrs.src ? path.resolve(proj, parsed.videos[0].attrs.src) : null;
    const pixSrc = src ? source : footage, keeps = src ? ed?.keeps : null;
    const fd = probe(final)?.dur || 0, off = ed?.duration ? Math.max(0, +(fd - ed.duration).toFixed(3)) : 0;
    const scenes = samplePlan(plan, ed?.duration || fd - off), pairs = [];
    for (const s of scenes) for (const t of s.ts) pairs.push({ scene: s, t: t + off, srcT: toSource(keeps, t) });
    const fits = pixSrc ? pixelFits(final, pixSrc, pairs) : { error: 'no source footage found' };
    if (fits.error) { console.log(`  pixels: not measured (${fits.error})`); res.pixels = { error: fits.error }; } else {
      res.pixels = { offset: off, scenes: [] };
      console.log(`  pixels: ${pairs.length} frames vs ${path.basename(pixSrc)} (lead-in ${off} s), FAIL when |sx/sy-1| > ${PIX_TOL}`);
      for (const s of scenes) {
        const rows = pairs.map((p, i) => ({ ...p, fit: fits[i], j: judgeFit(fits[i]) })).filter((p) => p.scene === s);
        const m = rows.filter((r) => r.j.measured), bad = m.filter((r) => r.j.squeeze);
        pixBad += bad.length;
        const desc = m.map((r) => `${r.t.toFixed(2)}s ${r.j.ratio.toFixed(3)}${r.j.ncc != null ? ` (orb ${r.j.orb.toFixed(3)})` : ''}`).join(', ');
        console.log(`    ${bad.length ? 'FAIL SQUEEZE' : m.length ? 'ok  ' : 'skip'} ${s.id} ${s.layout} ${s.start.toFixed(2)}-${s.end.toFixed(2)} s: ${m.length ? `sx/sy ${desc}` : 'no footage identifiable (card / other footage)'}`);
        res.pixels.scenes.push({ id: s.id, layout: s.layout, start: s.start, end: s.end, frames: rows.map((r) => ({ t: r.t, srcT: r.srcT, ...r.j })), fail: bad.length > 0 });
      }
    }
  }
  if (json) console.log(JSON.stringify(res, null, 1));
  const fail = comp.bad + pixBad;
  console.log(`aspect: ${fail ? 'FAIL' : 'PASS'} ${comp.bad} composition issue(s), ${pixBad} squeezed frame(s)${res.pixels?.error ? ' (pixels not measured)' : ''}`);
  return fail ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));

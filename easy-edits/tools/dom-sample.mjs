// Easy Edits DOM sampler: what text the composition actually shows, frame by frame, in headless Chrome.
//   node easy-edits/tools/dom-sample.mjs <project-dir> [--step 0.0667] [--out samples.json]
// Loads <project>/index.html (file://, HyperFrames' chrome-headless-shell, no GPU, no input), seeks the root
// GSAP timeline (window.__timelines[<data-composition-id>]) to each step and emulates HyperFrames clip windows
// (an element with data-start/data-duration is hidden outside [start, start + duration)). Per step, every
// visible element that owns text (HTML or SVG <text>) gives {id, text, kind, x, y, w, h, scale, opacity} where
// scale = rendered width / layout width (pop-in tweens) and opacity is the product up the ancestors.
// kind from the element's and its ancestors' id/class tokens: cap (`cap`), card (name / lower-third / byline),
// chip (chip pill tag label kick kicker badge eyebrow), kinetic (paper kinetic kin quote stack slam word words
// type huge giant punch headline), else other. Per element (once): computed font-family / size / weight /
// style, box style (color, text-shadow, nearest background + padding / radius / border / box-shadow) and the
// platform font Chrome actually drew it with (CDP CSS.getPlatformFontsForNode), so a missing
// webfont that falls back to a serif shows up. Mounted sub-compositions (data-composition-src) are not loaded.
// Result {duration, compositionId, step, elements: {key: {...style}}, samples: [{t, items: [...]}]}.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export function chromePath() {
  if (process.env.EASY_EDITS_CHROME && fs.existsSync(process.env.EASY_EDITS_CHROME)) return process.env.EASY_EDITS_CHROME;
  for (const root of [path.join(os.homedir(), '.cache/hyperframes/chrome/chrome-headless-shell'), path.join(os.homedir(), '.cache/ms-playwright')]) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name === 'chrome-headless-shell') return p;
      }
    }
  }
  for (const p of ['/opt/google/chrome/chrome', '/opt/ungoogled-chromium/chrome']) if (fs.existsSync(p)) return p;
  return null;
}

/** Browser driver without network installs: puppeteer-core (local, hyperframes' deps, npx cache) else playwright-core (global pnpm store). */
export function driver() {
  const roots = [import.meta.url, path.join(process.cwd(), 'package.json')];
  const npx = path.join(os.homedir(), '.npm/_npx');
  if (fs.existsSync(npx)) for (const d of fs.readdirSync(npx)) roots.push(path.join(npx, d, 'package.json'));
  for (const name of ['puppeteer-core', 'puppeteer', 'hyperframes/node_modules/puppeteer-core'])
    for (const r of roots) { try { const m = createRequire(r)(name); return { kind: 'puppeteer', m: m.default || m }; } catch { /* next */ } }
  const store = ['/usr/local/lib/pnpm/5/.pnpm', path.join(os.homedir(), '.local/share/pnpm/store')].filter((d) => fs.existsSync(d));
  for (const st of store)
    for (const d of fs.readdirSync(st).filter((n) => n.startsWith('playwright-core@')).sort().reverse()) {
      try { return { kind: 'playwright', m: require(path.join(st, d, 'node_modules/playwright-core')) }; } catch { /* next */ }
    }
  return null;
}

export async function launch(exe, args) {
  const d = driver();
  if (!d) throw new Error('dom-sample: no puppeteer-core or playwright-core found locally');
  if (d.kind === 'puppeteer') return d.m.launch({ executablePath: exe, headless: true, args });
  const b = await d.m.chromium.launch({ executablePath: exe, headless: true, args });
  // adapt the few puppeteer calls used below
  return { close: () => b.close(), newPage: async () => {
    const pg = await b.newPage();
    pg.setViewport = ({ width, height }) => pg.setViewportSize({ width, height });
    pg.createCDPSession = () => pg.context().newCDPSession(pg);
    return pg;
  } };
}

const KIND = { cap: /^cap$/i, card: /name|lower-?third|^lt$|byline|speaker|guest|host|credit/i,
  chip: /^(chip|chip-in|pill|tag|label|kick|kicker|badge|eyebrow)$/i,
  kinetic: /^(paper|kinetic|kin|quote|stack|stacked|slam|word|words|type|huge|giant|punch|headline)$/i };

/** Sample the visible text of a project. */
export async function sampleProject(proj, { step = 1 / 15 } = {}) {
  const exe = chromePath();
  if (!exe) throw new Error('dom-sample: no chrome-headless-shell (run `npx hyperframes browser ensure`)');
  const browser = await launch(exe,
    ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-features=PointerLockOptions', '--mute-audio']);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.goto(pathToFileURL(path.resolve(proj, 'index.html')).href, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const meta = await page.evaluate((KINDSRC) => {
      const K = Object.fromEntries(Object.entries(KINDSRC).map(([k, s]) => [k, new RegExp(s, 'i')]));
      const root = document.querySelector('[data-composition-id]');
      const id = root?.getAttribute('data-composition-id');
      document.querySelectorAll('video,audio').forEach((m) => { m.pause?.(); m.style.visibility = 'hidden'; });
      const holders = [];
      let n = 0;
      for (const el of document.querySelectorAll('body *')) {
        if (/^(script|style|video|audio|svg|g|path)$/i.test(el.tagName)) continue;
        const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ').replace(/\s+/g, ' ').trim();
        if (!own) continue;
        if (!el.id) el.id = `__gc${n++}`;
        const toks = []; for (let e = el; e && e !== document.body; e = e.parentElement) toks.push(...(e.id || '').split(/\s+/), ...[...e.classList]);
        const ownToks = [el.id, ...el.classList];
        const kind = toks.some((t) => K.cap.test(t)) ? 'cap' : toks.some((t) => K.card.test(t)) ? 'card'
          : ownToks.some((t) => K.chip.test(t)) || toks.some((t) => K.chip.test(t)) && !ownToks.some((t) => K.kinetic.test(t)) ? 'chip'
          : toks.some((t) => K.kinetic.test(t)) ? 'kinetic' : 'other';
        let parent = null; for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) if (holders.some((x) => x.id === e.id)) { parent = e.id; break; }
        holders.push({ id: el.id, parent, text: (el.closest('svg') ? el.textContent : el.innerText || el.textContent).replace(/\s+/g, ' ').trim(), kind });
      }
      window.__gcHolders = holders;
      window.__gcClips = [...document.querySelectorAll('[data-start][data-duration]')].filter((e) => e !== root && !/^(video|audio)$/i.test(e.tagName))
        .map((e) => [e, +e.getAttribute('data-start'), +e.getAttribute('data-duration')]);
      return { id, duration: +(root?.getAttribute('data-duration') || 0), holders };
    }, Object.fromEntries(Object.entries(KIND).map(([k, r]) => [k, r.source])));
    const samples = [];
    for (let t = 0; t < meta.duration - 1e-6; t += step) {
      const items = await page.evaluate(([t, cid]) => {
        for (const [e, s, d] of window.__gcClips) e.style.visibility = t >= s && t < s + d ? '' : 'hidden';
        const tl = window.__timelines?.[cid]; if (tl) { tl.seek(t, false); }
        const out = [];
        for (const h of window.__gcHolders) {
          const el = document.getElementById(h.id);
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none') { op = 0; break; } op *= +c.opacity; }
          if (op < 0.05) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > 1920 || r.right < 0 || r.left > 1080) continue;
          const lw = el.offsetWidth || r.width;
          out.push({ id: h.id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), scale: +(r.width / lw).toFixed(3), opacity: +op.toFixed(3) });
        }
        return out;
      }, [+t.toFixed(4), meta.id]);
      samples.push({ t: +t.toFixed(4), items });
    }
    // computed + platform fonts, once per element
    const cdp = await page.createCDPSession();
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const elements = {};
    // middle of each element's first visible run (entry tweens settled)
    const run = {}, closed = new Set();
    for (const sm of samples) { const on = new Set(sm.items.map((it) => it.id));
      for (const id of on) if (!closed.has(id)) (run[id] ??= [sm.t, sm.t])[1] = sm.t;
      for (const id of Object.keys(run)) if (!on.has(id)) closed.add(id); }
    const firstT = Object.fromEntries(Object.entries(run).map(([id, [a, b]]) => [id, +((a + b) / 2).toFixed(4)]));
    for (const h of meta.holders) {
      const st = await page.evaluate(([id, t, cid]) => {
        // seek into the element's first visible run so the hit test sees what is painted under it
        if (t != null) { for (const [e, s, d] of window.__gcClips) e.style.visibility = t >= s && t < s + d ? '' : 'hidden'; window.__timelines?.[cid]?.seek(t, false); }
        const el = document.getElementById(id), c = getComputedStyle(el);
        // box style: the nearest non-transparent background up to the clip (or 3 levels), its padding / radius / border / shadow
        let b = el;
        for (let e = el, k = 0; e && e !== document.body && k < 4; e = e.parentElement, k++) {
          const bg = getComputedStyle(e).backgroundColor;
          if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) { b = e; break; }
          if (e.hasAttribute('data-start')) break;
        }
        const bc = getComputedStyle(b);
        // a painted box under the text that is NOT an ancestor (a sibling pill div or an SVG rect behind a label)
        // wins over an ancestor scene background: hit-test the element's center
        const painted = (bg) => bg && bg !== 'none' && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg);
        let under = null;
        if (t != null) {
          const r = el.getBoundingClientRect();
          for (const e of document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)) {
            if (e === el || el.contains(e) || e.contains(el)) { if (e.contains(el) && e !== el) break; continue; }
            let op = 1; for (let a = e; a && a.nodeType === 1; a = a.parentElement) op *= +getComputedStyle(a).opacity;
            if (op < 0.05) continue;
            const ec = getComputedStyle(e);
            if (e instanceof SVGElement && /^(rect|circle|ellipse|path|polygon)$/i.test(e.tagName) && painted(ec.fill)) {
              const er = e.getBoundingClientRect();
              if (er.left <= r.left + 4 && er.right >= r.right - 4 && er.top <= r.top + 4 && er.bottom >= r.bottom - 4) { under = { background: ec.fill, radius: `${+(e.getAttribute('rx') || 0)}px` }; break; }
            } else if (!(e instanceof SVGElement) && painted(ec.backgroundColor)) {
              const er = e.getBoundingClientRect();
              if (er.left <= r.left + 4 && er.right >= r.right - 4 && er.top <= r.top + 4 && er.bottom >= r.bottom - 4) { under = { background: ec.backgroundColor, radius: ec.borderRadius }; break; }
            }
          }
        }
        if (under)
          return { family: c.fontFamily, size: parseFloat(c.fontSize), weight: c.fontWeight, style: c.fontStyle, transform: c.textTransform, letterSpacing: c.letterSpacing,
            color: c.color, textShadow: c.textShadow, background: under.background, padding: '0px', radius: under.radius, border: 'none', boxShadow: 'none', bgFrom: 'under' };
        return { family: c.fontFamily, size: parseFloat(c.fontSize), weight: c.fontWeight, style: c.fontStyle, transform: c.textTransform, letterSpacing: c.letterSpacing,
          color: c.color, textShadow: c.textShadow, background: b === el && /rgba\(.*,\s*0\)$|transparent/.test(bc.backgroundColor) ? 'none' : bc.backgroundColor,
          padding: b === el && /rgba\(.*,\s*0\)$|transparent/.test(bc.backgroundColor) ? '0px' : bc.padding, radius: bc.borderRadius,
          border: bc.borderTopWidth === '0px' ? 'none' : `${bc.borderTopWidth} ${bc.borderTopColor}`, boxShadow: bc.boxShadow };
      }, [h.id, firstT[h.id] ?? null, meta.id]);
      let drawn = null;
      try {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${CSS_escape(h.id)}` });
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        drawn = fonts.sort((a, b) => b.glyphCount - a.glyphCount)[0]?.familyName || null;
      } catch { /* node gone */ }
      elements[h.id] = { ...h, ...st, drawn };
    }
    return { v: SAMPLE_V, duration: meta.duration, compositionId: meta.id, step, elements, samples };
  } finally { await browser.close(); }
}
/** Bump when the sample gains fields; older caches are re-sampled. 2: box style (color, background, padding, radius, border, shadows).
 *  3: parent holder id; background hit-tested mid first visible run (a sibling pill / SVG rect under a label). */
export const SAMPLE_V = 3;
const CSS_escape = (s) => s.replace(/([^\w-])/g, '\\$1');

const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
/** Cached sample: <project>/.easy-edits/dom-sample.json, reused while index.html is older or while its recorded
 *  indexSha1 equals index.html's sha1 (frozen test fixtures, whose mtimes a git checkout resets). */
export async function projectSamples(proj, opts = {}) {
  const cache = path.join(proj, '.easy-edits/dom-sample.json'), idx = path.join(proj, 'index.html');
  const c = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : null;
  if (c && (fs.statSync(cache).mtimeMs > fs.statSync(idx).mtimeMs || c.indexSha1 === sha1(idx))) {
    if (!opts.step || Math.abs(c.step - opts.step) < 1e-9) {
      if (c.v === SAMPLE_V) return c;
      // an older cache without the box-style fields: re-sample when the browser driver is installed, else keep it
      if (!driver()) { console.error(`dom-sample: cache v${c.v || 1} < v${SAMPLE_V} and no browser driver; using it (no box styles)`); return c; }
    }
  }
  const s = { ...(await sampleProject(proj, opts)), indexSha1: sha1(idx) };
  fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, JSON.stringify(s));
  return s;
}

/** Visible runs per element: [{id, text, kind, start, end, settledStart, settledEnd, settled (s), box}] (box = union while settled). */
export function runs(sample) {
  const out = [], open = new Map(), dt = sample.step;
  const close = (id) => { const r = open.get(id); open.delete(id); out.push(r); };
  for (const s of sample.samples) {
    const seen = new Set();
    for (const it of s.items) {
      seen.add(it.id);
      const el = sample.elements[it.id];
      let r = open.get(it.id);
      if (!r) { r = { id: it.id, text: el.text, kind: el.kind, start: s.t, end: s.t + dt, settled: 0, settledStart: null, settledEnd: null, box: null }; open.set(it.id, r); }
      r.end = s.t + dt;
      if (it.opacity >= 0.9 && Math.abs(it.scale - 1) <= 0.08) {
        r.settled += dt; r.settledStart ??= s.t; r.settledEnd = s.t + dt;
        const b = r.box;
        r.box = b ? { x0: Math.min(b.x0, it.x), y0: Math.min(b.y0, it.y), x1: Math.max(b.x1, it.x + it.w), y1: Math.max(b.y1, it.y + it.h) } : { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
      }
    }
    for (const id of [...open.keys()]) if (!seen.has(id)) close(id);
  }
  for (const id of [...open.keys()]) close(id);
  return out.sort((a, b) => a.start - b.start).map((r) => ({ ...r, start: +r.start.toFixed(3), end: +r.end.toFixed(3), settled: +r.settled.toFixed(3) }));
}

/** Seconds of lead-in the post stage put before the composition: final duration - composition duration (>= 0). */
export function leadOffset(finalDur, compDur) { const d = finalDur - compDur; return d > 0.02 && d < 1.5 ? +d.toFixed(3) : 0; }

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2), proj = argv[0];
  if (!proj) { console.error('usage: dom-sample.mjs <project-dir> [--step 0.0667] [--out samples.json] [--no-cache]'); process.exit(2); }
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (argv.includes('--no-cache')) fs.rmSync(path.join(proj, '.easy-edits/dom-sample.json'), { force: true });
  const s = await projectSamples(proj, { step: Number(opt('--step', 1 / 15)) });
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(s));
  for (const r of runs(s)) console.log(`${String(r.start).padStart(7)}-${String(r.end).padEnd(7)} settled ${r.settled.toFixed(2)} ${r.kind.padEnd(7)} ${r.id} "${r.text}"`);
}

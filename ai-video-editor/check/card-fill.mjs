// AI Video Editor card fill check (embedded brief, presets/look-bright.json `cards.fill`): no half-empty UI cards.
//   node ai-video-editor/check/card-fill.mjs <project-dir> [final.mp4] [--min 30] [--json]
// With final.mp4 the card WIDTH is also judged on the encoded frames (card-final.mjs: card segmented on the
// settled frame, 1080-wide px): FAIL CARD WIDTH outside 55-65% of the frame width (look-bright cards.widthPct).
// Loads <project>/index.html in headless Chrome (clip windows emulated, root GSAP timeline seeked) and samples
// every UI card (own class token `card`, `*-card`, `card-*`, same rule as look-check) at its SETTLED time: the
// last moment it is settled before its clip window ends (walk back past the exit tween: opacity >= 0.99, scale ~1),
// i.e. after the entry tween and the internal detail animations (bars risen, route drawn). Videos are hidden, the
// card box (inset 6% for the tilt and the rounded corners) is screenshot and the fill is the share of 32 px tiles
// at least 25% covered by pixels off the card fill (RGB distance >= 12). A lonely label (icon chip + one line), a
// thin dashed route or stub bars land under the bar; a thick gauge arc or solid risen bars fill it.
// FAIL when fill < --min % (default 30, look-bright cards.fill.minPct). Prints per-card fill %.
// Exit 1 on FAIL, 2 on usage / no browser.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromePath, launch } from '../tools/dom-sample.mjs';
import { fillColor } from './look-check.mjs';

export const MIN_FILL = 30, INSET = 0.06, DIFF = 40, SETTLE_BACK = 0.05, TILE = 32, TILE_ON = 0.25, SETTLE_STEP = 0.05;

export const isCardCls = (cls) => cls.some((c) => /(^|-)card($|-)/i.test(c)) && !cls.some((c) => /idea|full|^fs|inner|body|back/i.test(c));

/** RGBA bytes + background rgb -> share (0-1) of pixels at RGB distance >= DIFF from it (alpha < 128 ignored). */
export function fillShare(data, bg, diff = DIFF) {
  let n = 0, on = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    n++;
    if (Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) >= diff) on++;
  }
  return n ? on / n : 0;
}

/** RGBA bytes (w x h) -> share (0-1) of TILE x TILE tiles whose non-background share >= TILE_ON: the area a
 *  visual covers (a thick gauge arc or solid bars fill their tiles; a thin dashed route or one label line do not). */
export function tileShare(data, w, h, bg, { tile = TILE, on = TILE_ON, diff = DIFF } = {}) {
  let n = 0, hit = 0;
  for (let ty = 0; ty + tile <= h; ty += tile) for (let tx = 0; tx + tile <= w; tx += tile) {
    let m = 0, k = 0;
    for (let y = ty; y < ty + tile; y++) for (let x = tx; x < tx + tile; x++) {
      const i = 4 * (y * w + x); if (data[i + 3] < 128) continue;
      m++; if (Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) >= diff) k++;
    }
    if (!m) continue;
    n++; if (k / m >= on) hit++;
  }
  return n ? hit / n : 0;
}

/** cards [{id, t, fill 0-1}] -> [{...card, pct, ok}] */
export function judgeFill(cards, minPct = MIN_FILL) {
  return cards.map((c) => ({ ...c, pct: +(100 * c.fill).toFixed(1), ok: 100 * c.fill >= minPct }));
}

export async function sampleCards(proj) {
  const exe = chromePath();
  if (!exe) throw new Error('card-fill: no chrome-headless-shell (run `npx hyperframes browser ensure`)');
  const browser = await launch(exe, ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-features=PointerLockOptions', '--mute-audio']);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.goto(pathToFileURL(path.resolve(proj, 'index.html')).href, { waitUntil: 'load', timeout: 60000 });
    const cards = await page.evaluate((src) => {
      const isCard = new Function(`return ${src}`)();
      const root = document.querySelector('[data-composition-id]');
      document.querySelectorAll('video,audio').forEach((m) => { m.pause?.(); });
      window.__gcClips = [...document.querySelectorAll('[data-start][data-duration]')].filter((e) => e !== root && !/^(video|audio)$/i.test(e.tagName))
        .map((e) => [e, +e.getAttribute('data-start'), +e.getAttribute('data-duration')]);
      window.__gcCid = root?.getAttribute('data-composition-id');
      let n = 0; for (const el of document.querySelectorAll('body *')) if (!el.id) el.id = `__gf${n++}`;
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!isCard([...el.classList])) continue;
        let s = 0, e = +(root?.getAttribute('data-duration') || 0);
        for (let a = el; a && a !== root; a = a.parentElement) {
          if (a.hasAttribute?.('data-start') && a.hasAttribute('data-duration')) {
            s = Math.max(s, +a.getAttribute('data-start')); e = Math.min(e, +a.getAttribute('data-start') + +a.getAttribute('data-duration'));
          }
        }
        const text = (el.querySelector('.ct, h1, h2, h3, .title') || el).textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
        out.push({ id: el.id, s, e, text });
      }
      return out;
    }, isCardCls.toString());
    const res = [];
    for (const c of cards) {
      // last settled moment: walk back from the window end past the exit tween (opacity >= 0.99, scale ~1)
      let t = 0, box = null;
      for (let k = 0; ; k++) {
        t = +Math.max(c.s, c.e - SETTLE_BACK - k * SETTLE_STEP).toFixed(3);
        box = await page.evaluate(([t, id]) => {
          for (const [e, s, d] of window.__gcClips) e.style.visibility = t >= s && t < s + d ? '' : 'hidden';
          const tl = window.__timelines?.[window.__gcCid]; if (tl) tl.seek(t, false);
          document.querySelectorAll('video').forEach((v) => { v.style.visibility = 'hidden'; });
          const el = document.getElementById(id), c = getComputedStyle(el);
          let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= +getComputedStyle(e).opacity;
          const r = el.getBoundingClientRect(), lw = el.offsetWidth || r.width;
          // text runs (card-text.mjs): each visible text node's rendered box and its computed font size
          const texts = [], tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = tw.nextNode(); n; n = tw.nextNode()) {
            const s = n.textContent.replace(/\s+/g, ' ').trim(); if (!s) continue;
            const pc = getComputedStyle(n.parentElement); if (pc.visibility === 'hidden' || +pc.opacity < 0.3) continue;
            const rg = document.createRange(); rg.selectNodeContents(n); const q = rg.getBoundingClientRect();
            if (q.width < 2 || q.height < 2) continue;
            texts.push({ text: s.slice(0, 40), fs: parseFloat(pc.fontSize), x: q.left, y: q.top, w: q.width, h: q.height });
          }
          return { x: r.left, y: r.top, w: r.width, h: r.height, lw, op, sw: r.width / (lw || 1), texts, color: c.backgroundColor, image: c.backgroundImage === 'none' ? '' : c.backgroundImage };
        }, [t, c.id]);
        if ((box.op >= 0.99 && Math.abs(box.sw - 1) <= 0.03) || t <= c.s || k > 40) break;
      }
      const bg = fillColor(box.color, box.image);
      if (!bg || box.w < 4 || box.h < 4) { res.push({ ...c, t, fill: null, why: 'no card fill' }); continue; }
      const ix = box.w * INSET, iy = box.h * INSET;
      const clip = { x: Math.max(0, box.x + ix), y: Math.max(0, box.y + iy), width: Math.max(1, box.w - 2 * ix), height: Math.max(1, box.h - 2 * iy) };
      const b64 = await page.screenshot({ clip, encoding: 'base64' });
      if (process.env.GC_FILL_DUMP) (await import('node:fs')).writeFileSync(path.join(process.env.GC_FILL_DUMP, `${c.id}.png`), Buffer.from(b64, 'base64'));
      const fill = await page.evaluate(async ([b64, bg, diff, src]) => {
        const tiles = new Function(`return ${src}`)();
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
        return tiles(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, bg, { diff });
      }, [b64, bg.rgb, 12, tileShare.toString().replace(/\bTILE_ON\b/, String(TILE_ON)).replace(/\bTILE\b/, String(TILE)).replace(/= DIFF\b/, '= 12')]);
      res.push({ ...c, t, fill, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h), lw: box.lw, texts: box.texts });
    }
    return res;
  } finally { await browser.close(); }
}

async function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length < 1 || pos.length > 2) { console.error('usage: card-fill.mjs <project-dir> [final.mp4] [--min 30] [--json]'); return 2; }
  let wbad = 0;
  if (pos[1]) {
    const { finalCards, judgeWidth } = await import('./card-final.mjs');
    let fc; try { fc = await finalCards(pos[0], pos[1]); } catch (e) { console.error(String(e.message || e)); return 2; }
    for (const c of fc.cards) {
      if (!c.box) { console.log(`  skip CARD WIDTH ${c.tf.toFixed(2)} s #${c.id} (card not found on the frame)`); continue; }
      const j = judgeWidth(c); if (!j.ok) wbad++;
      console.log(`  ${j.ok ? 'ok  ' : 'FAIL'} CARD WIDTH ${c.tf.toFixed(2)} s #${c.id} "${c.text}" ${c.box.w} px = ${j.pct}% on the final frame (DOM ${c.dom.lw} px)${j.ok ? '' : ' (want 55-65%, 594-702 px)'}`);
    }
  }
  const min = +(o.min || MIN_FILL);
  let cards;
  try { cards = await sampleCards(pos[0]); } catch (e) { console.error(String(e.message || e)); return 2; }
  const measured = cards.filter((c) => c.fill !== null), r = judgeFill(measured, min);
  if (o.json) console.log(JSON.stringify(r, null, 1));
  for (const c of r) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} CARD FILL ${c.t.toFixed(2)} s #${c.id} "${c.text}" ${c.w}x${c.h} fill ${c.pct}%${c.ok ? '' : ` < ${min}% (half-empty card: a real visual must fill it)`}`);
  for (const c of cards.filter((c) => c.fill === null)) console.log(`  skip CARD FILL ${c.t.toFixed(2)} s #${c.id} (${c.why})`);
  const bad = r.filter((c) => !c.ok).length;
  console.log(`card-fill: ${bad + wbad ? 'FAIL' : 'PASS'} ${bad} of ${r.length} card(s) under ${min}% fill${pos[1] ? `, ${wbad} outside 55-65% width on the final` : ''}`);
  return bad + wbad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2)).then((c) => { process.exitCode = c; }); // not awaited: card-final <-> card-fill <-> look-check import each other

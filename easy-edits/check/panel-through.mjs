// Easy Edits ink panel see-through on the FINAL video frames (embedded brief, presets/look-bright.json `panel`).
//   node easy-edits/check/panel-through.mjs <project-dir> <final.mp4> [--lead s] [--json]
// The DOM only locates the panels (class token `panel`, `*-panel`, `panel-*` with data-start / data-duration) and
// their box at mid window; the judgement is on pixels. Per panel, SAMPLES frames inside the window (past the 0.3 s
// slide-in, + the post lead-in), the panel box cut into TILE px tiles; tiles holding any bright pixel (luma > 150:
// icons, captions, kinetic words) are dropped; median over the rest of the luma std and the mean |gradient|.
// FAIL when std < MIN_STD or edge < MIN_EDGE (no footage texture) or the mean colour is within NEAR of #0E1116.
// Tile medians calibrated on 1 s hyperframes renders of style2c footage (check/test/fixtures/style2c/panel-*.png):
// flat #0E1116 std 0 / edge 0; rgba(14,17,22,.85) + backdrop blur(24px) 1.51 / 0.14 (reads opaque); .85 over a
// blur(24px) brightness(.6) copy 0.8 / 0.08 (darker still); .72 over a blur(8px) brightness(.8) copy 3.51 / 0.48;
// .70 + backdrop blur(8px) 5.75 / 0.89. gen_th_style2c final: 1.2-1.5 / 0.12-0.15 -> FAIL.
// Exit 1 on FAIL, 2 on usage / no browser.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromePath, launch, leadOffset } from '../tools/dom-sample.mjs';
import { frameAt } from './frame-measure.mjs';
import { probe } from './card-final.mjs';

export const INK = [14, 17, 22], MIN_STD = 3, MIN_EDGE = 0.35, NEAR = 10, TILE = 60, BRIGHT = 150, SAMPLES = 3, ENTRY = 0.4;
const med = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[v.length >> 1] : 0; };

/** frame + box [x, y, w, h] -> {std, edge, mean, tiles}: median tile stats over text-free tiles. */
export function panelStats({ w, h, data }, [bx, by, bw, bh], { tile = TILE, bright = BRIGHT } = {}) {
  const L = (x, y) => { const i = 3 * (y * w + x); return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  const st = [], ed = [], mr = [], mg = [], mb = [];
  for (let ty = Math.max(0, by); ty + tile <= Math.min(h, by + bh); ty += tile) for (let tx = Math.max(0, bx); tx + tile <= Math.min(w, bx + bw); tx += tile) {
    let n = 0, s = 0, s2 = 0, g = 0, r = 0, gg = 0, b = 0, hot = false;
    for (let y = ty; y < ty + tile - 1 && !hot; y++) for (let x = tx; x < tx + tile - 1; x++) {
      const l = L(x, y); if (l > bright) { hot = true; break; }
      const i = 3 * (y * w + x); r += data[i]; gg += data[i + 1]; b += data[i + 2];
      s += l; s2 += l * l; g += Math.abs(L(x + 1, y) - l) + Math.abs(L(x, y + 1) - l); n++;
    }
    if (hot || !n) continue;
    const mu = s / n; st.push(Math.sqrt(Math.max(0, s2 / n - mu * mu))); ed.push(g / n); mr.push(r / n); mg.push(gg / n); mb.push(b / n);
  }
  return { std: +med(st).toFixed(2), edge: +med(ed).toFixed(2), mean: [med(mr), med(mg), med(mb)].map((v) => +v.toFixed(1)), tiles: st.length };
}

/** stats -> {ok, why[]} */
export function judgePanel(s, { minStd = MIN_STD, minEdge = MIN_EDGE, near = NEAR } = {}) {
  const why = [], d = Math.hypot(...s.mean.map((v, k) => v - INK[k]));
  if (s.std < minStd) why.push(`luma std ${s.std} < ${minStd}`);
  if (s.edge < minEdge) why.push(`edge ${s.edge} < ${minEdge}`);
  if (d < near) why.push(`mean rgb(${s.mean.join(',')}) within ${near} of #0E1116`);
  return { ok: !why.length && s.tiles > 0, why: s.tiles ? why : ['no text-free tile'], dist: +d.toFixed(1) };
}

export async function panelBoxes(proj) {
  const exe = chromePath();
  if (!exe) throw new Error('panel-through: no chrome-headless-shell (run `npx hyperframes browser ensure`)');
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
        const r = el.getBoundingClientRect();
        out.push({ id: el.id, s, e: s + d, x: Math.round(Math.max(0, r.left)), y: Math.round(Math.max(0, r.top)), w: Math.round(Math.min(1080, r.right) - Math.max(0, r.left)), h: Math.round(Math.min(1920, r.bottom) - Math.max(0, r.top)) });
      }
      return out;
    });
  } finally { await browser.close(); }
}

async function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 2) { console.error('usage: panel-through.mjs <project-dir> <final.mp4> [--lead s] [--json]'); return 2; }
  const [proj, video] = pos;
  let panels;
  try { panels = await panelBoxes(proj); } catch (e) { console.error(String(e.message || e)); return 2; }
  const html = fs.readFileSync(path.join(proj, 'index.html'), 'utf8');
  const comp = +(/data-composition-id[^>]*data-duration="([\d.]+)"|data-duration="([\d.]+)"[^>]*data-composition-id/.exec(html)?.slice(1).find(Boolean) || 0);
  const lead = o.lead != null ? +o.lead : leadOffset(probe(video).dur, comp);
  let bad = 0;
  for (const p of panels) {
    const a = p.s + ENTRY, b = p.e - ENTRY;
    for (let k = 0; k < SAMPLES; k++) {
      const t = +(a + (b - a) * (k + 0.5) / SAMPLES + lead).toFixed(3);
      const s = panelStats(frameAt(video, t), [p.x, p.y, p.w, p.h]), j = judgePanel(s);
      if (o.json) console.log(JSON.stringify({ id: p.id, t, ...s, ...j }));
      if (!j.ok) bad++;
      console.log(`  ${j.ok ? 'ok  ' : 'FAIL'} PANEL THROUGH ${t.toFixed(2)} s #${p.id} std ${s.std} edge ${s.edge} mean rgb(${s.mean.join(',')}) (${s.tiles} tiles)${j.ok ? '' : `: ${j.why.join(', ')} (opaque-looking: footage must show through)`}`);
    }
  }
  console.log(`panel-through: ${bad ? 'FAIL' : 'PASS'} ${bad} of ${panels.length * SAMPLES} panel frame(s) without footage texture (std >= ${MIN_STD}, edge >= ${MIN_EDGE}, lead ${lead} s)`);
  return bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });

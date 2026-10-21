// Easy Edits card measurement on the FINAL video frames (card-fill --final, look-check --final, card-text,
// caption-face-final): the DOM (card-fill sampleCards) only gives each card's settled time, a candidate box and
// its text runs; the card box and the type size are measured on the encoded frame.
//   card box   frame at the settled time (+ the post lead-in, minus FRAME_BACK so the exit tween has not begun)
//              scaled to 1080 x 1920, near-white connected component (frame-measure whiteCard) seeded by the DOM
//              box grown by SEED_PAD: its bbox. The card-back (rotated sheet behind) is part of it (+~9 px).
//   type size  each DOM text run, shifted by (frame card - DOM card), ink = pixels whose luma differs from the run
//              box's median luma by >= INK (dark on white / yellow, white on an ink pill); the longest run of ink rows
//              is the cap height (caps-only Montserrat). font px = cap height / CAP_EM.
// Why the numbers differ from a hand measurement: frames from the 720 x 1280 `_mobile` / `_phone` derivatives
// carry 2/3 of the pixels (a 648 px card is 432 px there; 432 / 1080 = 40%). Everything here is 1080-wide px.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sampleCards } from './card-fill.mjs';
import { frameAt } from './frame-measure.mjs';
import { whiteCard } from './frame-measure.mjs';
import { leadOffset } from '../tools/dom-sample.mjs';

// AA: the ink threshold catches ~1 px of anti-aliasing (44 px Montserrat Black caps read 31 px; 32 px read 24).
export const AA = 1, FRAME_BACK = 0.1, SEED_PAD = 40, INK = 80, CAP_EM = 0.70, W = 1080, H = 1920;

export function probe(video) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', video], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout); return { w: j.streams[0].width, h: j.streams[0].height, dur: +j.format.duration };
}

/** frame + run box [x, y, w, h] -> cap height px (longest run of rows with >= 2 ink pixels), or 0. */
export function capHeight({ w, data }, [bx, by, bw, bh], ink = INK) {
  const x0 = Math.max(0, Math.round(bx)), x1 = Math.min(w, Math.round(bx + bw)), y0 = Math.max(0, Math.round(by)), y1 = Math.round(by + bh);
  const L = (x, y) => { const i = 3 * (y * w + x); return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  const all = []; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x += 2) all.push(L(x, y));
  if (!all.length) return 0;
  all.sort((a, b) => a - b); const m = all[all.length >> 1];
  let best = 0, run = 0;
  for (let y = y0; y < y1; y++) {
    let n = 0; for (let x = x0; x < x1; x++) if (Math.abs(L(x, y) - m) >= ink) n++;
    run = n >= 2 ? run + 1 : 0; if (run > best) best = run;
  }
  return best;
}

/** cards from sampleCards + frame(t) -> [{id, text, t, tf, dom, box, texts: [{text, fs, cap, px}]}] */
export function measureCards(cards, frameOf, lead = 0) {
  return cards.filter((c) => c.w > 4).map((c) => {
    const tf = +Math.max(0, c.t + lead - FRAME_BACK).toFixed(3), f = frameOf(tf);
    const box = whiteCard(f, [c.x - SEED_PAD, c.y - SEED_PAD, c.w + 2 * SEED_PAD, c.h + 2 * SEED_PAD]);
    const dx = box ? box.x - c.x : 0, dy = box ? box.y - c.y : 0;
    const texts = (c.texts || []).map((r) => { const cap = capHeight(f, [r.x + dx, r.y + dy, r.w, r.h]); return { text: r.text, fs: r.fs, y: r.y, h: r.h, cap, px: +(Math.max(0, cap - AA) / CAP_EM).toFixed(1) }; });
    return { id: c.id, text: c.text, s: c.s, e: c.e, t: c.t, tf, dom: { x: c.x, y: c.y, w: c.w, h: c.h, lw: c.lw }, box, texts };
  });
}

/** project + final video -> {lead, cards: measureCards()} (all px in 1080-wide output units). */
export async function finalCards(proj, video, { lead } = {}) {
  const info = probe(video), cards = await sampleCards(proj);
  const html = (await import('node:fs')).readFileSync(path.join(proj, 'index.html'), 'utf8');
  const comp = +(/data-composition-id[^>]*data-duration="([\d.]+)"|data-duration="([\d.]+)"[^>]*data-composition-id/.exec(html)?.slice(1).find(Boolean) || 0);
  const ld = lead ?? leadOffset(info.dur, comp);
  return { lead: ld, cards: measureCards(cards, (t) => frameAt(video, t, { w: W, h: H }), ld) };
}

export const BODY_MIN = 34, HEAD_MIN = 44, CARD_W = [0.55, 0.65];
/** measured card -> {head: px | null, body: [{text, px}], bad: [...]}: headline = the runs on the first text
 *  line (top within half a run height of the topmost run), measured as the line's tallest run; body = the rest. */
export function judgeText(c, { body = BODY_MIN, head = HEAD_MIN } = {}) {
  const runs = c.texts.filter((r) => r.cap > 0);
  if (!runs.length) return { head: null, body: [], bad: [] };
  const top = Math.min(...runs.map((r) => r.y)), first = runs.filter((r) => r.y <= top + r.h / 2), rest = runs.filter((r) => !first.includes(r));
  const hp = Math.max(...first.map((r) => r.px)), bad = [];
  if (hp < head) bad.push({ role: 'headline', text: first.map((r) => r.text).join(' '), px: hp, min: head });
  for (const r of rest) if (r.px < body) bad.push({ role: 'body', text: r.text, px: r.px, min: body });
  return { head: hp, body: rest.map((r) => ({ text: r.text, px: r.px })), bad };
}
/** measured card -> {pct, ok} on the frame width (1080 units). */
export const judgeWidth = (c, W0 = W, [lo, hi] = CARD_W) => { const pct = +(100 * c.box.w / W0).toFixed(1); return { pct, ok: pct >= 100 * lo && pct <= 100 * hi }; };

export const ENTRY = 0.35;
/** measured cards -> (t composition s) -> [{id, text, kind: 'card', box}] on screen SETTLED (entry tween done,
 *  up to the settled sample time) at the box MEASURED on the final frame. */
export const cardBoxesAt = (cards) => (t) => cards.filter((c) => c.box && t >= c.s + ENTRY && t <= c.t)
  .map((c) => ({ id: c.id, text: c.text, kind: 'card', box: { x0: c.box.x, y0: c.box.y, x1: c.box.x + c.box.w, y1: c.box.y + c.box.h } }));

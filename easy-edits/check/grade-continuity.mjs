// Easy Edits grade continuity on the FINAL: the grade is applied once (look grade.applyAt: baked into assets/clip.mp4
// in one pass), so footage must not jump in exposure or colour where one clip meets the next. At every keep
// boundary (assets/edit-decisions.json keeps[].start), plan.json scene start and composition camera move (a
// `#push` / wrapper scale tl.to / tl.set in index.html), shifted by the post lead-in, compare frames 0.07-0.27 s
// before with 0.07-0.27 s after on 108x192 RGB (idea-panel scenes skipped: their entry / exit is an overlay change), on pixels that are footage in both (overlay pixels masked: near
// white, key yellow, near black text strokes):
//   luma  mean Rec.709 luma, relative change > 6%        sat  mean HSV saturation, relative change > 12%
//   R-B   mean (R - B) balance, absolute change > 0.025 (warm -> cool)
// Camera / punch boundaries (gen_th_style2c 13.10 s: .push 1.04 -> 1 punch-out + white card #c3 exit, -24.5% luma on
// the SAME grade): the wider side is cropped to the tighter side's view from the DOM transform (`.push` / `.spkw` /
// `#push` / `#spkwrap` scale, nested wrappers composed) and scaled back to 108x192, and overlay card boxes (`.slot` /
// `.card` clips live in either window: left, top from style, 662 px wide, CARD_H tall) are masked out of both sides.
// FAIL GRADE JUMP when 2 of the 3 move (one alone is often a real lighting change in the source); WARN for one.
//   node easy-edits/check/grade-continuity.mjs <project-dir> <final.mp4> [--json]
// CUTAWAYS (lib/cutaways.mjs: plan.json broll / cutaway / footage scenes): a boundary with a cutaway on one side and
// the speaker on the other is a content change, reported "skip (cutaway in/out)"; speaker -> speaker and
// cutaway -> cutaway boundaries are judged as above.
// Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { projectCutaways, sideOf } from './lib/cutaways.mjs';

export const W = 108, H = 192, LUMA = 0.06, SAT = 0.12, RB = 0.025;
const durOf = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);
export function frames(video, a, b) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, a)), '-t', String(b - a), '-i', video, '-vf', `fps=30,scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  const n = Math.floor(r.stdout.length / (W * H * 3)), out = [];
  for (let i = 0; i < n; i++) out.push(r.stdout.subarray(i * W * H * 3, (i + 1) * W * H * 3));
  return out;
}
/** index.html -> (t) => {a, b}: the composed speaker camera (screen = a * x + b per axis) from wrapper scale tweens. */
export function cameraAt(html) {
  const layers = [];
  for (const sel of ['.push', '#push', '.spkw', '#spkwrap']) {
    const esc = sel.replace('.', '\\.'), css = new RegExp(`${esc}[^{]*\\{[^}]*transform-origin:([\\d.]+)px ([\\d.]+)px`).exec(html.replace(/,\s*(?=[.#])/g, ' '));
    const ev = [];
    for (const m of html.matchAll(/tl\.(set|to|fromTo)\('([^']+)',(\{[^}]*\})(?:,(\{[^}]*\}))?,([\d.]+)\)/g)) {
      if (m[2] !== sel) continue;
      const to = m[1] === 'fromTo' ? m[4] : m[3], sc = /scale:([\d.]+)/.exec(to); if (!sc) continue;
      const from = m[1] === 'fromTo' ? /scale:([\d.]+)/.exec(m[3]) : null, d = /duration:([\d.]+)/.exec(to);
      ev.push({ t: +m[5], s: +sc[1], from: from ? +from[1] : null, dur: m[1] !== 'set' && d ? +d[1] : 0 });
    }
    if (ev.length) layers.push({ ev: ev.sort((a, b) => a.t - b.t), ox: css ? +css[1] : 540, oy: css ? +css[2] : 960 });
  }
  const scaleAt = (ev, t) => { let s = 1; for (const e of ev) { if (e.t > t) break; const s0 = e.from ?? s; s = e.dur && t < e.t + e.dur ? s0 + (e.s - s0) * (t - e.t) / e.dur : e.s; } return s; };
  return (t) => layers.reduceRight((c, l) => { const s = scaleAt(l.ev, t); return { a: s * c.a, bx: s * c.bx + l.ox * (1 - s), by: s * c.by + l.oy * (1 - s) }; }, { a: 1, bx: 0, by: 0 });
}
export const CARD_H = 720;
/** Overlay card boxes (composition px [x, y, w, h]) of `.slot` / card clips live in [a, b]. */
export function cardBoxes(html, a, b) {
  const out = [];
  for (const m of html.matchAll(/<div\b[^>]*class="[^"]*\b(?:slot|card)\b[^"]*"[^>]*>/g)) {
    const st = /data-start="([\d.]+)"/.exec(m[0]), du = /data-duration="([\d.]+)"/.exec(m[0]); if (!st || !du) continue;
    if (+st[1] > b || +st[1] + +du[1] < a) continue;
    const top = /top:([\d.]+)px/.exec(m[0]), left = /left:([\d.]+)px/.exec(m[0]);
    out.push([(left ? +left[1] : 216) - 20, (top ? +top[1] : 960) - 60, 702, CARD_H]);
  }
  return out;
}
/** Crop a W x H frame (1080x1920 composition px rect) and resample it back to W x H (bilinear). */
export function cropTo(f, [x, y, w, h]) {
  const o = Buffer.alloc(W * H * 3), sx = W / 1080, sy = H / 1920;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = Math.min(W - 1, Math.max(0, (x + (i + 0.5) * w / W) * sx - 0.5)), v = Math.min(H - 1, Math.max(0, (y + (j + 0.5) * h / H) * sy - 0.5));
    const i0 = Math.floor(u), j0 = Math.floor(v), i1 = Math.min(W - 1, i0 + 1), j1 = Math.min(H - 1, j0 + 1), fu = u - i0, fv = v - j0;
    for (let c = 0; c < 3; c++) {
      const p = (ii, jj) => f[3 * (jj * W + ii) + c];
      o[3 * (j * W + i) + c] = Math.round((p(i0, j0) * (1 - fu) + p(i1, j0) * fu) * (1 - fv) + (p(i0, j1) * (1 - fu) + p(i1, j1) * fu) * fv);
    }
  }
  return o;
}
/** Align a camera boundary: crop the wider side to the tighter side's view (camera {a, bx, by} before / after);
 *  boxes (composition px) are masked on their own side and mapped into the aligned view. -> {before, after, masks}. */
export function alignCamera(before, after, cb, ca, boxes = []) {
  const k = ca.a / cb.a, wide = k >= 1 ? 'before' : 'after', [cw, ct] = k >= 1 ? [cb, ca] : [ca, cb];
  // a screen point p on the tight side shows source x = (p - b_t) / a_t, which the wide side shows at a_w * x + b_w
  const r = cw.a / ct.a, rect = [cw.bx - ct.bx * r, cw.by - ct.by * r, 1080 * r, 1920 * r];
  const map = ([x, y, w, h]) => [(x - rect[0]) / r, (y - rect[1]) / r, w / r, h / r];
  const fs_ = { before, after }; fs_[wide] = fs_[wide].map((f) => cropTo(f, rect));
  return { before: fs_.before, after: fs_.after, masks: [...boxes, ...boxes.map(map)] };
}
const overlay = (r, g, b) => (r > 225 && g > 225 && b > 225) || (r > 200 && g > 170 && b < 80) || (r < 20 && g < 22 && b < 28);
/** before / after frame lists -> {luma, sat, rb} for each side on the shared footage mask. */
export function sideStats(before, after, boxes = []) {
  const mask = new Uint8Array(W * H).fill(1);
  for (const [x, y, w, h] of boxes) for (let j = Math.max(0, Math.floor(y * H / 1920)); j < Math.min(H, Math.ceil((y + h) * H / 1920)); j++)
    for (let i = Math.max(0, Math.floor(x * W / 1080)); i < Math.min(W, Math.ceil((x + w) * W / 1080)); i++) mask[j * W + i] = 0;
  for (const f of [...before, ...after]) for (let p = 0; p < W * H; p++) if (overlay(f[3 * p], f[3 * p + 1], f[3 * p + 2])) mask[p] = 0;
  const st = (fs_) => {
    let y = 0, s = 0, rb = 0, n = 0;
    for (const f of fs_) for (let p = 0; p < W * H; p++) {
      if (!mask[p]) continue;
      const r = f[3 * p] / 255, g = f[3 * p + 1] / 255, b = f[3 * p + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      y += 0.2126 * r + 0.7152 * g + 0.0722 * b; s += mx > 0 ? (mx - mn) / mx : 0; rb += r - b; n++;
    }
    return { luma: y / n, sat: s / n, rb: rb / n, px: n / fs_.length };
  };
  return { before: st(before), after: st(after) };
}
export function judge({ before: a, after: b }) {
  const dl = (b.luma - a.luma) / a.luma, ds = (b.sat - a.sat) / a.sat, drb = b.rb - a.rb;
  const moved = [Math.abs(dl) > LUMA && 'luma', Math.abs(ds) > SAT && 'sat', Math.abs(drb) > RB && 'R-B'].filter(Boolean);
  return { dl: +dl.toFixed(3), ds: +ds.toFixed(3), drb: +drb.toFixed(3), moved, verdict: moved.length >= 2 ? 'FAIL' : moved.length ? 'WARN' : 'ok' };
}
/** boundaries [{t}] + cutaway spans -> same rows, cutaway in / out ones marked {skip: 'cutaway in/out'}. */
export const markCutaways = (rows, spans) => rows.map((b) => { const s = sideOf(spans, b.t); return s.before !== s.after ? { ...b, skip: 'cutaway in/out' } : b; });
/** Boundary times (composition seconds) with a reason. */
export function boundaries(proj) {
  const out = [], J = (f) => { try { return JSON.parse(fs.readFileSync(path.join(proj, f), 'utf8')); } catch { return null; } };
  for (const k of J('assets/edit-decisions.json')?.keeps || []) if (k.start > 0.3) out.push({ t: +k.start, why: 'keep' });
  for (const s of J('assets/plan.json')?.scenes || []) if (s.start > 0.3) out.push({ t: +s.start, why: `scene ${s.id} ${s.layout || ''}`.trim() });
  const html = fs.existsSync(path.join(proj, 'index.html')) ? fs.readFileSync(path.join(proj, 'index.html'), 'utf8') : '';
  for (const m of html.matchAll(/tl\.(?:to|set)\('([^']*(?:push|wrap)[^']*)',\{[^}]*scale:[^}]*\},([\d.]+)\)/g)) if (+m[2] > 0.3) out.push({ t: +m[2], why: `camera ${m[1]}` });
  // an idea-panel scene (layout paper / panel / ink) changes the overlay, not the grade: skip its entry and exit
  const panels = (J('assets/plan.json')?.scenes || []).filter((s) => /paper|panel|ink|idea/i.test(`${s.layout} ${s.kind}`));
  const inPanel = (t) => panels.some((s) => t >= s.start - 0.3 && t <= s.end + 0.3);
  const ts = out.filter((b) => !inPanel(b.t)).sort((a, b) => a.t - b.t), kept = [];
  for (const b of ts) { const l = kept.at(-1); if (l && b.t - l.t <= 0.15) { if (!l.why.split(", ").includes(b.why)) l.why += `, ${b.why}`; } else kept.push({ ...b }); }
  return kept;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2), [proj, video] = argv.filter((a) => !a.startsWith('--'));
  if (!proj || !video || !fs.existsSync(video)) { console.error('usage: grade-continuity.mjs <project-dir> <final.mp4> [--json]'); process.exit(2); }
  const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(proj, 'assets/edit-decisions.json'), 'utf8')); } catch { return {}; } })();
  const dur = durOf(video), off = meta.duration ? Math.max(0, +(dur - meta.duration).toFixed(3)) : 0;
  const html = fs.existsSync(path.join(proj, 'index.html')) ? fs.readFileSync(path.join(proj, 'index.html'), 'utf8') : '', cam = cameraAt(html);
  const rows = markCutaways(boundaries(proj), projectCutaways(proj)).filter((b) => b.t + off + 0.3 < dur).map((b) => {
    if (b.skip) return { ...b, at: +(b.t + off).toFixed(2), verdict: 'skip' };
    const t = b.t + off, bf = frames(video, t - 0.27, t - 0.07), af = frames(video, t + 0.07, t + 0.27);
    const j = judge(/camera|punch/.test(b.why) ? (({ before, after, masks }) => sideStats(before, after, masks))(alignCamera(bf, af, cam(b.t - 0.17), cam(b.t + 0.17), cardBoxes(html, b.t - 0.27, b.t + 0.27))) : sideStats(bf, af));
    return { ...b, at: +t.toFixed(2), ...j };
  });
  const bad = rows.filter((r) => r.verdict === 'FAIL');
  if (argv.includes('--json')) console.log(JSON.stringify({ pass: !bad.length, offset: off, rows }, null, 1));
  else {
    for (const r of rows) if (r.skip) console.log(`  skip (${r.skip}) ${r.at.toFixed(2)} s (${r.why})`); else console.log(`  ${r.verdict === 'FAIL' ? 'FAIL GRADE JUMP' : r.verdict === 'WARN' ? 'WARN' : 'ok  '} ${r.at.toFixed(2)} s (${r.why}): luma ${r.dl > 0 ? '+' : ''}${(r.dl * 100).toFixed(1)}%, sat ${r.ds > 0 ? '+' : ''}${(r.ds * 100).toFixed(1)}%, R-B ${r.drb > 0 ? '+' : ''}${r.drb}`);
    console.log(`grade-continuity: ${bad.length ? 'FAIL' : 'PASS'} ${bad.length}/${rows.length} boundaries jump in 2+ of luma (> ${LUMA * 100}%), saturation (> ${SAT * 100}%), R-B (> ${RB}) (lead-in ${off} s, ${rows.filter((r) => r.skip).length} skipped: cutaway in/out)`);
  }
  process.exit(bad.length ? 1 : 0);
}

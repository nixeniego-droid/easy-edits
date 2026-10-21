// Easy Edits source prep: measure the raw source once, before the edit agent starts, so the agent does not re-probe it.
//   node easy-edits/tools/source-prep.mjs <source.mp4> <out-dir> [--transcript words.json]
// Writes <out-dir>/source-prep.json and <out-dir>/source-prep-sheet.png:
//   source  duration, fps, size, aspect, audio
//   scenes  cuts (ffmpeg scene score + a 0.5 s-lag thumbnail diff that also catches dissolves and flashes), each
//           with a kind guess (speaker / cutaway / screen-recording / title-card / flash; camera without faces), the face box, a 9:16 crop
//           and the 1080x1920 cover transform centred on the face, letterbox (cropdetect), speech share
//   head    title-card / flash frames before the first clean frame, first word time
//   gapCuts internal pauses > 0.15 s (speech-band silencedetect) as cuts [start + 40 ms, end - 40 ms] (gap-cuts.mjs)
//   events  screen-recording changes (page loads, scrolls, typing) with the words spoken around them, each with a
//           recommended crop-zoom `zoom` {x,y,w,h,scale} (source px, source aspect, <= 2.5x) on its region of change
//           for a browser / laptop frame (zoom-rect.mjs)
// Faces: OpenCV Haar cascades (source-prep-faces.py) via $EASY_EDITS_PYTHON or python3, whichever imports cv2.
// Without OpenCV (or EASY_EDITS_PREP_FACES=0) crops come from a motion + edge saliency window; the JSON says which.
// Stutter / restart cut candidates (cut-candidates.mjs -> <out-dir>/source.cut-candidates.json/.md): always run by
// default; a cache hit is ~0 s, a miss decodes the suspect windows (~35 s for 30 s of speech) and fills the cache.
// EASY_EDITS_CUTCAND=0 = skipped with a note.
// Sheet: one tile per scene (plus fillers in long scenes); yellow box = 9:16 crop, cyan box = face.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zoomRect } from './zoom-rect.mjs';
import { gapCuts } from './gap-cuts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [src, outDir] = argv;
if (!src || !outDir || src.startsWith('--') || outDir.startsWith('--')) {
  console.error('usage: source-prep.mjs <source.mp4> <out-dir> [--transcript words.json]'); process.exit(2);
}
if (!fs.existsSync(src)) { console.error(`source-prep: missing ${src}`); process.exit(2); }
const TRANSCRIPT = opt('--transcript');
const T_START = Date.now();
const r3 = (v) => Math.round(v * 1000) / 1000, r2 = (v) => Math.round(v * 100) / 100;
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- probe
const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', src], { encoding: 'utf8' }));
const vs = pr.streams.find((s) => s.codec_type === 'video');
if (!vs) { console.error('source-prep: no video stream'); process.exit(2); }
const W = vs.width, H = vs.height, DUR = Number(pr.format.duration);
const [fn, fd] = vs.avg_frame_rate.split('/').map(Number), FPS = r3(fn / (fd || 1));
const words = TRANSCRIPT ? (JSON.parse(fs.readFileSync(TRANSCRIPT, 'utf8')).words || []).filter((w) => (w.type || 'word') === 'word') : null;

// ---- three passes in parallel: scene scores (full fps), stats frames (4 fps gray 320 px + cropdetect), faces (2 fps)
const SF = 4, SW = Math.min(320, W) & ~1, SH = Math.round(H * SW / W / 2) * 2;
const BK = 4, DW = Math.floor(SW / BK), DH = Math.floor(SH / BK);   // diff map blocks
const TB = 10, TW = Math.floor(SW / TB), TH = Math.floor(SH / TB);  // thumbnail blocks
function run(cmd, args, onStdout) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (onStdout ? onStdout(d) : (out += d)));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
  });
}

const sceneP = run('ffmpeg', ['-v', 'info', '-nostats', '-i', src, '-an', '-vf',
  `scale=${SW}:${SH},select='gt(scene,0.15)',metadata=print:key=lavfi.scene_score`, '-f', 'null', '-']);

const frames = []; let prevPix = null, pending = Buffer.alloc(0);
const FSZ = SW * SH;
function statFrame(pix) {
  const i = frames.length, f = { t: r3(i / SF) };
  let sum = 0, sq = 0; for (let k = 0; k < FSZ; k++) { sum += pix[k]; sq += pix[k] * pix[k]; }
  f.mean = sum / FSZ; f.std = Math.sqrt(Math.max(0, sq / FSZ - f.mean * f.mean));
  // thumbnail (TB x TB block means) for the lagged scene diff
  const th = new Float32Array(TW * TH);
  for (let y = 0; y < TH * TB; y++) for (let x = 0; x < TW * TB; x++) th[((y / TB) | 0) * TW + ((x / TB) | 0)] += pix[y * SW + x];
  for (let k = 0; k < th.length; k++) th[k] /= TB * TB;
  f.thumb = th;
  // flat 8x8 blocks (UI, cards) and horizontal edge energy per column (saliency)
  let flat = 0, nb = 0;
  for (let by = 0; by + 8 <= SH; by += 8) for (let bx = 0; bx + 8 <= SW; bx += 8) {
    let lo = 255, hi = 0;
    for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) { const v = pix[y * SW + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
    nb++; if (hi - lo <= 2) flat++;
  }
  f.flat = flat / nb;
  const edge = new Float32Array(SW);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW - 1; x++) edge[x] += Math.abs(pix[y * SW + x + 1] - pix[y * SW + x]);
  f.edge = edge;
  if (prevPix) {
    let still = 0, changed = 0, x0 = SW, y0 = SH, x1 = -1, y1 = -1;
    const motion = new Float32Array(SW), dmap = new Float32Array(DW * DH);
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const k = y * SW + x, d = Math.abs(pix[k] - prevPix[k]);
      if (d <= 1) still++;
      if (d > 8) { changed++; motion[x]++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x < DW * BK && y < DH * BK) dmap[((y / BK) | 0) * DW + ((x / BK) | 0)] += d;
    }
    f.still = still / FSZ; f.changed = changed / FSZ; f.motion = motion; f.dmap = dmap;
    f.box = x1 >= 0 ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : null;
  }
  prevPix = pix;
  frames.push(f);
}
const statP = run('ffmpeg', ['-v', 'info', '-nostats', '-i', src, '-an', '-vf',
  `fps=${SF},scale=${SW}:${SH},cropdetect=limit=24:round=2:reset=1,format=gray`, '-f', 'rawvideo', '-'], (d) => {
  pending = pending.length ? Buffer.concat([pending, d]) : d;
  while (pending.length >= FSZ) { statFrame(Uint8Array.from(pending.subarray(0, FSZ))); pending = pending.subarray(FSZ); }
});

let facePy = null;
if (process.env.EASY_EDITS_PREP_FACES !== '0') {
  for (const py of [process.env.EASY_EDITS_PYTHON, 'python3'].filter(Boolean)) {
    if (spawnSync(py, ['-c', 'import cv2'], { stdio: 'ignore' }).status === 0) { facePy = py; break; }
  }
}
const FACE_FPS = 2;
const faceP = facePy ? run(facePy, [path.join(HERE, 'source-prep-faces.py'), src, String(FACE_FPS), '512']) : Promise.resolve(null);

const [sceneR, statR, faceR] = await Promise.all([sceneP, statP, faceP]);
if (statR.code !== 0 || !frames.length) { console.error('source-prep: ffmpeg stats pass failed\n' + statR.err.slice(-800)); process.exit(2); }
let faceFrames = [], detector = 'none';
if (faceR && faceR.code === 0) {
  const j = JSON.parse(faceR.out); faceFrames = j.frames; detector = `${j.detector} via ${facePy}`;
} else if (faceR) detector = `none (face helper exit ${faceR.code})`;

// hard cuts with their scores
const hard = [];
{ let t = null; for (const l of sceneR.err.split('\n')) {
  const m = l.match(/pts_time:([\d.]+)/); if (m) t = Number(m[1]);
  const s = l.match(/lavfi\.scene_score=([\d.]+)/); if (s && t != null) { hard.push({ t, score: Number(s[1]) }); t = null; }
} }
// cropdetect per stats frame (320 px coords)
const crops = [];
for (const l of statR.err.split('\n')) {
  const m = l.match(/ t:([\d.]+).*crop=(\d+):(\d+):(\d+):(\d+)/); if (m) crops.push({ t: Number(m[1]), w: +m[2], h: +m[3], x: +m[4], y: +m[5] });
}

// ---- scene boundaries
const N = frames.length;
const d2 = frames.map((f, i) => {
  if (i < 2) return 0; const a = f.thumb, b = frames[i - 2].thumb; let s = 0;
  for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); return s / a.length;
});
const DTH = 20, cuts = new Set(), transitions = [];
for (let i = 0; i < N; i++) {
  if (d2[i] < DTH) continue;
  let j = i; while (j + 1 < N && d2[j + 1] >= DTH) j++;
  const t0 = (i - 2) / SF, t1 = j / SF;
  const inRun = hard.filter((h) => h.t > t0 - 0.05 && h.t <= t1 + 0.05);
  if (inRun.length) {
    cuts.add(r3(inRun[0].t)); const last = inRun[inRun.length - 1].t;
    if (last - inRun[0].t > 0.1) cuts.add(r3(last));
  } else if (t1 - t0 <= 0.75) cuts.add(r3((i - 1) / SF));
  else { cuts.add(r3(t0 + 0.25)); cuts.add(r3(t1)); transitions.push([r3(t0 + 0.25), r3(t1)]); }
  i = j;
}
for (const h of hard) if (h.score >= 0.3) cuts.add(r3(h.t));
let bounds = [0, ...[...cuts].filter((t) => t > 0.05 && t < DUR - 0.05).sort((a, b) => a - b), r3(DUR)];
bounds = bounds.filter((t, i) => i === 0 || t - bounds[i - 1] >= 0.1);
const inSpan = (arr, s, e) => arr.filter((f) => f.t >= s && f.t < e);
const nearest = (arr, t) => arr.reduce((b, f) => (Math.abs(f.t - t) < Math.abs(b.t - t) ? f : b), arr[0]);
// flash / black frame: a short span much brighter or darker than the second around it
// (classified later: a dark span with contrast, e.g. white text on black, is a slate / title card)
const isFlashSpan = (s, e) => {
  if (e - s > 1) return false;
  const fs_ = inSpan(frames, s, e).length ? inSpan(frames, s, e) : [nearest(frames, (s + e) / 2)];
  const m = median(fs_.map((f) => f.mean));
  const around = [...inSpan(frames, s - 1, s), ...inSpan(frames, e, e + 1)].map((f) => f.mean);
  return m > 225 || m < 14 || ((m > 190 || m < 25) && around.length > 0 && Math.abs(m - median(around)) > 50);
};
// merge spans shorter than 0.35 s into the previous one, except flashes
for (let k = 1; k < bounds.length - 1;) {
  const s = bounds[k - 1], e = bounds[k], next = bounds[k + 1];
  if (e - s < 0.35 && !isFlashSpan(s, e) && k > 1) { bounds.splice(k - 1, 1); continue; }
  if (next - e < 0.35 && !isFlashSpan(e, next)) { bounds.splice(k, 1); continue; }
  k++;
}

// ---- faces: global clusters
const clusters = [];
for (const ff of faceFrames) for (const b of ff.faces) {
  const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
  let c = clusters.find((c) => Math.abs(cx - c.cx) < 0.08 * W && Math.abs(cy - c.cy) < 0.1 * H && b[2] / c.size > 0.67 && b[2] / c.size < 1.5);
  if (!c) { c = { id: clusters.length, cx, cy, size: b[2], hits: [] }; clusters.push(c); }
  c.hits.push({ t: ff.t, b });
  const n = c.hits.length; c.cx += (cx - c.cx) / n; c.cy += (cy - c.cy) / n; c.size += (b[2] - c.size) / n;
}
const mainCl = clusters.reduce((m, c) => (!m || c.hits.length * c.size > m.hits.length * m.size ? c : m), null);
const medBox = (hits) => [0, 1, 2, 3].map((k) => Math.round(median(hits.map((h) => h.b[k]))));

// ---- 9:16 crop + 1080x1920 cover transform for a focus point
const portraitish = W / H <= 9 / 16 + 0.01;
const CW = portraitish ? W : Math.round(H * 9 / 16) & ~1, CH = portraitish ? Math.min(H, Math.round(W * 16 / 9) & ~1) : H;
function cropFor(fx, fy) {
  const x = Math.round(clamp(fx - CW / 2, 0, W - CW)), y = Math.round(clamp(fy - CH * 0.38, 0, H - CH));
  const scale = 1080 / CW;
  return { crop: { x, y, w: CW, h: CH }, cover1080x1920: { scale: r3(scale), x: r2(-x * scale), y: r2(-y * scale) } };
}
function saliency(fs_) {
  const col = new Float32Array(SW), mo = new Float32Array(SW), ed = new Float32Array(SW);
  for (const f of fs_) { if (f.motion) for (let x = 0; x < SW; x++) mo[x] += f.motion[x]; for (let x = 0; x < SW; x++) ed[x] += f.edge[x]; }
  const mm = Math.max(...mo) || 1, em = Math.max(...ed) || 1;
  for (let x = 0; x < SW; x++) col[x] = mo[x] / mm + 0.5 * ed[x] / em;
  const cw = Math.max(1, Math.round(CW * SW / W)); let best = 0, bx = 0, s = 0;
  for (let x = 0; x < SW; x++) { s += col[x]; if (x >= cw) s -= col[x - cw]; if (x >= cw - 1 && s > best) { best = s; bx = x - cw + 1; } }
  return (bx + cw / 2) * W / SW;
}
const mouthMotion = (fs_, b) => {
  const x0 = Math.floor((b[0] + 0.2 * b[2]) * SW / W / BK), x1 = Math.ceil((b[0] + 0.8 * b[2]) * SW / W / BK);
  const y0 = Math.floor((b[1] + 0.6 * b[3]) * SH / H / BK), y1 = Math.ceil((b[1] + 1.05 * b[3]) * SH / H / BK);
  let s = 0, n = 0;
  for (const f of fs_) if (f.dmap) for (let y = clamp(y0, 0, DH - 1); y <= clamp(y1, 0, DH - 1); y++) for (let x = clamp(x0, 0, DW - 1); x <= clamp(x1, 0, DW - 1); x++) { s += f.dmap[y * DW + x]; n++; }
  return n ? s / n : 0;
};
const speechShare = (s, e) => {
  if (!words) return null; let v = 0;
  for (const w of words) v += Math.max(0, Math.min(e, w.end) - Math.max(s, w.start));
  return r2(v / (e - s));
};

// ---- per-scene facts
const scenes = [];
for (let k = 0; k < bounds.length - 1; k++) {
  const s = bounds[k], e = bounds[k + 1], dur = e - s;
  let fs_ = inSpan(frames, s, e); if (!fs_.length) fs_ = [nearest(frames, (s + e) / 2)];
  let fc = inSpan(faceFrames, s, e); if (!fc.length && faceFrames.length) fc = [nearest(faceFrames, (s + e) / 2)];
  const sc = { i: k, start: r3(s), end: r3(e), dur: r3(dur) };
  const lum = median(fs_.map((f) => f.mean)), still = median(fs_.filter((f) => f.still != null).map((f) => f.still));
  const flat = median(fs_.map((f) => f.flat));
  sc.stats = { luma: Math.round(lum), still: r2(still || 0), flat: r2(flat), motion: r3(median(fs_.filter((f) => f.changed != null).map((f) => f.changed)) || 0) };
  if (transitions.some(([a, b]) => Math.abs(a - s) < 0.01 && Math.abs(b - e) < 0.01)) sc.transition = 'dissolve/morph';
  sc.speech = speechShare(s, e);
  const sceneIsFlash = isFlashSpan(s, e), slate = sceneIsFlash && median(fs_.map((f) => f.mean)) < 25 && median(fs_.map((f) => f.std)) > 40;
  // faces present in this scene
  const present = clusters.map((c) => ({ c, hits: c.hits.filter((h) => fc.some((f) => f.t === h.t)) }))
    .filter((p) => p.hits.length).map((p) => ({ ...p, share: new Set(p.hits.map((h) => h.t)).size / fc.length, box: medBox(p.hits) }));
  // another face counts as a speaker only when big and seen for >= 2 s over the clip (Haar false positives flicker)
  const cand = sceneIsFlash ? [] : present.filter((p) => p.share >= 0.5 && (p.c === mainCl ? p.box[3] >= 0.06 * H : p.box[3] >= 0.2 * H && p.c.hits.length >= 2 * FACE_FPS));
  let subj = null, pick = null;
  if (cand.length === 1) { subj = cand[0]; pick = 'only face'; }
  else if (cand.length > 1) {
    for (const p of cand) p.mouth = mouthMotion(fs_, p.box);
    const byMouth = [...cand].sort((a, b) => b.mouth - a.mouth);
    if (byMouth[0].mouth >= 1.25 * byMouth[1].mouth) { subj = byMouth[0]; pick = 'mouth motion'; }
    else {
      const score = (p) => p.share * p.box[3] * (1 - Math.abs((p.box[0] + p.box[2] / 2) / W - 0.5));
      subj = [...cand].sort((a, b) => score(b) - score(a))[0]; pick = 'largest + most central';
    }
  }
  if (present.length) sc.faces = present.map((p) => ({ box: p.box, share: r2(p.share), main: p.c === mainCl, ...(p.mouth != null ? { mouth: r2(p.mouth) } : {}) }));
  // kind
  const edge = k === 0 || k === bounds.length - 2;
  if (slate) sc.kind = 'title-card';
  else if (sceneIsFlash) sc.kind = 'flash';
  else if (subj) sc.kind = 'speaker';
  else if (still >= 0.93 && flat >= 0.1 && dur >= 1.5 && !(edge && dur <= 4 && (sc.speech ?? 0) < 0.3)) sc.kind = 'screen-recording';
  else if ((k === 0 && dur <= 3 && bounds.length > 2) || (still >= 0.9 && dur <= 4 && (edge || (sc.speech ?? 0) < 0.3))) sc.kind = 'title-card';
  else sc.kind = faceFrames.length ? 'cutaway' : 'camera';   // no face detector: speaker vs cutaway unknown
  // focus + crop
  let fx, fy;
  if (subj) {
    const b = subj.box; fx = b[0] + b[2] / 2; fy = b[1] + b[3] / 2;
    const xs = subj.hits.map((h) => h.b[0] + h.b[2] / 2);
    sc.face = { box: b, pick, candidates: cand.length, cxRange: [Math.round(Math.min(...xs)), Math.round(Math.max(...xs))] };
    sc.focus = { x: Math.round(fx), y: Math.round(fy), from: 'face' };
  } else {
    fx = saliency(fs_); fy = H / 2;
    sc.focus = { x: Math.round(fx), y: Math.round(fy), from: 'saliency (motion + edges)' };
  }
  if (!(portraitish && CH === H)) Object.assign(sc, cropFor(fx, fy));
  else Object.assign(sc, { crop: { x: 0, y: 0, w: W, h: H, note: 'source is already 9:16' }, cover1080x1920: { scale: r3(1080 / W), x: 0, y: 0 } });
  if (sc.face) {
    const b = sc.face.box, c = sc.crop;
    const inX = (lo, hi) => lo >= c.x && hi <= c.x + c.w;
    sc.face.inCrop = inX(b[0], b[0] + b[2]);
    sc.face.alwaysInCrop = inX(sc.face.cxRange[0] - b[2] / 2, sc.face.cxRange[1] + b[2] / 2);
  }
  // letterbox / pillarbox
  const cr = crops.filter((c) => c.t >= s && c.t < e);
  if (cr.length) {
    const m = { x: median(cr.map((c) => c.x)), y: median(cr.map((c) => c.y)), w: median(cr.map((c) => c.w)), h: median(cr.map((c) => c.h)) };
    if (m.w < SW * 0.97 || m.h < SH * 0.97) sc.activeArea = [m.x, m.y, m.w, m.h].map((v, j) => Math.round(v * (j % 2 ? H / SH : W / SW)));
  }
  scenes.push(sc);
}

// ---- screen-recording events
const events = [];
for (const sc of scenes.filter((x) => x.kind === 'screen-recording')) {
  const fs_ = inSpan(frames, sc.start, sc.end);
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const t0 = r2(Math.max(sc.start, cur.t0)), t1 = r2(cur.t1), b = cur.box;
    const box = [b[0] * W / SW, b[1] * H / SH, b[2] * W / SW, b[3] * H / SH].map(Math.round);
    const said = words ? words.filter((w) => w.start < t1 + 0.5 && w.end > t0 - 0.5).map((w) => w.text).join(' ') : null;
    events.push({ start: t0, end: t1, kind: cur.peak >= 0.2 ? 'page (load / scroll / big change)' : 'local (typing / cursor / hover)', area: r3(cur.peak), box, zoom: zoomRect(box, W, H), ...(said != null ? { said } : {}) });
    cur = null;
  };
  for (const f of fs_) {
    if (f.changed != null && f.changed > 0.0008 && f.box) {
      const t0 = f.t - 1 / SF;
      if (cur && t0 - cur.t1 <= 0.5) {
        const a = cur.box, b = f.box, x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
        cur.box = [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
        cur.t1 = f.t; cur.peak = Math.max(cur.peak, f.changed);
      } else { flush(); cur = { t0, t1: f.t, box: f.box, peak: f.changed }; }
    }
  }
  flush();
}

// ---- head: leading title cards / flashes
const head = { firstWord: words?.length ? r3(words[0].start) : null, titleCard: null, flashes: [], cleanFrom: 0 };
for (const sc of scenes) {
  if (sc.start > 3 || !['title-card', 'flash'].includes(sc.kind)) break;
  if (sc.kind === 'title-card') head.titleCard = [sc.start, sc.end]; else head.flashes.push([sc.start, sc.end]);
  head.cleanFrom = sc.end;
}

// ---- summary
const byKind = {};
for (const sc of scenes) byKind[sc.kind] = r2((byKind[sc.kind] || 0) + sc.dur);
const speakerShare = r2((byKind.speaker || 0) / DUR);
const notes = [];
if (detector.startsWith('none')) notes.push(`No local face detector (no OpenCV in ${process.env.EASY_EDITS_PYTHON || 'EASY_EDITS_PYTHON'} or python3): crops use a motion + edge saliency window and live-action scenes are kind "camera" (speaker or cutaway unknown); check them on the draft.`);
if (head.cleanFrom > 0) notes.push(`Head: ${[head.titleCard && `title card ${head.titleCard.join('-')} s`, head.flashes.length && `flash / black frame ${head.flashes.map((f) => f.join('-')).join(', ')} s`].filter(Boolean).join(', ')}. Start the EDL at >= ${head.cleanFrom} s or cover it with a graphic.`);
if (speakerShare < 0.5 && byKind.speaker) notes.push(`Speaker on screen ${byKind.speaker} of ${r2(DUR)} s (${Math.round(speakerShare * 100)}%); the rest is the source's own ${Object.keys(byKind).filter((k) => k !== 'speaker').join(' / ')}.`);
const multi = scenes.filter((s) => s.face?.candidates > 1);
if (multi.length) notes.push(`Several faces in scene(s) ${multi.map((s) => s.i).join(', ')}: the crop follows the face picked by ${[...new Set(multi.map((s) => s.face.pick))].join(' / ')}.`);
const outCrop = scenes.filter((s) => s.face && !s.face.alwaysInCrop);
if (outCrop.length) notes.push(`Speaker moves past the 9:16 crop edge in scene(s) ${outCrop.map((s) => s.i).join(', ')}: widen, pan, or use a split/punch there.`);
if (byKind['screen-recording']) notes.push('Screen recording: 9:16 crops of UI are tiny; show it in a browser / laptop frame (never a phone mockup), crop-zoomed to each event zoom rect, and retime screen segments so each action lands on the words that describe it.');

// ---- contact sheet
fs.mkdirSync(outDir, { recursive: true });
const SHEET = path.join(outDir, 'source-prep-sheet.png');
{
  let tiles = [];
  for (const sc of scenes) {
    tiles.push({ t: r2(sc.start + Math.min(0.25, sc.dur * 0.4)), sc, main: true });
    for (let t = sc.start + 3; t < sc.end - 1; t += 3) tiles.push({ t: r2(t), sc, main: false });
  }
  const MAXT = 20;
  if (tiles.length > MAXT) {
    const mains = tiles.filter((x) => x.main), fill = tiles.filter((x) => !x.main), keep = Math.max(0, MAXT - mains.length);
    tiles = [...mains.slice(0, MAXT), ...fill.filter((_, j) => j % Math.ceil(fill.length / Math.max(1, keep)) === 0).slice(0, keep)].sort((a, b) => a.t - b.t);
  }
  const th = portraitish ? 400 : 216, tw = Math.round(th * W / H / 2) * 2, cols = Math.max(3, Math.min(tiles.length, Math.floor(1700 / tw)));
  const lw = Math.max(2, Math.round(H / 200)), fsz = Math.round(Math.min(th / 11, tw / 9));
  const args = ['-v', 'error', '-y'];
  const fc = [];
  tiles.forEach((tl, j) => {
    args.push('-ss', String(tl.t), '-i', src);
    const c = tl.sc.crop, ch = [`[${j}:v]setpts=PTS-STARTPTS`];
    if (c && c.w < W) ch.push(`drawbox=x=${c.x}:y=${c.y}:w=${c.w}:h=${c.h}:color=yellow@0.9:t=${lw}`);
    if (tl.sc.face && faceFrames.length) {
      const ff = nearest(faceFrames, tl.t), sb = tl.sc.face.box;
      const b = ff.faces.find((x) => Math.abs(x[0] + x[2] / 2 - (sb[0] + sb[2] / 2)) < 0.1 * W) || sb;
      ch.push(`drawbox=x=${b[0]}:y=${b[1]}:w=${b[2]}:h=${b[3]}:color=cyan@0.9:t=${lw}`);
    }
    ch.push(`scale=${tw}:${th}`, `drawtext=text='#${tl.sc.i} ${tl.sc.kind} ${tl.t.toFixed(1)}s':x=6:y=6:fontsize=${fsz}:fontcolor=white:box=1:boxcolor=black@0.65`);
    fc.push(ch.join(',') + `[t${j}]`);
  });
  const layout = tiles.map((_, j) => `${(j % cols) * tw}_${Math.floor(j / cols) * th}`).join('|');
  fc.push(`${tiles.map((_, j) => `[t${j}]`).join('')}xstack=inputs=${tiles.length}:layout=${layout}:fill=black`);
  if (tiles.length === 1) fc[fc.length - 1] = '[t0]null';
  args.push('-filter_complex', fc.join(';'), '-frames:v', '1', SHEET);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) { console.error('source-prep: sheet failed\n' + r.stderr.slice(-800)); process.exit(1); }
}

// ---- stutter / restart cut candidates (cached by source sha1)
let cutCand = { status: 'skipped' };
{
  const cc = await import('./cut-candidates.mjs');
  if (process.env.EASY_EDITS_CUTCAND === '0') notes.push('Cut candidates skipped (EASY_EDITS_CUTCAND=0): find stutters with cut-mistakes on the retimed transcript.');
  else {
    try {
      const j = cc.run(src);
      fs.writeFileSync(path.join(outDir, 'source.cut-candidates.json'), JSON.stringify(j, null, 1));
      fs.writeFileSync(path.join(outDir, 'source.cut-candidates.md'), cc.markdown(j, src));
      cutCand = { status: 'ok', cache: j.cache, json: path.join(outDir, 'source.cut-candidates.json'), cuts: j.cuts };
    } catch (e) { cutCand = { status: 'failed', error: String(e.message || e) }; notes.push(`Cut candidates failed: ${cutCand.error}`); }
  }
}

const out = {
  tool: 'easy-edits/tools/source-prep.mjs',
  source: { path: src, duration: r3(DUR), fps: FPS, width: W, height: H, aspect: r3(W / H), orientation: W > H ? 'landscape' : W < H ? 'portrait' : 'square', audio: pr.streams.some((s) => s.codec_type === 'audio') },
  faceDetector: detector,
  crop916: { w: CW, h: CH, note: 'crop = source px; cover1080x1920 = scale the source by `scale` (origin top-left) and translate by (x, y) output px to fill 1080x1920 with that crop' },
  summary: { kinds: byKind, speakerShare, scenes: scenes.length, notes },
  head,
  scenes,
  events,
  cutCandidates: cutCand,
  gapCuts: pr.streams.some((s) => s.codec_type === 'audio') ? gapCuts(src) : null,
  sheet: SHEET,
  seconds: r2((Date.now() - T_START) / 1000),
};
fs.writeFileSync(path.join(outDir, 'source-prep.json'), JSON.stringify(out, null, 1));
console.log(`source-prep: ${W}x${H} ${FPS} fps ${r2(DUR)} s, ${scenes.length} scene(s), faces ${detector}, ${out.seconds} s -> ${path.join(outDir, 'source-prep.json')}`);
for (const sc of scenes) console.log(`  #${sc.i} ${sc.start.toFixed(2)}-${sc.end.toFixed(2)} ${sc.kind}${sc.transition ? ' (' + sc.transition + ')' : ''}${sc.face ? ` face ${sc.face.box.join(',')}` : ''} crop x ${sc.crop.x}`);
for (const c of cutCand.cuts || []) console.log(`  stutter cut ${c.start.toFixed(2)}-${c.end.toFixed(2)} s ${c.because.join(' | ')} (cache ${cutCand.cache})`);
for (const n of notes) console.log('  note: ' + n);

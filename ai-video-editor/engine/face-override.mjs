// AI Video Editor --face: a manual face position for when face detection is wrong (a poster, a second person, a dark
// shot, a face the detector never finds). `top` | `center` | `bottom` or `X,Y` (fractions of the source frame,
// 0-1, e.g. 0.3,0.4). Every framing, punch-in, caption keep-out and pop placement then uses that point.
//   parseFace(spec)             -> {x, y, label} or throws (a clear message for the CLI)
//   applyFaceTrack(track, face) -> the face track (engine/facetrack.py shape) with every sample on that point
//   applyFacePrep(prep, face)   -> source-prep.json (tools/source-prep.mjs) with every scene's face box and 9:16
//                                  cover crop on that point (the approved clean-cut 9:16 path)
// The face size is the detected median (detection usually finds a size even when the place is wrong), else 18%
// of the frame's short side.
// CLI (clean-cut.sh): node face-override.mjs prep <in.json> <out.json> <spec>
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const FACE_PRESETS = { top: { x: 0.5, y: 0.28 }, center: { x: 0.5, y: 0.42 }, centre: { x: 0.5, y: 0.42 }, bottom: { x: 0.5, y: 0.62 } };
const USAGE = '--face takes top, center, bottom or X,Y (fractions of the frame from 0 to 1, e.g. 0.3,0.4)';

export function parseFace(spec) {
  if (spec == null || spec === true || String(spec).trim() === '') throw new Error(`${USAGE}`);
  const s = String(spec).trim().toLowerCase();
  if (FACE_PRESETS[s]) return { ...FACE_PRESETS[s], label: s === 'centre' ? 'center' : s };
  const m = /^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/.exec(s);
  if (!m) throw new Error(`--face "${spec}" not understood: ${USAGE}`);
  const x = Number(m[1]), y = Number(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new Error(`--face "${spec}": X and Y must be between 0 and 1 (fractions of the frame width and height, not pixels)`);
  return { x, y, label: `${x},${y}` };
}

const median = (a) => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };

/** facetrack.py json {width, height, samples:[{t, box:[x,y,w,h], cx, cy, seen, cut}]} -> same shape on the point. */
export function applyFaceTrack(track, face, { width, height } = {}) {
  if (!face) return track;
  const W = track?.width || width, H = track?.height || height;
  if (!W || !H) throw new Error('applyFaceTrack: the track has no frame size');
  const fw = median((track?.samples || []).filter((s) => s.seen && s.box).map((s) => s.box[2])) || Math.round(0.18 * Math.min(W, H));
  const cx = r3(face.x * W), cy = r3(face.y * H);
  const box = [Math.round(cx - fw / 2), Math.round(cy - fw / 2), Math.round(fw), Math.round(fw)];
  let samples = (track?.samples || []).map((s) => ({ ...s, cx, cy, box, seen: true, override: true }));
  // no samples (detection never ran or found nothing): one per second over the duration
  if (!samples.length) { const d = track?.duration || 1; samples = Array.from({ length: Math.max(1, Math.ceil(d)) }, (_, k) => ({ t: k, cx, cy, box, seen: true, override: true })); }
  return { ...track, width: W, height: H, samples, coverage: 1, faceOverride: face.label };
}

/** source-prep.json: every scene's face box + its 9:16 crop and 1080x1920 cover transform on the point. */
export function applyFacePrep(prep, face) {
  if (!face || !prep) return prep;
  const W = prep.width || prep.source?.width, H = prep.height || prep.source?.height;
  if (!W || !H) throw new Error('applyFacePrep: source-prep.json has no width / height');
  const portrait = W / H <= 9 / 16 + 0.01;
  const CW = portrait ? W : Math.round((H * 9) / 16) & ~1, CH = portrait ? Math.min(H, Math.round((W * 16) / 9) & ~1) : H;
  const fw = median((prep.scenes || []).map((s) => s.face?.box?.[2])) || Math.round(0.18 * Math.min(W, H));
  const fx = face.x * W, fy = face.y * H;
  const x = Math.round(clamp(fx - CW / 2, 0, W - CW)), y = Math.round(clamp(fy - CH * 0.38, 0, H - CH)), scale = 1080 / CW;
  const box = [Math.round(fx - fw / 2), Math.round(fy - fw / 2), Math.round(fw), Math.round(fw)];
  const scenes = (prep.scenes || []).map((s) => ({ ...s, face: { ...(s.face || {}), box, pick: 'override' }, crop: { x, y, w: CW, h: CH }, cover1080x1920: { scale: r3(scale), x: Math.round(-x * scale * 100) / 100, y: Math.round(-y * scale * 100) / 100 } }));
  return { ...prep, scenes, faceOverride: face.label };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, inp, out, spec] = process.argv.slice(2);
  if (kind !== 'prep' || !inp || !out || !spec) { console.error('usage: face-override.mjs prep <source-prep.json> <out.json> <top|center|bottom|X,Y>'); process.exit(2); }
  try {
    const res = applyFacePrep(JSON.parse(fs.readFileSync(inp, 'utf8')), parseFace(spec));
    fs.writeFileSync(out, JSON.stringify(res, null, 1));
    console.error(`face-override: ${res.scenes.length} scene(s) on --face ${res.faceOverride} -> ${out}`);
  } catch (e) { console.error(`face-override: ${e.message}`); process.exit(2); }
}

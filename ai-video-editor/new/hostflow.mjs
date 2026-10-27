// Host generation flow for `ai-video-editor new` (and the standalone runners): per-kind backend defaults, the generation
// session that every recipe's generate() calls go through (approved budget, usage, pending host assets), the
// "waiting for assets" stop (exit 3) and `ai-video-editor resume <out>`.
//
// The default image / video backend is `host`: the assistant driving AI Video Editor makes those assets with its own
// built-in generation. A host request is appended to <out>/GENERATION_MANIFEST.json and comes back
// { pending: true }. A recipe makes all of its generation calls, then calls checkpoint(); with anything pending
// that throws PendingAssetsError, the CLI prints the manifest and exits 3. Once every `file` in the manifest
// exists, `ai-video-editor resume <out>` re-renders the approved plan and the host adapter returns the files (cached).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getBackend, KINDS } from '../gen/index.mjs';
import { MANIFEST, readManifest, manifestStatus } from '../gen/host.mjs';

export const EXIT_PENDING = 3;
export const DEFAULT_BACKENDS = { video: 'host', image: 'host', tts: 'local', avatar: 'local', llm: 'none', search: 'none' };

/** Per-kind backend names: AI_VIDEO_EDITOR_BACKEND (every kind) > --<kind>-backend > --backend (every kind) > defaults. */
export function resolveBackendNames(o = {}) {
  const forced = process.env.AI_VIDEO_EDITOR_BACKEND;
  return Object.fromEntries(KINDS.map((k) => [k, forced || o[`${k}Backend`] || o.backend || DEFAULT_BACKENDS[k]]));
}

/** One name when every kind uses the same backend, else "video=host,image=host,tts=local,...". */
export function backendLabel(names) {
  const v = new Set(Object.values(names));
  return v.size === 1 ? [...v][0] : KINDS.filter((k) => names[k] !== 'none').map((k) => `${k}=${names[k]}`).join(',');
}

/** The backend name a plan uses for one kind (plans before per-kind backends carry one `backend`). */
export const backendOf = (plan, kind) => plan.backends?.[kind] || plan.backend || DEFAULT_BACKENDS[kind];

/** Where a generate() call should write: the output folder for the host backend (manifest + assets/), else `dir`. */
export const genDir = (b, out, dir) => (b?.capabilities?.host ? out : dir);

/**
 * A stable asset id for the host manifest: the shot id plus a short hash of what is asked for, so an edited prompt
 * gets a new file instead of reusing the old one, and an unchanged plan finds its files again on resume.
 */
export function hostId(id, kind, req = {}) {
  const key = { kind, prompt: req.prompt || '', durationSec: req.durationSec ?? null, aspect: req.aspect || null, width: req.width || null, height: req.height || null,
    refs: (req.refs || []).map((f) => path.basename(String(f))), image: req.image ? path.basename(String(req.image)) : null };
  const h = crypto.createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 8);
  return `${String(id || kind).replace(/[^A-Za-z0-9_.-]+/g, '_')}-${h}`;
}

/** Options for one generate() call: host requests go to the output folder under a stable id. */
export function genOpts(b, { out, dir, id, kind, req, offline }) {
  return b?.capabilities?.host ? { outDir: out, shotId: hostId(id, kind, req), offline } : { outDir: dir, offline };
}

export class PendingAssetsError extends Error {
  constructor(dir, missing = null) {
    const st = manifestStatus(dir);
    const m = missing || st.missing;
    super(`waiting for ${m.length} generated asset(s); see ${path.join(dir, MANIFEST)}`);
    this.name = 'PendingAssetsError';
    this.dir = dir;
    this.missing = m;
    this.total = st.total;
  }
}

const short = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}...` : s; };

/** The instructions printed when a run stops for host assets (also what an assistant reads to continue). */
export function pendingMessage(e, { resumeCmd } = {}) {
  const dir = e.dir;
  const shown = path.relative(process.cwd(), dir).startsWith('..') ? dir : path.relative(process.cwd(), dir) || '.';
  const L = [
    `waiting for ${e.missing.length} of ${e.total} generated asset(s); nothing has been rendered yet.`,
    `manifest: ${path.join(shown, MANIFEST)}`,
    '',
    `Generate each asset below with your assistant's built-in image/video generation (use its prompt, aspect,`,
    'durationSec, referenceImages and firstFrame from the manifest) and save it at its "file" path, relative to',
    `${shown}/. Images: PNG or JPEG. Videos: MP4.`,
    '',
  ];
  for (const a of e.missing) {
    L.push(`  ${a.id}  ${a.type}${a.durationSec ? ` ${a.durationSec} s` : ''}${a.aspect ? ` ${a.aspect}` : ''}  -> ${a.file}${a.problem && a.problem !== 'missing' ? `  (${a.problem}; generate it again)` : ''}`);
    L.push(`      ${short(a.prompt, 110)}`);
    if (a.referenceImages?.length) L.push(`      reference images: ${a.referenceImages.join(', ')}`);
    if (a.firstFrame) L.push(`      first frame: ${a.firstFrame}`);
  }
  L.push('', `Then run: ${resumeCmd || `ai-video-editor resume ${shown}`}`);
  return `${L.join('\n')}\n`;
}

/** A file in the manifest that exists but isn't usable media (empty, or ffprobe can't read it). */
function unreadable(file, type) {
  try { if (!fs.statSync(file).size) return 'empty file'; } catch { return 'missing'; }
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0 || !/video/.test(r.stdout)) return `not a readable ${type === 'video' ? 'video' : 'image'}`;
  return null;
}

/** Manifest check for resume: missing or unreadable assets (each with a reason). */
export function assetProblems(dir) {
  const m = readManifest(dir);
  const bad = [];
  for (const a of m.assets) {
    const why = unreadable(path.resolve(dir, a.file), a.type);
    if (why) bad.push({ ...a, problem: why });
  }
  return { total: m.assets.length, bad };
}

/** Start of an approved render (not a resume): the manifest is rebuilt from this plan's requests. */
export function resetManifest(dir) { fs.rmSync(path.join(dir, MANIFEST), { force: true }); }

/**
 * The generation session of one render: every recipe gets its backends from here, so the approved budget, the
 * usage record and the pending host assets are counted in one place.
 */
export function generationSession({ plan, out, budget = Infinity, offline = false, PlanError = Error }) {
  const used = [];
  let pending = 0;
  function backend(kind) {
    const name = backendOf(plan, kind);
    const b = getBackend(kind, { name });
    return {
      name: b.name, kind, capabilities: b.capabilities,
      async generate(req, opts = {}) {
        if (used.length >= budget) throw new PlanError(`generation budget of the approved plan (${budget}) reached; nothing more is generated`);
        const r = await b.generate(req, { ...opts, offline: opts.offline || offline });
        used.push({ kind, id: opts.shotId || null, cost: r.cost || 0, cached: !!r.cached, pending: !!r.pending });
        if (r.pending) pending++;
        return r;
      },
    };
  }
  return {
    backend, used,
    get pending() { return pending; },
    /** Call after a recipe's generation calls: stops the run (exit 3) while host assets are pending. */
    checkpoint() { if (pending) throw new PendingAssetsError(out); },
  };
}

/** The approval record written by `new --approve` and checked by `resume` (the plan's sha256 at approval). */
export const approvalFile = (planFile) => `${planFile}.approved`;
export function recordApproval(planFile, sha) {
  fs.writeFileSync(approvalFile(planFile), `${JSON.stringify({ sha256: sha, approvedAt: new Date().toISOString() })}\n`);
}
export function approvedSha(planFile) {
  try { return JSON.parse(fs.readFileSync(approvalFile(planFile), 'utf8')).sha256 || null; } catch { return null; }
}

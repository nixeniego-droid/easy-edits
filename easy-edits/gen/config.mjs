// Backend config, key lookup, redaction and the content-hash cache (see BACKENDS.md).
//   providers.json: ~/.easy-edits/providers.json (EASY_EDITS_CONFIG overrides), mode 600, never in the repo.
//   cache:          ~/.easy-edits/cache (EASY_EDITS_CACHE overrides), keyed by sha256 of (adapter, model, kind, request).
// Keys come only from env vars (provider "keyEnv") or the provider's "key" in providers.json. They are never logged,
// never put in results / meta / errors (redact()), and the doctor / `easy-edits backends` only say "key present: yes/no".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const home = () => process.env.EASY_EDITS_HOME || path.join(os.homedir(), '.easy-edits');
export const configPath = () => process.env.EASY_EDITS_CONFIG || path.join(home(), 'providers.json');
export const cacheDir = () => process.env.EASY_EDITS_CACHE || path.join(home(), 'cache');

const warned = new Set();
function warnOnce(msg) { if (warned.has(msg)) return; warned.add(msg); if (process.env.EASY_EDITS_QUIET !== '1') process.stderr.write(`easy-edits: ${msg}\n`); }

/** Mode problem of a config file ("" when fine): anything readable/writable by group or others. */
export function modeProblem(file) {
  if (process.platform === 'win32') return '';
  const m = fs.statSync(file).mode & 0o777;
  return m & 0o077 ? `${file} is mode ${m.toString(8)}; run: chmod 600 ${file}` : '';
}

/**
 * Load providers.json -> { file, exists, providers: {name: cfg}, defaults: {kind: name}, warnings: [] }.
 * A missing file is fine (local + mock + none still work). Bad JSON throws (with the path, no content).
 */
export function loadProviders({ file = configPath(), warn = true } = {}) {
  const res = { file, exists: false, providers: {}, defaults: {}, warnings: [] };
  if (!fs.existsSync(file)) return res;
  res.exists = true;
  const mp = modeProblem(file);
  if (mp) { res.warnings.push(mp); if (warn) warnOnce(mp); }
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file}: invalid JSON (${e.message.replace(/ in JSON.*$/, '')})`); }
  for (const [name, cfg] of Object.entries(j.providers || {})) {
    if (!cfg || typeof cfg !== 'object') continue;
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) { res.warnings.push(`provider "${name}": use letters, digits, . _ - only; skipped`); continue; }
    res.providers[name] = { adapter: 'http-generic', ...cfg, name };
  }
  res.defaults = j.defaults && typeof j.defaults === 'object' ? { ...j.defaults } : {};
  return res;
}

/** The key for a provider config (env var named by keyEnv first, then "key" in providers.json), or ''. */
export function providerKey(cfg = {}) {
  if (cfg.keyEnv && process.env[cfg.keyEnv]) return process.env[cfg.keyEnv];
  return typeof cfg.key === 'string' ? cfg.key : '';
}
export const keyPresent = (cfg = {}) => (cfg.keyEnv || cfg.key != null ? (providerKey(cfg) ? 'yes' : 'no') : 'n/a');

// Shapes of common secrets, for redact() and the repo lint. Built so this file holds no key-like literal.
export const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g,
];

/** Replace the given secrets, key-like tokens and auth header values in a string with "[redacted]". */
export function redact(text, secrets = []) {
  let s = String(text ?? '');
  for (const k of secrets) if (k && String(k).length >= 4) s = s.split(String(k)).join('[redacted]');
  for (const re of SECRET_PATTERNS) s = s.replace(re, '[redacted]');
  s = s.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]');
  s = s.replace(/([?&](?:api[_-]?key|key|token|access_token|auth|signature)=)[^&\s"']+/gi, '$1[redacted]');
  return s;
}

/** Deep-copy a value with every string redacted (for anything written to a report or printed). */
export function redactObject(v, secrets = []) {
  if (typeof v === 'string') return redact(v, secrets);
  if (Array.isArray(v)) return v.map((x) => redactObject(x, secrets));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = /^(key|apikey|api_key|token|secret|password|authorization)$/i.test(k) ? '[redacted]' : redactObject(x, secrets);
    return o;
  }
  return v;
}

// ---------------------------------------------------------------- cache

const fileHash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** sha256 of (adapter, model, kind, request), with file refs (refs, audio, hostImage, image) replaced by content hashes. */
export function cacheKey({ adapter, model = '', kind, req = {} }) {
  const norm = (v, k) => {
    if (typeof v === 'string' && /^(refs|audio|hostImage|image)$/.test(k) && fs.existsSync(v)) return `sha256:${fileHash(v)}`;
    if (Array.isArray(v)) return v.map((x) => norm(x, k));
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((kk) => [kk, norm(v[kk], kk)]));
    return v;
  };
  const r = Object.fromEntries(Object.keys(req).sort().filter((k) => req[k] !== undefined && k !== 'consent').map((k) => [k, norm(req[k], k)]));
  return crypto.createHash('sha256').update(JSON.stringify({ adapter, model, kind, req: r })).digest('hex');
}

/**
 * Run `produce(tmpOutDir)` once per content hash. A hit copies the cached file into outDir and returns the stored
 * result with cached:true and cost 0 (an approved plan is never billed twice). Results without a file (llm, search)
 * are cached as JSON. EASY_EDITS_CACHE=off disables the cache.
 */
export async function withCache({ adapter, model, kind, req, outDir = '.', noCache = false }, produce) {
  fs.mkdirSync(outDir, { recursive: true });
  if (noCache || process.env.EASY_EDITS_CACHE === 'off') return { ...(await produce(outDir)), cached: false };
  const key = cacheKey({ adapter, model, kind, req });
  const dir = path.join(cacheDir(), key.slice(0, 2));
  const metaFile = path.join(dir, `${key}.json`);
  if (fs.existsSync(metaFile)) {
    try {
      const hit = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (!hit.file) return { ...hit, cost: 0, cached: true, meta: { ...hit.meta, cacheKey: key } };
      const src = path.join(dir, hit.file);
      if (fs.existsSync(src)) {
        const dst = path.join(outDir, `${adapter}-${key.slice(0, 16)}${path.extname(src)}`);
        if (path.resolve(dst) !== path.resolve(src)) fs.copyFileSync(src, dst);
        return { ...hit, file: dst, cost: 0, cached: true, meta: { ...hit.meta, cacheKey: key } };
      }
    } catch { /* a broken entry: regenerate */ }
  }
  const res = await produce(outDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stored = { ...res };
  if (res.file) {
    const name = `${key}${path.extname(res.file)}`;
    fs.copyFileSync(res.file, path.join(dir, name));
    stored.file = name;
  }
  fs.writeFileSync(metaFile, JSON.stringify(stored));
  return { ...res, cached: false, meta: { ...res.meta, cacheKey: key } };
}

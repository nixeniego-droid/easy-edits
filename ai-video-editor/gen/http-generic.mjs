// The `http-generic` adapter: any REST generation API, configured in providers.json (no vendor is hard-wired).
// A provider entry (all fields but endpoint optional; see BACKENDS.md):
//   "my-images": {
//     "adapter": "http-generic", "kinds": ["image"], "endpoint": "https://api.example.com/v1/images",
//     "method": "POST", "authHeader": "Authorization", "authPrefix": "Bearer ", "keyEnv": "MY_IMAGES_KEY",
//     "headers": { "X-Extra": "1" }, "model": "<model id>",
//     "body": { "model": "{{model}}", "prompt": "{{prompt}}", "size": "{{width}}x{{height}}", "n": 1 },
//     "response": { "type": "base64" | "url" | "binary" | "text" | "json", "path": "data.0.b64_json" },
//     "ext": ".png", "costPerCall": 0.04, "secondsPerCall": 15, "maxClipSeconds": 8, "timeoutMs": 120000, "retries": 1
//   }
// Templates: "{{name}}" as a whole string keeps the value's type (numbers stay numbers); inside a longer string it is
// substituted as text. Names: prompt, text, voice, speaker, rate, width, height, aspect, durationSec, seed, model,
// system, query, limit, json, ref0_base64 (first ref file, base64), audio_base64, hostImage_base64.
// The key goes only into the auth header of the configured endpoint (never to a returned media URL), and is
// redacted from every error. network:true, so --offline refuses it (a loopback endpoint with "network": false is
// treated as local).
import fs from 'node:fs';
import path from 'node:path';
import { loadProviders, providerKey, redact, withCache } from './config.mjs';
import { frameSize } from './local.mjs';

const EXT = { image: '.png', video: '.mp4', tts: '.wav', avatar: '.mp4' };
const isLoopback = (u) => { try { return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(u).hostname); } catch { return false; } };

/** The provider config to use for `kind`: by name, else providers.json defaults[kind], else the first that lists kind. */
export function resolveProvider(kind, name) {
  const { providers, defaults, file } = loadProviders();
  const generic = Object.values(providers).filter((p) => p.adapter === 'http-generic');
  let p;
  if (name) { p = providers[name]; if (!p) throw new Error(`http-generic: no provider "${name}" in ${file}`); }
  else p = (defaults[kind] && providers[defaults[kind]]?.adapter === 'http-generic' ? providers[defaults[kind]] : null) || generic.find((x) => (x.kinds || []).includes(kind));
  if (!p) throw new Error(`http-generic: no provider for ${kind} in ${file} (add one with "kinds": ["${kind}"]; see ai-video-editor/gen/BACKENDS.md)`);
  if (p.kinds && !p.kinds.includes(kind)) throw new Error(`http-generic: provider "${p.name}" does not list kind ${kind}`);
  if (!p.endpoint) throw new Error(`http-generic: provider "${p.name}" has no endpoint`);
  return p;
}

/** Fill a JSON template: whole-string "{{x}}" keeps the type of vars.x; embedded ones become text. */
export function fillTemplate(tpl, vars) {
  if (typeof tpl === 'string') {
    const whole = tpl.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (whole) return vars[whole[1]] === undefined ? null : vars[whole[1]];
    return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : typeof vars[k] === 'object' ? JSON.stringify(vars[k]) : String(vars[k])));
  }
  if (Array.isArray(tpl)) return tpl.map((x) => fillTemplate(x, vars));
  if (tpl && typeof tpl === 'object') return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, fillTemplate(v, vars)]));
  return tpl;
}

/** Read a dotted path ("data.0.url", "output[0].url") from a parsed response. */
export function getPath(obj, p) {
  if (!p) return obj;
  return String(p).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function templateVars(kind, req, cfg) {
  const b64 = (f) => (f && fs.existsSync(f) ? fs.readFileSync(f).toString('base64') : undefined);
  const [width, height] = ['image', 'video', 'avatar'].includes(kind) ? frameSize(req) : [req.width, req.height];
  return {
    ...req, model: cfg.model, width, height, aspect: req.aspect || (width && height ? `${width}:${height}` : undefined),
    durationSec: req.durationSec != null ? Math.min(Number(req.durationSec), cfg.maxClipSeconds || Infinity) : undefined,
    ref0_base64: b64((req.refs || [])[0]), audio_base64: b64(req.audio), hostImage_base64: b64(req.hostImage),
  };
}

async function request(cfg, { url, method, headers, body }, secrets) {
  const retries = Number.isInteger(cfg.retries) ? cfg.retries : 1;
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(cfg.timeoutMs || 120000) });
      if (r.ok) return r;
      const txt = (await r.text().catch(() => '')).slice(0, 300);
      last = new Error(`http-generic ${cfg.name}: HTTP ${r.status}${txt ? `: ${txt}` : ''}`);
      if (!(r.status === 429 || r.status >= 500)) break;
    } catch (e) { last = new Error(`http-generic ${cfg.name}: ${e.name === 'TimeoutError' ? `timed out after ${cfg.timeoutMs || 120000} ms` : e.message}`); }
    if (attempt < retries) await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
  }
  throw new Error(redact(last.message, secrets));
}

export function httpGenericAdapter(kind, providerName) {
  // config problems surface on generate(), so `ai-video-editor backends` can still list the adapter
  let cfg = null, cfgError = null;
  try { cfg = resolveProvider(kind, providerName); } catch (e) { cfgError = e; }
  const c = cfg || {};
  const capabilities = {
    maxClipSeconds: c.maxClipSeconds ?? (kind === 'video' ? 8 : 0), aspects: c.aspects || ['9:16', '16:9', '1:1'],
    references: !!c.references, voiceClone: !!c.voiceClone, costPerCall: Number(c.costPerCall) || 0,
    secondsPerCall: Number(c.secondsPerCall) || 0,
    network: !(c.network === false && isLoopback(c.endpoint)),
    provider: c.name || null, configured: !!cfg,
  };
  return {
    name: 'http-generic', kind, capabilities,
    async generate(req = {}, { outDir = '.', noCache = false } = {}) {
      if (cfgError) throw cfgError;
      const key = providerKey(cfg);
      const secrets = [key];
      if ((cfg.keyEnv || cfg.authHeader) && !key && !cfg.keyOptional) throw new Error(`http-generic ${cfg.name}: no key (set ${cfg.keyEnv || 'keyEnv'} in the environment or "key" in providers.json)`);
      return withCache({ adapter: `http-generic:${cfg.name}`, model: cfg.model || '', kind, req, outDir, noCache }, async (dir) => {
        const vars = templateVars(kind, req, cfg);
        const url = fillTemplate(cfg.endpoint, vars);
        const method = (cfg.method || 'POST').toUpperCase();
        const headers = { Accept: '*/*', ...(cfg.headers || {}) };
        if (key && cfg.authHeader !== null) headers[cfg.authHeader || 'Authorization'] = `${cfg.authPrefix ?? (cfg.authHeader && cfg.authHeader !== 'Authorization' ? '' : 'Bearer ')}${key}`;
        let body;
        if (method !== 'GET' && method !== 'HEAD') { body = JSON.stringify(fillTemplate(cfg.body ?? { prompt: '{{prompt}}' }, vars)); headers['Content-Type'] = 'application/json'; }
        const t0 = Date.now();
        const r = await request(cfg, { url, method, headers, body }, secrets);
        const rt = cfg.response?.type || (kind === 'llm' ? 'text' : kind === 'search' ? 'json' : 'binary');
        const meta = { adapter: 'http-generic', provider: cfg.name, model: cfg.model || null, ms: Date.now() - t0, synthetic: kind === 'avatar' || undefined };
        const cost = Number(cfg.costPerCall) || 0;
        let parsed = null;
        if (rt !== 'binary') { const txt = await r.text(); try { parsed = JSON.parse(txt); } catch { if (rt === 'text') parsed = txt; else throw new Error(redact(`http-generic ${cfg.name}: response is not JSON`, secrets)); } }
        if (kind === 'llm') {
          const text = typeof parsed === 'string' ? parsed : getPath(parsed, cfg.response?.path);
          if (typeof text !== 'string') throw new Error(`http-generic ${cfg.name}: no text at response path "${cfg.response?.path || ''}"`);
          return { text, cost, meta };
        }
        if (kind === 'search') {
          const items = getPath(parsed, cfg.response?.path);
          if (!Array.isArray(items)) throw new Error(`http-generic ${cfg.name}: no result list at response path "${cfg.response?.path || ''}"`);
          const m = cfg.response?.map || {};
          const results = items.slice(0, req.limit || items.length).map((x) => ({ title: String(getPath(x, m.title || 'title') ?? ''), url: String(getPath(x, m.url || 'url') ?? ''), snippet: String(getPath(x, m.snippet || 'snippet') ?? '') }));
          return { results, cost, meta };
        }
        let buf;
        if (rt === 'binary') buf = Buffer.from(await r.arrayBuffer());
        else {
          const v = getPath(parsed, cfg.response?.path);
          if (typeof v !== 'string' || !v) throw new Error(`http-generic ${cfg.name}: no ${rt} at response path "${cfg.response?.path || ''}"`);
          if (rt === 'base64') buf = Buffer.from(v.replace(/^data:[^,]*,/, ''), 'base64');
          else if (rt === 'url') {
            // media URLs are fetched without the key (it belongs to the API endpoint only)
            const mr = await request({ ...cfg, retries: 1 }, { url: new URL(v, url).href, method: 'GET', headers: {} }, secrets);
            buf = Buffer.from(await mr.arrayBuffer());
          } else throw new Error(`http-generic ${cfg.name}: response type "${rt}" can't carry a ${kind} file (use base64, url or binary)`);
        }
        if (!buf.length) throw new Error(`http-generic ${cfg.name}: empty ${kind} response`);
        const file = path.join(dir, `http-${cfg.name}-${Date.now().toString(36)}${cfg.ext || EXT[kind] || '.bin'}`);
        fs.writeFileSync(file, buf);
        return { file, durationSec: kind === 'image' ? undefined : vars.durationSec, cost, meta };
      });
    },
  };
}

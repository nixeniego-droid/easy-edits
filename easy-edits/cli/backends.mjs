// easy-edits backends [list] [--json] | try <kind> ... | init | --doctor
// Lists the generation adapters, their capabilities per kind and, for providers.json entries, only "key present:
// yes/no" (never a key). `try` renders one sample with a backend; `init` writes a key-free providers.json (mode 600).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, getBackend, listBackends } from '../gen/index.mjs';
import { configPath, keyPresent, loadProviders, redact } from '../gen/config.mjs';
import { pickTtsEngine } from '../gen/local.mjs';

const HELP = `easy-edits backends: generation backends (BYO key; local and mock need none)

usage: easy-edits backends [list] [--json]     adapters, capabilities per kind, providers.json entries, key present yes/no
       easy-edits backends try <kind> --backend NAME -o DIR [--prompt "..."] [--text "..."] [--image F] [--audio F]
                               [--duration S] [--aspect 9:16|16:9|1:1|4:5] [--width W --height H] [--offline] [--no-cache]
                                               render one sample (kind: ${KINDS.join(' | ')})
       easy-edits backends init                write ~/.easy-edits/providers.json (mode 600, no keys) if it doesn't exist
       easy-edits backends --doctor            one status line (used by ./install.sh --doctor)

config: ~/.easy-edits/providers.json (EASY_EDITS_CONFIG), keys from env vars (keyEnv) or providers.json only;
cache:  ~/.easy-edits/cache (EASY_EDITS_CACHE; "off" disables). Docs: easy-edits/gen/BACKENDS.md
`;

const TEMPLATE = {
  defaults: {},
  providers: {
    'example-images': {
      adapter: 'http-generic', kinds: ['image'], endpoint: 'http://127.0.0.1:8188/generate', method: 'POST',
      authHeader: 'Authorization', authPrefix: 'Bearer ', keyEnv: 'EXAMPLE_IMAGES_KEY', keyOptional: true,
      body: { prompt: '{{prompt}}', width: '{{width}}', height: '{{height}}', seed: '{{seed}}' },
      response: { type: 'base64', path: 'image' }, ext: '.png', costPerCall: 0, secondsPerCall: 20, network: false,
    },
  },
};

/** Rows: one per adapter (and per providers.json entry) x kind. */
export function backendRows() {
  const rows = [];
  const { providers } = loadProviders({ warn: false });
  const generic = Object.values(providers).filter((p) => p.adapter === 'http-generic');
  const names = listBackends().flatMap((n) => (n === 'http-generic' ? generic.map((p) => `http-generic:${p.name}`) : [n]));
  rows.push({ name: 'none', kind: '*', note: 'default: refuses every generation; the planner falls back to stills / code graphics', network: false, costPerCall: 0, keyPresent: 'n/a' });
  if (!generic.length) rows.push({ name: 'http-generic', kind: '*', note: 'not configured (add providers to providers.json; easy-edits backends init)', network: true, costPerCall: 0, keyPresent: 'n/a' });
  for (const name of names.filter((x) => x !== 'none')) {
    const prov = name.startsWith('http-generic:') ? providers[name.slice(13)] : null;
    for (const kind of KINDS) {
      if (prov && prov.kinds && !prov.kinds.includes(kind)) continue;
      let b;
      try { b = getBackendNoEnv(kind, name); } catch (e) { rows.push({ name, kind, error: e.message }); continue; }
      const c = b.capabilities;
      if (name === 'local' && !c.supported) continue;
      const row = { name, kind, network: !!c.network, costPerCall: c.costPerCall, secondsPerCall: c.secondsPerCall ?? null, maxClipSeconds: c.maxClipSeconds, aspects: c.aspects, references: c.references, voiceClone: c.voiceClone, keyPresent: prov ? keyPresent(prov) : 'n/a' };
      if (name === 'local' && kind === 'tts') row.engine = safe(() => pickTtsEngine({})) || 'none found';
      if (name === 'local' && kind === 'avatar') row.note = 'still + zoom, labelled synthetic';
      rows.push(row);
    }
  }
  return rows;
}
const safe = (f) => { try { return f(); } catch { return null; } };
// EASY_EDITS_BACKEND forces one adapter for every kind; the listing shows them all
function getBackendNoEnv(kind, name) {
  const env = process.env.EASY_EDITS_BACKEND;
  delete process.env.EASY_EDITS_BACKEND;
  try { return getBackend(kind, { name }); } finally { if (env !== undefined) process.env.EASY_EDITS_BACKEND = env; }
}

/** The doctor line: providers.json state + key present yes/no per provider. Never fails on a missing config. */
export function doctorLine() {
  let p;
  try { p = loadProviders({ warn: false }); } catch (e) { return { ok: false, line: e.message }; }
  const tts = safe(() => pickTtsEngine({})) || 'none';
  const base = `local (tts: ${tts}), mock, none`;
  if (!p.exists) return { ok: true, line: `${base}; no providers.json (${p.file}): hosted backends off` };
  const provs = Object.values(p.providers).map((x) => `${x.name} key present: ${keyPresent(x)}`);
  const warn = p.warnings.length ? `; WARN ${p.warnings[0]}` : '';
  return { ok: true, line: `${base}; ${provs.length ? provs.join(', ') : 'providers.json has no providers'}${warn}` };
}

function parse(argv) {
  const o = { pos: [] };
  const withValue = new Set(['--backend', '-o', '--out', '--prompt', '--text', '--image', '--audio', '--duration', '--aspect', '--width', '--height', '--voice', '--seed', '--host']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (withValue.has(a)) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); o[a.replace(/^-+/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i]; }
    else if (a.startsWith('-')) o[a.replace(/^-+/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    else o.pos.push(a);
  }
  if (o.o) o.out = o.o;
  return o;
}

async function tryOne(o) {
  const kind = o.pos[1];
  if (!KINDS.includes(kind)) throw new Error(`backends try: kind must be one of ${KINDS.join(', ')}`);
  if (!o.out) throw new Error('backends try: -o DIR is required');
  const b = getBackend(kind, { name: o.backend || 'local' });
  const n = (x) => (x == null ? undefined : Number(x));
  const ref = o.image ? [path.resolve(o.image)] : [];
  const visual = { prompt: o.prompt || 'Easy Edits sample', aspect: o.aspect || '9:16', width: n(o.width), height: n(o.height), seed: n(o.seed) ?? 0, refs: ref };
  const text = o.text || o.prompt || 'This is an Easy Edits voice sample.';
  const req = {
    image: visual, video: { ...visual, durationSec: n(o.duration) ?? 4 }, tts: { text, voice: o.voice }, avatar: { aspect: visual.aspect, width: visual.width, height: visual.height },
    llm: { prompt: o.prompt || text }, search: { query: o.prompt || text, limit: 5 },
  }[kind];
  const out = path.resolve(o.out);
  if (kind === 'avatar') {
    // no --audio: voice the text with the same backend's TTS (local: Kokoro / Piper / eSpeak / flite)
    req.audio = o.audio ? path.resolve(o.audio) : (await getBackend('tts', { name: o.backend || 'local' }).generate({ text, voice: o.voice }, { outDir: out, offline: !!o.offline, noCache: !!o.noCache })).file;
    req.hostImage = o.host ? path.resolve(o.host) : o.image ? path.resolve(o.image) : undefined;
    req.likeness = 'fictional';
  }
  const r = await b.generate(req, { outDir: out, offline: !!o.offline, noCache: !!o.noCache });
  const summary = { backend: b.name, kind, ...r };
  console.log(JSON.stringify(summary, null, 1));
  return 0;
}

export async function backendsMain(argv) {
  let o;
  try { o = parse(argv); } catch (e) { console.error(`easy-edits backends: ${e.message}`); return 2; }
  if (o.help || o.h) { process.stdout.write(HELP); return 0; }
  if (o.doctor) { const d = doctorLine(); console.log(d.line); return d.ok ? 0 : 1; }
  const cmd = o.pos[0] || 'list';
  try {
    if (cmd === 'list') {
      const p = loadProviders();
      const rows = backendRows();
      if (o.json) { console.log(JSON.stringify({ config: p.file, configExists: p.exists, warnings: p.warnings, backends: rows }, null, 1)); return 0; }
      console.log(`providers.json: ${p.exists ? p.file : `none (${p.file})`}`);
      for (const w of p.warnings) console.log(`WARN ${w}`);
      for (const r of rows) {
        if (r.error) { console.log(`${r.name.padEnd(28)} ${r.kind.padEnd(7)} config error: ${redact(r.error)}`); continue; }
        const caps = [`network: ${r.network ? 'yes' : 'no'}`, `cost/call: ${r.costPerCall}`, r.secondsPerCall ? `~${r.secondsPerCall} s/call` : null, r.maxClipSeconds ? `max clip ${r.maxClipSeconds} s` : null, r.aspects?.length ? `aspects ${r.aspects.join(' ')}` : null, r.references ? 'refs' : null, r.voiceClone ? 'voice clone' : null, r.engine ? `engine: ${r.engine}` : null, r.note || null, `key present: ${r.keyPresent}`].filter(Boolean);
        console.log(`${r.name.padEnd(28)} ${r.kind.padEnd(7)} ${caps.join(', ')}`);
      }
      return 0;
    }
    if (cmd === 'try') return await tryOne(o);
    if (cmd === 'init') {
      const f = configPath();
      if (fs.existsSync(f)) { console.log(`${f} exists; left as it is`); return 0; }
      fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
      fs.writeFileSync(f, `${JSON.stringify(TEMPLATE, null, 2)}\n`, { mode: 0o600 });
      fs.chmodSync(f, 0o600);
      console.log(`wrote ${f} (mode 600, no keys). Put keys in env vars named by "keyEnv".`);
      return 0;
    }
  } catch (e) { console.error(`easy-edits backends: ${redact(e.message)}`); return 1; }
  console.error(`easy-edits backends: unknown command ${cmd}\n`);
  process.stdout.write(HELP);
  return 2;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) backendsMain(process.argv.slice(2)).then((c) => process.exit(c));

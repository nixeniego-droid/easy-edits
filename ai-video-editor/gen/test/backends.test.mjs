// Generation backends: providers.json loader + mode check, redaction, the content-hash cache, the local adapter
// (title card, Ken Burns mp4, TTS, synthetic avatar mastered to -14 LUFS / BT.709) and http-generic against a local
// HTTP stub. No network beyond 127.0.0.1, no real keys: the test key is random and built at run time.
process.env.AI_VIDEO_EDITOR_BACKEND = 'mock';
process.env.AI_VIDEO_EDITOR_QUIET = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-video-editor-gen-test-'));
process.env.AI_VIDEO_EDITOR_CACHE = path.join(TMP, 'cache');
process.env.AI_VIDEO_EDITOR_CONFIG = path.join(TMP, 'providers.json');
const { getBackend, listBackends } = await import('../index.mjs');
const { loadProviders, keyPresent, redact, redactObject, cacheKey } = await import('../config.mjs');
const { localAdapter, pickTtsEngine, wrap } = await import('../local.mjs');
const { httpGenericAdapter, fillTemplate, getPath } = await import('../http-generic.mjs');
const { measure } = await import('../../audio/master.mjs');

const MAIN = fileURLToPath(new URL('../../cli/main.mjs', import.meta.url));
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,color_space,color_primaries,color_transfer:format=duration', '-of', 'json', f], { encoding: 'utf8' }));
const vstream = (p) => p.streams.find((s) => s.codec_type === 'video');
const KEY = `testkey${crypto.randomBytes(12).toString('hex')}`;
const out = (name) => path.join(TMP, name);
function withoutEnvBackend(fn) {
  const v = process.env.AI_VIDEO_EDITOR_BACKEND; delete process.env.AI_VIDEO_EDITOR_BACKEND;
  return Promise.resolve().then(fn).finally(() => { process.env.AI_VIDEO_EDITOR_BACKEND = v; });
}
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('registry lists none, mock, local, http-generic; AI_VIDEO_EDITOR_BACKEND=mock forces mock', async () => {
  for (const n of ['none', 'mock', 'local', 'http-generic']) assert.ok(listBackends().includes(n), n);
  const b = getBackend('image', { name: 'local' });
  assert.equal(b.name, 'mock');
  const r = await b.generate({ prompt: 'x', width: 64, height: 64 }, { outDir: out('mock') });
  assert.ok(fs.existsSync(r.file));
});

test('providers.json: missing is fine, loose mode warns, key present yes/no', () => {
  assert.equal(loadProviders().exists, false);
  const f = process.env.AI_VIDEO_EDITOR_CONFIG;
  fs.writeFileSync(f, JSON.stringify({ providers: { a: { endpoint: 'http://127.0.0.1:1/x', keyEnv: 'EE_TEST_KEY_A' }, 'bad name!': {} } }));
  fs.chmodSync(f, 0o644);
  let p = loadProviders({ warn: false });
  assert.ok(p.warnings.some((w) => /chmod 600/.test(w)), p.warnings.join());
  assert.ok(p.warnings.some((w) => /bad name!/.test(w)));
  assert.equal(p.providers.a.adapter, 'http-generic');
  fs.chmodSync(f, 0o600);
  p = loadProviders({ warn: false });
  assert.ok(!p.warnings.some((w) => /chmod/.test(w)));
  assert.equal(keyPresent(p.providers.a), 'no');
  process.env.EE_TEST_KEY_A = KEY;
  assert.equal(keyPresent(p.providers.a), 'yes');
  delete process.env.EE_TEST_KEY_A;
  fs.rmSync(f);
});

test('redact: known keys, key-shaped tokens, auth headers and key query params', () => {
  const fake = ['s', 'k-'].join('') + 'A'.repeat(24);
  const s = redact(`key ${KEY} tok ${fake} Authorization: Bearer abcdefgh12345678 url https://x.test/a?api_key=zzz&b=1`, [KEY]);
  assert.ok(!s.includes(KEY) && !s.includes(fake) && !s.includes('abcdefgh12345678') && !s.includes('zzz'), s);
  assert.match(s, /b=1/);
  assert.deepEqual(redactObject({ key: 'x', nested: [{ apiKey: 'y', note: `has ${KEY}` }] }, [KEY]), { key: '[redacted]', nested: [{ apiKey: '[redacted]', note: 'has [redacted]' }] });
});

test('cacheKey: stable, order-free, follows file contents', () => {
  const a = out('ref-a.txt'); fs.writeFileSync(a, 'one');
  const k1 = cacheKey({ adapter: 'local', kind: 'image', req: { prompt: 'p', width: 2, refs: [a] } });
  assert.equal(k1, cacheKey({ adapter: 'local', kind: 'image', req: { width: 2, refs: [a], prompt: 'p' } }));
  fs.writeFileSync(a, 'two');
  assert.notEqual(k1, cacheKey({ adapter: 'local', kind: 'image', req: { prompt: 'p', width: 2, refs: [a] } }));
});

test('wrap: lines fit the width, overflow ends in ...', () => {
  const l = wrap('one two three four five six seven eight nine ten', 9, 3);
  assert.equal(l.length, 3);
  assert.ok(l.every((x) => x.length <= 9), l.join('|'));
  assert.match(l[2], /\.\.\.$/);
});

test('local image: title-card png at the asked size; a re-run is cached', async () => {
  const b = localAdapter('image');
  assert.equal(b.capabilities.network, false);
  assert.equal(b.capabilities.costPerCall, 0);
  const req = { prompt: 'How solar panels turn light into power', width: 360, height: 640, seed: 3 };
  const r1 = await b.generate(req, { outDir: out('img') });
  assert.equal(r1.cached, false);
  const v = vstream(probe(r1.file));
  assert.equal(v.codec_name, 'png');
  assert.deepEqual([v.width, v.height], [360, 640]);
  const r2 = await b.generate(req, { outDir: out('img2') });
  assert.equal(r2.cached, true);
  assert.equal(r2.cost, 0);
  assert.ok(fs.existsSync(r2.file));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(r1.file)).digest('hex'), crypto.createHash('sha256').update(fs.readFileSync(r2.file)).digest('hex'));
});

test('local video: Ken Burns mp4, duration, H.264, BT.709 tags; duration clamped', async () => {
  const r = await localAdapter('video').generate({ prompt: 'A city at night', width: 360, height: 640, durationSec: 2 }, { outDir: out('vid'), noCache: true });
  const p = probe(r.file), v = vstream(p);
  assert.equal(v.codec_name, 'h264');
  assert.deepEqual([v.width, v.height], [360, 640]);
  assert.deepEqual([v.color_space, v.color_primaries, v.color_transfer], ['bt709', 'bt709', 'bt709']);
  assert.ok(Math.abs(Number(p.format.duration) - 2) < 0.1, p.format.duration);
  // an image ref becomes the Ken Burns source
  const img = await localAdapter('image').generate({ prompt: 'ref', width: 200, height: 200 }, { outDir: out('vid'), noCache: true });
  const r2 = await localAdapter('video').generate({ prompt: 'x', aspect: '1:1', width: 240, durationSec: 99, refs: [img.file] }, { outDir: out('vid'), noCache: true });
  assert.equal(r2.durationSec, 20);
  assert.equal(r2.meta.clamped, true);
  assert.match(r2.meta.engine, /image ref/);
});

test('local tts: a 48 kHz wav from the first available engine (or a clear error)', async (t) => {
  // Kokoro downloads its model on first use, so the test forces the first offline engine that is installed
  const engine = ['piper', 'espeak-ng', 'espeak', 'flite'].find((e) => { process.env.AI_VIDEO_EDITOR_LOCAL_TTS = e; return pickTtsEngine({}); });
  try {
    if (!engine) {
      await assert.rejects(localAdapter('tts').generate({ text: 'hi' }, { outDir: out('tts'), noCache: true }), /not available here; no local TTS engine found/);
      t.skip('no offline local TTS engine on this machine (refusal checked)');
      return;
    }
    process.env.AI_VIDEO_EDITOR_LOCAL_TTS = engine;
    const r = await localAdapter('tts').generate({ text: 'Hello from the local voice.' }, { outDir: out('tts'), noCache: true });
    const a = probe(r.file).streams[0];
    assert.equal(a.codec_type, 'audio');
    assert.ok(r.durationSec > 0.5, String(r.durationSec));
    assert.equal(r.meta.engine, engine);
    await assert.rejects(localAdapter('tts').generate({ text: '  ' }, { outDir: out('tts'), noCache: true }), /empty text/);
  } finally { delete process.env.AI_VIDEO_EDITOR_LOCAL_TTS; }
});

test('local avatar: still + audio -> mp4, -14 LUFS / -1.5 dBTP, BT.709, labelled synthetic', async () => {
  const wav = out('voice.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=180:d=3', '-af', 'volume=0.3,tremolo=f=4:d=0.6', '-ar', '48000', wav]);
  const b = localAdapter('avatar');
  assert.equal(b.capabilities.synthetic, true);
  const r = await b.generate({ audio: wav, aspect: '9:16', width: 360, height: 640, likeness: 'fictional' }, { outDir: out('av'), noCache: true });
  const p = probe(r.file), v = vstream(p);
  assert.ok(p.streams.some((s) => s.codec_type === 'audio'));
  assert.deepEqual([v.color_space, v.color_primaries, v.color_transfer], ['bt709', 'bt709', 'bt709']);
  assert.ok(Math.abs(Number(p.format.duration) - 3) < 0.15, p.format.duration);
  const m = measure(r.file);
  assert.ok(Math.abs(m.I + 14) <= 1, `I ${m.I}`);
  assert.ok(m.TP <= -1.0, `TP ${m.TP}`);
  assert.equal(r.meta.synthetic, true);
  await assert.rejects(b.generate({ audio: wav, likeness: 'self' }, { outDir: out('av'), noCache: true }), /consent/);
  await assert.rejects(localAdapter('llm').generate({ prompt: 'x' }, { outDir: out('av') }), /no llm generator/);
});

// ---------------------------------------------------------------- http-generic against a local stub

async function stub() {
  const png = fs.readFileSync((await localAdapter('image').generate({ prompt: 'stub', width: 64, height: 64 }, { outDir: out('stub'), noCache: true })).file);
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, auth: req.headers.authorization, xkey: req.headers['x-api-key'], body: body ? JSON.parse(body) : null });
      const authed = req.headers.authorization === `Bearer ${KEY}` || req.headers['x-api-key'] === KEY;
      if (req.url === '/media/out.png') { res.end(png); return; }
      if (!authed) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
      if (req.url === '/img') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })); return; }
      if (req.url === '/img-url') { res.end(JSON.stringify({ output: [{ url: '/media/out.png' }] })); return; }
      if (req.url === '/llm') { res.end(JSON.stringify({ choices: [{ message: { content: 'drafted text' } }] })); return; }
      if (req.url === '/search') { res.end(JSON.stringify({ hits: [{ name: 'A', link: 'https://example.org/a', text: 'aa' }, { name: 'B', link: 'https://example.org/b', text: 'bb' }] })); return; }
      if (req.url === '/fail') { res.writeHead(400); res.end(`bad request for ${req.headers.authorization}`); return; }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, seen, base: `http://127.0.0.1:${server.address().port}` };
}

function writeProviders(base) {
  const common = { adapter: 'http-generic', keyEnv: 'EE_TEST_GEN_KEY', authHeader: 'Authorization', authPrefix: 'Bearer ', retries: 0, timeoutMs: 5000 };
  fs.writeFileSync(process.env.AI_VIDEO_EDITOR_CONFIG, JSON.stringify({
    providers: {
      'test-img': { ...common, kinds: ['image'], endpoint: `${base}/img`, model: 'stub-model-1', body: { model: '{{model}}', prompt: '{{prompt}}', size: '{{width}}x{{height}}', width: '{{width}}', seed: '{{seed}}' }, response: { type: 'base64', path: 'data.0.b64_json' }, costPerCall: 0.04, secondsPerCall: 12 },
      'test-url': { ...common, authHeader: 'X-Api-Key', authPrefix: '', kinds: ['image'], endpoint: `${base}/img-url`, response: { type: 'url', path: 'output[0].url' } },
      'test-llm': { ...common, kinds: ['llm'], endpoint: `${base}/llm`, body: { messages: [{ role: 'user', content: '{{prompt}}' }] }, response: { type: 'json', path: 'choices.0.message.content' } },
      'test-search': { ...common, kinds: ['search'], endpoint: `${base}/search`, body: { q: '{{query}}' }, response: { path: 'hits', map: { title: 'name', url: 'link', snippet: 'text' } } },
      'test-fail': { ...common, kinds: ['image'], endpoint: `${base}/fail` },
    },
  }), { mode: 0o600 });
}

test('http-generic: templates, auth header from env, base64 / url / llm / search, cost, cache, redaction, offline', async () => {
  const { server, seen, base } = await stub();
  try {
    writeProviders(base);
    process.env.EE_TEST_GEN_KEY = KEY;
    const img = httpGenericAdapter('image', 'test-img');
    assert.equal(img.capabilities.network, true);
    assert.equal(img.capabilities.costPerCall, 0.04);
    assert.equal(img.capabilities.secondsPerCall, 12);
    const req = { prompt: 'a red bicycle', width: 320, height: 568, seed: 7 };
    const r = await img.generate(req, { outDir: out('http') });
    assert.equal(r.cached, false);
    assert.equal(r.cost, 0.04);
    assert.deepEqual([vstream(probe(r.file)).width, vstream(probe(r.file)).height], [64, 64]);
    assert.deepEqual(seen.at(-1).body, { model: 'stub-model-1', prompt: 'a red bicycle', size: '320x568', width: 320, seed: 7 });
    assert.ok(!JSON.stringify(r).includes(KEY));
    // re-run: served from the cache, the stub is not called, nothing is billed
    const calls = seen.length;
    const r2 = await img.generate(req, { outDir: out('http2') });
    assert.equal(r2.cached, true);
    assert.equal(r2.cost, 0);
    assert.equal(seen.length, calls);

    // a url response: the media URL is fetched WITHOUT the key
    const u = await httpGenericAdapter('image', 'test-url').generate({ prompt: 'u' }, { outDir: out('http'), noCache: true });
    assert.ok(fs.existsSync(u.file));
    const media = seen.find((s) => s.url === '/media/out.png');
    assert.equal(media.auth, undefined); assert.equal(media.xkey, undefined);
    assert.equal(seen.find((s) => s.url === '/img-url').xkey, KEY);

    const l = await httpGenericAdapter('llm', 'test-llm').generate({ prompt: 'write' }, { outDir: out('http'), noCache: true });
    assert.equal(l.text, 'drafted text');
    const s = await httpGenericAdapter('search', 'test-search').generate({ query: 'q', limit: 1 }, { outDir: out('http'), noCache: true });
    assert.deepEqual(s.results, [{ title: 'A', url: 'https://example.org/a', snippet: 'aa' }]);

    // the server echoes the auth header in its error: the key must not reach the message
    await assert.rejects(httpGenericAdapter('image', 'test-fail').generate({ prompt: 'x' }, { outDir: out('http'), noCache: true }), (e) => { assert.match(e.message, /HTTP 400/); assert.ok(!e.message.includes(KEY), e.message); return true; });

    // no key: a clear refusal, no request
    delete process.env.EE_TEST_GEN_KEY;
    const n = seen.length;
    await assert.rejects(httpGenericAdapter('image', 'test-img').generate({ prompt: 'nokey' }, { outDir: out('http'), noCache: true }), /no key \(set EE_TEST_GEN_KEY/);
    assert.equal(seen.length, n);
    process.env.EE_TEST_GEN_KEY = KEY;

    // --offline refuses a network adapter through getBackend; the provider is picked by "http-generic:<name>"
    await withoutEnvBackend(async () => {
      const b = getBackend('image', { name: 'http-generic:test-img' });
      assert.equal(b.capabilities.provider, 'test-img');
      await assert.rejects(b.generate({ prompt: 'off' }, { outDir: out('http'), offline: true }), /refused by --offline/);
      // without a name, http-generic picks the first provider listing the kind
      assert.equal(getBackend('llm', { name: 'http-generic' }).capabilities.provider, 'test-llm');
    });
  } finally { server.close(); delete process.env.EE_TEST_GEN_KEY; }
});

test('fillTemplate / getPath', () => {
  assert.deepEqual(fillTemplate({ a: '{{n}}', b: 'x{{n}}y', c: ['{{missing}}'], d: '{{ s }}' }, { n: 5, s: 'str' }), { a: 5, b: 'x5y', c: [null], d: 'str' });
  assert.equal(getPath({ a: [{ b: 'v' }] }, 'a[0].b'), 'v');
  assert.equal(getPath({ a: [{ b: 'v' }] }, 'a.0.b'), 'v');
});

// ---------------------------------------------------------------- CLI

const cli = (args, env = {}) => spawnSync(process.execPath, [MAIN, 'backends', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('ai-video-editor backends: lists adapters and key present yes/no, never the key', async () => {
  writeProviders('http://127.0.0.1:9');
  let r = cli([], { EE_TEST_GEN_KEY: KEY });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^local\s+video\s+network: no/m);
  assert.match(r.stdout, /http-generic:test-img\s+image\s+network: yes, cost\/call: 0\.04.*key present: yes/);
  assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
  r = cli(['--json']);
  const j = JSON.parse(r.stdout);
  assert.equal(j.backends.find((x) => x.name === 'http-generic:test-img').keyPresent, 'no');
  r = cli(['--doctor'], { EE_TEST_GEN_KEY: KEY });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /test-img key present: yes/);
  assert.ok(!r.stdout.includes(KEY));
  fs.chmodSync(process.env.AI_VIDEO_EDITOR_CONFIG, 0o640);
  assert.match(cli(['--doctor']).stdout, /WARN .*chmod 600/);
  fs.rmSync(process.env.AI_VIDEO_EDITOR_CONFIG);
  r = cli(['init']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.statSync(process.env.AI_VIDEO_EDITOR_CONFIG).mode & 0o777, 0o600);
  assert.equal(loadProviders().providers['example-images'].keyOptional, true);
  fs.rmSync(process.env.AI_VIDEO_EDITOR_CONFIG);
});

test('ai-video-editor backends try: renders a real mp4 with mock and with local (ffprobe)', () => {
  for (const backend of ['mock', 'local']) {
    const env = backend === 'local' ? { AI_VIDEO_EDITOR_BACKEND: '' } : {};
    const r = cli(['try', 'video', '--backend', backend, '-o', out(`try-${backend}`), '--prompt', 'Sample', '--width', '320', '--height', '568', '--duration', '2'], env);
    assert.equal(r.status, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assert.equal(res.backend, backend);
    const p = probe(res.file), v = vstream(p);
    assert.equal(v.codec_name, 'h264');
    assert.ok(Math.abs(Number(p.format.duration) - 2) < 0.2, p.format.duration);
    if (backend === 'local') assert.deepEqual([v.color_space, v.color_primaries, v.color_transfer], ['bt709', 'bt709', 'bt709']);
  }
});

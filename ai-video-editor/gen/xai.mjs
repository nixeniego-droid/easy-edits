// xAI hosted adapter (image + video). Bring your own key: env XAI_API_KEY.
// Model IDs are NOT shipped: set them in ~/.ai-video-editor/providers.json:
//   { "xai": { "imageModel": "<image model id>", "videoModel": "<video model id>", "resolution": "720p" } }
// or env AI_VIDEO_EDITOR_XAI_IMAGE_MODEL / AI_VIDEO_EDITOR_XAI_VIDEO_MODEL. The key is never logged or written to outputs.
import '../engine/env-compat.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const API = 'https://api.x.ai/v1';

function config() {
  const p = process.env.AI_VIDEO_EDITOR_CONFIG || path.join(process.env.AI_VIDEO_EDITOR_HOME || path.join(os.homedir(), '.ai-video-editor'), 'providers.json');
  let c = {};
  try { c = JSON.parse(fs.readFileSync(p, 'utf8')).xai || {}; } catch {}
  return {
    imageModel: process.env.AI_VIDEO_EDITOR_XAI_IMAGE_MODEL || c.imageModel,
    videoModel: process.env.AI_VIDEO_EDITOR_XAI_VIDEO_MODEL || c.videoModel,
    resolution: c.resolution || '720p',
    costPerImage: c.costPerImage ?? 0.07,
    costPerVideoSecond: c.costPerVideoSecond ?? 0.05,
  };
}

const redact = (s) => { const k = process.env.XAI_API_KEY; return k ? String(s).split(k).join('[redacted]') : String(s); };

async function call(method, url, body) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error('xai backend: XAI_API_KEY is not set');
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(redact(`xai backend: HTTP ${r.status} ${t.slice(0, 300)}`));
  return JSON.parse(t);
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`xai backend: download failed HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

const dataUrl = (f) => `data:image/${path.extname(f).slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(f).toString('base64')}`;
const nearestAspect = (a) => (['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'].includes(a) ? a : a === '4:5' ? '3:4' : '9:16');

export function xaiAdapter(kind) {
  const cfg = config();
  const caps = { maxClipSeconds: 15, aspects: ['9:16', '16:9', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'], references: true, voiceClone: false,
    costPerCall: kind === 'video' ? cfg.costPerVideoSecond * 6 : cfg.costPerImage, network: true, keyPresent: !!process.env.XAI_API_KEY, keyEnv: 'XAI_API_KEY' };
  return {
    name: 'xai', kind, capabilities: caps,
    async generate(req = {}, { outDir = '.', pollMs = 5000, timeoutMs = 15 * 60 * 1000, log = () => {} } = {}) {
      if (kind !== 'image' && kind !== 'video') throw new Error(`xai backend: ${kind} not supported (image, video only)`);
      const model = kind === 'image' ? cfg.imageModel : cfg.videoModel;
      if (!model) throw new Error(`xai backend: set ${kind}Model in providers.json (xai section)`);
      fs.mkdirSync(outDir, { recursive: true });
      const id = crypto.createHash('sha256').update(JSON.stringify({ a: 'xai', model, kind, req })).digest('hex').slice(0, 16);
      const file = path.join(outDir, `xai-${id}.${kind === 'image' ? 'png' : 'mp4'}`);
      if (fs.existsSync(file)) return { file, cost: 0, cached: true, meta: { adapter: 'xai', model } };
      const refs = (req.refs || []).filter((f) => fs.existsSync(f));
      if (kind === 'image') {
        const j = await call('POST', `${API}/images/generations`, { model, prompt: req.prompt, n: 1, response_format: 'b64_json', ...(req.aspect ? { aspect_ratio: nearestAspect(req.aspect) } : {}) });
        const d = j.data?.[0] || {};
        if (d.b64_json) fs.writeFileSync(file, Buffer.from(d.b64_json, 'base64')); else await download(d.url, file);
        log({ type: 'image', count: 1 });
        return { file, cost: caps.costPerCall, cached: false, meta: { adapter: 'xai', model } };
      }
      const duration = Math.max(1, Math.min(15, Math.round(req.durationSec || 6)));
      const body = { model, prompt: req.prompt, duration, aspect_ratio: nearestAspect(req.aspect), resolution: cfg.resolution };
      if (req.image && fs.existsSync(req.image)) body.image = { url: dataUrl(req.image) };
      else if (refs.length) body.reference_images = refs.slice(0, 3).map((f) => ({ url: dataUrl(f) }));
      const { request_id } = await call('POST', `${API}/videos/generations`, body);
      log({ type: 'video', count: 1, durationSec: duration });
      const t0 = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, pollMs));
        const s = await call('GET', `${API}/videos/${request_id}`);
        if (s.status === 'done') {
          if (!s.video?.url) throw new Error('xai backend: video blocked by moderation');
          await download(s.video.url, file);
          const cost = s.usage?.cost_in_usd_ticks ? s.usage.cost_in_usd_ticks / 1e10 : cfg.costPerVideoSecond * duration;
          return { file, durationSec: s.video.duration || duration, cost, cached: false, meta: { adapter: 'xai', model } };
        }
        if (s.status === 'failed' || s.error) throw new Error(redact(`xai backend: ${s.error?.code} ${s.error?.message}`));
        if (Date.now() - t0 > timeoutMs) throw new Error('xai backend: timed out');
      }
    },
  };
}

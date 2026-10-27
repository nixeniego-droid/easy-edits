// host adapter: the assistant driving AI Video Editor generates assets with its own built-in tools.
// generate() never calls a network. If the expected file already exists it is returned; otherwise the
// request is appended to <outDir>/GENERATION_MANIFEST.json and a { pending: true, file } result is returned.
// Recipes collect pending results, stop, and tell the user/assistant to fill the manifest, then `resume`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MANIFEST = 'GENERATION_MANIFEST.json';

export function readManifest(dir) {
  const f = path.join(dir, MANIFEST);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { version: 1, instructions: 'Generate each asset with your assistant\'s built-in image/video generation and save it at "file". Then run: ai-video-editor resume <dir>', assets: [] };
}

export function manifestStatus(dir) {
  const m = readManifest(dir);
  const missing = m.assets.filter((a) => !fs.existsSync(path.resolve(dir, a.file)));
  return { total: m.assets.length, missing, complete: missing.length === 0 };
}

export function hostAdapter(kind) {
  return {
    name: 'host', kind,
    capabilities: { maxClipSeconds: 10, aspects: ['9:16', '16:9', '1:1', '4:5', '3:4', '4:3'], references: true, voiceClone: false, costPerCall: 0, network: false, host: true },
    async generate(req = {}, { outDir = '.', shotId } = {}) {
      if (kind !== 'image' && kind !== 'video') throw new Error(`host backend: ${kind} not supported; use local or mock`);
      fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
      const id = shotId || crypto.createHash('sha256').update(JSON.stringify({ kind, req })).digest('hex').slice(0, 12);
      const rel = path.join('assets', `${id}.${kind === 'image' ? 'png' : 'mp4'}`);
      const file = path.join(outDir, rel);
      if (fs.existsSync(file)) return { file, durationSec: req.durationSec, cost: 0, cached: true, meta: { adapter: 'host' } };
      const m = readManifest(outDir);
      if (!m.assets.find((a) => a.id === id)) {
        m.assets.push({ id, type: kind, prompt: req.prompt, durationSec: kind === 'video' ? req.durationSec : undefined, aspect: req.aspect, width: req.width, height: req.height,
          referenceImages: (req.refs || []).map((r) => path.relative(outDir, path.resolve(r))), firstFrame: req.image ? path.relative(outDir, path.resolve(req.image)) : undefined, file: rel });
        fs.writeFileSync(path.join(outDir, MANIFEST), JSON.stringify(m, null, 2));
      }
      return { file, pending: true, durationSec: req.durationSec, cost: 0, cached: false, meta: { adapter: 'host' } };
    },
  };
}

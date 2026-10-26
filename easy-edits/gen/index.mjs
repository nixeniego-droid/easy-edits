// Generation backend registry (stub; see CONTRACT.md). Adapters: none, mock. local/http-generic land in stream A.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const KINDS = ['video', 'image', 'tts', 'avatar', 'llm', 'search'];

const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

function noneAdapter(kind) {
  return {
    name: 'none', kind,
    capabilities: { maxClipSeconds: 0, aspects: [], references: false, voiceClone: false, costPerCall: 0, network: false },
    async generate() { throw new Error(`no ${kind} backend configured (backend "none"); planner should fall back to stills/code graphics`); },
  };
}

function mockAdapter(kind) {
  const caps = { maxClipSeconds: 8, aspects: ['9:16', '16:9', '1:1', '4:5'], references: true, voiceClone: true, costPerCall: 0, network: false };
  return {
    name: 'mock', kind, capabilities: caps,
    async generate(req = {}, { outDir = '.' } = {}) {
      fs.mkdirSync(outDir, { recursive: true });
      const id = hash({ kind, req });
      const w = req.width || 540, h = req.height || 960;
      const d = Math.min(req.durationSec || 3, caps.maxClipSeconds);
      let file;
      if (kind === 'image') { file = path.join(outDir, `mock-${id}.png`); ff(['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}`, '-frames:v', '1', file]); }
      else if (kind === 'video') { file = path.join(outDir, `mock-${id}.mp4`); ff(['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=30:d=${d}`, '-pix_fmt', 'yuv420p', file]); }
      else if (kind === 'tts') {
        const secs = Math.max(1, Math.round(String(req.text || '').split(/\s+/).length / 2.5));
        file = path.join(outDir, `mock-${id}.wav`); ff(['-f', 'lavfi', '-i', `sine=f=${req.speaker === 'B' ? 330 : 220}:d=${secs}`, '-ar', '48000', '-ac', '1', file]);
        return { file, durationSec: secs, cost: 0, cached: false, meta: { adapter: 'mock' } };
      } else if (kind === 'avatar') { file = path.join(outDir, `mock-${id}.mp4`); ff(['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=30:d=${d}`, '-i', req.audio, '-shortest', '-pix_fmt', 'yuv420p', file]); }
      else if (kind === 'llm') return { text: `MOCK RESPONSE ${id}`, cost: 0, cached: false, meta: { adapter: 'mock' } };
      else if (kind === 'search') return { results: [{ title: 'Mock source', url: 'https://example.org/mock', snippet: 'Mock snippet.' }], cost: 0, cached: false, meta: { adapter: 'mock' } };
      return { file, durationSec: kind === 'image' ? undefined : d, cost: 0, cached: false, meta: { adapter: 'mock' } };
    },
  };
}

const registry = { none: noneAdapter, mock: mockAdapter };
export function registerAdapter(name, factory) { registry[name] = factory; }
export function listBackends() { return Object.keys(registry); }
export function getBackend(kind, { name } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown backend kind ${kind}`);
  const n = process.env.EASY_EDITS_BACKEND || name || 'none';
  const f = registry[n]; if (!f) throw new Error(`unknown backend ${n}`);
  const b = f(kind);
  const gen = b.generate.bind(b);
  b.generate = async (req, opts = {}) => {
    if (opts.offline && b.capabilities.network) throw new Error(`backend ${n} needs network; refused by --offline`);
    return gen(req, opts);
  };
  return b;
}

#!/usr/bin/env node
// Write a shared exact+vad transcript (same cache as captions / shorts / …).
//   node asr-cached.mjs <media> <out.json> [--lang auto]
import { asr } from '../engine/media.mjs';

const argv = process.argv.slice(2);
let lang = 'auto';
const i = argv.indexOf('--lang');
if (i >= 0) { lang = argv[i + 1]; argv.splice(i, 2); }
const [media, out] = argv;
if (!media || !out) {
  console.error('usage: asr-cached.mjs <media> <out.json> [--lang auto]');
  process.exit(2);
}
asr(media, out, { lang });

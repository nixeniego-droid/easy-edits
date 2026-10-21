// Easy Edits gap cuts: internal pauses > 0.15 s in the source, snapped to speech edges, ready to cut.
//   node easy-edits/tools/gap-cuts.mjs <source.mp4> [--max 0.15] [--pad 0.04]
// Speech edges come from check/dead-air.mjs's detector run on the SOURCE (1.5-5 kHz speech band, RMS - 10 dB,
// silencedetect d = --max); the lead-in and tail are not gaps. Each cut keeps --pad (40 ms) of the silence on both
// sides: cut = [silence start + pad, silence end - pad]. source-prep.mjs writes them to source-prep.json `gapCuts`.
import { pathToFileURL } from 'node:url';
import { deadAir } from '../check/dead-air.mjs';

/** gaps [{start, end}] -> cuts [{start, end, dur}] with pad kept on both sides (cuts under 10 ms dropped). */
export const padCuts = (gaps, pad = 0.04) => gaps.map((g) => ({ start: +(g.start + pad).toFixed(3), end: +(g.end - pad).toFixed(3) })).filter((c) => c.end - c.start >= 0.01).map((c) => ({ ...c, dur: +(c.end - c.start).toFixed(3) }));

export const gapCuts = (src, { max = 0.15, pad = 0.04 } = {}) => { const r = deadAir(src, { max }); return { floorDb: r.floorDb, max, pad, cuts: padCuts(r.gaps, pad) }; };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2), o = (k, d) => { const i = a.indexOf(k); return i >= 0 ? +a[i + 1] : d; };
  if (!a[0]) { console.error('usage: gap-cuts.mjs <source.mp4> [--max 0.15] [--pad 0.04]'); process.exit(2); }
  const r = gapCuts(a[0], { max: o('--max', 0.15), pad: o('--pad', 0.04) });
  for (const c of r.cuts) console.log(`  CUT ${c.start.toFixed(3)}-${c.end.toFixed(3)} s (${c.dur.toFixed(3)} s)`);
  console.log(`gap-cuts: ${r.cuts.length} gap cut(s) over ${r.max} s, pad ${r.pad} s (speech band ${r.floorDb} dB)`);
}

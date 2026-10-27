// Presenter script helpers: clean a .txt / .md script, split it into sentences (one TTS call each), estimate
// its spoken length, and time its words onto the generated voice. Captions come from the known script, so
// nothing is transcribed and nothing can be misheard (SPEC C1).

export const WORDS_PER_SECOND = 2.5;   // ~150 wpm, the pace the planner budgets with
export const SENTENCE_GAP = 0.25;      // silence between sentences
export const LEAD = 0.35, TAIL = 0.6;  // silence before the first and after the last word

/** Markdown / script text -> plain spoken text (headings, bullets, emphasis, links and [stage notes] removed). */
export function cleanScript(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
    .map((l) => l.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[[^\]]*\]/g, ' ').replace(/[*_`~]+/g, ''));   // links, [stage notes], emphasis
  return lines.map((l, i) => {
    const marked = /^\s{0,3}#{1,6}\s+/.test(l) || /^\s*([-*+]|\d+[.)])\s+/.test(l);
    l = l.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*([-*+]|\d+[.)])\s+/, '').trim();
    // a heading, a bullet or the end of a paragraph is its own sentence even without closing punctuation
    const ends = marked || !String(lines[i + 1] || '').trim();
    return l && ends && !/[.!?,;:]["')\]]*$/.test(l) ? `${l}.` : l;
  }).join(' ').replace(/\s+/g, ' ').trim();
}

/** Sentences, each ending in its own punctuation; a sentence over maxWords is split at a comma or hard. */
export function splitSentences(text, { maxWords = 28 } = {}) {
  const raw = cleanScript(text).match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [];
  const out = [];
  for (let s of raw.map((x) => x.trim()).filter(Boolean)) {
    while (s.split(/\s+/).length > maxWords) {
      const w = s.split(/\s+/);
      let cut = -1;
      for (let i = Math.floor(maxWords * 0.8); i >= Math.floor(maxWords / 3); i--) if (/[,;:]$/.test(w[i - 1])) { cut = i; break; }
      if (cut < 0) cut = maxWords;
      out.push(w.slice(0, cut).join(' '));
      s = w.slice(cut).join(' ');
    }
    out.push(s);
  }
  return out;
}

export const wordCount = (s) => (String(s).trim() ? String(s).trim().split(/\s+/).length : 0);

/** Planner estimate of the finished length (narration + gaps + lead / tail). */
export function estimateSeconds(sentences) {
  const words = sentences.reduce((n, s) => n + wordCount(s), 0);
  return Math.round((LEAD + words / WORDS_PER_SECOND + SENTENCE_GAP * Math.max(0, sentences.length - 1) + TAIL) * 10) / 10;
}

/**
 * Words of one sentence spread over [start, start + duration], weighted by length (a long word takes longer
 * to say), with a little air at both ends. -> [{text, start, end}]
 */
export function timeWords(sentence, start, duration) {
  const words = String(sentence).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const pad = Math.min(0.08, duration * 0.05), span = Math.max(0.05, duration - 2 * pad);
  const weight = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1.5);
  const total = weight.reduce((a, b) => a + b, 0);
  let t = start + pad;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return words.map((text, i) => {
    const d = (span * weight[i]) / total;
    const w = { text, start: r3(t), end: r3(t + d * 0.92) };
    t += d;
    return w;
  });
}

/**
 * Avatar chunks over the narration timeline: each <= maxSec, cut in the gaps between sentences where
 * possible (a backend makes short clips; long reads are several clips). spans: [{start, end}] per sentence.
 */
export function chunkTimeline(spans, total, maxSec) {
  if (!maxSec || maxSec <= 0 || total <= maxSec) return [{ start: 0, end: total }];
  // candidate cut points: the middle of each gap between sentences
  const cuts = spans.slice(0, -1).map((s, i) => (s.end + spans[i + 1].start) / 2);
  const chunks = [];
  let start = 0;
  while (total - start > maxSec + 1e-6) {
    const fit = cuts.filter((c) => c > start + 0.5 && c - start <= maxSec);
    const end = fit.length ? fit.at(-1) : start + maxSec;
    chunks.push({ start, end });
    start = end;
  }
  chunks.push({ start, end: total });
  return chunks.map((c) => ({ start: Math.round(c.start * 1000) / 1000, end: Math.round(c.end * 1000) / 1000 }));
}

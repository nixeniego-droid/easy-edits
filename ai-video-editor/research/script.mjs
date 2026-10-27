// Scriptwriter (SPEC S1 + R2): sources -> script.json, every claim tied to a source id and a quoted passage.
//   writer "llm":        getBackend('llm') when one is configured; claims whose quote isn't verbatim in the named
//                        source are rejected (listed in script.rejected), never kept
//   writer "extractive": the deterministic fallback (no LLM, or the LLM gave nothing usable): the best sentences of
//                        the sources, picked round-robin so every source is used, ordered by source and position
// Length: targetSec x wordsPerSec words (wordsPerSec matches the TTS voice; 2.5 by default).
import { getBackend } from '../gen/index.mjs';
import { normWs, sentences } from './extract.mjs';

export const DEFAULT_WPS = 2.5;
const STOP = new Set('a an the and or but of to in on at by for with from as is are was were be been being it its this that these those there their they them we our you your he she his her i what which who whom how why when where than then so such not no do does did has have had can could would should will may might about into over under more most less very also just only'.split(' '));
const toks = (s) => (String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
const words = (s) => normWs(s).split(' ').filter(Boolean).length;
const BOILER = /(https?:|www\.|cookie|subscribe|sign up|log in|click|all rights reserved|©|newsletter|javascript|privacy policy|terms of use|share this|read more)/i;

/** narration text for a quote: inline reference markers ([12], [citation needed]) dropped. */
export const speakable = (q) => normWs(String(q).replace(/\[(?:\d+(?:[,–-]\d+)*|citation needed|note \d+|[a-z])\]/gi, ''));

/** score a sentence for the explainer: topic overlap, a readable length, early position. */
function score(s, topicToks) {
  const n = words(s.text);
  if (n < 6 || n > 40) return -1;
  if (!/[.!?]["'’”)\]]?$/.test(s.text) || BOILER.test(s.text) || !/[a-z]/.test(s.text)) return -1;
  if ((s.text.match(/[A-Z]/g) || []).length > s.text.length * 0.4) return -1;
  const t = new Set(toks(s.text));
  let overlap = 0;
  for (const k of topicToks) if (t.has(k)) overlap++;
  const lenFit = 1 - Math.abs(n - 20) / 40;
  const numbers = /\d/.test(s.text) ? 0.4 : 0;
  return 3 * overlap + lenFit + numbers + 1 / (1 + s.index * 0.15);
}
const jaccard = (a, b) => { const A = new Set(toks(a)), B = new Set(toks(b)); let i = 0; for (const x of A) if (B.has(x)) i++; return i / Math.max(1, A.size + B.size - i); };

/** deterministic extractive script: [{text, source, quote}] about targetWords long. */
export function extractiveClaims(sources, { topic = '', targetWords = 110 } = {}) {
  const topicToks = toks(topic).filter((t) => !STOP.has(t));
  const ranked = sources.map((s) => sentences(s.text).map((x) => ({ ...x, source: s.id, score: score(x, topicToks) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.index - b.index));
  const picked = [];
  let total = 0, progress = true;
  while (total < targetWords * 0.9 && progress) {
    progress = false;
    for (const list of ranked) {
      while (list.length) {
        const c = list.shift();
        const n = words(speakable(c.text));
        if (picked.some((p) => jaccard(p.text, c.text) > 0.6)) continue;
        if (picked.length && total + n > targetWords * 1.15) continue;
        picked.push(c); total += n; progress = true; break;
      }
      if (total >= targetWords * 0.9) break;
    }
  }
  const order = new Map(sources.map((s, i) => [s.id, i]));
  return picked.sort((a, b) => order.get(a.source) - order.get(b.source) || a.index - b.index).map((c) => ({ text: speakable(c.text), source: c.source, quote: c.text }));
}

function llmPrompt(sources, { topic, targetWords, title }) {
  const docs = sources.map((s) => `<source id="${s.id}" title="${s.title.replace(/"/g, "'")}">\n${normWs(s.text).slice(0, 6000)}\n</source>`).join('\n\n');
  return {
    system: 'You write the narration for a short cited explainer video. Use ONLY facts stated in the numbered sources. Every claim must be supported by one passage that you copy exactly, character for character, from that source. Never invent sources, numbers or quotes. Reply with JSON only.',
    prompt: `Topic: ${topic || title || '(from the sources)'}\nLength: about ${targetWords} spoken words in total, 3-8 claims, each claim one or two plain spoken sentences.\nReply as {"title": "...", "claims": [{"text": "narration sentence", "source": "S1", "quote": "exact passage copied from S1"}]}.\n\n${docs}`,
    json: true,
  };
}
function parseJson(text) {
  const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/**
 * Write the script. sources: [{id, n, title, url, text}] (loadSources). Returns the script.json object:
 * {version, title, topic, writer, writerNote, wordsPerSec, targetSec, targetWords, words, estSec, sources, claims, rejected}
 */
export async function writeScript(sources, { topic = '', title = '', targetSec = 45, wordsPerSec = DEFAULT_WPS, backends = {}, llm, offline = false, outDir } = {}) {
  if (!sources.length) throw new Error('no sources: give --source URL|FILE (or a --topic with a search backend configured)');
  const targetWords = Math.max(8, Math.round(targetSec * wordsPerSec));
  let claims = null, writer = 'extractive', writerNote = '', rejected = [], llmTitle = '';
  const b = llm || getBackend('llm', { name: backends.llm });
  if (b.name !== 'none') {
    try {
      const r = await b.generate(llmPrompt(sources, { topic, targetWords, title }), { outDir, offline });
      const j = parseJson(r.text);
      const byId = new Map(sources.map((s) => [s.id, normWs(s.text)]));
      const ok = [];
      for (const c of Array.isArray(j?.claims) ? j.claims : []) {
        const src = byId.get(c?.source), q = normWs(c?.quote);
        if (c?.text && src && q && src.includes(q)) ok.push({ text: normWs(c.text), source: c.source, quote: q });
        else rejected.push({ text: normWs(c?.text), source: c?.source ?? null, quote: q, reason: !src ? 'unknown source id' : !q ? 'no quote' : 'quote not found verbatim in the source' });
      }
      if (ok.length) { claims = ok; writer = 'llm'; llmTitle = normWs(j.title); writerNote = `llm backend ${b.name}${rejected.length ? `; ${rejected.length} claim(s) rejected` : ''}`; }
      else writerNote = `llm backend ${b.name} gave no usable claims; extractive fallback`;
    } catch (e) { writerNote = `llm backend ${b.name} failed (${e.message.split('\n')[0]}); extractive fallback`; }
  } else writerNote = 'no llm backend configured; extractive fallback';
  if (!claims) claims = extractiveClaims(sources, { topic, targetWords });
  if (!claims.length) throw new Error('the sources have no usable sentences to quote (too short, or not prose)');
  claims = claims.map((c, i) => ({ id: `c${i + 1}`, ...c }));
  const n = claims.reduce((a, c) => a + words(c.text), 0);
  return {
    version: 1, title: title || llmTitle || topic || sources[0].title, topic, writer, writerNote,
    wordsPerSec, targetSec, targetWords, words: n, estSec: Math.round((n / wordsPerSec) * 10) / 10,
    sources: sources.map(({ id, n: num, title: t, url, retrieved }) => ({ id, n: num, title: t, url, retrieved })),
    claims, rejected,
  };
}

/** script.txt: the narration, one claim per line with its source id (a readable copy; edit script.json). */
export const scriptTxt = (script) => `${script.title}\n\n${script.claims.map((c) => `${c.text}  [${c.source}]`).join('\n')}\n`;

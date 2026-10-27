/** Join Whisper splits like "long" + "-term" -> "long-term" (and "foo" + "-" + "bar"). */
export function joinHyphenWords(words) {
  if (!Array.isArray(words) || !words.length) return words || [];
  const out = [];
  for (const w of words) {
    const t = String(w?.text ?? '');
    const prev = out[out.length - 1];
    if (prev && /^-\w/.test(t)) {
      out[out.length - 1] = { ...prev, text: `${String(prev.text).replace(/-$/, '')}${t}`, end: w.end ?? prev.end };
      continue;
    }
    if (prev && t === '-' && words) {
      // lone hyphen: mark sticky for next token
      out[out.length - 1] = { ...prev, text: `${String(prev.text).replace(/-$/, '')}-`, end: w.end ?? prev.end, _hyphenJoin: true };
      continue;
    }
    if (prev?._hyphenJoin && t && !t.startsWith('-')) {
      const { _hyphenJoin, ...rest } = prev;
      out[out.length - 1] = { ...rest, text: `${rest.text}${t}`, end: w.end ?? rest.end };
      continue;
    }
    if (prev?._hyphenJoin) {
      const { _hyphenJoin, ...rest } = prev;
      out[out.length - 1] = rest;
    }
    out.push({ ...w });
  }
  if (out.at(-1)?._hyphenJoin) {
    const { _hyphenJoin, ...rest } = out[out.length - 1];
    out[out.length - 1] = rest;
  }
  return out;
}

/** Plain-English note for a reused phrase (said twice, not a retake). */
export function reusedPhraseNote(key, count = 2) {
  const phrase = String(key || '').trim();
  if (!phrase) return 'A short phrase is said more than once; that is fine.';
  return `The phrase "${phrase}" is said ${count} times; that is fine.`;
}

/** Plain-English note when ASR heard a near-repeat that is not a true retake. */
export function misheardPhraseNote(key) {
  const phrase = String(key || '').trim();
  if (!phrase) return 'The delivery check heard a short phrase twice with a small ASR difference; that is fine.';
  return `The delivery check heard "${phrase}" twice with a small difference in wording; that is fine.`;
}

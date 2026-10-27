// Repeated phrases in a final's fresh ASR, judged against the transcript the edit put on screen (the source
// transcript's kept words). The delivery check's small model mishears: talk_01's "Mission informs, but vision
// inspires. In mission we use our head, but in vision we use our heart" comes back as "Misha ... Misha", so the
// heard text repeats "misha we use our" although nothing was said twice. A heard repeat is REAL only when it is
// lexical in the reference too, or is extra audio the reference does not have:
//   spoken      both occurrences align to the same reference words (said twice, kept by the edit) within
//               REUSE_GAP words of each other: a retake / restart the edit kept
//   reused      the same, but further apart in the reference: one phrase reused in two sentences ("the sixth warmest
//               year on record, which is slightly down from the warmest year on record"), a note, never a FAIL
//   extra       an occurrence has >= n/2 heard words with no reference word under it (a duplicated splice, a
//               looped / invented phrase)
//   misheard    the occurrences align to DIFFERENT reference words: an ASR mishearing, a note, never a FAIL
//   loop        the whole clip is one stretch of speech looped >= 3 times (a test source made with -stream_loop /
//               concat: /tmp/ave-polish big.avi heard the same 27 words x3) and the occurrences are one
//               occurrence played again a whole number of loop periods later: a note, never a FAIL. A spliced
//               duplicate (2 copies) or a repeat within one period is judged as above (once per loop chain).
// Alignment: word-level edit distance (match 0, substitute / insert / delete 1) on normalised words.
export const normWord = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

/** heard[i] -> reference index (match or substitution) or -1 (inserted: no reference word under it). */
export function alignWords(heard, ref) {
  const n = heard.length, m = ref.length, W = m + 1;
  const D = new Uint32Array((n + 1) * W);
  for (let i = 0; i <= n; i++) D[i * W] = i;
  for (let j = 0; j <= m; j++) D[j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    D[i * W + j] = Math.min(D[(i - 1) * W + j - 1] + (heard[i - 1] === ref[j - 1] ? 0 : 1), D[(i - 1) * W + j] + 1, D[i * W + j - 1] + 1);
  }
  const map = new Array(n).fill(-1);
  for (let i = n, j = m; i > 0;) {
    if (j > 0 && D[i * W + j] === D[(i - 1) * W + j - 1] + (heard[i - 1] === ref[j - 1] ? 0 : 1)) { map[i - 1] = j - 1; i--; j--; }
    else if (D[i * W + j] === D[(i - 1) * W + j] + 1) { i--; }
    else j--;
  }
  return map;
}

const ngrams = (H, n) => {
  const at = new Map();
  for (let i = 0; i + n <= H.length; i++) { const k = H.slice(i, i + n).join(' '); (at.get(k) || at.set(k, []).get(k)).push(i); }
  return at;
};
const loopTol = (p) => Math.max(2, Math.round(p * 0.05)); // ASR drops / adds a word or two at a loop seam

/** A looped source: the heard words are >= minCopies copies of one period of >= minPeriod words. The period is the
 * commonest gap between consecutive occurrences of a repeated n-gram; it is a loop when >= minCoverage of the
 * n-grams are heard again one period (+- a few words) before or after (so a retake inside the loop, which shifts the
 * later copies, does not hide it). Natural speech reuses
 * phrases at scattered gaps and covers a few percent; a looped clip covers ~100%.
 * -> null or {periodWords, periodSec (null without word times), copies, coverage} */
export function detectLoop(heardWords, { n = 4, minPeriod = 8, minCopies = 2.5, minCoverage = 0.7 } = {}) {
  const W = heardWords.map((w) => ({ w, t: normWord(w.text ?? w) })).filter((x) => x.t), H = W.map((x) => x.t);
  const at = ngrams(H, n), gaps = [];
  for (const occ of at.values()) for (let k = 1; k < occ.length; k++) if (occ[k] - occ[k - 1] >= minPeriod) gaps.push(occ[k] - occ[k - 1]);
  if (!gaps.length) return null;
  let p = 0, best = 0;
  for (const d of new Set(gaps)) { const c = gaps.filter((g) => Math.abs(g - d) <= loopTol(d)).length; if (c > best || (c === best && d < p)) { best = c; p = d; } }
  if (H.length / p < minCopies) return null;
  const tol = loopTol(p), keys = H.map((_, i) => H.slice(i, i + n).join(' '));
  let hit = 0, tot = 0;
  for (let i = 0; i + n <= H.length; i++) {
    tot++;
    if (at.get(keys[i]).some((j) => Math.abs(Math.abs(j - i) - p) <= tol)) hit++;
  }
  // copies: the heard n-grams that repeat one period away, in periods (a doubled splice inside other talk is < 2)
  const coverage = tot ? hit / tot : 0, looped = (hit + n - 1) / p;
  if (coverage < minCoverage || looped < minCopies) return null;
  const secs = [];
  for (let i = 0; i + p < W.length; i++) if (keys[i] === keys[i + p] && Number.isFinite(W[i].w.start) && Number.isFinite(W[i + p].w.start)) secs.push(W[i + p].w.start - W[i].w.start);
  secs.sort((a, b) => a - b);
  return { periodWords: p, periodSec: secs.length ? secs[secs.length >> 1] : null, copies: Math.round(looped * 10) / 10, coverage: Math.round(coverage * 100) / 100 };
}

/** the first occurrence of each loop chain: occurrences a whole number of loop periods apart (+- the seam tolerance
 * per period) are one occurrence played again. One head: the repeat is the loop. More: the phrase also repeats within
 * one period ("the warmest year on record" twice in talk.mp4) and the heads are judged as an ordinary repeat. */
const loopHeads = (occ, loop) => {
  const P = loop.periodWords, tol = loopTol(P), head = occ.map((_, k) => k);
  for (let k = 1; k < occ.length; k++) for (let l = 0; l < k; l++) {
    const d = occ[k] - occ[l], m = Math.round(d / P);
    if (m >= 1 && Math.abs(d - m * P) <= tol * m) { head[k] = head[l]; break; }
  }
  return occ.filter((_, k) => head[k] === k);
};

/** repeated heard n-grams with a verdict each: [{key, count, verdict: spoken|extra|reused|misheard|loop|unchecked, refs}].
 * `ref` (array of words / strings) omitted: every repeat is `unchecked` (the old behaviour: a FAIL).
 * `loop` (detectLoop's result): repeats that sit exactly on the loop period are `loop` (not real). */
export const REUSE_GAP = 3;
export function repeatFindings(heardWords, refWords, { n = 4, reuseGap = REUSE_GAP, loop = null } = {}) {
  const H = heardWords.map((w) => normWord(w.text ?? w)).filter(Boolean);
  const all = [...ngrams(H, n)].filter(([, v]) => v.length > 1).map(([key, v]) => [key, loop ? loopHeads(v, loop) : v, v.length]);
  const looped = all.filter(([, v]) => v.length === 1).map(([key, , count]) => ({ key, count, verdict: 'loop', real: false }));
  const reps = all.filter(([, v]) => v.length > 1);
  if (!reps.length) return looped;
  if (!refWords) return [...reps.map(([key, v]) => ({ key, count: v.length, verdict: 'unchecked', real: true })), ...looped];
  let R = refWords.map((w) => normWord(w.text ?? w)).filter(Boolean);
  // a looped source against a reference of one period: tile the reference so each heard copy aligns to a copy of it
  // (otherwise the one reference copy aligns to some later heard copy and the first copy's chain heads read as extra)
  if (loop && R.length) R = Array.from({ length: Math.max(1, Math.round(H.length / R.length)) }, () => R).flat();
  const map = alignWords(H, R);
  return [...reps.map(([key, occ]) => {
    const spans = occ.map((i) => {
      const js = map.slice(i, i + n), got = js.filter((j) => j >= 0);
      return { extra: js.length - got.length, a: got.length ? Math.min(...got) : -1, b: got.length ? Math.max(...got) : -1,
        text: got.length ? R.slice(Math.min(...got), Math.max(...got) + 1).join(' ') : '' };
    });
    // same reference text at another reference position: said again. The gap is measured after extending the match
    // to the whole repeated run ("I told you to stop it now and I told you to stop it now": 1 word between), so a
    // retake (close together) stays spoken and a phrase reused in another clause (far apart) is reused
    const close = (s, x) => {
      const [p, q] = s.a <= x.a ? [s, x] : [x, s];
      let B = 0, L = 0;
      while (p.a - B > 0 && R[p.a - B - 1] === R[q.a - B - 1]) B++;
      const p0 = p.a - B, q0 = q.a - B;
      while (p0 + L < q0 && R[p0 + L] === R[q0 + L]) L++;
      return q0 - p0 - L <= reuseGap;
    };
    let verdict;
    if (spans.some((s) => s.extra * 2 >= n)) verdict = 'extra';
    else if (spans.some((s, k) => spans.some((x, l) => l !== k && x.text === s.text && close(s, x)))) verdict = 'spoken';
    else if (spans.some((s, k) => spans.findIndex((x) => x.text === s.text) !== k)) verdict = 'reused';
    else verdict = 'misheard';
    return { key, count: occ.length, verdict, real: verdict === 'extra' || verdict === 'spoken' || verdict === 'unchecked', refs: spans.map((s) => s.text) };
  }), ...looped];
}

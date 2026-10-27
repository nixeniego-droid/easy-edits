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

/** repeated heard n-grams with a verdict each: [{key, count, verdict: spoken|extra|reused|misheard|unchecked, refs}].
 * `ref` (array of words / strings) omitted: every repeat is `unchecked` (the old behaviour: a FAIL). */
export const REUSE_GAP = 3;
export function repeatFindings(heardWords, refWords, { n = 4, reuseGap = REUSE_GAP } = {}) {
  const H = heardWords.map((w) => normWord(w.text ?? w)).filter(Boolean);
  const at = new Map();
  for (let i = 0; i + n <= H.length; i++) { const k = H.slice(i, i + n).join(' '); (at.get(k) || at.set(k, []).get(k)).push(i); }
  const reps = [...at].filter(([, v]) => v.length > 1);
  if (!reps.length) return [];
  if (!refWords) return reps.map(([key, v]) => ({ key, count: v.length, verdict: 'unchecked', real: true }));
  const R = refWords.map((w) => normWord(w.text ?? w)).filter(Boolean);
  const map = alignWords(H, R);
  return reps.map(([key, occ]) => {
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
  });
}

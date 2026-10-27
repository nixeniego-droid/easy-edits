// AI Video Editor name guard: a proper name may appear in overlay text (name chip, lower-third, label, kinetic word)
// only when spelled exactly as in a trusted source. ASR spellings are not trusted ("MAYOR LENNY" for Leni Robredo).
//   node ai-video-editor/tools/name-guard.mjs <project-dir> [--names <file>|none] [--json]
// Overlay text = visible text in <project>/index.html and the compositions it mounts (data-composition-src), plus
// strings assigned in their scripts (textContent / innerText / innerHTML / GSAP text:), minus caption elements
// (class token `cap`) for the person-name check; captions are covered by the near-miss check below.
// A token is name-like when the transcript (assets/transcript.json, else assets/source-transcript.json) has it
// capitalised mid-sentence and never lowercase, and it is not a common word or title. A name-like token is a
// person name (FAIL unless trusted) when a title or person marker precedes it in the transcript or the overlay
// ("Mayor Lenny", "Dr", "my name is", "named", Tagalog si / ni / kay; surnames chain on), or when it sits in a
// name card (id/class with name, nameplate, lower-third, byline, speaker, guest, host). Other name-like tokens
// (places, orgs, missions) are WARN: listed for a spelling check, exit 0. Trusted = spelled exactly
// (case-insensitive) as a word of a trusted name:
//   --names <file>               one name per line (operator / user notes); `none` or absent = no file
//   <project>/assets/names-verified.txt   `Name | evidence` per line, for names the agent read in the source's own
//                                 on-screen text (e.g. `Dalia Kirschbaum | title card, source 0.2 s`); lines
//                                 without evidence are ignored. Accepted names are printed for review.
// Near-miss spelling: every visible text in index.html and its mounted compositions, captions and kinetic text
// included, is also checked against each word of a trusted name. A token that is not spelled exactly like it but
// is within edit distance 2 (1 for 3-letter words; case-insensitive) or sounds the same (Soundex code) FAILs (caption "is Dahlia" vs
// verified "Dalia Kirschbaum"). Common words, tokens under 3 letters and words the transcript has lowercase are
// skipped. Apply the names list to transcript.json before writing captions.
// Exit 1 when a person name or a near-miss spelling is flagged, 2 on usage / missing files, 0 otherwise (warnings included).
import fs from 'node:fs';
import path from 'node:path';
import { projectOverlays, read, tokens, key } from './overlay-text.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const proj = argv[0];
if (!proj || proj.startsWith('--')) { console.error('usage: name-guard.mjs <project-dir> [--names <file>|none] [--json]'); process.exit(2); }
const NAMES = opt('--names', 'none');
if (NAMES !== 'none' && !fs.existsSync(NAMES)) { console.error(`name-guard: missing names file ${NAMES}`); process.exit(2); }

// common words and titles that ASR capitalises mid-sentence without being names
const COMMON = new Set(`a about after again all also am an and any are as at be because been before being but by can
could did do does doing down during each even every few for from further had has have having he her here hers him his
how i if in into is it its just like me more most my no nor not now of off on once only or other our out over own same
she should so some such than that the their them then there these they this those through to too under until up very
was we were what when where which while who whom why will with would you your yes yeah okay ok oh hey hi hello thanks
thank please well right so now today tomorrow yesterday first second third next last new old big small good great best
really actually basically one two three four five six seven eight nine ten hundred thousand million billion percent
mr mrs ms miss dr doctor prof professor sir madam mayor governor president vice senator congressman congresswoman
secretary minister chairman chair director chief ceo cto captain general colonel major lieutenant sergeant officer
judge justice king queen prince princess pope father mother brother sister saint st mount lake river city state street
north south east west monday tuesday wednesday thursday friday saturday sunday january february march april may june
july august september october november december god internet web app ai`.split(/\s+/));
const TITLES = new Set(`mr mrs ms miss dr doctor prof professor sir madam dame lord lady mayor vice-mayor governor gov
president pres senator sen congressman congresswoman rep representative secretary sec minister premier chairman
chairwoman chancellor director chief captain capt general gen colonel col major lieutenant lt sergeant sgt officer
judge justice king queen prince princess pope father fr mother sister brother saint st uncle aunt coach attorney atty
engineer engr councilor councillor tito tita lolo lola ate kuya manong manang si ni kay sina nina kina named called
meet`.split(/\s+/));

const indexFile = path.join(proj, 'index.html');
const overlays = projectOverlays(proj);
if (!overlays) { console.error(`name-guard: missing ${indexFile}`); process.exit(2); }

const trFile = ['assets/transcript.json', 'assets/source-transcript.json'].map((f) => path.join(proj, f)).find((f) => fs.existsSync(f));
if (!trFile) { console.error(`name-guard: no assets/transcript.json or assets/source-transcript.json in ${proj}`); process.exit(2); }
const words = JSON.parse(read(trFile)).words.filter((w) => (w.type || 'word') === 'word');
const capMid = new Map(), lower = new Set(), cued = new Set();
const flat = words.flatMap((w, j) => tokens(w.text).map((t) => ({ t, j })));
flat.forEach(({ t, j }, n) => {
  const k = key(t);
  if (t[0] !== t[0].toLocaleUpperCase('en')) { lower.add(k); return; }
  const sentenceStart = j === 0 || (flat[n - 1]?.j !== j && /[.!?…]["')\]]*$/.test(words[j - 1].text.trim()));
  if (!sentenceStart && !capMid.has(k)) capMid.set(k, words.slice(Math.max(0, j - 3), j + 3).map((x) => x.text.trim()).join(' '));
});
const nameLike = (k) => capMid.has(k) && !lower.has(k) && !COMMON.has(k.toLowerCase()) && k.length > 1;
// person cue: a title / marker right before, "name is" / "name's", or a cued name right before (surname)
flat.forEach(({ t }, n) => {
  const k = key(t); if (!nameLike(k)) return;
  const p1 = flat[n - 1]?.t.toLowerCase(), p2 = flat[n - 2]?.t.toLowerCase();
  if (TITLES.has(p1) || (p2 === 'name' && p1 === 'is') || p1 === 'name' || (p1 && cued.has(key(flat[n - 1].t)) && nameLike(key(flat[n - 1].t)))) cued.add(k);
});

// ---- trusted names
const trusted = [];
if (NAMES !== 'none') for (const l of read(NAMES).split('\n')) if (l.trim() && !l.trim().startsWith('#')) trusted.push({ name: l.trim(), from: path.basename(NAMES) });
const verFile = path.join(proj, 'assets/names-verified.txt');
const verified = [];
if (fs.existsSync(verFile)) for (const l of read(verFile).split('\n')) {
  const [name, ev] = l.split('|').map((s) => s?.trim());
  if (name && !name.startsWith('#') && ev) { trusted.push({ name, from: `names-verified: ${ev}` }); verified.push({ name, evidence: ev }); }
}
const allowed = new Map();
for (const t of trusted) for (const w of tokens(t.name)) allowed.set(key(w), t);

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const flagged = [], warned = [], accepted = [];
for (const o of overlays) {
  const ts = tokens(o.text);
  ts.forEach((t, n) => {
    const k = key(t);
    if (!nameLike(k) || t[0] !== t[0].toLocaleUpperCase('en')) return;   // lowercase overlay word: not shown as a name
    const why = cued.has(k) ? 'person cue in transcript' : o.card ? 'name card' : TITLES.has(ts[n - 1]?.toLowerCase()) ? 'title in overlay' : null;
    const hit = { token: t, file: o.file, where: o.where, overlay: o.text.slice(0, 80), transcript: capMid.get(k), ...(why ? { person: why } : {}) };
    if (allowed.has(k)) { accepted.push({ ...hit, from: allowed.get(k).from }); return; }
    const close = [...allowed.keys()].map((a) => [a, lev(a, k)]).filter(([a, d]) => d <= Math.max(2, Math.floor(a.length / 3))).sort((a, b) => a[1] - b[1])[0];
    (why ? flagged : warned).push({ ...hit, ...(close ? { closestTrusted: allowed.get(close[0]).name } : {}) });
  });
}
// near-miss spellings of trusted name words in all visible text (captions included)
const soundex = (w) => {
  const c = w.toUpperCase().replace(/[^A-Z]/g, ''); if (!c) return '';
  const code = (ch) => ({ B: 1, F: 1, P: 1, V: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2, D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 })[ch] || 0;
  let out = c[0], prev = code(c[0]);
  for (const ch of c.slice(1)) { const d = code(ch); if (d && d !== prev) out += d; if (ch !== 'H' && ch !== 'W') prev = d; }
  return (out + '000').slice(0, 4);
};
const nearMiss = [];
for (const o of projectOverlays(proj, { caps: true })) for (const t of tokens(o.text)) {
  const k = key(t), lc = k.toLowerCase();
  if (k.length < 3 || allowed.has(k) || COMMON.has(lc) || lower.has(k) || lower.has(lc)) continue;
  const near = [...allowed.keys()].filter((a) => a.length >= 3).map((a) => [a, lev(a, k)])
    .filter(([a, d]) => d <= Math.min(2, a.length >> 1) || soundex(a) === soundex(k)).sort((a, b) => a[1] - b[1])[0];
  if (near) nearMiss.push({ token: t, file: o.file, where: o.where, text: o.text.slice(0, 80), caption: !!o.cap, trusted: allowed.get(near[0]).name, distance: near[1] });
}
const uniq = (a) => a.filter((h, j) => a.findIndex((x) => key(x.token) === key(h.token) && x.where === h.where) === j);
const res = { pass: !flagged.length && !nearMiss.length, project: proj, names: NAMES, transcript: path.relative(proj, trFile), overlayTexts: overlays.length,
  flagged: uniq(flagged), nearMiss: uniq(nearMiss), warned: uniq(warned), accepted: uniq(accepted), verified };
if (argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
else {
  console.log(`name-guard: ${res.pass ? 'PASS' : 'FAIL'} (${overlays.length} overlay texts, names ${NAMES}, transcript ${res.transcript})`);
  for (const f of res.flagged) console.log(`  FAIL ${f.token} in ${f.file} ${f.where} "${f.overlay}" (${f.person}; transcript: "${f.transcript}")${f.closestTrusted ? `; trusted spelling is "${f.closestTrusted}"` : ''}`);
  for (const f of res.nearMiss) console.log(`  FAIL ${f.token} in ${f.file} ${f.where}${f.caption ? ' (caption)' : ''} "${f.text}": near-miss of trusted "${f.trusted}" (distance ${f.distance})`);
  for (const f of res.warned) console.log(`  WARN ${f.token} in ${f.where} "${f.overlay}" (proper noun from the transcript: "${f.transcript}"; check the spelling)`);
  for (const a of res.accepted) console.log(`  ok   ${a.token} in ${a.where} (${a.from})`);
  if (!res.pass) console.log('  A proper name on screen must match a trusted spelling (--names file, the source\'s own on-screen text recorded in assets/names-verified.txt, or the user\'s notes). Fix the spelling or drop the chip; captions follow the trusted spelling too (apply the names list to transcript.json before writing captions).');
}
process.exit(res.pass ? 0 : 1);

// Easy Edits one-style check: all captions share one font family and one size, and all kinetic words share one
// family (their own, may differ from the captions') and at most 2 sizes, each from KINETIC_SIZES (150 / 110 px).
//   node easy-edits/check/text-style.mjs <project-dir> [--kinetic-free] [--one-caption] [--no-kinetic-size] [--json]
// --no-kinetic-size (edit.sh fault-only default): kinetic words keep one family and drawn font, but their sizes are
// free (no preset sizes, no 120-160 px band); --strict-look runs drop the flag.
// From tools/dom-sample.mjs (headless DOM sample, cached): every element of kind `cap` / `kinetic` that is
// actually on screen (has a visible run), its computed font-family (first family, unquoted, lowercased), its
// computed font-size (px) and the platform font Chrome drew it with. FAIL when a kind uses more than one
// family or drawn font, captions with more than one size, kinetic words with more than 2 sizes or a size off the
// presets. --kinetic-free (EMBEDDED briefs): kinetic words keep one family, sized by emphasis within KINETIC_RANGE
// (>= 120 px, the key word up to 160 px, nothing above 160: FAIL KINETIC SIZE outside it);
// captions are unchanged. --one-caption (EMBEDDED briefs): captions AND every chip / label word box (the viewer
// reads both as captions) must be ONE complete style: same font family and size, color, background, padding,
// border-radius, border, text-shadow and box-shadow (gen-th-style1: white shadowed captions, navy on a yellow
// chip, navy on a white label -> FAIL). Per presets/look-bright.json a caption may show ONE key word in the key
// colour (kinetic.keyWordFill #FFD60A): that is the same caption style, but 2+ key-colour words in one caption
// group FAIL. Label pills styled per cards.pill (white on ink) or cards.pill.onScene (ink on white) are the
// sanctioned pill style, not a caption mismatch. Also with --one-caption: every kinetic word (over footage or over
// an ~80% ink idea panel) wears the caption TREATMENT: the captions' most common font family, weight and
// text-shadow (and -webkit-text-stroke once dom-sample records it), white or the one key colour; a kinetic word
// that differs (no shadow, other weight, ink text on a marker) FAILs as KINETIC TREATMENT. Exit 1 on FAIL, 2 on usage.
import { pathToFileURL } from 'node:url';
import { projectSamples, runs } from '../tools/dom-sample.mjs';

export const KINDS = ['cap', 'kinetic'];
/** Fixed kinetic-word size presets (px); a video uses at most 2 of them. */
export const KINETIC_SIZES = [150, 110];
/** --kinetic-free size floor / ceiling (px): every kinetic word >= 120, the key word up to 160. */
export const KINETIC_RANGE = [120, 160];
/** Box style signature of a caption-like element (dom-sample v2 fields). */
export const boxStyle = (e) => [`color ${e.color}`, `bg ${e.background}`, `pad ${e.background === 'none' ? '-' : e.padding}`, `radius ${e.background === 'none' ? '-' : e.radius}`, `border ${e.border}`, `shadow ${e.textShadow}`, `box ${e.boxShadow}`].join('; ');
/** look-bright colours (rgb strings as getComputedStyle reports them). */
export const KEY_RGB = 'rgb(255, 214, 10)', INK_RGB = 'rgb(14, 17, 22)', WHITE_RGB = 'rgb(255, 255, 255)';
/** A label pill per look.cards.pill / pill.onScene: ink on white or white on ink. */
export const isSanctionedPill = (e) => e.kind === 'chip' && (e.color === INK_RGB && e.background === WHITE_RGB || e.color === WHITE_RGB && e.background === INK_RGB);
const words = (t) => (t || '').split(/\s+/).filter(Boolean).length;
const fam = (f) => (f || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();

/** elements [{id, text, kind, family, size, drawn}] -> {groups: {kind: {families, drawn, sizes}}, bad: [{kind, what, values}]}
 *  kineticFree: kinetic sizes are free within KINETIC_RANGE. kineticSizes false: kinetic sizes are not judged. */
export function checkTextStyle(elements, { kineticFree = false, oneCaption = false, kineticSizes = true } = {}) {
  const groups = {}, bad = [];
  if (oneCaption) {
    const els = elements.filter((e) => (e.kind === 'cap' || e.kind === 'chip') && !isSanctionedPill(e)), m = {};
    // the key word wears the caption style in the key colour: compare it as the white caption it sits in
    for (const e of els) (m[`${fam(e.family)} ${Math.round(e.size)}px; ${boxStyle(e.color === KEY_RGB && e.kind === 'cap' ? { ...e, color: WHITE_RGB } : e)}`] ??= []).push(e.text);
    if (Object.keys(m).length > 1) bad.push({ kind: 'caption', what: 'box styles', values: m });
    const byId = Object.fromEntries(elements.map((e) => [e.id, e])), keys = {};
    for (const e of els) if (e.kind === 'cap' && e.color === KEY_RGB) { const g = e.parent && byId[e.parent]?.kind === 'cap' ? e.parent : e.id; (keys[g] ??= []).push(e.text); }
    const many = Object.fromEntries(Object.entries(keys).filter(([, t]) => t.reduce((n, x) => n + words(x), 0) > 1).map(([g, t]) => [`${byId[g]?.text ?? g}`, t]));
    if (Object.keys(many).length) bad.push({ kind: 'caption', what: 'key words', values: many });
    const tr = (e) => `${fam(e.family)} ${e.weight}; shadow ${e.textShadow}${e.stroke ? `; stroke ${e.stroke}` : ''}`, caps = elements.filter((e) => e.kind === 'cap'), n = {};
    for (const e of caps) n[tr(e)] = (n[tr(e)] || 0) + 1;
    const ref = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0], off = {};
    if (ref) for (const e of elements.filter((e) => e.kind === 'kinetic')) {
      const why = tr(e) !== ref ? tr(e) : e.color !== WHITE_RGB && e.color !== KEY_RGB ? `color ${e.color}` : null;
      if (why) (off[why] ??= []).push(e.text);
    }
    if (Object.keys(off).length) bad.push({ kind: 'kinetic', what: 'treatment', ref, values: off });
  }
  for (const k of KINDS) {
    const els = elements.filter((e) => e.kind === k);
    if (!els.length) continue;
    const by = (f) => { const m = {}; for (const e of els) (m[f(e)] ??= []).push(e.text); return m; };
    const g = groups[k] = { families: by((e) => fam(e.family)), drawn: by((e) => e.drawn || '?'), sizes: by((e) => String(Math.round(e.size))) };
    for (const [what, m] of Object.entries(g)) {
      const n = Object.keys(m).length;
      if (k === 'kinetic' && what === 'sizes') {
        if (!kineticSizes) continue;
        if (kineticFree) {
          const out = Object.fromEntries(Object.entries(m).filter(([v]) => +v < KINETIC_RANGE[0] || +v > KINETIC_RANGE[1]));
          if (Object.keys(out).length) bad.push({ kind: k, what: 'range', values: out });
          continue;
        }
        if (n > 2 || Object.keys(m).some((v) => !KINETIC_SIZES.includes(+v))) bad.push({ kind: k, what, values: m });
      } else if (n > 1) bad.push({ kind: k, what, values: m });
    }
  }
  return { groups, bad };
}

/** Elements of a dom-sample that are visible at some point. */
export const shownElements = (sample) => { const ids = new Set(runs(sample).map((r) => r.id)); return Object.values(sample.elements).filter((e) => ids.has(e.id)); };

async function main(argv) {
  const proj = argv.find((a) => !a.startsWith('--'));
  if (!proj) { console.error('usage: text-style.mjs <project-dir> [--kinetic-free] [--one-caption] [--json]'); return 2; }
  const r = checkTextStyle(shownElements(await projectSamples(proj)), { kineticFree: argv.includes('--kinetic-free'), oneCaption: argv.includes('--one-caption'), kineticSizes: !argv.includes('--no-kinetic-size') });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  for (const b of r.bad.filter((x) => x.what === 'box styles')) for (const [v, t] of Object.entries(b.values)) console.log(`  MIXED caption style: ${v}  (${t.slice(0, 3).map((x) => `"${x}"`).join(', ')}${t.length > 3 ? ', ...' : ''})`);
  for (const b of r.bad.filter((x) => x.what === 'key words')) for (const [g, t] of Object.entries(b.values)) console.log(`  2+ KEY-COLOUR words in caption "${g}": ${t.map((x) => `"${x}"`).join(', ')} (max 1)`);
  for (const b of r.bad.filter((x) => x.what === 'treatment')) for (const [v, t] of Object.entries(b.values)) console.log(`  FAIL KINETIC TREATMENT ${v} != caption ${b.ref}  (${t.slice(0, 4).map((x) => `"${x}"`).join(', ')}${t.length > 4 ? ', ...' : ''})`);
  for (const b of r.bad.filter((x) => x.what === 'range')) for (const [v, t] of Object.entries(b.values)) console.log(`  FAIL KINETIC SIZE ${v}px outside ${KINETIC_RANGE[0]}-${KINETIC_RANGE[1]} px  (${t.slice(0, 4).map((x) => `"${x}"`).join(', ')}${t.length > 4 ? ', ...' : ''})`);
  for (const b of r.bad.filter((x) => !['box styles', 'key words', 'treatment', 'range'].includes(x.what))) console.log(`  MIXED ${b.kind} ${b.what}: ${Object.entries(b.values).map(([v, t]) => `${v}${b.what === 'sizes' ? 'px' : ''} (${t.slice(0, 3).map((x) => `"${x}"`).join(', ')}${t.length > 3 ? ', ...' : ''})`).join(' | ')}`);
  const sum = Object.entries(r.groups).map(([k, g]) => `${k} ${Object.keys(g.families).join('/')} ${Object.keys(g.sizes).join('/')}px`).join('; ');
  console.log(`text-style: ${r.bad.length ? 'FAIL' : 'PASS'}${argv.includes('--kinetic-free') ? ' (kinetic-free)' : ''} ${sum || 'no captions or kinetic words'}`);
  return r.bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv.slice(2));

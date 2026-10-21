// Overlay text of a HyperFrames project, shared by name-guard.mjs and verbatim-guard.mjs: visible text in
// <project>/index.html and the compositions it mounts (data-composition-src), plus strings assigned in their
// scripts (textContent / innerText / innerHTML / GSAP text:), minus caption elements (class token `cap`).
// Each entry: { file, where: '#id' | 'body' | 'script', text, card, ctx } where ctx is the ids and classes of the
// enclosing elements (outermost first, space-joined), own the innermost element's id and classes, and card is
// true inside a name card.
import fs from 'node:fs';
import path from 'node:path';

export const CARD = /name|lower-?third|\blt\b|byline|speaker|guest|host|credit/i;
export const read = (f) => fs.readFileSync(f, 'utf8');
export const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
export const tokens = (s) => s.match(/\p{L}[\p{L}\p{M}'’-]*\p{L}|\p{L}/gu)?.map((t) => t.replace(/['’]s$/i, '')) || [];
export const key = (t) => t.normalize('NFC').toLocaleUpperCase('en');

// ---- overlay text: walk tags, skip script/style/comments and caption subtrees, keep text with its element id
export function overlayText(html, file, { caps = false } = {}) {
  const out = [];
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const js of scripts) {
    for (const m of js.matchAll(/(?:textContent|innerText|innerHTML)\s*=\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1|\btext\s*:\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g)) {
      const s = decode((m[2] ?? m[4]).replace(/<[^>]*>/g, ' ').replace(/\$\{[^}]*\}/g, ' '));
      if (s.trim()) out.push({ file, where: 'script', text: s.trim() });
    }
  }
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template|title|head)\b[\s\S]*?<\/\1>/gi, '');
  const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr|path|circle|rect|line|polyline|polygon|ellipse|use|stop)$/i;
  const stack = []; let i = 0;
  const re = /<\/?([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g; let m;
  const push = (txt) => {
    const t = decode(txt).replace(/\s+/g, ' ').trim();
    const inCap = stack.some((e) => e.cap);
    if (!t || (inCap && !caps)) return;
    const id = [...stack].reverse().find((e) => e.id)?.id;
    out.push({ file, where: id ? `#${id}` : 'body', text: t, ...(inCap ? { cap: true } : {}), card: stack.some((e) => CARD.test(`${e.id || ''} ${e.cls}`)),
      ctx: stack.map((e) => `${e.id || ''} ${e.cls}`.trim()).filter(Boolean).join(' '), own: `${stack.at(-1)?.id || ''} ${stack.at(-1)?.cls || ''}`.trim() });
  };
  while ((m = re.exec(body))) {
    push(body.slice(i, m.index)); i = re.lastIndex;
    const [tag, name, attrs, selfClose] = [m[0], m[1], m[2], m[3]];
    if (tag.startsWith('</')) { const k = stack.map((e) => e.name).lastIndexOf(name.toLowerCase()); if (k >= 0) stack.length = k; continue; }
    if (selfClose || VOID.test(name)) continue;
    const cls = attrs.match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    stack.push({ name: name.toLowerCase(), id: attrs.match(/\bid\s*=\s*["']([^"']*)["']/i)?.[1], cls, cap: /(^|\s)cap(\s|$)/.test(cls) });
  }
  push(body.slice(i));
  return out;
}

/** Overlay texts of a project (index.html + mounted compositions), or null when index.html is missing.
 *  { caps: true } keeps caption text too (entries marked cap: true). */
export function projectOverlays(proj, opts = {}) {
  const indexFile = path.join(proj, 'index.html');
  if (!fs.existsSync(indexFile)) return null;
  const html = read(indexFile);
  const files = [indexFile, ...[...html.matchAll(/data-composition-src\s*=\s*["']([^"']+)["']/g)].map((m) => path.join(proj, m[1]))
    .filter((f, j, a) => fs.existsSync(f) && a.indexOf(f) === j)];
  return files.flatMap((f) => overlayText(read(f), path.relative(proj, f), opts));
}

// ---- transcript evidence: capitalised mid-sentence, never lowercase

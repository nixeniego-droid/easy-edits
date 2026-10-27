// Text extraction for the research sources store: HTML, Markdown, plain text and PDF (pdftotext) -> plain text
// paragraphs (blank-line separated) + a title. Also the sentence splitter and the whitespace normaliser the
// scriptwriter and the citation check share, so a quote picked from a source is always found in it again.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', deg: '°', eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó', uacute: 'ú', iacute: 'í', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', times: '×', minus: '−', shy: '' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m; }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** collapse every whitespace run to one space (the citation check compares quotes and sources this way). */
export const normWs = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** lines -> paragraphs: trims lines, drops empties, joins wrapped lines of one paragraph with a space. */
function paragraphs(text) {
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim()).filter(Boolean).join(' ')).filter(Boolean);
}

/** HTML -> {title, text}. Prefers <article>, then <main>, then <body>; scripts, styles, nav, header, footer and forms are dropped. */
export function htmlToText(html) {
  const pick = (re) => { const m = html.match(re); return m ? decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : ''; };
  const title = pick(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i) || pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const t of ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'head', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'select']) body = body.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}>`, 'gi'), ' ');
  const inner = (t) => { const m = body.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*)<\\/${t}>`, 'i')); return m ? m[1] : null; };
  body = inner('article') ?? inner('main') ?? inner('body') ?? body;
  body = body.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|section|li|ul|ol|h[1-6]|tr|table|blockquote|pre|figure|figcaption|dl|dt|dd)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return { title, text: paragraphs(decodeEntities(body)).join('\n\n') };
}

/** Markdown -> {title, text}: first # heading is the title; code blocks, images and link targets are dropped. */
export function markdownToText(md) {
  const src = md.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  const title = (src.match(/^#\s+(.+)$/m) || [])[1]?.trim() || '';
  const text = src.replace(/```[\s\S]*?```/g, '\n').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^#{1,6}\s+(.+)$/gm, '\n$1\n').replace(/^\s*[-*+]\s+/gm, '\n')
    .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1');
  return { title, text: paragraphs(text).join('\n\n') };
}

export function plainToText(txt) {
  const ps = paragraphs(txt);
  const first = ps[0] || '';
  return { title: first.length <= 100 && !/[.!?]$/.test(first) ? first : '', text: ps.join('\n\n') };
}

/** PDF file -> {title, text} through poppler's pdftotext / pdfinfo (poppler-utils). */
export function pdfToText(file) {
  const r = spawnSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error?.code === 'ENOENT') throw new Error('PDF sources need pdftotext (Debian/Ubuntu: apt install poppler-utils; macOS: brew install poppler)');
  if (r.status !== 0) throw new Error(`pdftotext failed on ${path.basename(file)}: ${(r.stderr || '').trim()}`);
  const info = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
  const title = ((info.stdout || '').match(/^Title:\s+(.+)$/m) || [])[1]?.trim() || '';
  const text = paragraphs(r.stdout.replace(/\f/g, '\n\n')).join('\n\n');
  return { title: title || plainToText(text).title, text };
}

/** kind from a file name / content type: html | md | txt | pdf */
export function kindOf(name = '', contentType = '') {
  const ct = contentType.toLowerCase(), ext = path.extname(String(name).split(/[?#]/)[0]).toLowerCase();
  if (ct.includes('pdf') || ext === '.pdf') return 'pdf';
  if (ct.includes('html') || ['.html', '.htm', '.xhtml'].includes(ext)) return 'html';
  if (ct.includes('markdown') || ['.md', '.markdown'].includes(ext)) return 'md';
  return 'txt';
}

/** text of one kind -> {title, text} (pdf takes a file path, the others a string). */
export function extract(kind, input) {
  if (kind === 'pdf') return pdfToText(input);
  if (kind === 'html') return htmlToText(input);
  if (kind === 'md') return markdownToText(input);
  return plainToText(input);
}

/** text -> sentences [{text, para, index}] (whitespace-normalised, so each is a verbatim substring of normWs(text)). */
export function sentences(text) {
  const out = [];
  String(text || '').split(/\n\s*\n/).forEach((p, para) => {
    const flat = normWs(p);
    if (!flat) return;
    // split after . ! ? (plus closing quotes / brackets) when the next sentence starts with a capital, digit or quote;
    // common abbreviations don't end a sentence
    const parts = flat.split(/(?<=(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Inc|Ltd|Co|No|Fig|U\.S))[.!?]["'’”)\]]?)\s+(?=["'‘“(]?[A-Z0-9])/);
    for (const s of parts) if (s.trim()) out.push({ text: s.trim(), para, index: out.length });
  });
  return out;
}

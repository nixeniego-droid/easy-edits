// Research sources store (SPEC R1): --source URL|FILE (repeatable) and --topic (search backend) -> <dir>/
//   sources.json            [{id, n, title, url, kind, retrieved, retrievedAt, chars, file, via}]
//   S<n>.txt                the extracted text (blank-line separated paragraphs)
//   S<n>.json               that source's metadata (same fields as its sources.json entry)
// `url` is the http(s) URL, or "file:<name>" for a local document (the base name only: no machine paths in outputs).
// --offline: local documents only; URL sources are refused and the search backend is skipped.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getBackend } from '../gen/index.mjs';
import { extract, kindOf } from './extract.mjs';

const MAX_BYTES = 10 << 20;
const isUrl = (s) => /^https?:\/\//i.test(String(s));
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** fetch a URL -> {kind, title, text, finalUrl}; PDFs are written to a temp file for pdftotext. */
export async function fetchSource(url, { timeoutMs = 20000 } = {}) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'easy-edits-research/1.4 (+source fetch for a cited explainer)', accept: 'text/html,application/pdf,text/plain,text/markdown;q=0.9,*/*;q=0.5' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`larger than ${MAX_BYTES >> 20} MB`);
  const kind = kindOf(new URL(res.url || url).pathname, res.headers.get('content-type') || '');
  if (kind === 'pdf') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-edits-src-'));
    try { const f = path.join(tmp, 'doc.pdf'); fs.writeFileSync(f, buf); return { kind, ...extract('pdf', f), finalUrl: res.url || url }; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  return { kind, ...extract(kind, buf.toString('utf8')), finalUrl: res.url || url };
}

/** a local document -> {kind, title, text} */
export function readSourceFile(file) {
  const kind = kindOf(file);
  return { kind, ...extract(kind, kind === 'pdf' ? file : fs.readFileSync(file, 'utf8')) };
}

/**
 * Build the store. sources: [URL|FILE], topic: string, dir: output folder.
 * search: a search backend object (default getBackend('search', {name: backends.search})); fetchResults: also fetch each
 * search hit's page (default true, except for mock results). Returns {dir, sources, notes}.
 */
export async function gatherSources({ sources = [], topic = '', dir, offline = false, backends = {}, search, fetchResults, limit = 5, now = new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const list = [], notes = [], seen = new Set();
  const add = (meta, text) => {
    const key = crypto.createHash('sha256').update(text).digest('hex');
    if (!text.trim()) { notes.push(`skipped ${meta.url}: no text extracted`); return; }
    if (seen.has(key) || seen.has(meta.url)) { notes.push(`skipped ${meta.url}: duplicate`); return; }
    seen.add(key); seen.add(meta.url);
    const n = list.length + 1, id = `S${n}`;
    const m = { id, n, title: (meta.title || meta.url).replace(/\s+/g, ' ').trim().slice(0, 140), url: meta.url, kind: meta.kind, via: meta.via, retrieved: day(now), retrievedAt: now.toISOString(), chars: text.length, sha256: key.slice(0, 16), file: `${id}.txt` };
    fs.writeFileSync(path.join(dir, m.file), `${text.trim()}\n`);
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(m, null, 1));
    list.push(m);
  };
  for (const s of sources) {
    if (isUrl(s)) {
      if (offline) throw new Error(`--offline: refusing to fetch ${s} (use a local copy of the document)`);
      let r;
      try { r = await fetchSource(s); } catch (e) { throw new Error(`could not fetch source ${s}: ${e.message}`); }
      add({ title: r.title, url: r.finalUrl || s, kind: r.kind, via: 'url' }, r.text);
    } else {
      if (!fs.existsSync(s)) throw new Error(`missing source file ${s}`);
      const r = readSourceFile(s);
      add({ title: r.title || path.basename(s).replace(/\.[^.]+$/, ''), url: `file:${path.basename(s)}`, kind: r.kind, via: 'file' }, r.text);
    }
  }
  if (topic && offline) notes.push('--offline: topic search skipped; only the provided documents are used');
  else if (topic) {
    const b = search || getBackend('search', { name: backends.search });
    if (b.name === 'none') notes.push('no search backend configured: topic used only to pick passages from the provided documents');
    else {
      const r = await b.generate({ query: topic, limit }, { outDir: path.join(dir, '.search'), offline });
      const mock = r.meta?.adapter === 'mock';
      for (const hit of (r.results || []).slice(0, limit)) {
        if (!hit?.url || !isUrl(hit.url)) continue;
        let text = '', title = hit.title, kind = 'txt', via = 'search-snippet';
        if (fetchResults ?? !mock) {
          try { const p = await fetchSource(hit.url); text = p.text; title = hit.title || p.title; kind = p.kind; via = 'search'; } catch (e) { notes.push(`search hit ${hit.url}: ${e.message}; using its snippet`); }
        }
        if (!text) text = String(hit.snippet || '');
        add({ title, url: hit.url, kind, via }, text);
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify(list, null, 1));
  return { dir, sources: list, notes };
}

/** read a store written by gatherSources -> {dir, sources:[{...meta, text}]} */
export function loadSources(dir) {
  const list = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'));
  return { dir, sources: list.map((m) => ({ ...m, text: fs.readFileSync(path.join(dir, m.file), 'utf8') })) };
}

/** SOURCES.txt: numbered, title, URL, retrieved date. */
export function sourcesTxt(sources, { title } = {}) {
  const head = `SOURCES${title ? ` - ${title}` : ''}\n${'='.repeat(7 + (title ? title.length + 3 : 0))}\n\n`;
  return head + sources.map((s) => `[${s.n}] ${s.title}\n    ${s.url}\n    retrieved ${s.retrieved}\n`).join('\n');
}

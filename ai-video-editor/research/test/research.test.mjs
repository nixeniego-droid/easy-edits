// Research + sourced script + citation check (SPEC R1, R2, S1): local files and a local HTTP server only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { htmlToText, markdownToText, sentences, normWs, kindOf } from '../extract.mjs';
import { gatherSources, loadSources, sourcesTxt } from '../sources.mjs';
import { writeScript, extractiveClaims } from '../script.mjs';
import { checkCitations } from '../citations.mjs';
import { writePdf, serve, scratch, BEES_HTML, BEES_MD, PDF_LINES } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const hasPdftotext = spawnSync('pdftotext', ['-v']).error == null;

test('html extraction keeps the article, drops scripts / nav / footer, decodes entities', () => {
  const r = htmlToText(BEES_HTML);
  assert.equal(r.title, 'How bees see the world');
  assert.match(r.text, /Bees see ultraviolet light, which is invisible to humans\./);
  assert.match(r.text, /A honeybee’s compound eye has about 5,500 lenses & each one/);
  assert.doesNotMatch(r.text, /Do not read|newsletter|All rights reserved|color:red/);
});

test('markdown extraction: title from the heading, emphasis and link targets dropped', () => {
  const r = markdownToText(BEES_MD);
  assert.equal(r.title, 'Honeybee navigation');
  assert.match(r.text, /called the waggle dance\./);
  assert.match(r.text, /for decoding the dance \(link\)\./);
  assert.doesNotMatch(r.text, /\*\*|https:/);
  assert.equal(kindOf('x.PDF'), 'pdf'); assert.equal(kindOf('/a', 'text/html; charset=utf-8'), 'html'); assert.equal(kindOf('notes.md'), 'md');
});

test('sentences are verbatim substrings of the whitespace-normalised text', () => {
  const text = 'Dr. Smith measured 3.5 kg. Then\nthe second line wraps here! "Quoted start" ends? yes.\n\nNew para.';
  const ss = sentences(text);
  assert.deepEqual(ss.map((s) => s.text), ['Dr. Smith measured 3.5 kg.', 'Then the second line wraps here!', '"Quoted start" ends? yes.', 'New para.']);
  for (const s of ss) assert.ok(normWs(text).includes(s.text));
});

test('sources store: files, URLs (html / md / pdf) from a local server, retrieval date + URL; --offline refuses URLs', { skip: !hasPdftotext && 'pdftotext not installed' }, async (t) => {
  const d = scratch(t, 'store');
  const pdfFile = writePdf(path.join(d, 'report.pdf'), PDF_LINES, { title: 'Pollination report' });
  const srv = await serve({ '/bees.html': { type: 'text/html; charset=utf-8', body: BEES_HTML }, '/nav.md': { type: 'text/markdown', body: BEES_MD }, '/report.pdf': { type: 'application/pdf', body: fs.readFileSync(pdfFile) } });
  t.after(() => srv.close());
  const local = path.join(d, 'notes.txt');
  fs.writeFileSync(local, 'Field notes\n\nBees returning to the hive dance on the vertical comb inside the dark nest.\n');
  const now = new Date(2026, 9, 26, 10, 0, 0);
  const g = await gatherSources({ sources: [srv.url('/bees.html'), srv.url('/nav.md'), srv.url('/report.pdf'), local, srv.url('/bees.html')], dir: path.join(d, 'sources'), now });
  assert.equal(g.sources.length, 4, 'the duplicate URL is skipped');
  assert.ok(g.notes.some((n) => /duplicate/.test(n)));
  const [h, m, p, f] = g.sources;
  assert.deepEqual([h.id, h.n, h.kind, h.title, h.url, h.retrieved], ['S1', 1, 'html', 'How bees see the world', srv.url('/bees.html'), '2026-10-26']);
  assert.deepEqual([m.kind, m.title], ['md', 'Honeybee navigation']);
  assert.deepEqual([p.kind, p.title], ['pdf', 'Pollination report']);
  assert.deepEqual([f.kind, f.title, f.url], ['txt', 'Field notes', 'file:notes.txt']);
  const store = loadSources(path.join(d, 'sources'));
  assert.match(store.sources[2].text, /A single colony can visit millions of flowers/);
  assert.ok(fs.existsSync(path.join(d, 'sources', 'S1.json')));
  assert.match(sourcesTxt(store.sources), /\[3\] Pollination report\n {4}http:\/\/127\.0\.0\.1:\d+\/report\.pdf\n {4}retrieved 2026-10-26/);
  await assert.rejects(gatherSources({ sources: [srv.url('/bees.html')], dir: path.join(d, 's2'), offline: true }), /--offline: refusing to fetch/);
  const off = await gatherSources({ sources: [local], topic: 'bees', dir: path.join(d, 's3'), offline: true, backends: { search: 'mock' } });
  assert.equal(off.sources.length, 1);
  assert.ok(off.notes.some((n) => /topic search skipped/.test(n)));
});

test('--topic through a search backend: hits are fetched (local server); mock hits keep their snippet', async (t) => {
  const d = scratch(t, 'search');
  const srv = await serve({ '/bees.html': { type: 'text/html', body: BEES_HTML } });
  t.after(() => srv.close());
  const search = { name: 'stub', capabilities: { network: false }, async generate(req) { assert.equal(req.query, 'bee vision'); return { results: [{ title: 'Bee vision', url: srv.url('/bees.html'), snippet: 'x' }, { title: 'Gone', url: srv.url('/missing'), snippet: 'Bees can learn to recognise human faces in laboratory tests.' }], meta: { adapter: 'stub' } }; } };
  const g = await gatherSources({ topic: 'bee vision', dir: path.join(d, 'a'), search });
  assert.deepEqual(g.sources.map((s) => [s.title, s.via]), [['Bee vision', 'search'], ['Gone', 'search-snippet']]);
  assert.match(g.sources[0].text ?? fs.readFileSync(path.join(d, 'a', 'S1.txt'), 'utf8'), /ultraviolet/);
  const prev = process.env.AI_VIDEO_EDITOR_BACKEND; process.env.AI_VIDEO_EDITOR_BACKEND = 'mock';
  try {
    const mock = await gatherSources({ topic: 'anything', dir: path.join(d, 'b') });
    assert.deepEqual(mock.sources.map((s) => [s.url, s.via]), [['https://example.org/mock', 'search-snippet']]);
  } finally { if (prev == null) delete process.env.AI_VIDEO_EDITOR_BACKEND; else process.env.AI_VIDEO_EDITOR_BACKEND = prev; }
});

function beeSources(t) {
  const d = scratch(t, 'script');
  const md = path.join(d, 'nav.md'), html = path.join(d, 'bees.html');
  fs.writeFileSync(md, BEES_MD); fs.writeFileSync(html, BEES_HTML);
  return gatherSources({ sources: [md, html], dir: path.join(d, 'sources') }).then(() => loadSources(path.join(d, 'sources')).sources);
}

test('extractive scriptwriter: deterministic, every source used, quotes verbatim, length near the target', async (t) => {
  const sources = await beeSources(t);
  const a = await writeScript(sources, { topic: 'how honeybees find food', targetSec: 30, backends: { llm: 'none' } });
  const b = await writeScript(sources, { topic: 'how honeybees find food', targetSec: 30, backends: { llm: 'none' } });
  assert.deepEqual(a.claims, b.claims);
  assert.equal(a.writer, 'extractive');
  assert.equal(a.targetWords, 75);
  assert.ok(a.words >= 75 * 0.6 && a.words <= 75 * 1.15, `words ${a.words}`);
  assert.deepEqual([...new Set(a.claims.map((c) => c.source))].sort(), ['S1', 'S2']);
  for (const c of a.claims) assert.ok(normWs(sources.find((s) => s.id === c.source).text).includes(c.quote), c.quote);
  assert.equal(checkCitations(a, sources).pass, true);
  const short = extractiveClaims(sources, { topic: 'waggle dance', targetWords: 20 });
  assert.ok(short.length >= 1 && short.length <= 2);
  assert.match(short[0].text, /waggle/);
});

test('llm scriptwriter: fabricated quotes are rejected, mock (non-JSON) output falls back to extractive', async (t) => {
  const sources = await beeSources(t);
  const llm = { name: 'stub', capabilities: { network: false }, async generate(req) {
    assert.match(req.prompt, /<source id="S2"/);
    return { text: `Here you go: ${JSON.stringify({ title: 'Bee senses', claims: [
      { text: 'Bees can see ultraviolet light that people cannot.', source: 'S2', quote: 'Bees see ultraviolet light, which is invisible to humans.' },
      { text: 'Bees can count to one hundred.', source: 'S2', quote: 'Bees can count to one hundred.' },
      { text: 'Made up.', source: 'S9', quote: 'Nothing here at all today.' },
    ] })}` };
  } };
  const s = await writeScript(sources, { llm, targetSec: 20 });
  assert.equal(s.writer, 'llm');
  assert.equal(s.title, 'Bee senses');
  assert.deepEqual(s.claims.map((c) => c.id), ['c1']);
  assert.deepEqual(s.rejected.map((r) => r.reason), ['quote not found verbatim in the source', 'unknown source id']);
  const prev = process.env.AI_VIDEO_EDITOR_BACKEND; process.env.AI_VIDEO_EDITOR_BACKEND = 'mock';
  try {
    const m = await writeScript(sources, { targetSec: 20 });
    assert.equal(m.writer, 'extractive');
    assert.match(m.writerNote, /mock gave no usable claims/);
  } finally { if (prev == null) delete process.env.AI_VIDEO_EDITOR_BACKEND; else process.env.AI_VIDEO_EDITOR_BACKEND = prev; }
});

test('citation check FAILs a claim whose quote is not verbatim in its source (and the CLI exits 1)', async (t) => {
  const sources = await beeSources(t);
  const s = await writeScript(sources, { targetSec: 20, backends: { llm: 'none' } });
  assert.equal(checkCitations(s, sources).pass, true);
  const bad = structuredClone(s);
  bad.claims[0].quote = bad.claims[0].quote.replace(/\w+\.$/, 'something else.');
  bad.claims.push({ id: 'cx', text: 'An extra claim.', source: 'S7', quote: 'An extra claim with no source.' });
  bad.claims.push({ id: 'cy', text: 'Short quote.', source: 'S1', quote: 'Honeybees communicate' });
  const r = checkCitations(bad, sources);
  assert.equal(r.pass, false);
  assert.deepEqual(r.claims.filter((c) => !c.pass).map((c) => [c.id, c.reason]), [['c1', 'quoted passage not found verbatim in S1'], ['cx', 'source S7 is not in the sources store'], ['cy', 'quoted passage shorter than 4 words']]);
  assert.match(r.text, /^citation: FAIL/);
  // a line wrap inside a quote is fine (whitespace is the only difference allowed)
  const wrapped = structuredClone(s); wrapped.claims[0].quote = wrapped.claims[0].quote.replace(/ /g, '\n  ');
  assert.equal(checkCitations(wrapped, sources).pass, true);
  const d = scratch(t, 'cli');
  fs.writeFileSync(path.join(d, 'bad.json'), JSON.stringify(bad));
  const store = path.join(d, 'store');
  fs.mkdirSync(store);
  fs.writeFileSync(path.join(store, 'sources.json'), JSON.stringify(sources.map(({ text, ...m }) => m)));
  for (const x of sources) fs.writeFileSync(path.join(store, x.file), x.text);
  const cli = spawnSync(process.execPath, [path.join(HERE, '..', 'citations.mjs'), path.join(d, 'bad.json'), store], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stdout, /citation: FAIL/);
});

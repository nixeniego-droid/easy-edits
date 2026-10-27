// "citation" delivery check (SPEC R2): every claim names a source in the store and quotes a passage that is found
// verbatim in that source's extracted text. Whitespace runs (line wraps, double spaces) are the only difference
// allowed. A claim that fails is a FAIL, never a warning: we don't let a script cite what its sources don't say.
//   node easy-edits/research/citations.mjs <script.json> <sources-dir>     exit 1 on FAIL
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normWs } from './extract.mjs';
import { loadSources } from './sources.mjs';

export const MIN_QUOTE_WORDS = 4;

/** script + sources [{id, text}] -> {name, pass, text, claims:[{id, source, pass, reason}]} */
export function checkCitations(script, sources) {
  const byId = new Map(sources.map((s) => [s.id, normWs(s.text)]));
  const claims = (script.claims || []).map((c, i) => {
    const id = c.id || `c${i + 1}`, q = normWs(c.quote), src = byId.get(c.source);
    let reason = '';
    if (!normWs(c.text)) reason = 'empty claim text';
    else if (!c.source) reason = 'no source id';
    else if (src == null) reason = `source ${c.source} is not in the sources store`;
    else if (!q) reason = 'no quoted passage';
    else if (q.split(' ').length < MIN_QUOTE_WORDS) reason = `quoted passage shorter than ${MIN_QUOTE_WORDS} words`;
    else if (!src.includes(q)) reason = `quoted passage not found verbatim in ${c.source}`;
    return { id, source: c.source ?? null, pass: !reason, ...(reason ? { reason } : {}) };
  });
  const bad = claims.filter((c) => !c.pass);
  const pass = claims.length > 0 && !bad.length;
  const text = !claims.length ? 'citation: FAIL the script has no claims'
    : `citation: ${pass ? 'PASS' : 'FAIL'} ${claims.length - bad.length}/${claims.length} claims quote their source verbatim${bad.length ? `; ${bad.map((c) => `${c.id}: ${c.reason}`).join('; ')}` : ''}`;
  return { name: 'citation', pass, text, claims };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [scriptFile, dir] = process.argv.slice(2);
  if (!scriptFile || !dir) { console.error('usage: citations.mjs <script.json> <sources-dir>'); process.exit(2); }
  const r = checkCitations(JSON.parse(fs.readFileSync(scriptFile, 'utf8')), loadSources(path.resolve(dir)).sources);
  console.log(r.text);
  process.exit(r.pass ? 0 : 1);
}

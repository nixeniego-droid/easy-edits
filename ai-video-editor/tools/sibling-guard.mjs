#!/usr/bin/env node
// Keep a one-shot edit fresh: find sibling projects made from the same source, and flag copies from other projects.
//   node ai-video-editor/tools/sibling-guard.mjs find <projects-root> <source.mp4> [--exclude a,b]
//     -> one sibling project name per line: a dir in <projects-root> (not excluded) whose raw/ or assets/ holds a file
//        (symlinks followed, loop-guarded) that resolves to the source, or has the source's basename, or the same
//        size + sha1; or whose meta.json / hyperframes.json mentions the source path or basename. A sibling whose dir
//        really contains <source> (its realpath, not via a link) is skipped (stderr note), since hiding it would hide
//        the input.
//   node ai-video-editor/tools/sibling-guard.mjs scan <stream.jsonl> [--allow a,b]
//     -> one "copied-from: <project>: <command>" line per Bash tool call in the claude stream-json log that runs
//        cp / rsync / cat / sed on a video-projects/<project> path not in --allow. Exit 1 when any line is printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [cmd, a1, a2] = process.argv.slice(2);
const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const list = (k) => opt(k).split(',').filter(Boolean);

// regular files under dir, following symlinked files and dirs; `seen` holds real dir paths (a link loop stops there)
function* files(dir, depth = 4, seen = new Set()) {
  let real, ents = [];
  try { real = fs.realpathSync(dir); ents = fs.readdirSync(real, { withFileTypes: true }); } catch { return; }
  if (seen.has(real)) return;
  seen.add(real);
  for (const e of ents) {
    const p = path.join(dir, e.name);
    let st = e;
    if (e.isSymbolicLink()) { try { st = fs.statSync(p); } catch { continue; } }
    if (st.isDirectory() && depth > 0) yield* files(p, depth - 1, seen);
    else if (st.isFile()) yield p;
  }
}
// every string value in a JSON file (the raw text when it does not parse)
function jsonStrings(f) {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { return []; }
  try {
    const out = [], walk = (v) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(JSON.parse(text));
    return out;
  } catch { return [text]; }
}
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

if (cmd === 'find' && a1 && a2) {
  const root = path.resolve(a1), src = fs.realpathSync(a2), exclude = new Set(list('--exclude'));
  const size = fs.statSync(src).size, bases = new Set([path.basename(src), path.basename(a2)]);
  const mentions = [src, path.resolve(a2), ...bases];
  let srcHash = null;
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')); } catch {}
  for (const d of dirs) {
    if (exclude.has(d.name)) continue;
    const dir = path.join(root, d.name);
    // skip only when the source file really lives in this project; a link in raw/ to it is a sibling
    if (src.startsWith(fs.realpathSync(dir) + path.sep)) { console.error(`sibling-guard: ${d.name} holds the source itself; not hidden`); continue; }
    const same = ['raw', 'assets'].some((sub) => {
      for (const f of files(path.join(dir, sub))) {
        if (bases.has(path.basename(f))) return true;
        let real, st;
        try { real = fs.realpathSync(f); st = fs.statSync(real); } catch { continue; }
        if (real === src || bases.has(path.basename(real))) return true;
        if (st.size === size && (srcHash ??= sha1(src)) === sha1(real)) return true;
      }
      return false;
    }) || ['meta.json', 'hyperframes.json'].some((j) => jsonStrings(path.join(dir, j)).some((v) => mentions.some((m) => v.includes(m))));
    if (same) console.log(d.name);
  }
} else if (cmd === 'scan' && a1) {
  const allow = new Set(list('--allow'));
  let n = 0, text = '';
  try { text = fs.readFileSync(a1, 'utf8'); } catch {}
  for (const line of text.split('\n')) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    for (const c of ev?.message?.content ?? []) {
      const command = c?.type === 'tool_use' && c.name === 'Bash' ? String(c.input?.command ?? '') : '';
      if (!/(^|[\s;&|(])(cp|rsync|cat|sed)\s/.test(command)) continue;
      const others = [...new Set([...command.matchAll(/video-projects\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]))].filter((p) => !allow.has(p));
      for (const p of others) { console.log(`copied-from: ${p}: ${command.replace(/\s+/g, ' ').slice(0, 200)}`); n++; }
    }
  }
  process.exitCode = n ? 1 : 0;
} else {
  console.error('usage: sibling-guard.mjs find <projects-root> <source> [--exclude a,b] | scan <stream.jsonl> [--allow a,b]');
  process.exit(2);
}

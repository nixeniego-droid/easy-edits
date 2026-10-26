#!/usr/bin/env node
// Open-source lint: FAIL on key-like strings, absolute home / machine paths, and the competitor bot's name anywhere
// except the one README.md "Use with ... Bot" line. Run: npm run lint  (or node easy-edits/tools/lint-repo.mjs [--root DIR]).
// Files: `git ls-files` (tracked + untracked, not ignored); outside a git checkout, every file under the root.
// A line containing "lint-repo: allow" is exempt from the key and path checks (never from the name check).
// The name is built from char codes so this file passes its own check.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_PATTERNS } from '../gen/config.mjs';

const NAME = String.fromCharCode(103, 114, 111, 107);
const NAME_RE = new RegExp(NAME, 'i');
// the one allowed README.md line: "Use with <Name> Bot" (bold or with "(template coming soon)")
const ALLOWED_LINE = new RegExp(`Use with ${NAME} Bot`, 'i');

const KEY_RULES = [
  ...SECRET_PATTERNS.map((re) => ({ re: new RegExp(re.source), what: 'key-like token' })),
  { re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["'][A-Za-z0-9_\-+/=.]{16,}["']/i, what: 'hard-coded credential' },
];
const PATH_RULES = [
  { re: /(?<![\w.])\/home\/[A-Za-z0-9_][\w.-]*/, what: 'absolute home path (Linux user home)' },
  { re: /(?<![\w.])\/Users\/[A-Za-z0-9_][\w.-]*/, what: 'absolute home path (macOS user home)' },
  { re: /(?<![\w.])\/root\//, what: 'absolute home path (root user home)' },
  { re: /(?<![\w.])\/work[s]pace\//, what: 'machine path (workspace dir)' },
  { re: /\b[A-Z]:\\(?:Users|Documents and Settings)\\/i, what: 'absolute home path (C:\\Users\\)' },
];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'renders', 'tmp', 'video-projects', 'raw-media', 'test-media']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|mp4|mov|mkv|webm|wav|mp3|m4a|aac|flac|ogg|ttf|otf|woff2?|onnx|bin|zip|gz|pdf)$/i;

function listFiles(root) {
  const g = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  if (g.status === 0 && fs.existsSync(path.join(root, '.git'))) return g.stdout.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = d ? `${d}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel); } else if (e.isFile()) out.push(rel);
    }
  };
  walk('');
  return out;
}

/** Lint every text file under root -> [{file, line, what, text}] (text is redacted for key hits). */
export function lintRepo(root) {
  const problems = [];
  let allowedUsed = 0;
  for (const rel of listFiles(root).sort()) {
    if (BINARY.test(rel)) continue;
    // file names count too (an adapter or test named after the bot)
    if (NAME_RE.test(rel)) problems.push({ file: rel, line: 0, what: 'forbidden name in a file path', text: rel });
    const buf = fs.readFileSync(path.join(root, rel));
    if (buf.subarray(0, 8000).includes(0)) continue;
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((ln, i) => {
      if (NAME_RE.test(ln)) {
        if (rel === 'README.md' && ALLOWED_LINE.test(ln) && ln.match(new RegExp(NAME, 'gi')).length === 1 && allowedUsed === 0) allowedUsed++;
        else problems.push({ file: rel, line: i + 1, what: 'forbidden name (only the README "Use with ... Bot" line may have it)', text: ln.trim().slice(0, 160) });
      }
      if (/lint-repo: allow/.test(ln)) return;
      for (const r of KEY_RULES) if (r.re.test(ln)) problems.push({ file: rel, line: i + 1, what: r.what, text: '[line not shown: possible secret]' });
      for (const r of PATH_RULES) { const m = ln.match(r.re); if (m) problems.push({ file: rel, line: i + 1, what: r.what, text: m[0] }); }
    });
  }
  return problems;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i > 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
  const problems = lintRepo(root);
  for (const p of problems) console.log(`FAIL  ${p.file}${p.line ? `:${p.line}` : ''}  ${p.what}: ${p.text}`);
  console.log(problems.length ? `lint-repo: ${problems.length} problem(s)` : 'lint-repo: PASS (no keys, no home paths, no forbidden name)');
  process.exit(problems.length ? 1 : 0);
}

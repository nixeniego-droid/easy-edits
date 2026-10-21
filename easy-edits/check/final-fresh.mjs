// Easy Edits stale-render gate: the final must be rendered from the current composition. FAIL when index.html, any
// file under compositions/ or assets/ is newer than the final (mtime, 2 s tolerance): the checks that read the
// DOM (card-fill, look-check, overlay-life ...) would judge a composition the final does not show.
//   node easy-edits/check/final-fresh.mjs <project-dir> <final.mp4> [--tol 2]
// Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
/** Files of the composition newer than the final: [{file, after (s)}]. */
export function staleFiles(proj, final, tol = 2) {
  const t = fs.statSync(final).mtimeMs;
  return [path.join(proj, 'index.html'), ...walk(path.join(proj, 'compositions')), ...walk(path.join(proj, 'assets'))]
    .filter((f) => fs.existsSync(f)).map((f) => ({ file: path.relative(proj, f), after: +((fs.statSync(f).mtimeMs - t) / 1000).toFixed(1) }))
    .filter((x) => x.after > tol).sort((a, b) => b.after - a.after);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2), [proj, final] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--tol');
  const ti = argv.indexOf('--tol'), tol = ti >= 0 ? +argv[ti + 1] : 2;
  if (!proj || !final || !fs.existsSync(final) || !fs.existsSync(path.join(proj, 'index.html'))) { console.error('usage: final-fresh.mjs <project-dir> <final.mp4> [--tol 2]'); process.exit(2); }
  const bad = staleFiles(proj, final, tol);
  for (const b of bad.slice(0, 12)) console.log(`  FAIL STALE ${b.file} is ${b.after} s newer than the final`);
  console.log(`final-fresh: ${bad.length ? 'FAIL' : 'PASS'} ${bad.length} composition file(s) newer than ${path.basename(final)}${bad.length ? ' (re-render the final from the current composition)' : ''}`);
  process.exit(bad.length ? 1 : 0);
}

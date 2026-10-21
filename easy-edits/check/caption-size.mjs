// Easy Edits caption size check: one phone-readable settled size for every caption, inside the safe zone.
//   node easy-edits/check/caption-size.mjs <project-dir> [--preset captions.json] [--json]
// Reads <project>/index.html. --preset: a style's caption preset (e.g. styles/clean-cut/captions.json, 68 px, 2 lines)
// instead of presets/captions-default.json. FAIL on any of:
//   size      `.cap span` font px below the preset (presets/captions-default.json font.size, 100 px at 1080 wide)
//   override  a font-size / font on `#capN`, `#capN span`, `.cap.<x> span` or a caption clip's inline style
//   settle    a caption's last scale tween does not settle at 1 (pop-in frames may be smaller or larger), or any
//             scale set / tween on `#caps` or `.cap` (per-layout shrinking)
//   overflow  estimated text width over the box: 0.66 em per char (Montserrat 900 caps measured on gen-talk-v3:
//             "THE PHILIPPINES", 15 chars at 84 px = 786 px = 0.62 em, +5%); a preset with box.lines N wraps, so its
//             budget is N x the box width
//   margin    the caption box closer than 40 px to a frame edge
//   safe      a caption centre outside the preset safeZone (top / bottom platform UI)
// Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { preset } from '../presets/captions-default.mjs';
import { readCaptions } from './caption-face.mjs';

export const EM = 0.66;

export function checkCaptionSize(html, p = preset) {
  const geo = readCaptions(html), bad = [];
  const add = (kind, what) => bad.push({ kind, what });
  if (!geo.caps.length) return { geo, bad };
  if (geo.font < p.font.size) add('size', `.cap span ${geo.font}px < ${p.font.size}px`);
  for (const m of html.matchAll(/(#cap\d+(?: span)?|\.cap\.[\w-]+(?: span)?|#caps [^{]*)\{([^}]*)\}/g)) {
    if (/font(-size)?:/.test(m[2])) add('override', `${m[1]} {${m[2].trim()}}`);
  }
  for (const c of geo.caps) if (/font(-size)?:/.test(c.style)) add('override', `${c.id} inline style`);
  const last = new Map();
  for (const m of html.matchAll(/tl\.(?:set|to|from|fromTo)\('([^']+)',(\{[^}]*\})(?:,(\{[^}]*\}))?,([\d.]+)\)/g)) {
    const tgt = m[1], vars = m[3] || m[2], s = vars.match(/(?:^|[{,])scale:([\d.]+)/);
    if (!s) continue;
    if (/^(#caps|\.cap)\b/.test(tgt) && +s[1] !== 1) add('settle', `${tgt} scale ${s[1]} @${m[4]}`);
    const id = tgt.match(/^#(cap\d+)\b/)?.[1];
    if (id && (!last.has(id) || +m[4] >= last.get(id).t)) last.set(id, { t: +m[4], scale: +s[1] });
  }
  for (const [id, v] of last) if (v.scale !== 1) add('settle', `${id} settles at scale ${v.scale}`);
  if (geo.left < 40 || geo.left + geo.width > 1040) add('margin', `box ${geo.left}-${geo.left + geo.width}px`);
  for (const c of geo.caps) {
    const w = c.text.length * geo.font * EM;
    if (w > geo.width * (p.box?.lines || 1)) add('overflow', `${c.id} "${c.text}" ~${Math.round(w)}px > ${geo.width * (p.box?.lines || 1)}px`);
    if (c.y < p.safeZone.top || c.y > p.safeZone.bottom) add('safe', `${c.id} "${c.text}" y ${c.y}`);
  }
  return { geo, bad };
}

function main(argv) {
  const pi = argv.indexOf('--preset'), pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--preset');
  if (pos.length !== 1 || (pi >= 0 && !fs.existsSync(argv[pi + 1] || ''))) { console.error('usage: caption-size.mjs <project-dir> [--preset captions.json] [--json]'); return 2; }
  const p = pi >= 0 ? JSON.parse(fs.readFileSync(argv[pi + 1], 'utf8')) : preset;
  const r = checkCaptionSize(fs.readFileSync(path.join(pos[0], 'index.html'), 'utf8'), p);
  if (argv.includes('--json')) console.log(JSON.stringify(r.bad, null, 1));
  const kinds = {};
  for (const b of r.bad) (kinds[b.kind] ||= []).push(b.what);
  for (const [k, v] of Object.entries(kinds)) console.log(`  ${k.padEnd(8)} ${v.length}: ${v.slice(0, 4).join('; ')}${v.length > 4 ? ' ...' : ''}`);
  console.log(`caption-size: ${r.bad.length ? 'FAIL' : 'PASS'} ${r.geo.caps.length} captions at ${r.geo.font}px (preset ${p.name || 'captions-default'} ${p.font.size}px), box ${r.geo.left}-${r.geo.left + r.geo.width}px`);
  return r.bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));

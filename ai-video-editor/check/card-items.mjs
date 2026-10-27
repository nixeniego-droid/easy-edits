// AI Video Editor card-items check (embedded brief, look-bright cards.maxItems / cards.atOnce): ONE card at a time with at
// most 3 list rows / notification items.
//   node ai-video-editor/check/card-items.mjs <project-dir> [--max-items 3] [--max-cards 1] [--json]
// Static DOM parse of index.html: every timed `.clip` whose subtree holds a `card` class is a card clip; its cards
// are the `card` elements inside it (a stack in one clip counts each). Items per card = elements with a list-item
// class (chk, item, row-item, list-row, notif, notification, toast, msg, bubble) plus <li>; the headline row is not
// an item. Cards on screen at once = sum of the cards in the clips active at each clip start. FAIL when a card has
// more than --max-items items or more than --max-cards cards are on screen at once. Exit 1 on FAIL, 2 on usage.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_ITEMS = 3, MAX_CARDS = 1;
const ITEM = new Set(['chk', 'item', 'row-item', 'list-row', 'notif', 'notification', 'toast', 'msg', 'bubble']);
const cls = (tag) => (tag.match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/).filter(Boolean);
const attr = (tag, a) => tag.match(new RegExp(`\\b${a}="([^"]*)"`))?.[1];

/** html -> element tree nodes [{tag, name, cls, children, start, end}] (div/li/span/section only; enough for cards). */
function tree(html) {
  const root = { children: [] }, stack = [root];
  for (const m of html.matchAll(/<(\/?)(div|li|section|span|ul|ol)\b[^>]*?>/g)) {
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const n = { tag: m[0], name: m[2], cls: cls(m[0]), children: [] };
    stack.at(-1).children.push(n); if (!m[0].endsWith('/>')) stack.push(n);
  }
  return root;
}
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };

/** index.html -> [{id, start, end, cards: [{id, items}]}] */
export function cardClips(html) {
  const out = [];
  walk(tree(html), (n) => {
    if (!n.cls?.includes('clip') || attr(n.tag, 'data-start') == null) return;
    const cards = [];
    n.children.forEach((c) => walk(c, (x) => {
      if (!x.cls.includes('card')) return;
      let items = 0; x.children.forEach((c2) => walk(c2, (y) => { if (y.name === 'li' || y.cls.some((k) => ITEM.has(k))) items++; }));
      cards.push({ id: attr(x.tag, 'id') || '', items });
    }));
    if (!cards.length) return;
    const start = +attr(n.tag, 'data-start');
    out.push({ id: attr(n.tag, 'id') || '', start, end: start + +attr(n.tag, 'data-duration'), cards });
  });
  return out;
}

/** -> {clips, crowded: [{id, items}], stacks: [{t, n, ids}], ok} */
export function checkCardItems(clips, { maxItems = MAX_ITEMS, maxCards = MAX_CARDS } = {}) {
  const crowded = clips.flatMap((c) => c.cards.filter((k) => k.items > maxItems).map((k) => ({ ...k, clip: c.id, start: c.start })));
  const stacks = [];
  for (const c of clips) {
    const on = clips.filter((d) => d.start <= c.start + 1e-6 && d.end > c.start + 1e-6), n = on.reduce((s, d) => s + d.cards.length, 0);
    if (n > maxCards) stacks.push({ t: c.start, n, ids: on.map((d) => d.id) });
  }
  return { clips, crowded, stacks, ok: !crowded.length && !stacks.length };
}

function main(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) argv[i] === '--json' ? (o.json = true) : argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  if (pos.length !== 1) { console.error('usage: card-items.mjs <project-dir> [--max-items 3] [--max-cards 1] [--json]'); return 2; }
  const maxItems = +(o['max-items'] || MAX_ITEMS), maxCards = +(o['max-cards'] || MAX_CARDS);
  const r = checkCardItems(cardClips(fs.readFileSync(path.join(pos[0], 'index.html'), 'utf8')), { maxItems, maxCards });
  if (o.json) console.log(JSON.stringify(r, null, 1));
  for (const c of r.clips) console.log(`  ${c.start.toFixed(2).padStart(6)}-${c.end.toFixed(2).padStart(6)} s ${c.id}: ${c.cards.map((k) => `${k.id} ${k.items} item(s)`).join(', ')}`);
  for (const k of r.crowded) console.log(`  TOO MANY ITEMS ${k.start.toFixed(2)} s ${k.clip}/${k.id}: ${k.items} > ${maxItems}`);
  for (const s of r.stacks) console.log(`  STACK ${s.t.toFixed(2)} s: ${s.n} cards on screen (${s.ids.join(', ')}) > ${maxCards}`);
  console.log(`card-items: ${r.ok ? 'PASS' : 'FAIL'} ${r.clips.length} card clip(s), ${r.crowded.length} card(s) > ${maxItems} items, ${r.stacks.length} moment(s) > ${maxCards} card on screen`);
  return r.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));

// Openverse music search/download. Anonymous
// API limits are 20 requests/minute and 200/day; we track our own usage and refuse to
// exceed them. Results keep their own CC licenses; CREDITS.txt is written next to the
// render. Files are cached in ~/.cache/easy-edits/audio and never committed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, NAME, VERSION } from './config.mjs';

const API = 'https://api.openverse.org/v1/audio/';
export const LIMITS = { perMinute: 20, perDay: 200 };
const stateFile = () => join(CACHE_DIR, 'openverse-usage.json');

/** Throws if one more request would break the anonymous limits; records it otherwise. */
export function takeToken(now = Date.now(), file = stateFile()) {
  const log = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).filter((t) => now - t < 86400e3) : [];
  if (log.filter((t) => now - t < 60e3).length >= LIMITS.perMinute) throw new Error('Openverse limit: 20 requests/minute reached; wait a minute');
  if (log.length >= LIMITS.perDay) throw new Error('Openverse limit: 200 requests/day reached; try tomorrow or register API credentials');
  log.push(now);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(log));
  return log.length;
}

export function searchUrl(query, { pageSize = 10 } = {}) {
  const u = new URL(API);
  u.searchParams.set('q', query);
  u.searchParams.set('license_type', 'commercial,modification');
  u.searchParams.set('page_size', String(pageSize));
  return u.toString();
}

export async function search(query, opts = {}) {
  takeToken();
  const res = await fetch(searchUrl(query, opts), { headers: { 'User-Agent': `${NAME}/${VERSION} (open-source video kit)` } });
  if (!res.ok) throw new Error(`Openverse ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.results.map((r) => ({
    id: r.id, title: r.title, creator: r.creator, license: r.license, license_version: r.license_version,
    license_url: r.license_url, source_url: r.foreign_landing_url, url: r.url, duration_ms: r.duration, filetype: r.filetype,
  }));
}

export async function download(item) {
  const dir = join(CACHE_DIR, 'audio');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${item.id}.${item.filetype || 'mp3'}`);
  if (!existsSync(file)) {
    const res = await fetch(item.url, { headers: { 'User-Agent': `${NAME}/${VERSION}` } });
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  writeFileSync(`${file}.json`, JSON.stringify(item, null, 2));
  return file;
}

export function creditsText(items) {
  return items.map((i) => [
    `Title: ${i.title}`, `Creator: ${i.creator}`, `License: ${String(i.license).toUpperCase()} ${i.license_version || ''}`.trim(),
    `License URL: ${i.license_url}`, `Source: ${i.source_url}`,
  ].join('\n')).join('\n\n') + '\n';
}

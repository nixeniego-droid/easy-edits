// Music-video planner (SPEC M2, X2, E3, S2, F1; recipe 6). --song FILE needs --i-own-this-music (refused
// otherwise; the attestation is recorded in report.json). The song is analysed locally for beats, shot boundaries
// snap to beats (downbeats preferred) within a tolerance, the video is exactly the song's length, and optional
// --lyrics (user-supplied only: LRC, SRT or plain lines) become captions.
import fs from 'node:fs';
import { parseAspect, sha, r3 } from './ffx.mjs';
import { loadCharacters, loadShots, normaliseShots, normTransition } from './shots.mjs';
import { resolveBackends, plannedSource, usable } from './sources.mjs';
import { analyseBeats, beatCuts } from './beats.mjs';
import { musicAttestation, backendSummary, LOUDNESS_SOCIAL } from './story.mjs';
import { RefusalError } from './errors.mjs';

const clock = (s) => { const p = String(s).trim().replace(',', '.').split(':').map(Number); return p.reduce((a, v) => a * 60 + v, 0); };
const lrcTime = (s) => { const m = s.match(/^(\d+):(\d+)(?:[.:](\d+))?$/); return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0); };

/** Lyrics -> caption cues. LRC ([mm:ss.xx] line) and SRT keep their times; plain lines are spread over the song. */
export function parseLyrics(text, durationSec) {
  const t = String(text).replace(/\r/g, '');
  const notes = [];
  let cues = [];
  const lrc = [...t.matchAll(/^\s*\[(\d+:\d+(?:[.:]\d+)?)\](.*)$/gm)].map((m) => ({ start: lrcTime(m[1]), text: m[2].trim() }));
  if (lrc.length) {
    lrc.sort((a, b) => a.start - b.start);
    cues = lrc.map((c, i) => ({ start: c.start, end: Math.min(lrc[i + 1]?.start ?? durationSec, c.start + 6), text: c.text })).filter((c) => c.text);
  } else if (/-->/.test(t)) {
    for (const b of t.split(/\n\s*\n/)) {
      const m = b.match(/([\d:.,]+)\s*-->\s*([\d:.,]+)\s*\n([\s\S]+)/);
      if (m) cues.push({ start: clock(m[1]), end: clock(m[2]), text: m[3].trim().replace(/\n+/g, ' ') });
    }
  } else {
    const lines = t.split('\n').map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
    const step = durationSec / Math.max(1, lines.length);
    cues = lines.map((l, i) => ({ start: i * step, end: (i + 1) * step - 0.1, text: l }));
    if (lines.length) notes.push('lyrics have no timestamps: lines are spread evenly over the song (use an LRC or SRT file for timed lyrics)');
  }
  return { cues: cues.filter((c) => c.start < durationSec).map((c) => ({ start: r3(c.start), end: r3(Math.min(c.end, durationSec)), text: c.text })), notes };
}

/**
 * Plan a music video. opts: song, iOwnThisMusic, brief | shotlist (prompts, cycled over the cuts), characters,
 * aspect, backend, shotSec (default 4 beats), snapTolerance (s), transition (default cut), lyrics, title.
 */
export function planMusicVideo(opts = {}) {
  if (!opts.song) throw new RefusalError('NO_SONG', 'music-video needs --song FILE (music you own or have licensed)');
  const music = musicAttestation(opts.song, !!opts.iOwnThisMusic);
  const dims = parseAspect(opts.aspect || opts.format || '9:16');
  const characters = loadCharacters(opts.characters);
  const backends = resolveBackends(opts.backend, opts.backends);
  const source = plannedSource(backends);
  const maxClip = source === 'video' ? backends.video.capabilities.maxClipSeconds : Infinity;
  const a = analyseBeats(opts.song);
  const beatSec = a.bpm ? 60 / a.bpm : 0.5;
  const shotSec = Number(opts.shotSec) || Math.min(Math.max(1, beatSec * 4), Math.min(maxClip, 6));
  const tolerance = opts.snapTolerance != null ? Number(opts.snapTolerance) : Math.min(0.25, beatSec / 2);
  const { cuts, end } = beatCuts(a, { shotSec, tolerance, maxSec: maxClip });
  const bounds = [0, ...cuts.map((c) => c.at), end];
  let pool = [{ prompt: 'abstract visuals that move with the music', characters: [] }];
  if (opts.brief || opts.shotlist) pool = loadShots({ brief: opts.brief, shotlist: opts.shotlist, characters, transition: opts.transition || 'cut' }).shots;
  const tr = normTransition(opts.transition || 'cut');
  const raw = bounds.slice(0, -1).map((b, i) => {
    const p = pool[i % pool.length];
    return { ...p, id: `m${i + 1}`, durationSec: bounds[i + 1] - b, transition: p.transition && opts.transition == null ? p.transition : tr, transitionSec: Math.min(0.3, beatSec / 2), narration: undefined, clip: p.clip };
  });
  const { shots, total } = normaliseShots(raw, { characters, maxClipSeconds: 0, source, style: opts.style });
  const notes = [];
  if (!a.beats.length) notes.push(`no beat grid found (${a.note || 'unclear rhythm'}): cuts every ${r3(shotSec)} s`);
  let lyrics = [];
  if (opts.lyrics) { const l = parseLyrics(fs.readFileSync(opts.lyrics, 'utf8'), total); lyrics = l.cues; notes.push(...l.notes); }
  const err = cuts.filter((c) => c.snapErrorMs != null).map((c) => c.snapErrorMs);
  const per = backendSummary(backends);
  const generations = { video: shots.filter((s) => s.source === 'video').length, image: shots.filter((s) => s.source === 'still').length, tts: 0 };
  generations.estimatedCost = r3(generations.video * per.video.costPerCall + generations.image * per.image.costPerCall);
  const plan = {
    recipe: 'music-video', version: 1, title: opts.title || null, ...dims, fps: 30, backend: opts.backend || null, backends: per,
    characters, shots, splits: [], durationSec: total, captions: lyrics.length > 0, lyrics,
    music: { ...music, durationSec: a.durationSec }, loudness: { ...LOUDNESS_SOCIAL }, generations, notes,
    beats: { bpm: a.bpm, count: a.beats.length, downbeats: a.downbeats.length, method: a.method, times: a.beats },
    cuts, snap: { cuts: cuts.length, snapped: cuts.filter((c) => c.snapped).length, toleranceSec: r3(tolerance), shotSec: r3(shotSec), meanErrorMs: err.length ? Math.round(err.reduce((x, y) => x + y, 0) / err.length) : null, maxErrorMs: err.length ? Math.max(...err) : null },
  };
  plan.id = sha({ s: shots.map((s) => [s.id, s.durationSec, s.fullPrompt]), m: music.sha256, w: dims.width, h: dims.height });
  return plan;
}

// Render a story / music-video plan end to end: per-shot generation with fallbacks, conform, per-shot QA,
// assembly with transitions and captions, narration / song soundtrack, loudness master (-14 LUFS / -1.5 dBTP),
// BT.709 check, a shot sheet, report.json (with WEAK_SHOTS) and REVIEW.txt.
import fs from 'node:fs';
import path from 'node:path';
import { resolveBackends, produceShot, conformShot, usable } from './sources.mjs';
import { qaShot, QA_LIMITS, fmtTime } from './qa.mjs';
import { timelineLengths, assembleVideo, writeCaptions, buildSoundtrack } from './assemble.mjs';
import { textCues } from './shots.mjs';
import { finishAudio, colorCheck, probe, shotSheet, r3 } from './ffx.mjs';
import { PendingAssetsError } from '../new/hostflow.mjs';
import { applyClipAudio, clipAudioPolicy, hasAudio } from '../new/clip-audio.mjs';

const say = (ctx, m) => (ctx.log || ((s) => process.stderr.write(`easy-edits: ${s}\n`)))(m);
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || null;

/** Narration clips through the TTS backend (one per shot with narration text); none when no TTS is available. */
async function narrate(plan, backends, work, ctx) {
  const out = [], notes = [];
  if (plan.narrationFile) out.push({ file: plan.narrationFile, at: 0, durationSec: r3(probe(plan.narrationFile).duration), shot: null, text: null });
  const wants = plan.shots.filter((s) => s.narration);
  if (!wants.length) return { voices: out, notes };
  if (!usable(backends.tts, 'tts')) { notes.push(`narration skipped: TTS backend "${backends.tts?.name || 'none'}" not available`); return { voices: out, notes }; }
  for (const s of wants) {
    try {
      const r = await backends.tts.generate({ text: s.narration, voice: plan.voice || null, speaker: s.speaker || 'A', rate: 1 }, { outDir: path.join(work, 'gen'), offline: ctx.offline });
      const d = r.durationSec ?? probe(r.file).duration;
      out.push({ file: r.file, at: r3(s.start + 0.15), durationSec: r3(d), shot: s.id, text: s.narration });
    } catch (e) { notes.push(`narration for ${s.id} failed: ${String(e.message).split('\n')[0]}`); }
  }
  return { voices: out, notes };
}

/**
 * Render `plan` (from planStory / planMusicVideo) into ctx.outDir. Returns {file, report, reportFile, pass}.
 * ctx: {outDir, offline, backends? (injected backend objects), log?, work?, clipAudio? (auto|keep|duck|drop)}.
 * Host-generated shots: every request is made first; while any is pending the render stops (PendingAssetsError).
 */
export async function renderPlan(plan, ctx = {}) {
  const outDir = path.resolve(ctx.outDir || 'out');
  const name = `easy-edits_${plan.recipe}_${slug(plan.title) || plan.recipe}`;
  const work = ctx.work || path.join(outDir, '.work', name);
  fs.mkdirSync(path.join(work, 'shots'), { recursive: true });
  const backends = resolveBackends(plan.backend, ctx.backends);
  const { width, height } = plan;
  const lens = timelineLengths(plan.shots);
  const shots = [], weak = [];
  let cost = 0;
  const gens = { video: 0, image: 0, tts: 0 };
  const raws = [];
  for (const [i, shot] of plan.shots.entries()) {
    say(ctx, `shot ${i + 1}/${plan.shots.length} ${shot.id} (${shot.durationSec} s, ${shot.source})`);
    raws.push(await produceShot(shot, { backends, width, height, work, offline: ctx.offline, planId: plan.id, hostDir: outDir }));
  }
  if (raws.some((r) => r.source === 'pending')) throw new PendingAssetsError(outDir);
  const clipItems = [];
  for (const [i, shot] of plan.shots.entries()) {
    const raw = raws[i];
    if (raw.source === 'video') gens.video++; else if (raw.source === 'still') gens.image++;
    cost += raw.cost || 0;
    const { len, td } = lens[i];
    const c = conformShot(raw, shot, { width, height, len, out: path.join(work, 'shots', `${String(i).padStart(3, '0')}_${shot.id.replace(/[^A-Za-z0-9_.-]/g, '_')}.mp4`), index: i });
    const start = r3(Math.max(0, shot.start - td / 2));
    if (raw.source === 'video') clipItems.push({ file: raw.file, at: start, dur: len });
    const q = qaShot({ shot, raw, file: c.file, len, start, refs: shot.refs || [], limits: { ...QA_LIMITS, ...(plan.qaLimits || {}) } });
    weak.push(...q.weak);
    shots.push({
      id: shot.id, start: shot.start, durationSec: shot.durationSec, source: raw.source, planned: shot.source,
      transition: shot.transition, ...(td ? { transitionSec: td } : {}), ...(shot.splitFrom ? { splitFrom: shot.splitFrom, part: `${shot.part}/${shot.parts}` } : {}),
      prompt: shot.fullPrompt, characters: shot.characters, refsPassed: raw.refsPassed, ...(raw.backend ? { backend: raw.backend } : {}),
      ...(raw.fallbacks.length ? { fallbacks: raw.fallbacks } : {}), qa: q.metrics, file: c.file, len, td,
    });
  }

  // captions: shot captions / narration (story), or the user's lyrics (music video)
  const { voices, notes: vNotes } = await narrate(plan, backends, work, ctx);
  gens.tts = voices.filter((v) => v.shot).length;
  let cues = [];
  if (plan.captions) {
    if (plan.lyrics?.length) cues = plan.lyrics;
    else for (const s of plan.shots) {
      const text = s.caption || s.narration;
      if (!text) continue;
      const v = voices.find((x) => x.shot === s.id);
      cues.push(...textCues(text, v ? v.at : s.start + 0.1, v ? v.durationSec : s.durationSec - 0.2));
    }
    cues = cues.map((c) => ({ ...c, end: Math.min(c.end, plan.durationSec) })).filter((c) => c.end > c.start);
  }
  const base = path.join(outDir, name);
  const cap = cues.length ? writeCaptions(cues, { width, height, assFile: path.join(work, 'captions.ass'), base }) : null;

  say(ctx, `assemble ${shots.length} shots -> ${plan.durationSec} s ${width}x${height}`);
  const silent = path.join(work, 'video.mp4');
  const asm = assembleVideo(shots.map((s) => ({ file: s.file, len: s.len, td: s.td, transition: s.transition })), { total: plan.durationSec, out: silent, ass: cap?.ass, work });

  // generated clips' own (ambient) audio: dropped under narration or a song, ducked under music, else kept
  const flag = ctx.clipAudio || plan.clipAudio || 'auto';
  const song = plan.recipe === 'music-video', music = !song && !!plan.music?.file;
  const policy = clipAudioPolicy(flag, { voice: voices.length > 0, song, music });
  const onlyClips = policy.mode !== 'drop' && !plan.music?.file && !voices.length && clipItems.some((c) => hasAudio(c.file));
  const pre = buildSoundtrack({ bed: plan.music?.file ? { file: plan.music.file, gainDb: 0 } : null, voices, total: plan.durationSec, out: path.join(work, 'premaster.wav'), ambient: !onlyClips });
  const clipAudio = applyClipAudio(pre, clipItems, { flag, voice: voices.length > 0, song, music, total: plan.durationSec, work });
  const file = `${base}.mp4`;
  fs.copyFileSync(silent, file);
  say(ctx, `master ${plan.loudness.target} LUFS / ${plan.loudness.truePeak} dBTP`);
  const loud = finishAudio(pre, file, { duration: plan.durationSec, target: plan.loudness.target, truePeak: plan.loudness.truePeak });
  const color = colorCheck(file);
  const p = probe(file);
  const durationOk = Math.abs(p.duration - plan.durationSec) <= 0.1;
  const sheet = shotSheet(file, shots, `${base}_sheet.png`);

  for (const v of voices.filter((x) => x.shot)) {
    const s = plan.shots.find((x) => x.id === v.shot);
    if (s && v.durationSec > s.durationSec + 0.5) weak.push({ shot: s.id, timestamp: fmtTime(s.start), startSec: s.start, check: 'narration', reason: `narration runs ${v.durationSec} s over a ${s.durationSec} s shot`, fix: 'lengthen the shot or shorten its narration' });
  }
  weak.sort((a, b) => a.startSec - b.startSec);
  const pass = loud.pass && color.pass && durationOk;
  const checks = [
    `loudness: I ${loud.I} LUFS (target ${loud.target} +-1), TP ${loud.TP} dBTP (<= ${loud.truePeak}) ${loud.pass ? 'PASS' : 'FAIL'}`,
    `color: ${color.primaries}/${color.transfer}/${color.space} ${color.pass ? 'PASS' : 'FAIL'}`,
    `duration: ${r3(p.duration)} s (plan ${plan.durationSec} s) ${durationOk ? 'PASS' : 'FAIL'}`,
  ];
  const report = {
    recipe: plan.recipe, title: plan.title || null, file: path.basename(file), aspect: plan.aspect, width, height, fps: 30,
    durationSec: r3(p.duration), planId: plan.id,
    backends: { video: backends.video?.name, image: backends.image?.name, tts: backends.tts?.name },
    generations: { ...gens, cost: r3(cost), planned: plan.generations },
    characters: (plan.characters || []).map((c) => ({ name: c.name, description: c.description, refs: c.refs.map((f) => path.basename(f)) })),
    shots: shots.map(({ file: _f, len: _l, td: _t, ...s }) => s), splits: plan.splits || [],
    WEAK_SHOTS: weak, qa: { limits: { ...QA_LIMITS, ...(plan.qaLimits || {}) }, weakCount: weak.length, shotsChecked: shots.length },
    loudness: loud, color, checks,
    captions: cap ? { count: cues.length, source: plan.lyrics?.length ? 'lyrics (user-supplied)' : 'shot narration / captions', files: cap.files.map((f) => path.basename(f)) } : null,
    narration: voices.map((v) => ({ shot: v.shot, at: v.at, durationSec: v.durationSec })),
    clipAudio,
    ...(plan.music ? { music: { file: path.basename(plan.music.file), sha256: plan.music.sha256, durationSec: plan.music.durationSec, attestation: plan.music.attestation } } : {}),
    ...(plan.beats ? { beats: plan.beats, cuts: plan.cuts, snap: plan.snap } : {}),
    sheet: sheet ? path.basename(sheet) : null, assembledSec: asm.assembledSec,
    notes: [...(plan.notes || []), ...vNotes],
    exports: [{ file, pass, note: pass ? '' : checks.filter((c) => c.endsWith('FAIL')).join('; ') }],
  };
  const reportFile = `${base}.report.json`;
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(outDir, 'REVIEW.txt'), reviewText(report));
  say(ctx, `${pass ? 'ok' : 'CHECK FAIL'} ${file} (${weak.length} weak shot${weak.length === 1 ? '' : 's'}); report ${reportFile}`);
  return { file, report, reportFile, pass };
}

/** Plain statements an agent can relay verbatim. */
export function reviewText(r) {
  const L = [`${r.recipe} ${r.file}: ${r.durationSec} s, ${r.width}x${r.height}, ${r.shots.length} shots.`, ...r.checks.map((c) => `Check ${c}.`)];
  if (r.music?.attestation) L.push(`Music: ${r.music.file}; ${r.music.attestation.statement}`);
  if (r.snap) L.push(`Cuts: ${r.snap.snapped}/${r.snap.cuts} on the beat; mean snap error ${r.snap.meanErrorMs} ms, max ${r.snap.maxErrorMs} ms.`);
  if (!r.WEAK_SHOTS.length) L.push('Weak shots: none found by the automatic checks (they cannot judge whether a shot matches its prompt; look at the sheet).');
  else { L.push(`Weak shots (${r.WEAK_SHOTS.length}):`); for (const w of r.WEAK_SHOTS) L.push(`- Shot ${w.shot} at ${w.timestamp}: ${w.reason}. Suggested fix: ${w.fix}.`); }
  for (const n of r.notes || []) L.push(`Note: ${n}`);
  return `${L.join('\n')}\n`;
}

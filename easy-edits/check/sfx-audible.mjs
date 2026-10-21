// Easy Edits SFX audibility check: did the planned SFX events reach the delivered audio?
//   node easy-edits/check/sfx-audible.mjs <video.mp4|mix.wav> <project-dir> [--json] [--slack 4] [--min-frac 0.5]
// Events = <project>/assets/plan.json events with an sfx. Reference = <project>/assets/voice.wav (the dry voice).
// Both are decoded mono 48 kHz through the master's 75 Hz high-pass; the delivered file is aligned to the voice by
// envelope cross-correlation (finds the post lead-in, 0-1.5 s); a post output (lead-in found) is compared with the
// reference through the premaster's 75 Hz high-pass once more, so their phases match. The voice is removed with a
// least-squares gain per 10 ms block (follows the master's compressor; SFX are uncorrelated with the voice); what
// is left is SFX, music and codec/compressor residue. Per event at t (composition time), on [t-0.02, t+0.35]:
//   rel     residual peak, dB re the delivered voice peak (reference peak x median fitted voice gain)
//   excess  residual RMS re the file's residual RMS away from every event (dB)
// An event is heard when rel >= its house class level - --slack (4 dB) and excess >= 6 dB. FAIL when fewer than
// --min-frac (half) of the planned SFX events are heard. Exit 1 on FAIL, 2 on usage.
// Run it on the composition render (edit.sh does): residual floor ~-60 dB re voice peak there. On a mastered AAC
// final the floor is ~-45 dB and the excess test is noisy (pre-fix gen_talk_v3.mp4 still showed 9/16 by excess
// alone), so treat the final's numbers as a cross-check.
// House level (easy-edits/audio/sfx-synth.mjs HOUSE): every cue -19 dB re the voice peak (-20..-18).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HOUSE, houseClass } from '../audio/sfx-synth.mjs';

const SR = 48000;
export function decode(file, af = 'highpass=f=75') {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-af', af, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`decode ${file}: ${r.stderr}`);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const peak = (a, s, e) => { let p = 0; for (let i = Math.max(0, s); i < Math.min(a.length, e); i++) p = Math.max(p, Math.abs(a[i])); return p; };
const rms = (a, s, e) => { let q = 0, n = 0; for (let i = Math.max(0, s); i < Math.min(a.length, e); i++) { q += a[i] * a[i]; n++; } return n ? Math.sqrt(q / n) : 0; };

/** Lag (samples) of `out` behind `ref`, from 1 ms abs-envelopes, searched 0..maxSec. */
export function align(ref, out, maxSec = 1.5) {
  const env = (a) => { const n = Math.floor(a.length / 48), e = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < 48; j++) s += Math.abs(a[i * 48 + j]); e[i] = s; } return e; };
  const er = env(ref), eo = env(out);
  let best = 0, bestScore = -Infinity;
  for (let lag = 0; lag <= maxSec * 1000; lag++) {
    let s = 0; for (let i = 0; i + lag < eo.length && i < er.length; i++) s += er[i] * eo[i + lag];
    if (s > bestScore) { bestScore = s; best = lag; }
  }
  // refine to the sample within +-1 ms
  let fine = best * 48, fineScore = -Infinity;
  for (let d = -48; d <= 48; d++) {
    const lag = best * 48 + d; if (lag < 0) continue;
    let s = 0; for (let i = 0; i < Math.min(ref.length, 10 * SR) && i + lag < out.length; i += 2) s += ref[i] * out[i + lag];
    if (s > fineScore) { fineScore = s; fine = lag; }
  }
  return fine;
}

/** Residual = out - g*ref (g fitted locally around each event), measured per event. */
export function measureSfx(ref, out, events, { slack = 4, minExcess = 6 } = {}) {
  const lag = align(ref, out);
  const at = (t) => Math.round(t * SR);
  // local voice-removed residual on [s, e) in out's timeline (ref index = out index - lag)
  const residual = (s, e) => {
    // voice gain fitted per 10 ms block (tracks the master's compressor/limiter; SFX are uncorrelated with the voice)
    const B = 480, res = new Float32Array(e - s);
    for (let b = s; b < e; b += B) {
      let xy = 0, xx = 0;
      for (let i = b; i < Math.min(e, b + B); i++) { const r = ref[i - lag] ?? 0; xy += r * out[i]; xx += r * r; }
      const g = xx > 1e-6 ? xy / xx : 0;
      for (let i = b; i < Math.min(e, b + B); i++) res[i - s] = out[i] - g * (ref[i - lag] ?? 0);
    }
    return { res };
  };
  // delivered voice peak = reference peak x median voice gain (10 ms blocks with speech)
  const gains = [];
  for (let b = lag; b + 480 < out.length; b += 480) {
    let xy = 0, xx = 0; for (let i = b; i < b + 480; i++) { const r = ref[i - lag] ?? 0; xy += r * out[i]; xx += r * r; }
    if (xx / 480 > 1e-4) gains.push(xy / xx);
  }
  gains.sort((a, b) => a - b);
  const voicePeak = peak(ref, 0, ref.length) * (gains[gains.length >> 1] || 1);
  // baseline: residual RMS in 1 s blocks with no event within 0.5 s
  const base = [];
  for (let t = 0.5; t + 1 < out.length / SR - lag / SR; t += 1) {
    if (events.some((e) => e.time > t - 0.5 && e.time < t + 1.5)) continue;
    const s = at(t) + lag; base.push(rms(residual(s - at(0.3), s + at(1.3)).res, at(0.3), at(1.3)));
  }
  base.sort((a, b) => a - b);
  const baseline = base.length ? base[Math.floor(base.length / 2)] : 0;
  const rows = events.map((e) => {
    const c = at(e.time) + lag, s = c - at(0.4), { res } = residual(Math.max(0, s), Math.min(out.length, c + at(0.6)));
    const o = c - Math.max(0, s), w0 = o - at(0.02), w1 = o + at(0.35);
    const rel = +(db(peak(res, w0, w1)) - db(voicePeak)).toFixed(1);
    const excess = baseline ? +(db(rms(res, w0, w1)) - db(baseline)).toFixed(1) : 99;
    const min = HOUSE[houseClass(e.sfx)].db - slack;
    // local: the cue's peak re the delivered voice peak within +-1 s; onset: first residual sample >= half the
    // cue's peak in [t-0.15, t+0.35], s re the planned time
    const g = gains[gains.length >> 1] || 1, rc = c - lag, lv = peak(ref, Math.max(0, rc - at(1)), Math.min(ref.length, rc + at(1))) * g;
    const local = +(db(peak(res, w0, w1)) - db(lv)).toFixed(1);
    const p0 = Math.max(0, o - at(0.15)), half = 0.5 * peak(res, p0, w1);
    let k = p0; while (k < w1 && Math.abs(res[k]) < half) k++;
    return { time: e.time, sfx: e.sfx, type: e.type, planDb: e.db, rel, local, onset: +((k - o) / SR).toFixed(3), min, excess, heard: rel >= min && excess >= minExcess };
  });
  return { lag: +(lag / SR).toFixed(3), voicePeakDb: +db(voicePeak).toFixed(1), baselineDb: +(db(baseline) - db(voicePeak)).toFixed(1), rows };
}

export function sfxEvents(proj) {
  const f = path.join(proj, 'assets/plan.json');
  if (!fs.existsSync(f)) return [];
  return (JSON.parse(fs.readFileSync(f, 'utf8')).events || []).filter((e) => e.sfx && Number.isFinite(e.time));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
  const [video, proj] = argv;
  if (!video || !proj || !fs.existsSync(video)) { console.error('usage: sfx-audible.mjs <video.mp4|mix.wav> <project-dir> [--json] [--slack 4] [--min-frac 0.5]'); process.exit(2); }
  const events = sfxEvents(proj), voice = path.join(proj, 'assets/voice.wav');
  if (!events.length) { console.log('sfx-audible: PASS (no planned SFX events)'); process.exit(0); }
  if (!fs.existsSync(voice)) { console.error(`sfx-audible: missing ${voice}`); process.exit(2); }
  // a post output (lead-in found) went through the premaster's high-pass + compressor once more: match the reference's phase
  const out = decode(video), lead = align(decode(voice), out) / SR;
  const m = measureSfx(decode(voice, lead > 0.05 ? 'highpass=f=75,highpass=f=75' : 'highpass=f=75'), out, events, { slack: opt('--slack', 4) });
  const heard = m.rows.filter((r) => r.heard).length, pass = heard >= Math.ceil(events.length * opt('--min-frac', 0.5));
  const res = { pass, video, project: proj, events: events.length, heard, ...m };
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else {
    console.log(`sfx-audible: ${pass ? 'PASS' : 'FAIL'} ${heard}/${events.length} planned SFX measurable (lead ${m.lag} s, voice peak ${m.voicePeakDb} dBFS, residual floor ${m.baselineDb} dB re voice peak)`);
    for (const r of m.rows) console.log(`  ${r.heard ? 'ok  ' : 'MISS'} ${r.time.toFixed(2).padStart(6)} s ${String(r.sfx).padEnd(10)} plan ${r.planDb ?? '-'} dB  peak ${r.rel} dB re voice (min ${r.min}), ${r.excess} dB over floor`);
    if (!pass) console.log('  Planned SFX are not measurable in the delivery: the composition must play assets/mix.wav built by mixSfx at house level (-19 dB re voice peak, -20..-18).');
  }
  process.exit(pass ? 0 : 1);
}

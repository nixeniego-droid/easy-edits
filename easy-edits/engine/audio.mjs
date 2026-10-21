// Easy Edits soundtrack: the edited voice (offset by the intro), an optional Openverse music bed (CC0 / CC BY only,
// fetched at render time and cached, never bundled; CREDITS written next to the export), and the synth SFX cues
// (easy-edits/audio/sfx-synth.mjs: whooshes, taps, clicks, shimmer; generated locally, no samples).
// Music level: full under the intro and end card, ducked well under the voice while the speaker talks.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as ov from '../audio/openverse.mjs';
import { pickTrack } from '../audio/music.mjs';
import { synthKit, mixSfx } from '../audio/sfx-synth.mjs';

const r3 = (v) => Math.round(v * 1000) / 1000;

/** fetch one CC0 / CC BY track for `query` (cached by openverse.mjs). Returns {file, pick} or null (offline). */
export async function fetchMusic(query, minSec) {
  for (const q of [query, 'upbeat', 'upbeat electronic']) {
    try {
      const res = await ov.search(q, { pageSize: 20 });
      const pick = pickTrack(res.filter((r) => !/vocal|voice|sing|lyrics/i.test(r.title || '')), Math.max(15000, minSec * 1000));
      if (pick) return { file: await ov.download(pick), pick, query: q };
    } catch (e) { process.stderr.write(`audio: Openverse "${q}" failed: ${e.message}\n`); }
  }
  return null;
}

/**
 * voice: edited mix.wav (starts at 0 of the edited timeline); offset: intro seconds; total: composition length;
 * speechEnd: offset + edited duration; cues [{t, sfx}]; music {file} | null. Writes out (48 kHz stereo wav).
 */
export function buildSoundtrack({ voice, offset = 0, total, speechEnd, cues = [], music = null, work, out, bedDb, cardDb = -13 }) {
  bedDb = bedDb ?? -27;
  fs.mkdirSync(work, { recursive: true });
  // 1. voice placed at the offset, padded to the full length
  const vpad = path.join(work, 'voice.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', voice, '-af', `aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(offset * 1000)}:all=1,apad=whole_dur=${total}`, '-t', String(total), '-ar', '48000', '-ac', '2', vpad]);
  let mixIn = vpad;
  // 2. music bed: card level under the intro and the end card, bed level under speech, 0.35 s ramps, fade out
  if (music?.file) {
    const bed = path.join(work, 'bed.wav');
    const g = (db) => Math.pow(10, db / 20).toFixed(4);
    const a = r3(offset), b = r3(speechEnd), R = 0.35;
    const env = `if(lt(t,${a}),${g(cardDb)},if(lt(t,${r3(a + R)}),${g(cardDb)}+(${g(bedDb)}-${g(cardDb)})*(t-${a})/${R},if(lt(t,${r3(b - 0.1)}),${g(bedDb)},if(lt(t,${r3(b + R - 0.1)}),${g(bedDb)}+(${g(cardDb)}-${g(bedDb)})*(t-${r3(b - 0.1)})/${R},${g(cardDb)}))))`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-stream_loop', '-1', '-i', music.file, '-af',
      `aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total},asetpts=PTS-STARTPTS,volume='${env}':eval=frame,afade=t=in:d=0.08,afade=t=out:st=${r3(Math.max(0, total - 1.2))}:d=1.2`,
      '-t', String(total), '-ar', '48000', '-ac', '2', bed]);
    const vm = path.join(work, 'voice_music.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', vpad, '-i', bed, '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0:duration=first[m]', '-map', '[m]', '-ar', '48000', '-ac', '2', vm]);
    mixIn = vm;
  }
  // 3. SFX at house level re the voice peak
  const sc = cues.filter((c) => c.sfx && c.t >= 0 && c.t < total - 0.1).map((c) => ({ time: c.t, sfx: c.sfx }));
  if (sc.length) {
    const kit = path.join(work, 'sfx');
    if (!fs.existsSync(path.join(kit, 'whoosh.wav'))) synthKit(kit);
    // the voice peak reference must be the voice alone (music would raise it)
    mixSfx(vpad, sc, kit, path.join(work, 'sfx_on_voice.wav'), total);
    // sfx-only track = (voice+sfx) - voice is not exact; re-mix: music bed + (voice+sfx)
    if (mixIn !== vpad) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(work, 'sfx_on_voice.wav'), '-i', path.join(work, 'bed.wav'), '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0:duration=first[m]', '-map', '[m]', '-ar', '48000', '-ac', '2', out]);
    } else fs.copyFileSync(path.join(work, 'sfx_on_voice.wav'), out);
  } else fs.copyFileSync(mixIn, out);
  return out;
}

export function creditsFor(pick, exportName) {
  return `Music for ${exportName} (fetched from Openverse at render time; not bundled)\n\n${ov.creditsText([pick])}\n`;
}

export const probe = (file) => {
  const j = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,width,height,r_frame_rate,color_transfer:stream_side_data=rotation', '-of', 'json', file], { encoding: 'utf8' }).stdout);
  const v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
  const rot = Number(v?.side_data_list?.find((d) => d.rotation != null)?.rotation || 0);
  const [n, d] = String(v?.r_frame_rate || '30/1').split('/').map(Number);
  let w = v?.width, h = v?.height; if (Math.abs(rot) === 90) [w, h] = [h, w];
  return { duration: Number(j.format.duration), w, h, fps: n / (d || 1), transfer: v?.color_transfer, audio: !!a, streams: j.streams.length, rotation: rot };
};

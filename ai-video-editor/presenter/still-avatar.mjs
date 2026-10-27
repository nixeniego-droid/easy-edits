// Local presenter fallback (avatar backend "none"): the host still with subtle motion: a slow breathing zoom and
// a small sway, no lip-sync. Fully local, no model, no network. Video only; the narration is laid on later.
import { spawnSync } from 'node:child_process';

export function stillAvatar(image, out, { width = 1080, height = 1920, duration, fps = 30 }) {
  if (!(duration > 0)) throw new Error('stillAvatar: duration is required');
  const frames = Math.ceil(duration * fps);
  // cover-fit at 2x so the zoom / sway stays sharp, then zoompan one output frame per input frame
  const vf = [
    `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase`,
    `crop=${width * 2}:${height * 2}`,
    `zoompan=z='1.03+0.025*sin(2*PI*on/(${fps}*7))':x='iw/2-(iw/zoom/2)+${Math.round(width * 0.012)}*sin(2*PI*on/(${fps}*11))':y='ih/2-(ih/zoom/2)+${Math.round(height * 0.006)}*sin(2*PI*on/(${fps}*5))':d=1:s=${width}x${height}:fps=${fps}`,
    'setsar=1', 'format=yuv420p',
  ].join(',');
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', String(fps), '-i', image, '-vf', vf,
    '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`still avatar failed: ${(r.stderr || '').trim().slice(-600)}`);
  return out;
}

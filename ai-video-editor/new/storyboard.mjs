// storyboard.png: one cell per shot (shot number, duration, source, prompt summary) drawn with ffmpeg before
// anything is generated. A cell shows the user's own still / first frame of a user clip when the shot has one, a
// recipe preview frame for code-drawn scenes (recipe.preview), else a placeholder card coloured by source.
import fs from 'node:fs';
import path from 'node:path';
import { ff, drawText, wrap } from './assemble.mjs';

const SOURCE_BG = { generate: '#3A2F6B', still: '#1F4E5F', code: '#2E4A2E', user: '#5A3A1E' };
const SOURCE_LABEL = { generate: 'GENERATE', still: 'STILL', code: 'CODE-DRAWN', user: 'USER FOOTAGE' };

export async function storyboard(plan, out, { work, previews = {}, cols = null, logFile } = {}) {
  const dir = path.join(work, 'storyboard');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const f = plan.formats[0];
  const tw = 360, th = Math.round(Math.min(480, tw * f.h / f.w) / 2) * 2, strip = 150, cw = tw, ch = th + strip;
  const n = plan.shots.length;
  const c = cols || Math.min(n, n <= 4 ? n : n <= 9 ? 3 : 4);
  const rows = Math.ceil(n / c);
  for (let i = 0; i < rows * c; i++) {
    const s = plan.shots[i];
    const cell = path.join(dir, `cell${String(i).padStart(3, '0')}.png`);
    if (!s) { ff(['-f', 'lavfi', '-i', `color=c=#0B0D10:s=${cw}x${ch}`, '-frames:v', '1', cell], 'storyboard cell', { logFile }); continue; }
    const thumb = previews[s.id] || (s.file && fs.existsSync(s.file) ? s.file : null);
    const bg = SOURCE_BG[s.source] || '#333333';
    const src = s.source === 'generate' && s.kind === 'avatar' ? 'GENERATE (AVATAR)' : s.source === 'still' && s.file ? 'STILL (YOURS)' : SOURCE_LABEL[s.source];
    const prompt = wrap(s.prompt || s.caption || '(no prompt)', 34).slice(0, 3).join('\n');
    const inputs = ['-f', 'lavfi', '-i', `color=c=#0B0D10:s=${cw}x${ch}`];
    let g;
    if (thumb) {
      inputs.push('-i', thumb);
      g = `[1:v]scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},setsar=1[t];[0:v][t]overlay=0:0`;
    } else {
      g = `[0:v]drawbox=x=0:y=0:w=${tw}:h=${th}:color=${bg}:t=fill`;
      g += `,${drawText(work, String(i + 1), { size: th * 0.32, color: 'white@0.9', y: `${Math.round(th * 0.32)}` })}`;
    }
    g += `,drawbox=x=0:y=0:w=${cw}:h=${ch}:color=#FFFFFF@0.25:t=2`;
    g += `,${drawText(work, `#${i + 1}  ${s.durationSec.toFixed(1)} s  ${src}`, { size: 20, color: '#FFD60A', x: '12', y: `${th + 12}` })}`;
    g += `,${drawText(work, prompt, { size: 17, color: '#E6E6E6', x: '12', y: `${th + 44}` })}`;
    g += ',format=rgb24[v]';
    ff([...inputs, '-filter_complex', g, '-map', '[v]', '-frames:v', '1', cell], 'storyboard cell', { logFile });
  }
  ff(['-framerate', '1', '-i', path.join(dir, 'cell%03d.png'), '-vf', `tile=${c}x${rows}:padding=6:margin=6:color=#000000`, '-frames:v', '1', out], 'storyboard', { logFile });
  return out;
}

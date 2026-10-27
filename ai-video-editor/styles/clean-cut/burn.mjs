#!/usr/bin/env node
// AI Video Editor CLEAN CUT fast render: the project's index.html captions burned onto assets/clip.mp4 with ffmpeg, one
// encode, no per-frame browser render.
//   node ai-video-editor/styles/clean-cut/burn.mjs <project-dir> <out.mp4> [--crf 15] [--preset veryfast] [--keep-pngs DIR]
// Same look as the HyperFrames render: every caption is drawn ONCE by the same chrome-headless-shell HyperFrames uses,
// from the same index.html CSS (font, stroke, shadow, position), screenshotted on a transparent page, then overlaid
// for exactly its data-start .. data-start+data-duration window (frames k/fps in [start, end)). The clean-cut
// composition is static (no tweens), so a still per caption is the whole caption track. The speaker video gets the
// composition's cover transform (scale + offset of #spk). Audio = assets/mix.wav (AAC 192k), as the render muxes it.
// Colour tags of clip.mp4's source (passed with --color-from FILE, e.g. the run's source) are copied to the output.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** the composition facts burn needs, read from index.html (the file every caption gate reads). */
export function parseComposition(html) {
  const num = (re, s = html) => { const m = s.match(re); if (!m) throw new Error(`burn: index.html has no ${re}`); return Number(m[1]); };
  const root = html.match(/<div id="root"[^>]*>/)[0];
  const spk = html.match(/#spk\{([^}]*)\}/)[1];
  const comp = { width: num(/data-width="(\d+)"/, root), height: num(/data-height="(\d+)"/, root), duration: num(/data-duration="([\d.]+)"/, root),
    cover: { x: num(/left:(-?[\d.]+)px/, spk), y: num(/top:(-?[\d.]+)px/, spk), w: num(/width:([\d.]+)px/, spk), h: num(/height:([\d.]+)px/, spk) } };
  if (/gsap\.timeline\(\{paused:true\}\);\s*tl\.set\(\{\}, \{\}, [\d.]+\);\s*window/.test(html) === false) throw new Error('burn: the timeline is not the static clean-cut one (tweens present); use bin/render.sh');
  comp.caps = [...html.matchAll(/<div id="(cap\d+)" class="cap clip" data-start="([\d.]+)" data-duration="([\d.]+)"/g)]
    .map((m) => ({ id: m[1], start: Number(m[2]), end: Number(m[2]) + Number(m[3]) }));
  return comp;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !['--crf', '--preset', '--keep-pngs', '--color-from'].includes(argv[i - 1]));
  if (pos.length !== 2) { console.error('usage: burn.mjs <project-dir> <out.mp4> [--crf 15] [--preset veryfast] [--color-from SRC] [--keep-pngs DIR]'); process.exit(2); }
  const proj = path.resolve(pos[0]), out = path.resolve(pos[1]);
  const CRF = opt('--crf', process.env.AI_VIDEO_EDITOR_BURN_CRF || '15'), PRESET = opt('--preset', process.env.AI_VIDEO_EDITOR_BURN_PRESET || 'veryfast');
  const T0 = performance.now(), lap = () => ((performance.now() - T0) / 1000).toFixed(1);
  const html = fs.readFileSync(path.join(proj, 'index.html'), 'utf8');
  const comp = parseComposition(html), A = path.join(proj, 'assets');
  const fps = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', path.join(A, 'clip.mp4')], { encoding: 'utf8' }).trim().split(/[\s,]+/)[0].split('/').map(Number).reduce((a, b) => a / b));
  const work = opt('--keep-pngs') ? path.resolve(opt('--keep-pngs')) : fs.mkdtempSync(path.join(os.tmpdir(), 'ai-video-editor-burn-'));
  fs.mkdirSync(work, { recursive: true });
  // 1. one transparent screenshot per caption, same CSS, same browser
  const chrome = execFileSync(path.join(REPO, 'node_modules/.bin/hyperframes'), ['browser', 'path'], { encoding: 'utf8' }).trim().split('\n').pop();
  const { default: puppeteer } = await import('puppeteer-core');
  const page0 = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<video[^>]*><\/video>/, '').replace(/<audio[^>]*><\/audio>/, '')
    .replace('</style>', 'html,body,#root{background:transparent!important}.cap{display:none}.cap.on{display:flex}</style>');
  const pagePath = path.join(proj, '.burn-captions.html');
  fs.writeFileSync(pagePath, page0);
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'shell', args: ['--no-sandbox', '--font-render-hinting=none', '--force-color-profile=srgb', '--disable-gpu'] });
  const shots = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: comp.width, height: comp.height, deviceScaleFactor: 1 });
    await page.goto('file://' + pagePath, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const fam = await page.evaluate(() => { const s = document.querySelector('.cap span'); return s ? getComputedStyle(s).fontFamily : ''; });
    for (const c of comp.caps) {
      const r = await page.evaluate((id) => { document.querySelectorAll('.cap.on').forEach((e) => e.classList.remove('on'));
        const e = document.getElementById(id); e.classList.add('on'); const b = e.querySelector('span').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, c.id);
      const m = 40, x = Math.max(0, Math.floor(r.x - m)), y = Math.max(0, Math.floor(r.y - m));
      const w = Math.min(comp.width - x, Math.ceil(r.w + 2 * m)), h = Math.min(comp.height - y, Math.ceil(r.h + 2 * m));
      const file = path.join(work, `${c.id}.png`);
      await page.screenshot({ path: file, omitBackground: true, clip: { x, y, width: w, height: h } });
      shots.push({ ...c, file, x, y });
    }
    const ok = await page.evaluate((f) => document.fonts.check(`700 68px ${f}`), fam.split(',')[0]);
    if (!ok) console.error(`burn: WARNING font ${fam} not available to chrome (captions use a fallback)`);
  } finally { await browser.close(); fs.rmSync(pagePath, { force: true }); }
  console.error(`burn: ${shots.length} caption stills in ${lap()} s`);
  // 2. one ffmpeg pass: cover transform, timed overlays, mix.wav
  // colour: an HDR source (HLG / PQ) keeps its tags (values pass through, as clip.mp4 carries them); an SDR source
  // is written BT.709 like the HyperFrames render (Chrome decodes to sRGB and encodes BT.709): a BT.601 source
  // (bt470bg / smpte170m, or untagged SD) is converted, so the colours match the browser render.
  const color = []; let CM = '';
  const cf = opt('--color-from');
  const p = cf ? (JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_transfer,color_primaries,height', '-of', 'json', cf], { encoding: 'utf8' })).streams?.[0] || {}) : {};
  const hdr = ['arib-std-b67', 'smpte2084'].includes(p.color_transfer);
  if (hdr) color.push('-color_primaries', p.color_primaries || 'bt2020', '-color_trc', p.color_transfer, '-colorspace', p.color_space || 'bt2020nc');
  else {
    const src601 = ['bt470bg', 'smpte170m'].includes(p.color_space) || (!p.color_space && Number(p.height) < 720);
    if (src601) CM = 'scale=in_color_matrix=bt601:out_color_matrix=bt709,';
    color.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
  }
  const { x, y, w, h } = comp.cover, W = comp.width, H = comp.height;
  const ew = 2 * Math.round(w / 2), eh = 2 * Math.round(h / 2);
  let g = (Math.abs(w - W) < 0.5 && Math.abs(h - H) < 0.5 && Math.abs(x) < 0.5 && Math.abs(y) < 0.5)
    ? `[0:v]setsar=1,${CM}format=yuv420p[v0]`
    : `[0:v]scale=${ew}:${eh}:flags=bilinear,setsar=1[sc];color=black:s=${W}x${H}:r=${fps}[bg];[bg][sc]overlay=x=${Math.round(x)}:y=${Math.round(y)}:shortest=1,${CM}format=yuv420p[v0]`;
  // frame k (t = k/fps) shows a caption when start <= t < end; enable uses frame index n to avoid float edges
  const fr = (t) => Math.round(t * fps * 1000) / 1000;
  shots.forEach((s, i) => { g += `;[v${i}][${i + 2}:v]overlay=x=${s.x}:y=${s.y}:eof_action=repeat:enable='gte(n,${Math.ceil(fr(s.start) - 1e-6)})*lt(n,${Math.ceil(fr(s.end) - 1e-6)})'[v${i + 1}]`; });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ['-v', 'error', '-y', '-progress', 'pipe:1', '-nostats', '-i', path.join(A, 'clip.mp4'), '-i', path.join(A, 'mix.wav'), ...shots.flatMap((s) => ['-i', s.file]),
    '-filter_complex', g, '-map', `[v${shots.length}]`, '-map', '1:a', '-t', String(comp.duration), '-r', String(fps),
    '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p', ...color, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', out];
  // Stream ffmpeg -progress to stderr as out_time_ms=/frame= lines so the CLI progress ingest can tick during encode.
  const { spawn } = await import('node:child_process');
  const r = await new Promise((resolve) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let last = 0;
    const bump = (buf, which) => {
      const text = buf.toString();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        if (/^(out_time_ms|frame)=/.test(line)) {
          const now = Date.now();
          if (now - last >= 2000 || line.startsWith('out_time_ms=')) {
            last = now;
            console.error(line);
          }
        } else if (which === 'err' && line.trim()) console.error(line);
      }
    };
    child.stdout.on('data', (b) => bump(b, 'out'));
    child.stderr.on('data', (b) => bump(b, 'err'));
    child.on('close', (code) => resolve({ status: code }));
  });
  if (!opt('--keep-pngs')) fs.rmSync(work, { recursive: true, force: true });
  if (r.status !== 0) { console.error('burn: ffmpeg failed'); process.exit(1); }
  console.error(`burn: ${path.basename(out)} (${comp.duration} s, ${shots.length} captions, x264 ${PRESET} crf ${CRF}) in ${lap()} s`);
}

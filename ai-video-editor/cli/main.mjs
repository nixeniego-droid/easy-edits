#!/usr/bin/env node
// ai-video-editor <mode> <input> -o <out-dir> [--format 9x16|1x1|16x9|all] [--notes "..."] [options]
// One CLI over the AI Video Editor / Herk pipelines; see `ai-video-editor --help`. Every mode writes, per format, into <out-dir>:
//   ai-video-editor_<mode>_<clip>[_<fmt>].mp4  the export (-14 LUFS, -1.5 dBTP ceiling; delivery-checked)
//   ai-video-editor_<mode>_<clip>[_<fmt>]_sheet.png  contact sheet
//   ai-video-editor_<mode>_<clip>[_<fmt>].srt / .vtt  subtitles (spoken words, final timeline)
//   CREDITS.txt (music used), ai-video-editor_<mode>_<clip>.report.json (plan, checks, timings)
// Work files go to <out-dir>/.work/<mode>_<clip>/ (kept; re-runs reuse the ASR, face track and cut).
import '../engine/env-compat.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { log, REPO } from '../engine/media.mjs';
import { loadPack, checkRequest, missingFonts, StyleError } from '../engine/style-pack.mjs';
import { parseFace } from '../engine/face-override.mjs';
import { styleMain } from './style.mjs';
import { backendsMain } from './backends.mjs';
import { newMain, resumeMain } from '../new/index.mjs';
import { finalOutputProblems, modeFinalFiles, FinalOutputError, NoSpeechError, EXIT_NO_OUTPUT } from '../engine/final-output.mjs';
import { withProgress } from '../engine/progress.mjs';
import { publicReport } from '../engine/report.mjs';

const pkgVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } };

const helpText = () => `AI Video Editor ${pkgVersion()}

usage: ai-video-editor <mode> <input> -o <out-dir> [--format 9x16|1x1|16x9|all] [--notes "..."] [options]
       ai-video-editor <input> -o <out-dir> ...            (mode defaults to clean-cut)
       ai-video-editor style list | validate <pack> | skill <pack>   (style packs; ai-video-editor style --help)
       ai-video-editor backends [list | try <kind> | init]          (generation backends; ai-video-editor backends --help)
       ai-video-editor new <type> -o <out-dir> ...   make a video from a brief / script / brand (plan, then
                          --approve; types explainer-cited presenter podcast story promo music-video other;
                          ai-video-editor new --help)
       ai-video-editor consent create | verify | show   (likeness consent for a presenter; ai-video-editor consent --help)
       ai-video-editor resume <out-dir>   finish an approved \`new\` plan once the assistant has generated the assets
                          listed in <out-dir>/GENERATION_MANIFEST.json (exit 3 while any are missing)
       (renamed from Easy Edits: \`easy-edits\` still works as an alias, and so do EASY_EDITS_* env vars and ~/.easy-edits)

exit codes: 0 done (final file(s) in <out-dir>), 1 a delivery check FAIL (the file is written), 2 bad request /
            refused, 3 waiting for generated assets (new / resume), 5 no usable final file in <out-dir> (missing,
            empty or unreadable: the run failed even if intermediates exist under <out-dir>/.work)

modes
  clean-cut     APPROVED default. Fillers, dead air and clear slips removed; clean minimal captions.
  talking-head  Motion design: animated title, kinetic captions, lower third, punch-ins, icon pops,
                progress bar, top-box cards keyed to the transcript, intro + end card, music + whooshes.
  explainer     Script/transcript -> scenes: cards, diagrams and lists over a screen recording or
                talking head, zooms on screen activity, voiceover-synced, clean outro.
  shorts        Long talk -> N ranked 9:16 shorts: hook finder, face-tracked reframe, kinetic captions.
  captions      Auto-captions only (burned + .srt/.vtt), no cuts.

options
  <input>                 a video file, or a YouTube / video URL (downloaded first, <= 1080p; docs/URL_INPUT.md;
                          only videos you own or have the rights to)
  -o, --out DIR           output directory (required)
  --format F              9x16 (default) | 1x1 | 16x9 | all
  --notes "..."           editor notes for the planner (talking-head / explainer / shorts)
  --title "..."           title for the intro / end card (else planned from the transcript)
  --speaker "Name" [--role "Role"]   lower-third name (never guessed; without it the lower third shows the title)
  --plan FILE             use this plan: a motion plan (talking-head / explainer; schema ai-video-editor/engine/plan.mjs) or
                          a shorts plan (<out>/<source-id>/proposals.json: spans, hook text, pinned review / EDL)
                          Plans are PINNED: the plan a run used is saved per source content hash
                          (~/.ai-video-editor/plans/<mode>/; AI_VIDEO_EDITOR_PLANS) + <out>/ai-video-editor_<mode>_<clip>.plan.json, and
                          every re-run of the same source reuses it, so re-runs are deterministic
  --replan                plan again (agent / picker) instead of reusing the pinned plan (also shorts --graphics)
  --plan-only             stop after planning: print the plan path for review, then re-run (it is pinned)
  --progress plain|json   stage lines on stderr every ~10 s (default plain; json = machine-readable). Also AI_VIDEO_EDITOR_PROGRESS.
  --preview [SECONDS]     captions / clean-cut / talking-head: a quick look before the full render: edits about
                          SECONDS (default 20) from the first speech to a pause, in the first format, into
                          <out-dir>/preview/ (mp4, contact sheet, .srt), exit 0; then run again without --preview
  --transcript FILE       reuse a word transcript ({words:[{text,start,end}]}, source timeline)
  --review-patch FILE     clean-cut review decisions (keep/remove/text by word index; see clean-cut.sh --help)
  --no-review             clean-cut: deterministic cut only (no agent review)
  --mode-cut clean|light|strict   clean-cut cut mode (default clean)
  --lang L                language (auto | en | tl | ...)
  --music "query" | --no-music     Openverse CC0/CC BY bed, fetched at render (default "upbeat" for
                          talking-head/explainer, none for clean-cut/captions/shorts)
  --preset FILE           private preset JSON (watermark, accent, cta), kept outside the repo
  --clips N               shorts: number of clips (default 3; 4 with --propose); --min S / --max S length after
                          the clean cut (30 / 75)
  --range START-END       shorts: only from this part of the source (seconds or mm:ss, e.g. 22:05-26:00)
  --propose               shorts: write PROPOSALS.txt (ranked candidates: score 0-100, timestamps, hook line,
                          reason) + a fast low-res preview per candidate, then stop
  --pick 1,3              shorts: render only those proposals at full quality (marks them used)
  --hook ["text"]         shorts: big hook card over the first 3 s (no text = the clip's own hook)
  --reset-used            shorts: forget the used-clips log (<out>/<source-id>/used_clips.json)
  --speaker-at T          shorts: a source time (mm:ss) where --speaker is the main face on screen; the lower
                          third then shows when that person appears; --people FILE for several
                          ([{"name","role","at","x"?}], name null = someone to tell apart, never labelled)
  --graphics              shorts: add the planner's punch-ins, icon pops and top boxes (kinetic look)
  --script FILE           explainer: the script text (on-screen wording; timing comes from the audio)
  --cookies FILE          URL input: Netscape cookies.txt exported from your browser (sign-in / bot checks)
  --style PACK            a style pack (captions / talking-head / explainer / shorts): palette, fonts, caption look,
                          transitions, number treatment, signature move, pacing, allowed scenes. Built-in: punch,
                          broadsheet, terminal; or an id in ~/.ai-video-editor/styles, or a path to a pack .json
                          (\`ai-video-editor style list\`). Anything the pack doesn't support is refused with the reason
  --face top|center|bottom|X,Y    where the face is, when face detection gets it wrong (X,Y = fractions of the
                          frame, e.g. 0.3,0.4): framing, punch-ins, caption keep-out and pops use it
  --caption-color auto|white|black|#RRGGBB   caption text (default auto: samples the footage behind each caption
                          and flips to dark text with a light edge on bright footage; clean-cut 9:16 keeps white)
  --agent claude|codex|none        planner agent (default: auto = first installed; none = heuristic only)
  -h, --help
  -V, --version            print version from package.json (not git describe) and exit

examples
  ai-video-editor samples/talk.mp4 -o out/                      # clean cut, 9:16
  ai-video-editor talking-head samples/talk.mp4 -o out/ --format all --speaker "Ana Cruz" --role "Founder"
  ai-video-editor shorts keynote.mp4 -o out/ --clips 5
  ai-video-editor shorts podcast.mp4 -o out/ --propose                 # 4 ranked proposals + previews, then stop
  ai-video-editor shorts podcast.mp4 -o out/ --pick 1,3 --hook         # render those two, hook card on
  ai-video-editor captions samples/talk.mp4 -o out/ --format 16x9
  ai-video-editor talking-head samples/talk.mp4 -o out/ --style broadsheet  # in the Broadsheet style
  ai-video-editor captions samples/talk.mp4 -o out/ --face 0.35,0.3     # face detection was wrong
  ai-video-editor style skill punch                                      # a Claude Code skill for the Punch style
`;

const MODES = ['clean-cut', 'talking-head', 'explainer', 'shorts', 'captions'];
const PREVIEW_MODES = ['captions', 'clean-cut', 'talking-head'], PREVIEW_SECS = 20;
const FLAGS_WITH_VALUE = new Set(['-o', '--out', '--format', '--notes', '--title', '--speaker', '--role', '--plan', '--transcript', '--review-patch', '--mode-cut', '--lang', '--music', '--preset', '--clips', '--min', '--max', '--script', '--agent', '--subtitle', '--cta', '--names', '--cookies', '--range', '--pick', '--speaker-at', '--people', '--style', '--face', '--caption-color', '--progress']);

export function parseArgs(argv) {
  const o = { pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--version' || a === '-V') o.version = true;
    // --hook alone = the clip's own hook line; --hook "text" = that text (a following path / URL / flag is not text)
    else if (a === '--hook') { const nx = argv[i + 1]; if (nx != null && !nx.startsWith('-') && !/^https?:\/\//i.test(nx) && !fs.existsSync(nx)) { o.hook = nx; i++; } else o.hook = true; }
    // --preview alone = about 20 s; --preview 30 = about 30 s (from the first speech to a pause)
    else if (a === '--preview') { const nx = argv[i + 1]; if (nx != null && /^\d+(\.\d+)?$/.test(nx)) { o.preview = Number(nx); i++; } else o.preview = PREVIEW_SECS; }
    else if (FLAGS_WITH_VALUE.has(a)) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); o[a.replace(/^-+/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i]; }
    else if (a.startsWith('--')) o[a.replace(/^-+/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    else o.pos.push(a);
  }
  if (o.o) o.out = o.o;
  if (MODES.includes(o.pos[0])) o.mode = o.pos.shift(); else o.mode = 'clean-cut';
  o.input = o.pos[0];
  const f = o.format || '9x16';
  o.formats = f === 'all' ? ['9x16', '1x1', '16x9'] : f.split(',');
  for (const x of o.formats) if (!['9x16', '1x1', '16x9'].includes(x)) throw new Error(`unknown format ${x} (9x16, 1x1, 16x9, all)`);
  if (o.agent) process.env.AI_VIDEO_EDITOR_AGENT = o.agent;
  if (o.progress != null && !['plain', 'json'].includes(String(o.progress))) throw new Error('--progress: use plain or json');
  if (o.face != null) o.face = parseFace(o.face);
  if (o.preview != null) {
    if (!PREVIEW_MODES.includes(o.mode)) throw new Error(`--preview: works with ${PREVIEW_MODES.join(', ')} (shorts: --propose already makes a preview per candidate)`);
    if (!(o.preview >= 5)) throw new Error('--preview: at least 5 seconds');
    o.formats = o.formats.slice(0, 1);
  }
  if (o.captionColor != null) {
    const c = String(o.captionColor).toLowerCase();
    o.ink = { auto: 'auto', white: 'light', light: 'light', black: 'dark', dark: 'dark' }[c] || (/^#[0-9a-f]{6}$/.test(c) ? c.toUpperCase() : null);
    if (!o.ink) throw new Error(`--caption-color ${o.captionColor}: use auto, white, black or a #RRGGBB colour`);
    if (o.mode === 'clean-cut' && o.formats.includes('9x16') && o.ink !== 'auto') throw new Error('--caption-color: clean-cut 9:16 keeps white captions; use it with captions / talking-head / explainer / shorts, or clean-cut --format 1x1 / 16x9');
  }
  return o;
}

/** --preview window [start, end] in source seconds from silencedetect's [[silenceStart, silenceEnd], ...]: skip a
 * leading silence (keep 0.3 s), aim for n seconds of speech, and end in the first pause after 60% of n, up to n + 8 s
 * (so the slice ends between sentences, not mid-word). */
export function previewWindow(silences, n, total = Infinity) {
  const lead = silences.find(([a]) => a < 0.1);
  const start = lead ? Math.max(0, lead[1] - 0.3) : 0;
  const pause = silences.find(([a]) => a >= start + 0.6 * n && a <= start + n + 8);
  const end = Math.min(total, pause ? pause[0] + 0.2 : start + n);
  return [Math.round(start * 1000) / 1000, Math.round(end * 1000) / 1000];
}

/** --preview: edit only a short slice from the first speech (about o.preview seconds), into <out>/preview/ (its own
 * .work, so the full run's cache and pinned plan stay untouched: the slice has a different content hash). */
export function previewInput(o) {
  const out = path.join(o.out, 'preview'), slice = path.join(out, '.work', `${o.clip}_preview${o.preview}s.mp4`);
  fs.mkdirSync(path.dirname(slice), { recursive: true });
  if (!fs.existsSync(slice)) {
    const sd = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-t', String(o.preview + 90), '-i', o.input, '-map', '0:a:0?', '-af', 'silencedetect=n=-45dB:d=0.25', '-f', 'null', '-'], { encoding: 'utf8' });
    const silences = [];
    for (const m of (sd.stderr || '').matchAll(/silence_(start|end): ([\d.]+)/g)) {
      if (m[1] === 'start') silences.push([Number(m[2]), Infinity]); else if (silences.length) silences.at(-1)[1] = Number(m[2]);
    }
    const [a, b] = previewWindow(silences, o.preview);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(a), '-i', o.input, '-t', String(b - a), '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', `${slice}.tmp.mp4`], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`--preview: could not cut the preview slice: ${(r.stderr || '').trim().split('\n').pop()}`);
    fs.renameSync(`${slice}.tmp.mp4`, slice);
    log(`preview: ${a.toFixed(1)}-${b.toFixed(1)} s of ${path.basename(o.input)} (from the first speech to a pause) -> ${out} [${o.formats[0]}]`);
  } else log(`preview: reusing ${slice} -> ${out} [${o.formats[0]}]`);
  Object.assign(o, { input: slice, out });
}

/** --style: load + validate the pack and check this run against it; returns [] or the reasons it can't render. */
export function styleProblems(o, pack) {
  let planBeats = [];
  if (o.plan && (o.mode === 'talking-head' || o.mode === 'explainer')) { try { planBeats = JSON.parse(fs.readFileSync(o.plan, 'utf8')).beats || []; } catch { /* the mode reports a broken plan */ } }
  return checkRequest(pack, {
    mode: o.mode, formats: o.formats, planBeats, hook: o.hook,
    speaker: o.mode === 'talking-head' || o.mode === 'explainer' ? o.speaker : null,
    lowerThirds: o.mode === 'shorts' && !!((o.speaker && o.speakerAt) || o.people), graphics: o.mode === 'shorts' && o.graphics,
  });
}

async function main() {
  if (process.argv[2] === 'style') process.exit(styleMain(process.argv.slice(3)));
  if (process.argv[2] === 'backends') process.exit(await backendsMain(process.argv.slice(3)));
  if (process.argv[2] === 'new') process.exit(await newMain(process.argv.slice(3)));
  if (process.argv[2] === 'resume') process.exit(await resumeMain(process.argv.slice(3)));
  if (process.argv[2] === 'consent') process.exit((await import('../presenter/consent-cli.mjs')).consentMain(process.argv.slice(3)));
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`ai-video-editor: ${e.message}`); process.exit(2); }
  if (o.version) { process.stdout.write(pkgVersion() + '\n'); process.exit(0); }
  if (o.help || !o.input) {
    process.stdout.write(helpText());
    if (!o.help) console.error(`ai-video-editor: needs a video (a file or URL). Try the bundled sample:\n  ai-video-editor ${o.mode} ${SAMPLE} -o out/`);
    process.exit(o.help ? 0 : 2);
  }
  if (!o.out) { console.error(`ai-video-editor: -o <out-dir> is required (the folder the finished video goes in). Run:\n  ai-video-editor ${process.argv.slice(2).map((a) => (/[\s"'$`\\]/.test(a) ? JSON.stringify(a) : a)).join(' ')} -o out/`); process.exit(2); }
  // a YouTube / video URL: download it (<= 1080p mp4 + audio, reused on re-runs) and edit the local file (docs/URL_INPUT.md)
  if (/^https?:\/\//i.test(o.input)) {
    const fetchArgs = [o.input, '--work-dir', path.join(path.resolve(o.out), '.work', 'downloads')];
    if (o.cookies) fetchArgs.push('--cookies', path.resolve(o.cookies));
    const r = spawnSync(fileURLToPath(new URL('../bin/fetch-input.sh', import.meta.url)), fetchArgs, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
    if (r.status !== 0) process.exit(r.status || 4);   // fetch-input.sh already printed what happened + the options
    o.input = r.stdout.trim();
  }
  o.input = path.resolve(o.input); o.out = path.resolve(o.out);
  if (!fs.existsSync(o.input)) { console.error(`ai-video-editor: input not found: ${o.input}\nCheck the path (relative paths start from ${process.cwd()}), or try the bundled sample:\n  ai-video-editor ${o.mode} ${SAMPLE} -o ${path.relative(process.cwd(), o.out) || '.'}/`); process.exit(2); }
  for (const k of ['plan', 'transcript', 'reviewPatch', 'preset', 'script', 'names', 'people']) if (o[k]) { o[k] = path.resolve(o[k]); if (!fs.existsSync(o[k])) { console.error(`ai-video-editor: --${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} file not found: ${o[k]}${k === 'plan' ? `\nMake one with: ai-video-editor ${o.mode} ${path.relative(process.cwd(), o.input)} -o ${path.relative(process.cwd(), o.out) || '.'}/ --plan-only` : ''}`); process.exit(2); } }
  o.preset = o.preset ? JSON.parse(fs.readFileSync(o.preset, 'utf8')) : {};
  if (o.style) {
    try { o.style = loadPack(o.style); } catch (e) { if (e instanceof StyleError) { console.error(`ai-video-editor: ${e.message}`); process.exit(2); } throw e; }
    const bad = styleProblems(o, o.style);
    const miss = missingFonts(o.style);
    if (miss.length) bad.push(`font(s) not installed: ${miss.join(', ')} (run ./install.sh; the captions would silently fall back to another font)`);
    if (bad.length) { console.error(`ai-video-editor: style "${o.style.id}" can't render this run:\n${bad.map((x) => `  - ${x}`).join('\n')}`); process.exit(2); }
    log(`style: ${o.style.name} (${o.style.file})`);
  }
  o.clip = path.basename(o.input).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-');
  if (o.progress) process.env.AI_VIDEO_EDITOR_PROGRESS = String(o.progress);
  else if (!process.env.AI_VIDEO_EDITOR_PROGRESS) process.env.AI_VIDEO_EDITOR_PROGRESS = 'plain';
  if (o.preview != null) previewInput(o);
  o.work = path.join(o.out, '.work', `${o.mode}_${o.clip}`);
  fs.mkdirSync(o.work, { recursive: true });
  o.logFile = path.join(o.work, 'ai-video-editor.log');
  runLog = o.logFile;
  const t0 = Date.now();
  log(`${o.mode} ${o.input} -> ${o.out} [${o.formats.join(', ')}] (log ${o.logFile})`);
  const mod = await import(`../modes/${o.mode}.mjs`);
  let res;
  try {
    const stageMsg = ({ 'clean-cut': 'Cleaning up your video…', captions: 'Adding captions…', shorts: 'Making short clips…', 'talking-head': 'Rendering your talking-head edit…', explainer: 'Rendering your explainer…' })[o.mode] || 'Working on your video…';
    res = await withProgress(o.mode, stageMsg, (p) => { o._progress = p; return mod.default(o); });
  } catch (e) {
    if (!(e instanceof NoSpeechError)) throw e;
    console.error(`ai-video-editor: ${e.message}\nNothing was rendered (exit 2). Try the bundled sample:\n  ai-video-editor ${o.mode} ${SAMPLE} -o ${path.relative(process.cwd(), o.out) || '.'}/`);
    process.exit(2);
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  // the final file(s) must be in the output folder, non-empty and readable (engine/final-output.mjs)
  const fin = modeFinalFiles(o, res);
  const missing = finalOutputProblems(fin.files, o.out, { expect: fin.expect });
  const report = publicReport({ mode: o.mode, input: o.input, formats: o.formats, seconds: secs, ...res, finalOutput: { ok: !missing.length, files: fin.files, problems: missing } });
  const rp = path.join(o.out, `ai-video-editor_${o.mode}_${o.clip}.report.json`);
  fs.writeFileSync(rp, JSON.stringify(report, null, 1));
  for (const e of res.exports || []) log(`${e.pass === false ? 'CHECK FAIL' : 'ok'} ${e.file}${e.note ? ` (${e.note})` : ''}`);
  if (missing.length) { console.error(`ai-video-editor: FAILED: ${new FinalOutputError(missing, o.out).message}\n(work files: ${o.work}; log: ${o.logFile})`); process.exit(EXIT_NO_OUTPUT); }
  log(`done in ${secs} s; report ${rp}`);
  if (o.preview != null) {
    // a preview is a look, not a delivery: a check FAIL on a 20 s slice is noted, the full render decides
    const fails = (res.exports || []).filter((e) => e.pass === false);
    log(`preview: ${o.out}${fails.length ? ` (delivery check on the slice: ${fails.map((e) => e.note || 'FAIL').join('; ')}; the full render checks again)` : ''}; run again without --preview for the final`);
    process.exit(0);
  }
  const failed = (res.exports || []).filter((e) => e.pass === false);
  if (failed.length) { console.error(deliveryFailText(failed, o.out, rp)); process.exit(1); }
  process.exit(0);
}

/** The exit-1 message: the video was made, some delivery checks failed; which ones and what to open next. */
export function deliveryFailText(failed, out, reportFile) {
  const L = [`ai-video-editor: delivery FAIL (exit 1). This is not a crash: the video is written, but ${failed.length} export(s) failed a delivery check:`];
  for (const e of failed) {
    L.push(`  ${path.relative(out, e.file) || e.file}: ${e.note || 'FAIL'}`);
    for (const line of String(e.check || '').split('\n').filter((l) => /^FAIL\b/.test(l))) L.push(`    ${line}`);
  }
  if (failed.some((e) => /^FAIL\s+transcript\s+0 words heard/m.test(e.check || ''))) L.push('No speech was heard in the video: use a clip with clear speech (try samples/talk.mp4).');
  L.push(`Next: open the *_sheet.png contact sheet(s) and ${path.relative(out, reportFile)} in ${out}, watch the video,`,
    `and check KNOWN_ISSUES.txt for known false alarms. Re-run only after you change the input or the options.`);
  return L.join('\n');
}

let runLog = null;
// the bundled sample, as a path the user can paste from where they are
const SAMPLE = ((abs) => (path.relative(process.cwd(), abs).startsWith('..') ? abs : path.relative(process.cwd(), abs)))(path.join(REPO, 'samples/talk.mp4'));

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => {
  // an unexpected error: not a delivery FAIL (exit 1 means "the video is written"), so exit 5 (no usable final file)
  console.error(`ai-video-editor: the run stopped on an error (exit ${EXIT_NO_OUTPUT}; no final video was finished):\n  ${e.message}`);
  if (runLog) { try { fs.appendFileSync(runLog, `\n${e.stack}\n`); } catch { /* the log folder is gone */ } }
  if (process.env.AI_VIDEO_EDITOR_DEBUG) console.error(e.stack);
  else console.error(`The stack trace is ${runLog ? `at the end of ${runLog}` : 'printed with AI_VIDEO_EDITOR_DEBUG=1'}; please include it in a bug report.`);
  process.exit(EXIT_NO_OUTPUT);
});

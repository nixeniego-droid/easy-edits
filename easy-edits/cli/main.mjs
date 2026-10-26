#!/usr/bin/env node
// easy-edits <mode> <input> -o <out-dir> [--format 9x16|1x1|16x9|all] [--notes "..."] [options]
// One CLI over the Easy Edits / Herk pipelines; see `easy-edits --help`. Every mode writes, per format, into <out-dir>:
//   easy-edits_<mode>_<clip>[_<fmt>].mp4  the export (-14 LUFS, -1.5 dBTP ceiling; delivery-checked)
//   easy-edits_<mode>_<clip>[_<fmt>]_sheet.png  contact sheet
//   easy-edits_<mode>_<clip>[_<fmt>].srt / .vtt  subtitles (spoken words, final timeline)
//   CREDITS.txt (music used), easy-edits_<mode>_<clip>.report.json (plan, checks, timings)
// Work files go to <out-dir>/.work/<mode>_<clip>/ (kept; re-runs reuse the ASR, face track and cut).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { log } from '../engine/media.mjs';
import { loadPack, checkRequest, missingFonts, StyleError } from '../engine/style-pack.mjs';
import { parseFace } from '../engine/face-override.mjs';
import { styleMain } from './style.mjs';
import { backendsMain } from './backends.mjs';
import { newMain } from '../new/index.mjs';

const HELP = `Easy Edits: one CLI for talking-head editing, built on Herk Edit Kit (Nate Herk) + HyperFrames.

usage: easy-edits <mode> <input> -o <out-dir> [--format 9x16|1x1|16x9|all] [--notes "..."] [options]
       easy-edits <input> -o <out-dir> ...            (mode defaults to clean-cut)
       easy-edits style list | validate <pack> | skill <pack>   (style packs; easy-edits style --help)
       easy-edits backends [list | try <kind> | init]          (generation backends; easy-edits backends --help)
       easy-edits new <type> -o <out-dir> ...   make a video from a brief / script / brand (plan, then
                          --approve; types explainer-cited presenter podcast story promo music-video other;
                          easy-edits new --help)

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
  --plan FILE             use this plan: a motion plan (talking-head / explainer; schema easy-edits/engine/plan.mjs) or
                          a shorts plan (<out>/<source-id>/proposals.json: spans, hook text, pinned review / EDL)
                          Plans are PINNED: the plan a run used is saved per source content hash
                          (~/.easy-edits/plans/<mode>/; EASY_EDITS_PLANS) + <out>/easy-edits_<mode>_<clip>.plan.json, and
                          every re-run of the same source reuses it, so re-runs are deterministic
  --replan                plan again (agent / picker) instead of reusing the pinned plan (also shorts --graphics)
  --plan-only             stop after planning: print the plan path for review, then re-run (it is pinned)
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
                          broadsheet, terminal; or an id in ~/.easy-edits/styles, or a path to a pack .json
                          (\`easy-edits style list\`). Anything the pack doesn't support is refused with the reason
  --face top|center|bottom|X,Y    where the face is, when face detection gets it wrong (X,Y = fractions of the
                          frame, e.g. 0.3,0.4): framing, punch-ins, caption keep-out and pops use it
  --caption-color auto|white|black|#RRGGBB   caption text (default auto: samples the footage behind each caption
                          and flips to dark text with a light edge on bright footage; clean-cut 9:16 keeps white)
  --agent claude|codex|none        planner agent (default: auto = first installed; none = heuristic only)
  -h, --help

examples
  easy-edits talk.mp4 -o out/                              # clean cut, 9:16
  easy-edits talking-head talk.mp4 -o out/ --format all --speaker "Ana Cruz" --role "Founder"
  easy-edits shorts keynote.mp4 -o out/ --clips 5
  easy-edits shorts podcast.mp4 -o out/ --propose                 # 4 ranked proposals + previews, then stop
  easy-edits shorts podcast.mp4 -o out/ --pick 1,3 --hook         # render those two, hook card on
  easy-edits captions talk.mp4 -o out/ --format 16x9
  easy-edits talking-head talk.mp4 -o out/ --style broadsheet       # in the Broadsheet style
  easy-edits captions talk.mp4 -o out/ --face 0.35,0.3              # face detection was wrong
  easy-edits style skill punch                                      # a Claude Code skill for the Punch style
`;

const MODES = ['clean-cut', 'talking-head', 'explainer', 'shorts', 'captions'];
const FLAGS_WITH_VALUE = new Set(['-o', '--out', '--format', '--notes', '--title', '--speaker', '--role', '--plan', '--transcript', '--review-patch', '--mode-cut', '--lang', '--music', '--preset', '--clips', '--min', '--max', '--script', '--agent', '--subtitle', '--cta', '--names', '--cookies', '--range', '--pick', '--speaker-at', '--people', '--style', '--face', '--caption-color']);

export function parseArgs(argv) {
  const o = { pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    // --hook alone = the clip's own hook line; --hook "text" = that text (a following path / URL / flag is not text)
    else if (a === '--hook') { const nx = argv[i + 1]; if (nx != null && !nx.startsWith('-') && !/^https?:\/\//i.test(nx) && !fs.existsSync(nx)) { o.hook = nx; i++; } else o.hook = true; }
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
  if (o.agent) process.env.EASY_EDITS_AGENT = o.agent;
  if (o.face != null) o.face = parseFace(o.face);
  if (o.captionColor != null) {
    const c = String(o.captionColor).toLowerCase();
    o.ink = { auto: 'auto', white: 'light', light: 'light', black: 'dark', dark: 'dark' }[c] || (/^#[0-9a-f]{6}$/.test(c) ? c.toUpperCase() : null);
    if (!o.ink) throw new Error(`--caption-color ${o.captionColor}: use auto, white, black or a #RRGGBB colour`);
    if (o.mode === 'clean-cut' && o.formats.includes('9x16') && o.ink !== 'auto') throw new Error('--caption-color: clean-cut 9:16 keeps the approved white captions; use it with captions / talking-head / explainer / shorts, or clean-cut --format 1x1 / 16x9');
  }
  return o;
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
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`easy-edits: ${e.message}`); process.exit(2); }
  if (o.help || !o.input) { process.stdout.write(HELP); process.exit(o.help ? 0 : 2); }
  if (!o.out) { console.error('easy-edits: -o <out-dir> is required'); process.exit(2); }
  // a YouTube / video URL: download it (<= 1080p mp4 + audio, reused on re-runs) and edit the local file (docs/URL_INPUT.md)
  if (/^https?:\/\//i.test(o.input)) {
    const fetchArgs = [o.input, '--work-dir', path.join(path.resolve(o.out), '.work', 'downloads')];
    if (o.cookies) fetchArgs.push('--cookies', path.resolve(o.cookies));
    const r = spawnSync(fileURLToPath(new URL('../bin/fetch-input.sh', import.meta.url)), fetchArgs, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
    if (r.status !== 0) process.exit(r.status || 4);   // fetch-input.sh already printed what happened + the options
    o.input = r.stdout.trim();
  }
  o.input = path.resolve(o.input); o.out = path.resolve(o.out);
  if (!fs.existsSync(o.input)) { console.error(`easy-edits: missing input ${o.input}`); process.exit(2); }
  for (const k of ['plan', 'transcript', 'reviewPatch', 'preset', 'script', 'names', 'people']) if (o[k]) { o[k] = path.resolve(o[k]); if (!fs.existsSync(o[k])) { console.error(`easy-edits: missing ${k} file ${o[k]}`); process.exit(2); } }
  o.preset = o.preset ? JSON.parse(fs.readFileSync(o.preset, 'utf8')) : {};
  if (o.style) {
    try { o.style = loadPack(o.style); } catch (e) { if (e instanceof StyleError) { console.error(`easy-edits: ${e.message}`); process.exit(2); } throw e; }
    const bad = styleProblems(o, o.style);
    const miss = missingFonts(o.style);
    if (miss.length) bad.push(`font(s) not installed: ${miss.join(', ')} (run ./install.sh; the captions would silently fall back to another font)`);
    if (bad.length) { console.error(`easy-edits: style "${o.style.id}" can't render this run:\n${bad.map((x) => `  - ${x}`).join('\n')}`); process.exit(2); }
    log(`style: ${o.style.name} (${o.style.file})`);
  }
  o.clip = path.basename(o.input).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-');
  o.work = path.join(o.out, '.work', `${o.mode}_${o.clip}`);
  fs.mkdirSync(o.work, { recursive: true });
  o.logFile = path.join(o.work, 'easy-edits.log');
  const t0 = Date.now();
  log(`${o.mode} ${o.input} -> ${o.out} [${o.formats.join(', ')}] (log ${o.logFile})`);
  const mod = await import(`../modes/${o.mode}.mjs`);
  const res = await mod.default(o);
  const secs = Math.round((Date.now() - t0) / 1000);
  const report = { mode: o.mode, input: o.input, formats: o.formats, seconds: secs, ...res };
  const rp = path.join(o.out, `easy-edits_${o.mode}_${o.clip}.report.json`);
  fs.writeFileSync(rp, JSON.stringify(report, null, 1));
  for (const e of res.exports || []) log(`${e.pass === false ? 'CHECK FAIL' : 'ok'} ${e.file}${e.note ? ` (${e.note})` : ''}`);
  log(`done in ${secs} s; report ${rp}`);
  process.exit((res.exports || []).some((e) => e.pass === false) ? 1 : 0);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`easy-edits: ${e.stack || e.message}`); process.exit(1); });

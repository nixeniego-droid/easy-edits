#!/usr/bin/env node
// Standalone runner for the story and music-video recipes (until they are wired into `easy-edits new`).
//   node easy-edits/story/run.mjs story --brief brief.txt|"text" | --shotlist shotlist.json -o out/ [options]
//   node easy-edits/story/run.mjs music-video --song song.wav --i-own-this-music -o out/ [options]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planStory } from './story.mjs';
import { planMusicVideo } from './music-video.mjs';
import { renderPlan } from './render.mjs';
import { RefusalError } from './errors.mjs';
import { PendingAssetsError, pendingMessage, EXIT_PENDING } from '../new/hostflow.mjs';
import { finalOutputProblems, FinalOutputError, EXIT_NO_OUTPUT } from '../engine/final-output.mjs';

export const HELP = `usage: node easy-edits/story/run.mjs <story|music-video> -o <out-dir> [options]

story         a brief (one shot per sentence / bullet) or shotlist.json -> a multi-shot video
  --brief FILE|"text"     the brief (a .json brief is read as a shotlist)
  --shotlist FILE         {title?, style?, shots:[{id, durationSec, prompt, characters[], camera, transition,
                          transitionSec?, narration?, caption?, clip?}]}
  --characters FILE       [{name, refs:[image files], description}]: attached to every shot that names them;
                          refs go to backends that take references; identity drift is scored against them
  --length S | --shot-sec S   total length / seconds per brief shot (default 4 s per shot)
  --narrate               brief sentences become narration (TTS backend); --narration FILE = your own audio
  --music FILE --i-own-this-music   a music bed you own (ducked under narration)
  --no-captions           no burned captions / .srt / .vtt (default: on when shots have narration or captions)

music-video   your song -> beat-cut shots, video length = song length
  --song FILE --i-own-this-music    required: only music you own or have licensed (refused otherwise)
  --brief / --shotlist / --characters   prompts and characters, cycled over the cuts
  --shot-sec S            target seconds per shot (default 4 beats); --snap-tolerance S (default min(0.25, beat/2))
  --lyrics FILE           your lyrics as captions: LRC, SRT, or plain lines (spread evenly)
  --transition T          cut (default), fade, fadeblack, wipeleft, slideleft, ...

both
  --aspect A              9:16 (default), 16:9, 1:1, 4:5, any W:H, or an exact WxH (e.g. 1080x1350)
  --backend NAME          generation backend (default: EASY_EDITS_BACKEND, else none -> code-drawn cards)
  --title "..."           names the output file
  --plan-only             write <out>/<recipe>.plan.json and stop; --plan FILE renders a (reviewed) plan
  --offline               refuse network backends
  --clip-audio M          generated clips' own audio: auto (default: dropped under narration / a song, -18 dB
                          under music, as-is when it is the only audio) | keep | duck | drop

Writes easy-edits_<recipe>_<title>.mp4 (-14 LUFS / -1.5 dBTP, BT.709), _sheet.png, .srt/.vtt, .report.json
(WEAK_SHOTS, QA, loudness, colour, beats / snap error, music attestation) and REVIEW.txt.
`;

const VALUE = new Set(['-o', '--out', '--brief', '--shotlist', '--characters', '--aspect', '--format', '--backend', '--length', '--shot-sec', '--narration', '--music', '--song', '--lyrics', '--title', '--plan', '--snap-tolerance', '--transition', '--style', '--voice', '--clip-audio']);
const camel = (a) => a.replace(/^-+/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export function parseRunArgs(argv) {
  const o = { pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--no-captions') o.captions = false;
    else if (VALUE.has(a)) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); o[camel(a)] = argv[++i]; }
    else if (a.startsWith('--')) o[camel(a)] = true;
    else o.pos.push(a);
  }
  if (o.o) o.out = o.o;
  o.recipe = o.pos[0];
  return o;
}

/** Plan (or load a plan) and render. Returns {code, result?}. */
export async function runRecipe(o, { log } = {}) {
  if (!['story', 'music-video'].includes(o.recipe)) throw new Error(`unknown recipe "${o.recipe || ''}" (story | music-video)`);
  if (!o.out) throw new Error('-o <out-dir> is required');
  const out = path.resolve(o.out);
  fs.mkdirSync(out, { recursive: true });
  let plan;
  if (o.plan) {
    plan = JSON.parse(fs.readFileSync(o.plan, 'utf8'));
    if (plan.recipe !== o.recipe) throw new Error(`${path.basename(o.plan)} is a ${plan.recipe} plan, not ${o.recipe}`);
    if (plan.recipe === 'music-video' && !(o.iOwnThisMusic && plan.music?.attestation?.owned)) throw new RefusalError('NO_MUSIC_ATTESTATION', 'refusing to render a music-video plan without --i-own-this-music on this run');
  } else plan = o.recipe === 'story' ? planStory(o) : planMusicVideo(o);
  const pf = path.join(out, `${o.recipe}.plan.json`);
  if (!o.plan) fs.writeFileSync(pf, JSON.stringify(plan, null, 1));
  const g = plan.generations;
  (log || ((s) => process.stderr.write(`easy-edits: ${s}\n`)))(`plan ${o.plan || pf}: ${plan.shots.length} shots, ${plan.durationSec} s, ${plan.width}x${plan.height}; generations: ${g.video} video, ${g.image} image, ${g.tts} TTS (est. cost ${g.estimatedCost})`);
  if (o.planOnly) return { code: 0, plan, planFile: pf };
  const result = await renderPlan(plan, { outDir: out, offline: !!o.offline, log, clipAudio: o.clipAudio });
  return { code: result.pass ? 0 : 1, plan, result };
}

async function main() {
  let o;
  try { o = parseRunArgs(process.argv.slice(2)); } catch (e) { console.error(`easy-edits: ${e.message}`); process.exit(2); }
  if (o.help || !o.recipe) { process.stdout.write(HELP); process.exit(o.help ? 0 : 2); }
  try {
    const r = await runRecipe(o);
    const bad = r.result ? finalOutputProblems([r.result.file], o.out) : [];
    if (bad.length) { console.error(`easy-edits: FAILED: ${new FinalOutputError(bad, path.resolve(o.out)).message}`); process.exit(EXIT_NO_OUTPUT); }
    process.exit(r.code);
  } catch (e) {
    if (e instanceof RefusalError) { console.error(`easy-edits: ${e.message}`); process.exit(2); }
    if (e instanceof PendingAssetsError) { process.stdout.write(pendingMessage(e, { resumeCmd: 'the same command again (the saved assets are picked up)' })); process.exit(EXIT_PENDING); }
    console.error(`easy-edits: ${process.env.EASY_EDITS_DEBUG ? e.stack : e.message}`); process.exit(e.code === 'ENOENT' ? 2 : 1);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();

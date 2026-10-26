# `easy-edits new`: plan, approve, render

`easy-edits new <type>` makes a video from a brief, a script or brand assets instead of editing footage. It always
stops after planning; nothing is generated until the user approves the pinned plan.

```sh
easy-edits new promo -o out/promo --brand brand.json --assets brand/ --format 9x16,1x1 --length 15
cat out/promo/PLAN.txt                      # generations, cost, wall time, "will send" lines, the shots
easy-edits new --approve out/promo/plan.json   # sha256-checked, budget-checked, then rendered
```

## Files

| File | What |
| --- | --- |
| `index.mjs` | CLI (`newMain`), `planNew`, `approveNew`, `repin`, report / REVIEW / DELIVERY / POST_DRAFT writers |
| `plan.mjs` | plan.json schema (top of the file), generation count, cost / wall-time estimate, "will send" lines, PLAN.txt, sha256 pin |
| `storyboard.mjs` | storyboard.png: one cell per shot (number, duration, source, prompt summary) |
| `recipes.mjs` | Recipe registry, the "other" keyword mapping, script parsing, built-in generic recipes |
| `recipes/<name>.mjs` | Recipes, auto-loaded (sorted); a recipe here replaces the built-in of the same name |
| `render.mjs` | `renderShots`: voice -> timeline -> one clip per shot per format -> crossfades + captions -> master |
| `assemble.mjs` | ffmpeg toolkit: formats, conform to WxH / 30 fps / BT.709, stills (Ken Burns), code-drawn cards, xfade, burned captions, SRT / VTT, premix, music bed |
| `finish.mjs` | Finish presets (social -14 LUFS / -1.5 dBTP, podcast -16 LUFS / -1.5 dBTP), the WAV + MP3 master, delivery verification |

## The approval gate

- Planning writes `plan.json`, `plan.json.sha256` (sha256sum format), `PLAN.txt` and `storyboard.png`, and renders
  nothing. PLAN.txt starts with `generations: N video, M image, K TTS`, the estimated cost (from each backend's
  `capabilities.costPerCall`), the estimated wall time, and a `will send: ...` line for every network backend.
- `--approve plan.json` refuses (exit 2) when the plan changed since it was pinned. After a hand edit, run
  `easy-edits new repin plan.json`: it re-validates the shots, recounts generations and rewrites PLAN.txt and the
  storyboard before pinning again.
- `--max-generations N` refuses a plan that needs more than N generations (at planning and again at approval), and
  the render never makes more generations than the approved plan counted. `--offline` refuses any backend whose
  capabilities say `network: true`. Generation goes through `easy-edits/gen` (see `gen/CONTRACT.md`).

## Backends and the host generation flow

Each kind has its own backend (`plan.backends`): image and video default to `host`, tts and avatar to `local`, llm
and search to `none`. `--backend NAME` sets every kind, `--video-backend` / `--image-backend` / `--tts-backend` /
`--avatar-backend` / `--llm-backend` / `--search-backend` one kind; `EASY_EDITS_BACKEND` forces every kind (tests).

`host` means the AI assistant driving Easy Edits makes the asset with its own built-in image/video generation:

1. `--approve` records the approval (`plan.json.approved`, the plan's sha256), clears `GENERATION_MANIFEST.json`
   and renders. Every recipe gets its backends from one generation session (`hostflow.mjs`: the approved budget,
   usage, pending host assets). A host request is appended to the manifest (id = shot id + a hash of the request,
   type, prompt, durationSec, aspect, referenceImages, firstFrame, file under `assets/`) and comes back pending.
2. After its generation calls a recipe calls `ctx.checkpoint()` (or its pipeline throws `PendingAssetsError`):
   with anything pending the CLI prints the manifest and the steps and exits **3**. Nothing has been rendered.
3. The assistant saves each asset at its `file`. `easy-edits resume <out>` re-reads the plan (pin and approval
   hash), refuses with exit 3 and the list while an asset is missing or unreadable, then renders again: the host
   adapter finds every file (`cached: true`) and the run finishes with report.json, REVIEW.txt and DELIVERY.json.

An edited prompt gets a new asset id, so a stale file is never reused. `xai` and `http-generic` are opt-in hosted
backends (`gen/BACKENDS.md`); they are never a default.

Generated clips' own audio (`clip-audio.mjs`, `--clip-audio auto|keep|duck|drop`): auto drops it under narration or
a song, ducks it -18 dB under a music bed and keeps it as-is when it is the only audio; the master then sets social
-14 LUFS / -1.5 dBTP or podcast -16 LUFS / -1.5 dBTP.

## Writing a recipe

A file in `recipes/` registers its `recipe` export when it has one (so its default export can stay a pipeline's own
interface, as `explainer-cited`, `presenter`, `story` and `music-video` do), else its default export. Pipelines
that call backends themselves take `ctx.getBackend(kind)` (the session's backend) and route host requests with
`genOpts()` from `hostflow.mjs`.

```js
// easy-edits/new/recipes/my-type.mjs
import { renderShots, voiceSegments } from '../render.mjs';
export default {
  name: 'my-type', description: '...', keywords: ['words', 'that', 'pick', 'it', 'for', 'other'],
  defaults: { length: [15, 90], loudness: 'social' },
  plan(o) {   // o: CLI options + formats, finish, length, backendName, caps(kind), canGen(kind), probeSec(file)
    return { title: o.title, shots: [{ id: 's1', durationSec: 3, source: 'generate', prompt: '...', refs: [], camera: 'static', transition: 'fade' }],
             voice: [{ id: 'v1', speaker: null, text: '...' }], notes: [], options: {} };
  },
  async render(plan, ctx) {   // ctx: out, work, logFile, generate(kind, req, {id}), getBackend(kind), checkpoint(), outName(fmt, ext), ff, probeSec
    return renderShots(plan, ctx, { segments: await voiceSegments(plan, ctx) });   // -> { outputs, captions, weakShots }
  },
};
```

`render` returns `{ outputs:[{file, format, kind, extraChecks?:[{name, pass, text}]}], captions:[files],
weakShots:[{shot, at, reason, fix}], sources?, sourcesFile?, sheets?, credits?, notes?, postText?, clipAudio?, details? }`;
`plan` may also return `assets:[{id, kind, prompt}]` (generations that aren't shots, e.g. a presenter's host image); `approveNew` verifies every output (loudness against the plan's finish
preset, BT.709 tags, `--length`) and writes `report.json` (`WEAK_SHOTS`), `REVIEW.txt`, `DELIVERY.json` and, with
`--post-draft`, `POST_DRAFT.txt`.

Shot sources: `generate` (a video or `kind: 'avatar'` clip), `still` (a generated image, or the user's image with
`file`), `code` (drawn; recipes pass `drawCode` to `renderShots`), `user` (the user's clip in `file`).

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

## Writing a recipe

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
  async render(plan, ctx) {   // ctx: out, work, logFile, generate(kind, req, {id}), outName(fmt, ext), ff, probeSec
    return renderShots(plan, ctx, { segments: await voiceSegments(plan, ctx) });   // -> { outputs, captions, weakShots }
  },
};
```

`render` returns `{ outputs:[{file, format, kind}], captions:[files], weakShots:[{shot, at, reason, fix}],
sources?, credits?, notes?, postText? }`; `approveNew` verifies every output (loudness against the plan's finish
preset, BT.709 tags, `--length`) and writes `report.json` (`WEAK_SHOTS`), `REVIEW.txt`, `DELIVERY.json` and, with
`--post-draft`, `POST_DRAFT.txt`.

Shot sources: `generate` (a video or `kind: 'avatar'` clip), `still` (a generated image, or the user's image with
`file`), `code` (drawn; recipes pass `drawCode` to `renderShots`), `user` (the user's clip in `file`).

# Easy Edits internals

The user docs are the root [README.md](../README.md). This file is the technical reference for the code under
`easy-edits/`.

Easy Edits is built on **Herk Edit Kit** by **Nate Herk** (https://github.com/nateherkai/herk-edit-kit, MIT). Herk's
kit supplied the editing playbook, the house style, the style library and the HyperFrames render workflow that
Easy Edits automates.

## Layout

| Path | What |
| --- | --- |
| `../bin/easy-edits` | The CLI entry point (loads `~/.easy-edits/env.sh`, then runs `cli/main.mjs`) |
| `cli/main.mjs` | Argument parsing, URL input, `--style` / `--face` / `--caption-color` checks, dispatch to `modes/<mode>.mjs` |
| `cli/style.mjs` | `easy-edits style list \| validate \| skill` (the skill generator) |
| `modes/` | `clean-cut`, `talking-head`, `explainer`, `shorts`, `captions` |
| `engine/` | Shared stages: source normalisation + SDR tone-map, ASR, face track (`facetrack.py`, YuNet), screen-activity track (`activity.py`), motion plan (`plan.mjs`, pinned plans in `plan-store.mjs`), HyperFrames composition per format (`compose.mjs`), soundtrack (`audio.mjs`), export + delivery check (`export.mjs`, `media.mjs`) |
| `new/` | `easy-edits new <type>`: plan.json + PLAN.txt + storyboard, the approval gate, the recipe registry (`new/recipes/`), the ffmpeg assembler and finish presets ([new/README.md](new/README.md)) |
| `gen/` | Generation backend registry (`gen/CONTRACT.md`): none / mock adapters |
| `bin/clean-cut.sh` | The approved Clean cut pipeline (9:16), also used as the cut stage of talking-head |
| `styles/pack.schema.json`, `styles/packs/` | Style pack schema and the built-in packs (`punch`, `broadsheet`, `terminal`) |
| `styles/clean-cut/` | Deterministic cut list (`cut.mjs`), build, caption burn-in, review briefs |
| `presets/` | Caption presets (`captions-default`, `captions-layout`, ASS export), the locked Clean cut preset, look specs |
| `audio/` | Loudness master (-14 LUFS / -1.5 dBTP), Openverse music fetch (CC0 / CC BY only), synth SFX |
| `post/` | Lead-in and the post-pass (lead-in, optional music, master, delivery check) |
| `check/` | Delivery check and the quality gates (captions vs faces, cards, panels, verbatim, dead air, ...) |
| `tools/` | Source prep, cut candidates, name / verbatim / sibling guards, DOM sampler |
| `smoke/` | Local faster-whisper word transcript (`asr_words.py`) and an experimental smoke render |
| `research/` | Cited explainer: sources store, scriptwriter, citation check, render ([research/README.md](research/README.md)); recipe `new/recipes/explainer-cited.mjs` |
| `presenter/` | Presenter shorts (plan, render, still-motion fallback) and likeness consent records; `run.mjs` is the standalone runner, `../new/recipes/presenter.mjs` the recipe ([docs/CONSENT.md](../docs/CONSENT.md)) |
| `briefs/` | Prompts for the experimental one-shot agent edit (`bin/edit.sh` without `--style`) |
| `gen/` | Generation backends: registry (`index.mjs`), `local`, `http-generic`, providers.json / keys / redaction / cache (`config.mjs`); [gen/BACKENDS.md](gen/BACKENDS.md). `cli/backends.mjs` is `easy-edits backends` |

## Clean cut (approved)

Locked in `presets/clean-cut-default.json`: `--mode clean` with the captions-minimal look.

A competent editor's quick pass: fillers (uh, um, ah, er), false starts, repeated words / phrases and dead air
removed, normal cuts, one natural grade, clean minimal captions. No motion graphics, SFX or music.

- **Transcript.** Source prep's cut-candidates pass decodes the whole clip locally (faster-whisper medium, with a
  disfluent prompt so fillers and repeats are heard; cached by source sha1).
- **Cut list.** Deterministic (`styles/clean-cut/cut.mjs`). Edit points sit on the frame grid in the quiet between
  words, >= 30 ms clear of kept words, and pauses > 0.3 s are trimmed to ~0.2 s. Audio joins are 30 ms crossfades
  with continuous room tone. A source that ends on speech gets a 0.4 s held last frame over faded room tone.
- **Review (optional).** One short `claude -p` pass before the build (Sonnet, `--max-turns 3`, 120 s cap;
  `EASY_EDITS_REVIEW_MODEL`, `EASY_EDITS_REVIEW_CAP`). It may only keep an intentional repeat, drop a missed filler or fix
  an ASR mishearing / name, through `review-patch.json`. A `text` fix is caption-only and never moves a cut.
  `--no-review` skips it. `--review-only` stops after the cut so any agent can review `cut-review.md` and re-run
  with `--review-patch FILE` (see [docs/AGENTS_GUIDE.md](../docs/AGENTS_GUIDE.md)).
- **Caption verify.** A review aid, never a gate: `check/caption-verify.mjs` decodes the built audio again and flags
  caption words that no window heard. `EASY_EDITS_CAPVERIFY=0` skips it.
- **Render.** `styles/clean-cut/burn.mjs` draws each caption once in HyperFrames' Chrome from the composition CSS
  and overlays it on the cut clip (x264 veryfast, crf 15). `EASY_EDITS_RENDER=hyperframes` uses the per-frame
  HyperFrames render instead.
- **Cut modes** (`--mode-cut` in the CLI): `clean` (default), `light` (fillers and dead air only), `strict` (pauses
  > 0.3 s trimmed, no sentence-end exception).
- **Language:** `--lang`, else `~/.easy-edits/profile.json` `language`, else auto.
- Phone footage (rotation, extra spatial-audio streams) is normalised first.
- ASR processes take a machine-wide lock (`EASY_EDITS_ASR_LOCK`, `0` = off), because concurrent CTranslate2 int8
  decodes are not deterministic.

## Style packs

`engine/style-pack.mjs` loads a pack (built-in id, an id in `~/.easy-edits/styles` / `EASY_EDITS_STYLES`, or a
path), validates it against `styles/pack.schema.json` with a small dependency-free validator (the JSON Schema
subset the schema uses; `x-error` gives a readable message) and then the rules a schema can't express: font
weights the installed font has, WCAG 4.5:1 for text on background / surface and on the accent, `punchZoom` order.
`checkRequest()` turns a run the pack doesn't support (mode, format, `--plan` beat types, `--hook`, `--speaker`,
`--graphics`, missing fonts) into reasons, and the CLI exits 2 before any work. `stylePlan()` leaves out planner
beats outside the pack's `scenes`, spaces pops / punch-ins by `pacing.minBeatGap`, caps beats per minute and clamps
punch zooms; `exportFormats()` also drops intro / outro / progress / lower thirds / hook the pack doesn't list.

`engine/theme.mjs` maps a pack onto the fields `compose()` draws with (the house look is the same structure, so
there is one code path). The pack drives: palette and fonts on every element; captions (font, case, words per
group, highlight `keywords` / `active-word` as `color` / `underline` / `glow` / `box`, animation `pop` / `fade-up` /
`type`, edge, shadow); transitions at every layout change, camera change and card edge (`whip`, `dip`, `glitch`);
the stat number treatment (`slam`, `count-up`, `scramble`; seeded, so re-renders match); a signature move on every
punch-in (`punch-shake`, `letterbox`, `hud`); entrances; drift; SFX policy; the default music query. `report.json`
records `style`, `transitions`, `signatures` and `styleDropped` per export.

`cli/style.mjs` `skillMarkdown()` writes a Claude Code skill from a pack: frontmatter, the commands with
`--style`, the look, the beat types allowed in a plan, pacing, review steps and the rules.

## Smarter captions

- **Auto contrast** (`engine/contrast.mjs`). `lumaGrid()` decodes the clip once to a 64 px wide greyscale grid at
  2 fps (cached next to the clip). For each caption, `compose()` maps the estimated text rect back through the
  camera framing into source pixels, `regionStats()` reads mean luminance and spread over the caption's time
  window, and the part of the rect that is off the picture is blended with the backdrop colour. `pickInk()` keeps
  white (dark edge) unless near-black text (light edge) has 2.5x its WCAG contrast, with a hysteresis band so
  neighbouring captions don't flicker between inks. A busy background (grey spread > 48) gets a heavier edge; a
  pack highlight colour under 3:1 against the background becomes a highlight box. `--caption-color` fixes the ink.
  The approved clean-cut 9:16 burn-in keeps its white captions.
- **Manual face position** (`engine/face-override.mjs`). `--face top|center|bottom|X,Y` replaces every face-track
  sample with that point (keeping the detected face size, else 18% of the short side), so framing, punch-ins,
  caption keep-out, pops and the HUD signature all follow it. On the clean-cut 9:16 path, `clean-cut.sh` writes
  `source-prep.face.json` (every scene's crop and cover transform on the point) for the build and the face gates.
  Shorts previews use one steady crop on the point. Explainer screen recordings ignore it (their track is screen
  activity).

## Delivery check

Every export runs `check/delivery.mjs`, which transcribes the delivered file again with faster-whisper and prints
PASS/FAIL. It is a fault detector: read the check text before trusting a FAIL (see [KNOWN_ISSUES.txt](../KNOWN_ISSUES.txt)).

| Check | Fails when |
| --- | --- |
| `first-word` | the first word starts before 0.15 s |
| `last-word` | the last word ends within 0.15 s of the end |
| `no-repeat` | a phrase is heard twice that the reference transcript says only once |
| `loudness` | integrated loudness is outside -14 +-1 LUFS or true peak is above -1 dBTP (the master's ceiling is -1.5 dBTP, so this only trips on a real overshoot) |

Segments not backed by speech-band activity (e.g. a phantom "thanks for watching" decoded from a music tail) are
dropped and listed as `dropped`. Standalone: `node easy-edits/check/delivery.mjs out.mp4 [--script narr.txt]`.

## Music and sound

Music is never bundled. With `--music "query"` (default for talking-head and explainer), `audio/openverse.mjs`
searches Openverse for CC0 / CC BY tracks only, downloads one at render time, and writes `CREDITS.txt` (title,
author, licence, source URL) next to the export. Ship that file with the video. `--no-music` turns it off. The
whooshes and pops are synthesised locally (`audio/sfx-synth.mjs`); the icons are original SVG paths
(`engine/icons.mjs`).

## Experimental paths

- `bin/edit.sh` without `--style`: a one-shot creative edit of a ~30 s clip by headless Claude Code
  (`claude -p --permission-mode bypassPermissions`, unattended shell access: run it only in a VM, container or
  throwaway checkout). Its briefs load Herk's skills and docs (`.claude/skills/...`, `docs/WORKFLOW.md`,
  `MOTION_PHILOSOPHY.md`), which are **not** bundled here: run it from a checkout of the upstream Herk Edit Kit with
  this `easy-edits/` folder added. Measured runs took 7-17 min and cost $1.33-$3.48 each in model time.
- `smoke/run-smoke.sh talk.mov out/smoke.mp4 10`: a short smoke render with the default caption preset.
- `../style-library/` and `../style-templates/`: Herk's card and scene library for hand-built HyperFrames
  compositions. The CLI does not use them. Brand names and figures on the cards are placeholders.

## Tests

```sh
npm test
```

The suite is offline unit and fixture tests (Node's test runner, ffmpeg, the venv python). Tests that need local
media that is not in the repo (renders, source clips, frame crops of test footage) are reported as `skipped`.
A few tests decode audio with faster-whisper and need the models from `./install.sh`.

## Licence

MIT (see [../LICENSE](../LICENSE)). Third-party components: [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

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
| `cli/main.mjs` | Argument parsing, URL input, dispatch to `modes/<mode>.mjs` |
| `modes/` | `clean-cut`, `talking-head`, `explainer`, `shorts`, `captions` |
| `engine/` | Shared stages: source normalisation + SDR tone-map, ASR, face track (`facetrack.py`, YuNet), screen-activity track (`activity.py`), motion plan (`plan.mjs`, pinned plans in `plan-store.mjs`), HyperFrames composition per format (`compose.mjs`), soundtrack (`audio.mjs`), export + delivery check (`export.mjs`, `media.mjs`) |
| `bin/clean-cut.sh` | The approved Clean cut pipeline (9:16), also used as the cut stage of talking-head |
| `styles/clean-cut/` | Deterministic cut list (`cut.mjs`), build, caption burn-in, review briefs |
| `presets/` | Caption presets (`captions-default`, `captions-layout`, ASS export), the locked Clean cut preset, look specs |
| `audio/` | Loudness master (-14 LUFS / -1 dBTP), Openverse music fetch (CC0 / CC BY only), synth SFX |
| `post/` | Lead-in and the post-pass (lead-in, optional music, master, delivery check) |
| `check/` | Delivery check and the quality gates (captions vs faces, cards, panels, verbatim, dead air, ...) |
| `tools/` | Source prep, cut candidates, name / verbatim / sibling guards, DOM sampler |
| `smoke/` | Local faster-whisper word transcript (`asr_words.py`) and an experimental smoke render |
| `briefs/` | Prompts for the experimental one-shot agent edit (`bin/edit.sh` without `--style`) |

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

## Delivery check

Every export runs `check/delivery.mjs`, which transcribes the delivered file again with faster-whisper and prints
PASS/FAIL. It is a fault detector: read the check text before trusting a FAIL (see [KNOWN_ISSUES.txt](../KNOWN_ISSUES.txt)).

| Check | Fails when |
| --- | --- |
| `first-word` | the first word starts before 0.15 s |
| `last-word` | the last word ends within 0.15 s of the end |
| `no-repeat` | a phrase is heard twice that the reference transcript says only once |
| `loudness` | integrated loudness is outside -14 +-1 LUFS or true peak is above -1 dBTP |

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

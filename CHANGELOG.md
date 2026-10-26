# Changelog

## Unreleased

- **Generation backends (bring your own key).** `local` (ffmpeg title-card stills, Ken Burns clips, Kokoro / Piper /
  eSpeak / flite TTS, a synthetic still + zoom avatar mastered to -14 LUFS / -1.5 dBTP, BT.709) and `http-generic`
  (any REST API from `~/.easy-edits/providers.json`: endpoint, auth header, env-var key, JSON body template,
  response path to a URL / base64 / binary) join `none` and `mock`. Keys come from env vars or providers.json only and
  are redacted everywhere; results are cached by content hash in `~/.easy-edits/cache` (`cached: true`, cost 0 on a
  re-run). `easy-edits backends [list | try | init]`; the doctor has a `backends` line (key present yes/no only).
  Docs: `easy-edits/gen/BACKENDS.md`.
- `npm run lint` (`easy-edits/tools/lint-repo.mjs`, CI workflow `lint.yml`): fails on key-like strings and absolute
  home paths.
- **`easy-edits new <type>`** (explainer-cited, presenter, podcast, story, promo, music-video, other): plan first
  (`plan.json` with `shots[]`, `PLAN.txt` with `generations: N video, M image, K TTS`, estimated cost and wall time,
  `will send: ...` lines, `storyboard.png`), then `--approve plan.json` (sha256 pin; `new repin` after an edit),
  `--max-generations N`, `--offline`. Recipes register in `easy-edits/new/recipes/`.
- **Promo** from `--brand brand.json --assets DIR`: code-drawn scenes, zero generations, brand colours contrast-checked.
- **Podcast** from a speaker-tagged script: two voices, turn gaps, room tone; waveform video with speaker-named
  captions, or `--audio-only` WAV + MP3 at -16 LUFS.
- Shared assembler (BT.709 conform, crossfades, captions from the known script), finish presets (social -14 LUFS,
  podcast -16 LUFS, both -1.5 dBTP), `--loudness`, `--length`, 4:5 and custom `WxH` formats, `report.json`
  `WEAK_SHOTS`, `REVIEW.txt`, `DELIVERY.json` and opt-in `--post-draft` (`POST_DRAFT.txt`, labelled DRAFT).
- Docs: the master's true-peak ceiling is -1.5 dBTP (some docs said -1 dBTP).

## 1.3.1 (2026-10-26)

macOS font checks, supported Python, install CI. The macOS font fix and the install CI come from PR #1 (squashed).

- Fixed (macOS): the doctor reported the installed fonts as missing (`caption-font` and `style-fonts` FAIL) when
  a Homebrew `fc-list` (it comes with Homebrew's ffmpeg) doesn't index `~/Library/Fonts`, and the renderer refused
  `--style broadsheet` / `terminal` for the same reason. On macOS both now look for the font files in
  `~/Library/Fonts` and `/Library/Fonts` (where Chrome finds them) before asking `fc-list`. Without `fc-list`, the
  doctor also needed the font in both folders at once; one is enough now. The doctor and the renderer accept the
  same exact files (the ones `install.sh` installs, e.g. `Montserrat[wght].ttf`), so a look-alike such as
  `MontserratAlternates-Bold.otf` no longer counts as Montserrat.
- The doctor's font FAIL lines say where they looked.
- Fixed: on a machine whose `python3` is newer than faster-whisper supports (Python 3.15, e.g. a fresh Homebrew
  python), the install died with "No matching distribution found for ctranslate2". `install.sh` now builds the venv
  with a Python 3.9-3.14 (`python3`, else `python3.14` ... `python3.9`; on macOS it installs `python@3.13` with
  Homebrew if there is none), rebuilds a venv an unsupported python left behind, and the doctor's `python3` line
  checks the venv's Python version. A Python without venv/ensurepip gets its own error when the venv is created.
- `install.sh` can be sourced (`. ./install.sh`) to define its functions without running anything; the tests use
  that instead of copying functions out of the script.
- CI (`.github/workflows/install.yml`): a fresh `./install.sh` + `./install.sh --doctor` on Linux and macOS
  (also with an `fc-list` that lists none of the fonts), and `npm test`, on every push and pull request.

## 1.3.0 (2026-10-22)

Style packs, style skills, smarter captions.

- **Style packs.** One JSON file per editing style: palette, fonts, caption look, transitions, number treatment,
  signature move, pacing, allowed scenes and sound, with a JSON schema (`easy-edits/styles/pack.schema.json`).
  `--style <pack>` works with `captions`, `talking-head`, `explainer` and `shorts`. The renderer validates the pack
  (schema, font weights, readable palette contrast) and refuses, with the reason, anything the pack doesn't support:
  modes, formats, `--plan` beat types, `--hook`, `--speaker`, missing fonts. Planner beats outside the style or its
  pacing are left out and listed in `report.json` (`styleDropped`).
- **Three built-in styles**, each with its own transition, number treatment and signature move:
  `punch` (whip-pan, numbers slam in, punch-in camera shake), `broadsheet` (dip through paper, numbers count up,
  letterbox bars) and `terminal` (RGB glitch, numbers decode, HUD brackets on the face).
- **`easy-edits style list | validate <pack> | skill <pack>`.** `style skill` writes a Claude Code skill
  (`~/.claude/skills/easy-edits-style-<id>/SKILL.md`, or `--project`, `-o DIR`, `--print`) so Claude edits in that
  style: it adds `--style` to every render, plans only the allowed beats and reviews against the style.
- **Auto contrast captions.** Captions sample the footage behind them and switch between white text with a dark
  edge and near-black text with a light edge, with hysteresis; busy backgrounds get a heavier edge.
  `--caption-color auto|white|black|#RRGGBB` overrides it. `report.json` gains `contrast`.
- **`--face top|center|bottom|X,Y`**: a manual face position for when face detection is wrong. Framing,
  punch-ins, caption placement and pops follow it, in every mode (the approved clean-cut 9:16 included).
- `install.sh` also installs Playfair Display and JetBrains Mono (SIL OFL, pinned commit, sha256-checked); the
  doctor has a new `style-fonts` line.
- Fixed: the doctor could report an installed style font as missing (`grep -q` in a pipeline under `pipefail`).
- Setup guidance (repo skill, `/easy-edits`, CLAUDE.md): run `./install.sh` in the foreground and wait for it
  before the doctor.

## 1.2.0 (2026-10-22)

- Claude Code onboarding: the repo skill `.claude/skills/easy-edits/SKILL.md` ("set up Easy Edits", `/easy-edits`),
  CLAUDE.md / AGENTS.md guidance.

## 1.1.0 (2026-10-21)

- First public release of Easy Edits: `clean-cut`, `talking-head`, `explainer`, `shorts` and `captions` modes.

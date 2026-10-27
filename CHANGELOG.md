# Changelog

## 1.4.2 (2026-10-27)

Install polish: the move to `~/.ai-video-editor` always happens, and the local TTS has a real voice out of the box.

- Legacy home: an `AI_VIDEO_EDITOR_HOME` or `EASY_EDITS_HOME` still pointing at `~/.easy-edits` (a stale shell or an
  old `env.sh`) no longer makes `./install.sh` keep writing there. It counts as the default home: `~/.easy-edits` is moved
  to `~/.ai-video-editor` (venv, node and models kept), `env.sh` is written there and `~/.easy-edits` becomes a symlink
  to it. A custom home elsewhere is still left alone.
- Piper voice by default: `./install.sh` installs the `piper` CLI (`piper-tts` into the venv, linked from
  `~/.ai-video-editor/bin`, unless a working `piper` is already on PATH) and the `en_US-amy-low` voice (~60 MB,
  `~/.ai-video-editor/models/piper/`, from huggingface.co/rhasspy/piper-voices v1.0.0, pinned by sha256). `env.sh`
  exports `AI_VIDEO_EDITOR_PIPER_MODEL` (and `EASY_EDITS_PIPER_MODEL`), so `ai-video-editor new` voice-overs use Piper
  instead of flite. `AI_VIDEO_EDITOR_PIPER_CACHE=<dir>` copies the voice from a local folder instead of downloading it;
  a custom `AI_VIDEO_EDITOR_PIPER_MODEL` is kept. The doctor has a `piper-voice` line and its `backends` line reports
  `tts: piper`.
- Sample: `samples/talk.mp4` is a ~15 s public-domain NASA talking-head trim (SVS14069 / Wikimedia; see
  `samples/LICENSE`) with a real face and clear speech, so captions / clean-cut / shorts / talking-head demos work.
- Shorts: `--propose` also writes machine-readable `proposals.json` (id, hook, durationSec, previewPath) for
  assistant pick cards; default min/max auto-shrinks when the source is shorter than 30 s so demos still propose.
- Preview: `--preview` renders ~20 s from the first speech (captions / clean-cut / talking-head) before the full run.
- Stranger-facing errors: missing input / `-o` / `--brand` / empty speech name the next command; delivery FAIL (exit 1)
  lists the failing checks and is not phrased as a crash; unexpected errors exit 5 with the stack in the log.
- Guided chat: skill §0 + getting-started + template STARTER / FIRST_RUN use tap-to-pick choice cards, progress lines,
  preview-before-final, and error fix cards (never raw errors or CLI flags to the user).
- Captions: stable face keep-out — `pickCaptionY` places captions above or below the face and sticks to that side so
  captions never cover a tight talking-head crop.
- Delivery: intentionally looped sources (repeated AVI / tiled demos) are detected; `no-repeat` reports a plain NOTE
  instead of FAIL so demos and looped stock still deliver.
- Copy polish: generation approval card names the plan the built-in tools run on; short picks use a clear stand-alone
  moment; the `easy-edits` skill-id alias stays agent-only (CLI alias still works for one release).

## 1.4.1 (2026-10-27)

Renamed from Easy Edits to **AI Video Editor**, plus stranger-test fixes after the public rename.

- The command is now `ai-video-editor` (`bin/ai-video-editor`; package `ai-video-editor`). `easy-edits` stays as an
  alias for one release (`bin/easy-edits` runs `ai-video-editor` with the same arguments); the doctor checks both
  (`ai-video-editor-cli`, `easy-edits-alias`).
- The code moved from `easy-edits/` to `ai-video-editor/`; the repo skill and command are now
  `.claude/skills/ai-video-editor` and `.claude/commands/ai-video-editor.md`, and `./install.sh` registers
  `~/.claude/skills/ai-video-editor` (it removes the copy it registered as `~/.claude/skills/easy-edits` before).
- Outputs are named `ai-video-editor_<mode>_<clip>...` (was `easy-edits_...`); the log tag is `[ai-video-editor]`.
- Config home is always `~/.ai-video-editor` (`AI_VIDEO_EDITOR_HOME`). A pre-rename `~/.easy-edits` is moved there on
  install (venv, node and models kept) and left as a symlink, so `. ~/.easy-edits/env.sh` still works. `EASY_EDITS_HOME`
  and every old `EASY_EDITS_*` name still work for one release; the new name wins when both are set. `env.sh` exports both.
- Public repo: https://github.com/nixeniego/ai-video-editor (tag `v1.4.1`). Clone URLs and the skill point at that tag.
- `samples/talk.mp4`: a small CC0 synthetic demo clip for help/README examples (regenerate with `samples/make-talk.sh`).
- Doctor TTS is honest: Kokoro is only "ready" when HyperFrames' Python deps (`kokoro-onnx`, `soundfile`) import; Piper
  on PATH without `AI_VIDEO_EDITOR_PIPER_MODEL` is reported as such instead of being silent.
- `ai-video-editor new promo --init-brand [DIR]` writes a starter `brand.json` (+ `assets/`) you can fill in; no plan.
- Delivery FAIL (exit 1) now says the outputs were written under the out dir and to review them rather than re-run.
- README: never posts or schedules for you; `--post-draft` only writes a local `POST_DRAFT.txt` labelled DRAFT — it never
  publishes on your behalf.

## 1.4.0 (2026-10-26)

Make new videos, not just edit them: `easy-edits new` plans, waits for approval, has your AI assistant generate the
pictures, and finishes the edit. Tested with the mock backend and the host flow fed with test-pattern assets;
the quality of real generated pictures and hosted backends is untested.

- Every mode, `new` and `resume` now check that the final file is in the `-o` folder, non-empty and readable
  (ffprobe); otherwise they exit 5 with the file named (`report.json` `finalOutput`). A run that only left
  `.work/` intermediates no longer looks done.
- `./install.sh` registers the skill as `~/.claude/skills/easy-edits` (names the checkout; `--skill-only`,
  `EASY_EDITS_NO_SKILL=1`; doctor line `claude-skill`), and README opens with install steps for AI assistants, so
  "Install Easy Edits from <url>" in an empty folder finds the skill and later sessions can load it.
- Story QA identity drift compares face and torso regions (background ignored), with a colour fallback; calibrated
  on a real story (see KNOWN_ISSUES.txt).
- **Host generation is the default for images and video.** After `--approve`, every image / video request goes
  into `GENERATION_MANIFEST.json` in the output folder (id, type, prompt, durationSec, aspect, referenceImages,
  firstFrame, file) and the run exits with code 3. The assistant driving Easy Edits makes each asset with its own
  built-in image/video generation and saves it at `file`; **`easy-edits resume <out>`** checks the approved plan's
  hash and every asset (exit 3 with the list while any are missing or unreadable) and finishes the edit, captions,
  QA, `report.json`, `REVIEW.txt` and `DELIVERY.json`. Voice and avatar default to `local`; `xai` and
  `http-generic` stay opt-in. Per-kind backend flags: `--video-backend`, `--image-backend`, `--tts-backend`, ...
- **Every type goes through the recipe registry**: `explainer-cited`, `presenter`, `podcast`, `story`, `promo`,
  `music-video` and `other`, with the same plan -> storyboard -> approval -> render -> report flow. Hand edits to
  `plan.json` shots (re-pinned) reach the story and music-video renderers. The standalone runners still work.
- **Generated-clip audio**: `--clip-audio auto|keep|duck|drop`. By default a clip's own ambient audio is dropped
  under narration or a song, ducked -18 dB under music, and kept as-is when it is the only sound; then the
  finish preset masters it (social -14 LUFS / -1.5 dBTP, podcast -16 LUFS / -1.5 dBTP).
- The master (`audio/master.mjs`) now runs its correction pass whenever true peak is over the requested ceiling
  (-1.5 dBTP by default), not only above -1.
- Story QA flags a held last frame when a shot is longer than its generated clip.
- The cited explainer generates one still per claim and crops it for each format (half the image generations for
  `--format all`), and renders custom `WxH` sizes.
- Skill, README, AGENTS.md / CLAUDE.md and `gen/BACKENDS.md` describe the `new` types and the plan -> approve ->
  generate -> resume -> deliver flow, consent for a presenter's likeness and `--i-own-this-music`.
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
- Docs: every true-peak figure now says -1.5 dBTP, the master's ceiling.
- **Cited explainer (research stream).** `easy-edits/research/`: a sources store from `--source URL|FILE` (HTML, PDF
  via pdftotext, txt, md) and `--topic` (search backend), a scriptwriter (LLM backend, or a deterministic extractive
  fallback) that writes `script.json` (claim -> source id -> quoted passage) to a target length, a `citation` check
  that FAILs any quote not found verbatim in its source, and a render with TTS narration, a still or code card per
  claim, `[n] Source title` chips, captions from the script, a Sources end card, `SOURCES.txt` and `.srt` / `.vtt`
  (9:16, 16:9; -14 LUFS / -1.5 dBTP; BT.709). Recipe `easy-edits/new/recipes/explainer-cited.mjs`; standalone runner
  `node easy-edits/research/run.mjs`.
- **Presenter shorts with likeness consent** (preview; `easy-edits/presenter/`, recipe `new/recipes/presenter.mjs`).
  Script -> tts -> avatar -> captions from the script, 9:16, 15-90 s (`--length`), -14 LUFS / -1.5 dBTP, BT.709.
  A fictional host comes from the image backend or a licensed `--host-image` with `--host-license`; `--likeness
  self` needs a consent record and refuses before any generation without a matching, unexpired, self-attested
  record with intact reference hashes. Voice cloning uses the tts `voiceClone` capability. `report.json` says
  `synthetic: true`, with an on-screen "AI-generated presenter" label by default. `easy-edits consent create |
  verify | show` writes and checks the records. See [docs/CONSENT.md](docs/CONSENT.md).
- **Multi-shot story and music video** (`easy-edits/story/`, recipes `easy-edits/new/recipes/story.mjs` and
  `music-video.mjs`; standalone runner `node easy-edits/story/run.mjs`). Story: a brief or `shotlist.json`,
  `characters.json` descriptions on every shot prompt and reference images to backends that take them, long beats
  split at the backend's max clip length, video -> still + Ken Burns -> text card fallback, transitions, narration
  and captions. Music video: `--song FILE` only with `--i-own-this-music` (recorded in `report.json`), local beat
  detection, cuts snapped to beats with the snap error reported, length = song, lyric captions from your own
  lyrics file. Any aspect (9:16, 16:9, 1:1, 4:5, W:H, WxH). Per-shot QA (black / frozen frames, duration match,
  flicker, identity drift) feeds `WEAK_SHOTS` in `report.json` and `REVIEW.txt`. Finished at -14 LUFS / -1.5 dBTP,
  tagged BT.709.

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

# AI Video Editor: guide for AI agents

`AGENTS.md` and `CLAUDE.md` have the same content; keep them in sync.

AI Video Editor edits talking-head video from one command. You drive the CLI and use judgement; AI Video Editor does the cutting,
captions, graphics and rendering. Built on Herk Edit Kit by Nate Herk.

Claude Code: the full step-by-step flow (install, fix doctor FAILs, first run, shorts, review) is the repo skill
`.claude/skills/ai-video-editor/SKILL.md`. When the user says "set up AI Video Editor" (or runs `/ai-video-editor`), follow it. This
folder is already an AI Video Editor checkout, so skip the skill's `git clone` and run everything from here.
Asked to install AI Video Editor from outside a checkout (e.g. "Install AI Video Editor from <repo url>" in an empty folder)?
Follow README.md's "For AI assistants: install steps": clone to `~/ai-video-editor`, read the skill file there and follow it.
`./install.sh` registers the skill as `~/.claude/skills/ai-video-editor`, so later sessions in any folder can load it.

## Setup (once per machine, then once per shell)

```sh
./install.sh              # idempotent; downloads Node 22, a Python venv, ~2 GB of Whisper models, Chrome, a font
./install.sh --doctor     # PASS/FAIL per dependency; must end with "doctor: all PASS"
. ~/.ai-video-editor/env.sh    # every new shell: puts ai-video-editor, Node 22 and the venv python on PATH
ai-video-editor --help
```

- Renamed from Easy Edits: the old `easy-edits` command still works as an alias for one release, and so do the old
  `EASY_EDITS_*` env vars and an existing `~/.easy-edits` (the new `AI_VIDEO_EDITOR_*` names win when both are set).

- Run `./install.sh` in the foreground with a long timeout (a first install takes 5-15 min) and wait for it to
  finish before the doctor; don't background it.
- `./install.sh --no-models` skips the Whisper models on a slow connection (they download on the first edit).
- A doctor FAIL: the skill's section 2 has the fix for each line. Fix it, then run `./install.sh` and
  `./install.sh --doctor` again. Never call setup done until doctor prints "doctor: all PASS".
- If `claude -p "say ok"` fails or hangs in this shell, add `--agent none` to every `ai-video-editor` command.

## Run

```sh
ai-video-editor <clean-cut|talking-head|explainer|shorts|captions> <video-or-url> -o <out-dir> [--format 9x16|1x1|16x9|all]
```

- With no mode, `ai-video-editor <video> -o out/` makes the approved clean cut. The user doesn't need to give
  instructions; only ask when the mode or the output format is genuinely unclear.
- `--format`: `9x16` (the default), `1x1`, `16x9`, or `all` (all three; file names then end in `_<fmt>`).
- Pass `--speaker` / `--role` only with names the user gave you. Never guess a person's name.
- `--agent none` keeps AI Video Editor from calling `claude` / `codex` itself; `--no-review` gives the deterministic clean cut.
- Renders take minutes. For long runs, start them in the background with a log file and poll the log:
  `nohup ai-video-editor ... > out/run.log 2>&1 &`.
- Exit codes: 0 done, 1 a delivery FAIL (file written), 2 refused, 3 waiting for assets (`new` / `resume`), 5 no
  usable final file in the `-o` folder. `<out>/.work/` holds intermediates, never the result. Keep the exit status
  (don't pipe into `tail`); 137 / 143 means the command was killed before it finished: re-run it.
- URL input: only for videos the user owns or has the rights to edit.

### The modes

```sh
ai-video-editor clean-cut talk.mp4 -o out/                    # same as `ai-video-editor talk.mp4 -o out/`: fillers, dead air, slips out
ai-video-editor clean-cut talk.mp4 -o out/ --no-review        # deterministic cut, no agent review
ai-video-editor talking-head talk.mp4 -o out/ --format all --speaker "Ana Cruz" --role "Founder"   # motion design
ai-video-editor talking-head talk.mp4 -o out/ --plan-only     # stop after planning; edit the plan, re-run with --plan FILE
ai-video-editor explainer screen-recording.mp4 -o out/ --script script.md                         # cards, diagrams, zooms
ai-video-editor captions talk.mp4 -o out/ --format 16x9       # captions only (burned + .srt / .vtt), no cuts
```

Shorts are two steps, propose then pick (same video, same `-o` folder, so the transcript is reused):

```sh
ai-video-editor shorts podcast.mp4 -o out/ --propose          # out/PROPOSALS.txt + proposal_<n>_*_preview.mp4, then stop
ai-video-editor shorts podcast.mp4 -o out/ --pick 1,3 --hook  # render the user's picks: out/short_<n>_<slug>.mp4
```

Show the user each proposal's rank, score, timestamps, hook line and reason, and let them pick. Steer with
`--clips N`, `--range 12:00-20:00`, `--min` / `--max` seconds, `--notes`. Rendered clips are logged as used
(`--reset-used` clears that). Propose on a long video is slow on a CPU (an 87-minute video took ~35 minutes).

### Style packs (v1.3.0)

A style pack is one JSON file (palette, fonts, caption look, transitions, number treatment, signature move, pacing,
allowed scenes, sound) checked against `ai-video-editor/styles/pack.schema.json`. Built-in: `punch` (loud creator
shorts), `broadsheet` (calm editorial), `terminal` (dark tech). Use one only when the user asks for a style or a
look that matches one:

```sh
ai-video-editor style list                                    # built-in packs + yours (~/.ai-video-editor/styles/<id>.json)
ai-video-editor style validate my-pack.json                   # every problem, with its path; exit 1 when invalid
ai-video-editor style skill punch                             # writes ~/.claude/skills/ai-video-editor-style-punch/SKILL.md
ai-video-editor talking-head talk.mp4 -o out/ --style broadsheet   # also captions / explainer / shorts (not clean-cut)
```

The renderer refuses (exit 2, nothing rendered) anything the pack doesn't support: a mode or format it doesn't
list, a `--plan` beat type outside its `scenes`, `--hook` / `--speaker` without a hook / lower-third scene, a
missing font. Fix the command; don't edit a built-in pack to get around it. Planner beats the pack doesn't allow,
or that break its pacing, are left out and listed in `report.json` (`styleDropped`).

### Captions: auto contrast and --face

- Captions sample the footage behind them and flip to dark text with a light edge on bright footage (a white
  wall, sky). `report.json` `contrast` counts light / dark captions. `--caption-color auto|white|black|#RRGGBB`
  fixes the colour (not on the approved clean-cut 9:16, which keeps white).
- `--face top|center|bottom` or `--face X,Y` (fractions of the frame, e.g. `0.3,0.4`): use it only when the
  contact sheet shows face detection got it wrong (a poster, a second person, a dark shot). Framing, punch-ins,
  caption placement and pops then use that point. Works in every mode, clean-cut included
  (explainer screen recordings ignore it).

Every export: `ai-video-editor_<mode>_<clip>[_<fmt>].mp4`, a `_sheet.png` contact sheet, `.srt` / `.vtt`,
`ai-video-editor_<mode>_<clip>.report.json`, and a `CREDITS.txt` when music is used.

### Make a video from a brief (`ai-video-editor new`)

```sh
ai-video-editor new <explainer-cited|presenter|podcast|story|promo|music-video|other> -o out/x [--brief ".." | --script F | --source F|URL | --brand F --assets DIR | --song F --i-own-this-music]
ai-video-editor new --approve out/x/plan.json          # only after the user has seen PLAN.txt and storyboard.png
ai-video-editor resume out/x                           # after you have generated every asset in GENERATION_MANIFEST.json
```

Images and video clips come from **your own built-in image/video generation** (the default `host` backend);
voice from the local TTS. Hosted APIs are opt-in only (`--backend NAME`, set up by the user: `ai-video-editor/gen/BACKENDS.md`).

1. Plan: `new` writes plan.json, PLAN.txt and storyboard.png and generates nothing. Show the user PLAN.txt
   (generation count, cost, wall time, host assets, "will send" lines) and storyboard.png. After editing plan.json,
   run `ai-video-editor new repin plan.json` and show it again.
2. Approve only when the user says so: `--approve`. With images or video to make it exits **3** and writes
   `GENERATION_MANIFEST.json` in the output folder (id, type image|video, prompt, durationSec, aspect,
   referenceImages, firstFrame, file). Exit 3 is "waiting for assets", not a failure.
3. Generate each asset with your built-in generation from its prompt (use referenceImages / firstFrame when set) and
   save it at its `file` (relative to the output folder; PNG/JPEG images, MP4 video).
4. `ai-video-editor resume <out>`: checks the approved plan's hash and the assets (exit 3 + the list while any are
   missing), then finishes the edit, captions, QA, report.json, REVIEW.txt and DELIVERY.json.
5. Deliver: relay REVIEW.txt's WEAK SHOTS lines as written and every FAIL. POST_DRAFT.txt is a draft for the user;
   never post it, never publish anything.

- Finish: social -14 LUFS / -1.5 dBTP, podcast -16 LUFS / -1.5 dBTP, video BT.709. Generated clips' own ambient audio
  is dropped under narration or a song, -18 dB under music, kept when alone (`--clip-audio keep|duck|drop`).
- Presenter with the user's own face or voice: only with a consent record they created as the subject
  (`ai-video-editor consent create ... --i-am-the-subject`, docs/CONSENT.md). Never a third party or a public figure.
- `--i-own-this-music` only when the user has said they own or licensed the track.

## Talking with the user

The user may never have used a terminal: you run everything (install included) and they chat and tap. The skill's
section 0 has the details: the plain-English -> mode table, the choice cards, progress lines and error cards.

- **Always attach the finished video(s), the `.srt` and the contact sheet to the chat. Never reply with only a path.**
- Plain words, one sentence per step. Never show flags, subcommands, file paths, exit codes or raw errors.
- Every decision is a tap-to-pick choice card with the recommended option first (what to make, shape, hook line,
  kind of new video, which shorts, "Look good?", "What's next?").
- Shorts pick cards come from `<out>/proposals.json` (`id`, `start`, `end`, `durationSec`, `hook`, `hookCard`,
  `previewPath` per candidate; written by `--propose`).
- Before a full captions / clean-cut / talking-head render, `--preview` makes about 20 s (from the first speech to a pause) into `<out>/preview/`
  (exit 0) to show first.

## Review (your main job)

1. Open every `*_sheet.png` contact sheet and look at faces, captions, cards and crops.
2. Read `report.json`: the delivery check, caption overlaps, the plan and any dropped beats (with `--style`: `style`,
   `transitions`, `signatures`, `styleDropped`; always: `contrast`, and `face` when `--face` was used).
3. The CLI exits 1 when any export has a delivery FAIL, even though the mp4 was written. Report every FAIL to the
   user with its check text. Some FAILs are known false alarms (KNOWN_ISSUES.txt), but say so and explain why;
   never hide a FAIL or call a FAIL run "done".
4. To steer the graphics: `--plan-only`, edit the plan JSON it prints (schema at the top of
   `ai-video-editor/engine/plan.mjs`; anchors are exact transcript phrases), then re-run with `--plan FILE`.
5. To review a clean cut yourself: see "Agent review" in `docs/AGENTS_GUIDE.md`.

## Rules

- Never upload, post or publish anything, and never send media to an online service, unless the user explicitly
  asks you to.
- Keep the user's media, renders, `cookies.txt` and private presets (`--preset FILE`) outside the repo or in
  gitignored folders (`out/`, `renders/`, `video-projects/`, `raw-media/`). Never commit them.
- Don't print secrets or cookies.
- Music comes only from Openverse (CC0 / CC BY) at render time. Keep the `CREDITS.txt` written next to each export
  with the video.
- Code changes: AI Video Editor code lives in `ai-video-editor/` (CLI in `ai-video-editor/cli/main.mjs`, modes in `ai-video-editor/modes/`, shared
  stages in `ai-video-editor/engine/`). Run `npm test` after a change. `ai-video-editor/README.md` is the technical reference.

# Easy Edits: guide for AI agents

`AGENTS.md` and `CLAUDE.md` have the same content; keep them in sync.

Easy Edits edits talking-head video from one command. You drive the CLI and use judgement; Easy Edits does the cutting,
captions, graphics and rendering. Built on Herk Edit Kit by Nate Herk.

Claude Code: the full step-by-step flow (install, fix doctor FAILs, first run, shorts, review) is the repo skill
`.claude/skills/easy-edits/SKILL.md`. When the user says "set up Easy Edits" (or runs `/easy-edits`), follow it. This
folder is already an Easy Edits checkout, so skip the skill's `git clone` and run everything from here.

## Setup (once per machine, then once per shell)

```sh
./install.sh              # idempotent; downloads Node 22, a Python venv, ~2 GB of Whisper models, Chrome, a font
./install.sh --doctor     # PASS/FAIL per dependency; must end with "doctor: all PASS"
. ~/.easy-edits/env.sh    # every new shell: puts easy-edits, Node 22 and the venv python on PATH
easy-edits --help
```

- `./install.sh --no-models` skips the Whisper models on a slow connection (they download on the first edit).
- A doctor FAIL: the skill's section 2 has the fix for each line. Fix it, then run `./install.sh` and
  `./install.sh --doctor` again. Never call setup done until doctor prints "doctor: all PASS".
- If `claude -p "say ok"` fails or hangs in this shell, add `--agent none` to every `easy-edits` command.

## Run

```sh
easy-edits <clean-cut|talking-head|explainer|shorts|captions> <video-or-url> -o <out-dir> [--format 9x16|1x1|16x9|all]
```

- With no mode, `easy-edits <video> -o out/` makes the approved clean cut. The user doesn't need to give
  instructions; only ask when the mode or the output format is genuinely unclear.
- `--format`: `9x16` (the default), `1x1`, `16x9`, or `all` (all three; file names then end in `_<fmt>`).
- Pass `--speaker` / `--role` only with names the user gave you. Never guess a person's name.
- `--agent none` keeps Easy Edits from calling `claude` / `codex` itself; `--no-review` gives the deterministic clean cut.
- Renders take minutes. For long runs, start them in the background with a log file and poll the log:
  `nohup easy-edits ... > out/run.log 2>&1 &`.
- URL input: only for videos the user owns or has the rights to edit.

### The modes

```sh
easy-edits clean-cut talk.mp4 -o out/                    # same as `easy-edits talk.mp4 -o out/`: fillers, dead air, slips out
easy-edits clean-cut talk.mp4 -o out/ --no-review        # deterministic cut, no agent review
easy-edits talking-head talk.mp4 -o out/ --format all --speaker "Ana Cruz" --role "Founder"   # motion design
easy-edits talking-head talk.mp4 -o out/ --plan-only     # stop after planning; edit the plan, re-run with --plan FILE
easy-edits explainer screen-recording.mp4 -o out/ --script script.md                         # cards, diagrams, zooms
easy-edits captions talk.mp4 -o out/ --format 16x9       # captions only (burned + .srt / .vtt), no cuts
```

Shorts are two steps, propose then pick (same video, same `-o` folder, so the transcript is reused):

```sh
easy-edits shorts podcast.mp4 -o out/ --propose          # out/PROPOSALS.txt + proposal_<n>_*_preview.mp4, then stop
easy-edits shorts podcast.mp4 -o out/ --pick 1,3 --hook  # render the user's picks: out/short_<n>_<slug>.mp4
```

Show the user each proposal's rank, score, timestamps, hook line and reason, and let them pick. Steer with
`--clips N`, `--range 12:00-20:00`, `--min` / `--max` seconds, `--notes`. Rendered clips are logged as used
(`--reset-used` clears that). Propose on a long video is slow on a CPU (an 87-minute video took ~35 minutes).

Every export: `easy-edits_<mode>_<clip>[_<fmt>].mp4`, a `_sheet.png` contact sheet, `.srt` / `.vtt`,
`easy-edits_<mode>_<clip>.report.json`, and a `CREDITS.txt` when music is used.

## Review (your main job)

1. Open every `*_sheet.png` contact sheet and look at faces, captions, cards and crops.
2. Read `report.json`: the delivery check, caption overlaps, the plan and any dropped beats.
3. The CLI exits 1 when any export has a delivery FAIL, even though the mp4 was written. Report every FAIL to the
   user with its check text. Some FAILs are known false alarms (KNOWN_ISSUES.txt), but say so and explain why;
   never hide a FAIL or call a FAIL run "done".
4. To steer the graphics: `--plan-only`, edit the plan JSON it prints (schema at the top of
   `easy-edits/engine/plan.mjs`; anchors are exact transcript phrases), then re-run with `--plan FILE`.
5. To review a clean cut yourself: see "Agent review" in `docs/AGENTS_GUIDE.md`.

## Rules

- Never upload, post or publish anything, and never send media to an online service, unless the user explicitly
  asks you to.
- Keep the user's media, renders, `cookies.txt` and private presets (`--preset FILE`) outside the repo or in
  gitignored folders (`out/`, `renders/`, `video-projects/`, `raw-media/`). Never commit them.
- Don't print secrets or cookies.
- Music comes only from Openverse (CC0 / CC BY) at render time. Keep the `CREDITS.txt` written next to each export
  with the video.
- Code changes: Easy Edits code lives in `easy-edits/` (CLI in `easy-edits/cli/main.mjs`, modes in `easy-edits/modes/`, shared
  stages in `easy-edits/engine/`). Run `npm test` after a change. `easy-edits/README.md` is the technical reference.

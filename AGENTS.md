# Easy Edits: guide for AI agents

`AGENTS.md` and `CLAUDE.md` have the same content; keep them in sync.

Easy Edits edits talking-head video from one command. You drive the CLI and use judgement; Easy Edits does the cutting,
captions, graphics and rendering. Built on Herk Edit Kit by Nate Herk.

## Setup (once per machine, then once per shell)

```sh
./install.sh            # idempotent; ./install.sh --doctor must print "doctor: all PASS"
. ~/.easy-edits/env.sh     # every new shell: puts easy-edits, Node 22 and the venv python on PATH
easy-edits --help
```

## Run

```sh
easy-edits <clean-cut|talking-head|explainer|shorts|captions> <video-or-url> -o <out-dir> [--format 9x16|1x1|16x9|all]
```

- With no mode, `easy-edits <video> -o out/` makes the approved clean cut. The user doesn't need to give
  instructions; only ask when the mode or the output format is genuinely unclear.
- Pass `--speaker` / `--role` only with names the user gave you. Never guess a person's name.
- `--agent none` keeps Easy Edits from calling `claude` / `codex` itself; `--no-review` gives the deterministic clean cut.
- Renders take minutes. For long runs, start them in the background with a log file and poll the log.
- URL input: only for videos the user owns or has the rights to edit.

## Review (your main job)

1. Open every `*_sheet.png` contact sheet and look at faces, captions, cards and crops.
2. Read `report.json`: the delivery check, caption overlaps, the plan and any dropped beats.
3. Report every FAIL to the user with its check text. Some FAILs are known false alarms (KNOWN_ISSUES.txt), but
   say so and explain why; never hide a FAIL or call a FAIL run "done".
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

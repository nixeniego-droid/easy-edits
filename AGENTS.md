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

- Run `./install.sh` in the foreground with a long timeout (a first install takes 5-15 min) and wait for it to
  finish before the doctor; don't background it.
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

### Style packs (v1.3.0)

A style pack is one JSON file (palette, fonts, caption look, transitions, number treatment, signature move, pacing,
allowed scenes, sound) checked against `easy-edits/styles/pack.schema.json`. Built-in: `punch` (loud creator
shorts), `broadsheet` (calm editorial), `terminal` (dark tech). Use one only when the user asks for a style or a
look that matches one:

```sh
easy-edits style list                                    # built-in packs + yours (~/.easy-edits/styles/<id>.json)
easy-edits style validate my-pack.json                   # every problem, with its path; exit 1 when invalid
easy-edits style skill punch                             # writes ~/.claude/skills/easy-edits-style-punch/SKILL.md
easy-edits talking-head talk.mp4 -o out/ --style broadsheet   # also captions / explainer / shorts (not clean-cut)
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

Every export: `easy-edits_<mode>_<clip>[_<fmt>].mp4`, a `_sheet.png` contact sheet, `.srt` / `.vtt`,
`easy-edits_<mode>_<clip>.report.json`, and a `CREDITS.txt` when music is used.

## Review (your main job)

1. Open every `*_sheet.png` contact sheet and look at faces, captions, cards and crops.
2. Read `report.json`: the delivery check, caption overlaps, the plan and any dropped beats (with `--style`: `style`,
   `transitions`, `signatures`, `styleDropped`; always: `contrast`, and `face` when `--face` was used).
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

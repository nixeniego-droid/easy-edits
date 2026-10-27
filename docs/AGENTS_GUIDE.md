# AI Video Editor agents guide

How to drive AI Video Editor from an AI agent (Claude Code, Codex, Cursor, or anything with a shell). The short
rules are in [AGENTS.md](../AGENTS.md); the per-agent start steps are in the root [README.md](../README.md).

## The CLI loop (any agent)

```sh
. ~/.ai-video-editor/env.sh
ai-video-editor <clean-cut|talking-head|explainer|shorts|captions> input.mp4 -o out/ [--format 9x16|1x1|16x9|all] [--notes "..."]
```

1. Pick the mode. Pass only what you know: `--speaker` / `--role` only when the user told you the name,
   `--title`, `--notes`.
2. Run it. A 30 s clip takes a few minutes; long sources take longer. Run long jobs in the background with a log
   (`nohup ai-video-editor ... > ai-video-editor.log 2>&1 &`) and poll the log.
3. Review: open each `_sheet.png`, read `report.json` (delivery check, caption overlaps, plan, dropped beats).
4. Report: list each output file and every FAIL with its check text. A FAIL is a fault to report, not to hide.

### Steering the graphics (talking-head, explainer)

```sh
ai-video-editor talking-head talk.mp4 -o out/ --plan-only        # prints the plan path and stops
# edit out/ai-video-editor_talking-head_<clip>.plan.json (schema at the top of ai-video-editor/engine/plan.mjs;
# anchors are exact transcript phrases)
ai-video-editor talking-head talk.mp4 -o out/ --plan out/ai-video-editor_talking-head_<clip>.plan.json
```

The plan a run used is pinned per source (`~/.ai-video-editor/plans/`), so re-runs are deterministic. `--replan` plans
again.

### Shorts

```sh
ai-video-editor shorts podcast.mp4 -o out/ --propose              # PROPOSALS.txt + previews; show them to the user
ai-video-editor shorts podcast.mp4 -o out/ --pick 1,3 --hook      # render the user's picks
```

Let the user pick. After each render check the start and end of the clip, the cut and the contact sheet
(see KNOWN_ISSUES.txt for faults the delivery check doesn't catch).

## Agent review of a clean cut

The clean cut's optional review step is the only part that needs judgement. Three ways:

| Review | Flag | Who |
| --- | --- | --- |
| none (the deterministic cut) | `--no-review` | any agent, or a plain terminal |
| headless Claude Code (`claude -p`, ~10 s) | default when `claude` is installed | needs `claude` on PATH and logged in |
| **you, the agent, review the cut** | `--review-only`, then `--review-patch FILE` | any agent with a shell |

Agent review, with the lower-level clean-cut script (9:16):

1. `ai-video-editor/bin/clean-cut.sh talk.mp4 work/talk out/talk.mp4 --review-only` stops after the cut and prints the
   path of `work/talk/assets/cut-review.md` (word table: index, word, times, keep / cut and why).
2. Read it against the rules in `ai-video-editor/styles/clean-cut/brief-clean.md` and write a patch JSON:
   `{"keep":[i],"remove":[i],"text":{"i":"word"},"notes":"why"}`. Whole words only; `text` fixes a caption and
   never moves a cut. `{}` means no change.
3. Run `ai-video-editor talk.mp4 -o out/ --review-patch patch.json` (or the same `clean-cut.sh` command with
   `--review-patch patch.json` instead of `--review-only`).
4. Show the user the output and the check summary. Don't deliver a FAIL without saying so.

`ai-video-editor/bin/clean-cut.sh --help` lists every flag; `--dry-run` prints each phase command.

## Notes per agent

- **Claude Code** reads `CLAUDE.md` automatically. AI Video Editor itself calls `claude -p` for the motion plan and the
  clean-cut review when `claude` is installed (`--agent none` / `--no-review` turn that off).
- **Codex** reads `AGENTS.md` automatically. AI Video Editor plans with `codex exec` when `claude` is not installed.
- **Cursor**: use Agent mode (it needs the terminal) and add `@AGENTS.md` to the chat.
- **Other agents**: give it a shell with the repo, then the CLI loop above. `--agent none` avoids
  needing another agent CLI on that machine.

## Safety

- Never upload, post or publish without the user's explicit go-ahead.
- `ai-video-editor/bin/edit.sh` without `--style` (experimental) runs Claude Code with `--permission-mode
  bypassPermissions`: unattended shell access. Use it only in a VM, a container or a throwaway checkout.
- Keep `cookies.txt`, private presets and the user's media out of the repo.

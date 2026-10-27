---
description: Set up AI Video Editor (install, doctor) and make a first quick edit
argument-hint: "[video file]"
---

Use the `ai-video-editor` skill (`.claude/skills/ai-video-editor/SKILL.md`) and follow its getting-started flow in this
checkout (it is already cloned, so skip the `git clone`):

1. Section 1: run `./install.sh` in the foreground (long timeout; wait for it to finish), then
   `. ~/.ai-video-editor/env.sh`, then `./install.sh --doctor`.
2. Section 2: fix every doctor FAIL with the fix in the table, re-run `./install.sh` and `./install.sh --doctor`
   until it ends with "doctor: all PASS". Check the picker agent (`claude -p "say ok"`); use `--agent none` if it fails.
3. Section 3: the quick first run on the user's video: $ARGUMENTS
   If no video was given, ask the user for one (only a video they own or have the rights to edit). Then read the
   result as section 3 says, even if the command exits 1: the report.json, KNOWN_ISSUES.txt and the contact sheet.

Tell the user what passed, every FAIL with its text, and where the outputs are. Never upload or publish anything.

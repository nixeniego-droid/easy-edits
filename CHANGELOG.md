# Changelog

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

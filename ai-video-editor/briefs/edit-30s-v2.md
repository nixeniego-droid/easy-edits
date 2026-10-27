# Edit: `{{PROJECT}}` (9:16, ~30 s)
<!-- ai-video-editor: v2 (Europa v2 setup, diagnosis approved: kit-led, fault-only gates, top box opt-in) -->

## Goal
Turn this talking-head clip into a short a top editor would post: Reels / Shorts, general audience.
By second 3 the viewer knows the subject; by the end they feel the point (and laugh if the line is a joke).
Approval is given for everything below. No uploads, no paid calls, no new transcription. Don't stop for review.

## Source facts
- Source `{{SOURCE}}`; word transcript `{{TRANSCRIPT}}` (`{words:[{text,start,end,type}]}`, source time).
- Prep facts in `{{PREP}}/`: source-prep.json + source-prep-sheet.png (scenes, face boxes, crops) and
  source.cut-candidates.{json,md} (stutters / restarts). Look at the footage yourself whenever framing needs it.
- Project `{{PROJECT}}` (new; build it from scratch, do not copy other projects). Render the composition to `{{OUT}}`.
- Trusted name spellings: `{{NAMES}}`.

## Follow the kit (it is the creative lead)
Read `CLAUDE.md`, `.claude/skills/short-form-edit/SKILL.md`, `docs/EDITING-PLAYBOOK.md`, `docs/SHORT-FORM.md`,
`.claude/skills/cut-silences/` and `.claude/skills/cut-mistakes/`, and the SFX guidance in
`.claude/skills/motion-showreel/`. Read any other kit doc or skill they point to. Run their workflow end to end.

## DESIGN.md first
Before building, write `{{PROJECT}}/DESIGN.md`: the story arc (hook -> turn -> payoff); 3 openings considered and
why 2 were rejected; one story colour that links the beats; a per-beat table
`time | words | format | graphic idea | why`; and a "what not to do" list. If DESIGN.md already exists (an
`edit.sh --plan-only` run), build from it: keep its plan, revise only what your drafts prove wrong.

## Layout palette (choose per beat)
- in-frame graphic beside the speaker | full-frame idea card | punch-in | clean footage
- top box (top-square split illustration): ONLY for a process, a comparison or a scene. For each top-box beat
  give a one-line reason naming which (DESIGN.md row, or `topBoxWhy` on the plan.json scene). Never the default.

## Graphics
Draw the idea being said: objects, actions, metaphors (a craft unfolding on "massive", a hug that fails), not
generic labels, checklists or icon rows. Graphics follow relevance, not rate: use them confidently where the line
has a concept, number, list, name or key point; let shots breathe when the speaker carries it.
Captions: `ai-video-editor/presets/captions-default.{json,mjs}` (+ captions-layout.mjs), one consistent style, off the
face, chin and head, and clear of the graphics.
Optional palette / grade / type guidance: `{{LOOK}}` (a suggestion; your DESIGN.md decides).

## Sound
SFX tied to on-screen events (`ai-video-editor/audio/sfx-synth.mjs`, free / synth only); most cuts pass silently.
No music bed unless the kit's workflow adds one. Master -14 LUFS (edit.sh runs `ai-video-editor/audio/master.mjs` in post).

## Iterate
Draft, review your own frames (contact sheet + hero frames + transition boundaries) and the audio joins, revise.
No round limit. Fix what you see before the final.

## Fault checks
After your final render edit.sh runs fault-only gates: name-guard, verbatim-guard + verbatim-final +
caption-cover, cut-guard, disfluency, dead-air, caption-face + caption-face-final (captions and cards vs face /
chin / head), text-style --one-caption, caption-size, readability, panel-contrast, layout-jump --flash-only,
grade-continuity, final-fresh, edl-order, kinetic-dup, sfx-audible, room-tone (ambience continuous under every join: 20-40 ms crossfades, no silence or clicks), top-box-justified, delivery / loudness
(scripts in `ai-video-editor/check/` and `ai-video-editor/tools/`). Run the ones that help you before the final. Fix faults; never
change a creative choice just to pass a gate.

## Deliver
`{{OUT}}` (composition render; edit.sh posts it), `{{PROJECT}}/DESIGN.md`, and `{{PROJECT}}/VERIFY.md` with the
frames, gate results and audio evidence. Report duration and what you checked.

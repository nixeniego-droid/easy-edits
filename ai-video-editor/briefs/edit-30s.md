# AI Video Editor brief: ~30 s talking-head short (one-shot)

<!-- Operator: replace the placeholders, then run headless with the watchdog, e.g.
     node ai-video-editor/bin/claude-watchdog.mjs --prompt-file brief.filled.md --log {{PROJECT}}/watchdog.log -- \
       --permission-mode bypassPermissions
     After it finishes:  node ai-video-editor/post.mjs {{OUT}}   (writes {{OUT}} with .post.mp4; see the end). -->

Edit `{{SOURCE}}` into a finished vertical short (1080x1920, 30 fps, ~25-30 s). The transcript is
`{{TRANSCRIPT}}` (word-level `{words:[{text,start,end,type}]}`, source time). Work in `{{PROJECT}}`
(repo-relative `video-projects/<slug>/`; create it with `npm run new-video -- <slug>` if it does not exist).
Write the composition render to `{{OUT}}`. Approval is given for everything below. No uploads, no paid calls,
no new transcription (reuse `{{TRANSCRIPT}}`).
Do not copy or read other video-projects except the worked example ai-video-editor-full-30s (pattern only) and the
may-shorts compositions listed under "Read these" (treatment only); build this project from scratch. Copying a
project made from the same source fails the run (`fresh FAIL`).

## Speed rules

Budget: 7 minutes wall clock for the whole edit. Run `date` at the start and before every render.

- Read only the files listed under "Read these". Do not read the other kit docs (README, docs/WORKFLOW.md,
  MOTION_PHILOSOPHY.md, the other skills, style-library) or the CHANGELOG.
- The source is already measured: read `{{PREP}}/source-prep.json` and look once at
  `{{PREP}}/source-prep-sheet.png` (see "Source facts"). Do not re-probe the source: no ffprobe, contact sheets,
  scene detection or frame grabs of the raw file. Trust its scene kinds, face boxes and crops unless a draft
  frame shows a problem.
- Make one plan and build it. Write `scripts/build.mjs` in ONE Write call; fix it with Edit, never rewrite it.
- Run lint + preflight + validate-plan + validate-footage + name-guard once before draft1 and once before the
  final.
- Review draft1 with the sheet `gates.mjs` writes (`--sheet`), then extract frames only where the sheet or gates
  flag an issue. At most 8 frame looks in the whole edit.
- Redraft only when it is needed (see "Verify and render"); otherwise render the final straight from the reviewed
  draft plan.
- Render the final exactly once.
- Do not write docs, changelog entries, or READMEs during the edit. Keep VERIFY.md to a short evidence list.
- Do not run the post stage (lead-in, loudness, delivery check). The operator runs `ai-video-editor/post.mjs` afterwards.
- Run long commands once. Do not poll them.

## Read these (and nothing else unless something breaks)

1. `.claude/skills/short-form-edit/SKILL.md` for the workflow. Its plan schema is
   `.claude/skills/short-form-edit/references/plan-schema.md`.
2. The worked example to copy: `video-projects/ai-video-editor-full-30s/`
   - `scripts/build-edl.mjs`: a reviewed source-time EDL rendered from the raw file in one ffmpeg pass
   - `scripts/build.mjs`: builds plan.json, mix.wav (voice + synth SFX) and index.html from the retimed
     transcript, using split/face/punch layouts, per-layout captions and SVG/GSAP panels
   - `index.html`, `DESIGN.md`, `assets/plan.json`, `VERIFY.md`: the output shapes
   Copy its pipeline, not its layout mix (it is split-heavy). For in-frame graphics copy these (1080x1920):
   - face + floating chips: `video-projects/may-shorts-18/compositions/scene2-not-hype.html` (pills over the
     head), `video-projects/may-shorts-19/compositions/scene6-only-ones.html` (tag + terminal chip)
   - kinetic type: `video-projects/may-shorts-18/compositions/scene5-too-late.html` (SWITCH. / TOO LATE.),
     `video-projects/may-shorts-19/compositions/scene3-pointless.html` (COOL / POINTLESS)
   - split for a list: `video-projects/may-shorts-18/compositions/scene3-three-wins.html`
   Read them for treatment and motion only; keep generating everything inline from `build.mjs`.
3. AI Video Editor modules (import them, do not reimplement them):
   - captions: `ai-video-editor/presets/captions-default.mjs` (+ `.json`) and `ai-video-editor/presets/captions-layout.mjs`
     (`layoutCaptions`, `layoutCaptionHtml`, `captionOverlaps`)
   - SFX: `ai-video-editor/audio/sfx-synth.mjs` (synth kit + `mixSfx`, house levels in `HOUSE`)
   - gates: `ai-video-editor/tools/gates.mjs <video> <project>`
4. Cut tools: `.claude/skills/cut-silences/scripts/cut-silences.mjs`, then
   `.claude/skills/cut-mistakes/scripts/find-cut-candidates.mjs` on the retimed transcript.

## Source facts (`{{PREP}}/source-prep.json`)

`ai-video-editor/tools/source-prep.mjs` measured the source before you started:

- `source`: duration, fps, size, aspect. `head`: title-card / flash frames at the start; begin the EDL at or after
  `head.cleanFrom`, or cover that span with a graphic.
- `scenes[]`: `start`/`end` in source time, `kind` (`speaker` / `cutaway` / `screen-recording` / `title-card` /
  `flash`; `camera` when no face detector was available), `face.box` `[x,y,w,h]` in source px, `crop` (9:16 window
  in source px) and `cover1080x1920` (`{scale,x,y}`: scale the source by `scale` from its top-left corner, then
  translate by `x`,`y` output px to fill 1080x1920 with that crop). Use these for face framing and push-ins, and
  keep chips off `face.box`. `face.alwaysInCrop: false` means the speaker drifts out of the crop in that scene.
- `events[]` (screen recordings only): each on-screen change with its `box`, `kind`, the words `said` around it
  and `zoom` `{x,y,w,h,scale}`: the recommended crop of the active area (region of change plus margin, source
  aspect, at most 2.5x) in source px.
- `summary.notes`: anything unusual (low speaker share, several faces, no face detector).
- The sheet shows one tile per scene: yellow box = the 9:16 crop, cyan box = the face.

## Layout per shot

Choose each scene's layout from what that line says, not by habit. Stock kinds only:

| Kind | plan `layout` / caption Y | Use for |
| --- | --- | --- |
| face + overlays | `face` / face | Default. Full speaker plus 1-2 floating elements: keyword pill or tag, callout or pointer, a lower-third name card on the intro, chips that pop in near the face, never over it. |
| kinetic type | `paper` / punch | The punchline or the number: one to three big words or a big numeral full-frame (kinetic, stacked-words, type-scale). Keep the type above y 1150 so captions stay clear. |
| punch | `punch` / punch | Speaker push-in for a conviction line. |
| split | `split` / split | Only when a diagram, process or comparison needs the space. |
| source B-roll | `broll` / punch | Only if the source has its own cutaways: show them full-frame with captions (`assets/<kind>.mp4` = that span of the clip), or cut back to the speaker. |

`layoutCaptions` knows only face/punch/split, so pass it the caption Y column above.

Rules:
- Split covers at most ~40% of the runtime. Use at least 3 different kinds. The speaker is on screen
  (face, punch, split) for at least ~50% of the runtime.
- Never two split scenes in a row without a face beat between them.
- Never put a drawn panel above the source's own B-roll (no `broll-split` on source footage).
- Proper names on screen (person, place used as a name, organisation) in a name chip, lower-third, label or
  kinetic word must be spelled exactly as in a trusted source: the names file `{{NAMES}}` (`none` = no file),
  the source's own on-screen text that you read in a frame (a title card or super), or the user's notes. An ASR
  spelling is not a trusted source: the transcript said "Mayor Lenny" for Leni Robredo and "Dahlia" for Dalia
  Kirschbaum. If the only spelling is the ASR one, leave the chip out. Record each name you read on screen in
  `assets/names-verified.txt` as `Name | where you read it` (e.g. `Dalia Kirschbaum | source title card 0.2 s`),
  then apply the names list to `assets/transcript.json` (replace each ASR spelling with the trusted one) BEFORE
  writing captions: captions and kinetic text use the trusted spelling too. name-guard FAILs any near-miss
  (edit distance <= 2 or same sound) of a trusted name in any visible text, captions included.
- Words on screen that stand for speech are verbatim: kinetic words, big type, quote cards and caption-like
  overlays must be a contiguous span of `assets/transcript.json` (case and punctuation aside), word for word:
  "trust" is not "trusted", "tiny ones" is not "small ones". If the transcript wording looks wrong, check the
  audio and show the words as said, or leave the overlay out. Short topic chips may be labels in your own words
  ("HYDROLOGY LAB"), but a chip that quotes speech uses the spoken words. `ai-video-editor/tools/verbatim-guard.mjs .`
  must PASS. Give kinetic text a class or ancestor class `paper`/`kinetic`/`quote`/`stack`/`type` and chips a
  class `chip`/`pill`/`tag`/`label`/`kick`, so the guard reads each one in the right tier.
- One visual language per video: one palette, one type family and one illustration style for panels, chips and
  type. Do not mix flat SVG with photos or 3D renders.
- Screen-recording sources: never put a widescreen desktop capture into a phone mockup (it shrinks the UI to
  unreadable). Frame it in a browser window or laptop frame and crop-zoom to the active area: use each event's
  `zoom` rect (scale the capture by `zoom.scale` and translate so the rect fills the frame's screen), moving the
  zoom with the action, and pull out to the full screen for page-sized changes (`scale` 1).
- Screen-recording sources: retime the screen inside the EDL so each on-screen action lands on the words that
  describe it (the click on "click", the typing on "type", the scroll on "scroll"). Use `events[]` to find each
  action, then trim, freeze (hold a frame) or speed-ramp that screen segment while the voice stays continuous;
  the video track's total length must equal the voice's. Record every retime in `assets/edit-decisions.json`.
- SFX: a soft UI pop (`click2`, `click`, `tap`) on each word / chip entry and a soft swish (`whoosh`,
  `whoosh_low`, `wrap`) on each card / layout entry, mixed with `mixSfx` into `assets/mix.wav`, and the root
  `<audio>` plays `assets/mix.wav` (not `voice.wav`). Levels are set by `mixSfx` relative to the voice peak:
  pops -16 dB, swishes -20 dB, accents (`thud`, `tone`, `shimmer`) -18 dB. A cue's `db` is clamped to within
  2 dB of that (pops -18..-12, swishes -22..-16), so leave `db` out unless you mean it. Every cue goes in
  plan.json `events[]` with its `sfx`. `ai-video-editor/check/sfx-audible.mjs <render> .` must PASS: it fails when the
  planned SFX are not measurable in the render. `ai-video-editor/check/sfx-mix.mjs <render> .` must PASS too: every cue
  sits >= 12 dB under the voice around it and starts on a card / graphic entry (not on a punch-in, a zoom or a cut
  back to the face).
- No stutter or restart left in the speech: `ai-video-editor/check/disfluency.mjs <render>` must PASS (a repeated word
  or 2-3 word phrase heard by >= 2 ASR windows fails).
- Captions never cover the face, chin included. Place them per layout below the chin (face / punch) or on the
  seam (split), from the prep face box ({{PREP}}/source-prep.json `scenes[].face.box`, source px) pushed through
  the transform you give `#spk` / `#spkwrap` in that scene (cover scale and offset, punch scale and origin). On a
  big punch-in where the chin reaches the caption band, lower the caption or ease the punch.
  `ai-video-editor/check/caption-face.mjs <project> --prep {{PREP}}/source-prep.json` must PASS, and on the render
  `ai-video-editor/check/caption-face-final.mjs . <render>` (Haar face + 35% chin + 4% margin per frame) must PASS.
- Keep the source in order: `assets/edit-decisions.json` keeps play in rising `sourceStart`. Opening on a later
  line (a cold-open hook) is allowed only when plan.json says so: `"hook": {"deliberate": true, "reason": "..."}`.
  `ai-video-editor/check/edl-order.mjs .` must PASS.
- One caption size for the whole video: the preset's 100 px Montserrat 900 (`captionCss`), the same in every
  layout. Never shrink captions per layout or per caption; the pop may start small but settles at scale 1. Keep
  groups to the preset's 2 words / 13 chars so they fit the 960 px box. `ai-video-editor/check/caption-size.mjs .`
  must PASS.
- Motion density: a new visual event at least every ~2.5 s, never more than 3.0 s without one: a punch-in or
  zoom, a chip / tag pop, a kinetic word, a layout change. Captions do not count, and a slow drift is not a
  punch. On a long face or punch hold, add a punch-in on a stressed word or a chip on a key noun. Put every
  such beat in plan.json (`scenes[]` start or `events[]` time); `ai-video-editor/check/motion-density.mjs . <render>`
  must PASS.
- One text style per role: captions use ONE font and ONE size; kinetic words use ONE font and at most 2 sizes,
  both from the fixed presets 150 px and 110 px (fit long words by line breaks, not by shrinking).
  `ai-video-editor/check/text-style.mjs .` must PASS.
- Readable groups: every caption group and kinetic word stays settled (full opacity, scale 1) for at least 0.3 s;
  merge a fast pair into the next group rather than flash it. A kinetic stack shows a contiguous spoken phrase,
  never with a word left out mid-phrase. `ai-video-editor/check/readability.mjs .` must PASS.
- In DESIGN.md, list every scene with its layout and a one-line reason, then the split %, speaker % and kinds
  used. Fix the plan before building if a rule fails.

## Plan (one pass)

1. Cuts: run cut-silences, then find-cut-candidates on its retimed transcript. Review each candidate in context;
   intentional repetition stays. Stutters / restarts heard on the source: when `assets/source.cut-candidates.json`
   exists (prep wrote it; also `{{PREP}}/source.cut-candidates.md`), read it and cut every entry in `cuts` (source
   seconds), even when the transcript dropped the repeat: remove the earlier, broken instance and keep the later,
   complete one, with both boundaries snapped to the silence between words. Merge these cuts with the
   cut-silences removals into the one source-time EDL. Record the decisions in `assets/edit-decisions.json`. Build one combined
   source-time EDL and render the clip from the raw file in one ffmpeg pass (as in `build-edl.mjs`). Keep about
   0.2 s of audio before the first word; the post stage adds another 0.2 s. Never mix source and edited times.
   Cut only on word boundaries: every keep starts and ends in the silence between words, never inside a word
   (ASR edges are 20-80 ms off; the first consonant of "Flight" or the onset of "I" goes first). Leave at least
   30 ms between a boundary and the nearest voiced audio of a kept or removed word; when two words run together
   with no gap ("that I", "very small"), cut at the quietest 10 ms between them or keep both.
   `ai-video-editor/tools/cut-guard.mjs <project> --source {{SOURCE}}` checks edit-decisions.json keeps against the source transcript
   and the speech-band audio and must PASS.
2. Design: copy the structure of `ai-video-editor-full-30s/scripts/build.mjs`, with layouts chosen per "Layout per shot".
   Tie every graphic to an exact transcript phrase. Place default-preset captions per layout, and put synth SFX
   on the cuts and reveals. Educational speech gets room to breathe.
3. Build `index.html`. Follow the composition rules in CLAUDE.md: muted video plus sibling audio, one paused GSAP
   timeline registered as `window.__timelines['<id>']`, and no overlapping clips on the same track.

## Verify and render

```bash
cd {{PROJECT}}
npx hyperframes lint .
node ../../scripts/preflight.mjs .            # known root/inline-video data-start false positive is OK
node ../../.claude/skills/short-form-edit/scripts/validate-plan.mjs .
node ../../.claude/skills/short-form-edit/scripts/validate-footage.mjs .
node ../../ai-video-editor/tools/name-guard.mjs . --names {{NAMES}}   # FAIL = a person name not from a trusted source, or a near-miss spelling (captions too)
node ../../ai-video-editor/tools/verbatim-guard.mjs .                  # FAIL = kinetic / quoted text not the spoken words
(cd ../.. && node ai-video-editor/tools/cut-guard.mjs {{PROJECT}} --source {{SOURCE}})  # FAIL = a cut inside a word / through speech
node ../../ai-video-editor/check/caption-size.mjs .                 # FAIL = captions below / off the preset size
(cd ../.. && node ai-video-editor/check/caption-face.mjs {{PROJECT}} --prep {{PREP}}/source-prep.json)  # FAIL = a caption over the face

# draft (intermediates): draft quality, 4 workers
../../ai-video-editor/bin/render.sh draft . renders/draft1.mp4
#   = npx hyperframes render . -o renders/draft1.mp4 --quality draft --workers 4
node ../../ai-video-editor/tools/gates.mjs renders/draft1.mp4 . --sheet renders/draft1-sheet.png
node ../../ai-video-editor/check/sfx-audible.mjs renders/draft1.mp4 .   # FAIL = planned SFX not audible in the render
node ../../ai-video-editor/check/motion-density.mjs . renders/draft1.mp4  # FAIL = > 3.0 s without a visual event
node ../../ai-video-editor/check/caption-face-final.mjs . renders/draft1.mp4  # FAIL = a caption inside face + chin on the frames
node ../../ai-video-editor/check/readability.mjs .                   # FAIL = a group settled < 0.3 s or a kinetic phrase skipping words
node ../../ai-video-editor/check/text-style.mjs .                    # FAIL = mixed families, >1 caption size, kinetic sizes not <= 2 of 150/110 px
node ../../ai-video-editor/check/sfx-mix.mjs renders/draft1.mp4 .      # FAIL = an SFX too loud or off a card entry
node ../../ai-video-editor/check/disfluency.mjs renders/draft1.mp4     # FAIL = a stutter / repeated phrase still heard
```

Review draft1 once: the gates JSON and its contact sheet (`gates.mjs ... --sheet renders/draft1-sheet.png`).
Extract frames only at flagged spots (max 8 looks total). Blocking issues are: a failed gate, a cropped face,
overflow, unreadable text, a caption over a face or a graphic, and a black flash.

- If there is a blocking issue: fix them all and make ONE redraft (`renders/draft2.mp4`, same command), rerun
  the checks above once, then render the final.
- If there is none: render the final straight from the reviewed draft plan, with no changes and no draft2.
  List non-blocking nits as open issues in the reply instead of fixing them.

Render the final once:

```bash
../../ai-video-editor/bin/render.sh final . {{OUT}}
#   = npx hyperframes render . -o {{OUT}} --quality high --workers 4
```

Loudness in the gates output will be pre-master. That is expected; do not fix it in the composition.

## Done

Reply with: the `{{OUT}}` path, its duration, the cuts made (one line each), each scene's layout with its anchor
phrase, and any open issue. Then stop.

The operator then runs:

```bash
node ai-video-editor/post.mjs {{OUT}}        # lead-in 0.2 s -> loudness master -> delivery check, per-stage timings
```

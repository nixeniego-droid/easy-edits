# Easy Edits brief: ~30 s talking-head short, EMBEDDED style
<!-- easy-edits: kinetic-free -->
<!-- easy-edits: embedded -->

<!-- Operator: replace the placeholders, then run headless with the watchdog, e.g.
     node easy-edits/bin/claude-watchdog.mjs --prompt-file brief.filled.md --log {{PROJECT}}/watchdog.log -- \
       --permission-mode bypassPermissions
     After it finishes:  node easy-edits/post.mjs {{OUT}}   (writes {{OUT}} with .post.mp4; see the end). -->

Edit `{{SOURCE}}` into a finished vertical short (1080x1920, 30 fps, ~25-30 s). The transcript is
`{{TRANSCRIPT}}` (word-level `{words:[{text,start,end,type}]}`, source time). Work in `{{PROJECT}}`
(repo-relative `video-projects/<slug>/`; create it with `npm run new-video -- <slug>` if it does not exist).
Write the composition render to `{{OUT}}`. Approval is given for everything below. No uploads, no paid calls,
no new transcription (reuse `{{TRANSCRIPT}}`).
Do not copy or read other video-projects except the worked example easy-edits-full-30s (pattern only) and the
may-shorts compositions listed under "Read these" (treatment only); build this project from scratch. Copying a
project made from the same source fails the run (`fresh FAIL`).

## Speed rules

Budget: ~20 minutes wall clock for the whole edit (design and iteration need the time). Run `date` at the start and before every render.

- Read only the files listed under "Read these". Do not read the other kit docs (README, docs/WORKFLOW.md,
  MOTION_PHILOSOPHY.md, the other skills, style-library) or the CHANGELOG.
- The source is already measured: read `{{PREP}}/source-prep.json` and look once at
  `{{PREP}}/source-prep-sheet.png` (see "Source facts"). Do not re-probe the source: no ffprobe, contact sheets,
  scene detection or frame grabs of the raw file. Trust its scene kinds, face boxes and crops unless a draft
  frame shows a problem.
- Make one plan and build it. Write `scripts/build.mjs` in ONE Write call; fix it with Edit, never rewrite it.
- Run lint + preflight + validate-plan + validate-footage + name-guard once before draft1 and once before the
  final.
- Review each draft with the sheet `gates.mjs` writes (`--sheet`) and frames at the shot-list times: at most 20
  frame looks in the whole edit.
- At most 3 draft renders. After draft1 always review the frames against the GRAPHICS SHOT LIST and add or
  upgrade elements (see "Verify and render").
- Render the final exactly once.
- Do not write docs, changelog entries, or READMEs during the edit. Keep VERIFY.md to a short evidence list.
- Do not run the post stage (lead-in, loudness, delivery check). The operator runs `easy-edits/post.mjs` afterwards.
- Run long commands once. Do not poll them.

## Read these (and nothing else unless something breaks)

1. `.claude/skills/short-form-edit/SKILL.md` for the workflow. Its plan schema is
   `.claude/skills/short-form-edit/references/plan-schema.md`.
2. The worked example to copy: `video-projects/easy-edits-full-30s/`
   - `scripts/build-edl.mjs`: a reviewed source-time EDL rendered from the raw file in one ffmpeg pass
   - `scripts/build.mjs`: builds plan.json, mix.wav (voice + synth SFX) and index.html from the retimed
     transcript, using split/face/punch layouts, per-layout captions and SVG/GSAP panels
   - `index.html`, `DESIGN.md`, `assets/plan.json`, `VERIFY.md`: the output shapes
   Copy its pipeline, not its layout mix (it is split-heavy; this brief is EMBEDDED, see "Style"). For motion
   reference only (word sync; the look's pops override theirs):
   - `video-projects/may-shorts-18/compositions/scene2-not-hype.html` (elements floating beside the head)
   - `video-projects/may-shorts-18/compositions/scene5-too-late.html` (kinetic words)
   Read them for treatment and motion only; design this script's elements yourself and keep generating
   everything inline from `build.mjs`.
3. Easy Edits modules (import them, do not reimplement them):
   - captions: `easy-edits/presets/captions-default.mjs` (+ `.json`) and `easy-edits/presets/captions-layout.mjs`
     (`layoutCaptions`, `layoutCaptionHtml`, `captionOverlaps`)
   - SFX: `easy-edits/audio/sfx-synth.mjs` (synth kit + `mixSfx`, house levels in `HOUSE`)
   - gates: `easy-edits/tools/gates.mjs <video> <project>`
4. Cut tools: `.claude/skills/cut-silences/scripts/cut-silences.mjs`, then
   `.claude/skills/cut-mistakes/scripts/find-cut-candidates.mjs` on the retimed transcript.
   Dead air: cut EVERY internal pause > 0.15 s. `{{PREP}}/source-prep.json` `gapCuts` lists them (speech-band
   silencedetect on the source, `easy-edits/tools/gap-cuts.mjs`), already snapped to the speech edges with a ~40 ms
   pad kept on both sides; apply them all (only the lead-in and tail stay). `check/dead-air.mjs` FAILs the final on
   any internal silence > 0.15 s between words.

## Source facts (`{{PREP}}/source-prep.json`)

`easy-edits/tools/source-prep.mjs` measured the source before you started:

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

## Style: talking head, EMBEDDED

The speaker is full-frame the whole time (plan `layout` `face`, or `punch` for a push-in). Graphics live in the
frame around the speaker, never replacing or shrinking them:

DEFAULTS (each is checked after the edit; gen-th-style1 failed all of them):

- Pacing: a visual change every 1-1.5 s; no stretch over 2.0 s without one (`motion-density.mjs --max 2.0`).
  Every jump cut is hidden by a punch-in / out: alternate scale 1.0 <-> 1.15-1.25 on the cut frame.
- Shots on the final: a new shot at least every 1.5 s, measured on the rendered frames (`shot-length.mjs --max
  1.5`): a cut, a punch step of 115-125% (smaller zooms are the same shot) or a card / panel / kinetic entry or
  exit. Captions changing do not count. style2c held 8.80-11.29 s (panel up, no punch) and 16.49-18.69 s.
- Linger: no single shot / hold of the speaker longer than ~2.5 s without a cut, a punch-in / out or a reframe
  (look `punchIn.maxHoldS`). The style2b draft lingered at 0:06-0:10 of talk; break such a stretch with a punch
  or reframe on a word, not mid-word.
- LOOK: read `{{LOOK}}` first and follow it EXACTLY; it is the one source for every look value (palette, footage
  grade, kinetic and caption type / stroke / pop / position, the caption band, cards, icons, pills, motion, SFX).
  Copy its values into DESIGN.md and `build.mjs` (read the JSON, do not retype). Bake `grade.ffmpeg` into
  `assets/clip.mp4` in the clip's ffmpeg pass (see `grade.applyAt`): EXACTLY ONCE, in one place (one pass over
  the concatenated clip), never again per segment, never a CSS filter on a wrapper or a second `<video>` copy (the
  shoulder mask copy plays the same graded clip.mp4 with no filter). `easy-edits/check/grade-continuity.mjs . <final>`
  FAILs a clip-to-clip jump in luma (> 6%), saturation (> 12%) or R-B balance (> 0.025), 2 of 3, on the footage
  pixels at keep / camera boundaries. Where any rule below names a color, a pop or a
  caption position, the look file wins. The look file covers: the same `grade.ffmpeg` on every clip with hard cuts only
  (`grade.cuts`), ~72% ink idea panels over the blurred, dimmed live footage, texture visible (`scenes`), the 240 px yellow `iconFrame`, UI cards at ~60% width (`cards.width`,
  `cards.placement`) with a 1.00 -> 1.04 footage push-in under each entrance (`cards.pushIn`), captions to the top 18%
  while a card is low (`captions.whenCardLow`), one yellow key word per caption line, SFX on every card / icon entry,
  and the diagram stagger (`motion.stagger`: people pop, then pills, then the bridge draws left -> right).
- Kinetic system: the look's `kinetic` block (one family, uppercase 1-3 words, white + one yellow key word, ink
  stroke + hard shadow). Kinetic words sit at the look's `kinetic.position` (66-70% height, or the top 18% while a
  card is low) and only inside fixed safe zones clear of the HEAD ZONE. `caption-face-final.mjs` enforces a fixed
  head zone: the punch-normalised median face box, extended +45% upward (forehead / cap), plus 35% chin and a 4%
  frame-width margin. Compute it per scene from {{PREP}}/source-prep.json `scenes[].face.box` (source px) pushed
  through that scene's `#spk` transform (cover scale and offset, punch scale and origin). Text goes in the band
  BELOW the chin (default: the caption band 78-84%). Use the top band ONLY if it clears the head zone (the +45%
  included) at that scene's punch scale; otherwise use a side zone (left / right of face + chin + margin). Never
  put text on the cap or forehead. Write the zone rects per scene in DESIGN.md and keep every kinetic and caption
  box inside one. Never on the face: the final is
  checked frame by frame for every caption AND kinetic word, also during punch-ins (`caption-face-final.mjs`;
  a punch-in grows the face, so the zone must clear the face at the punched scale). Pop per `kinetic.pop`
  (scale 0.90 -> 1.0 over ~4 frames, no overshoot), entering on the word's start, hard cut to the next word.
- Each kinetic word shows ONCE: never the same word in two kinetic blocks, and hide the caption while a kinetic
  word for the same word is on screen (`kinetic-dup.mjs`).
- ONE card on screen at a time with at most 3 list rows / notification items; never a notification or list stack
  (`card-items.mjs <project>` FAILs > 3 items in a card or > 1 card at once; look `cards.maxItems` / `cards.atOnce`).
- Cards: 4-6 big bespoke UI-style mock cards like herk_example, tied to the spoken nouns, NOT clip-art icons: a
  chat bubble, a checklist, a stat card, a profile card, built in HTML/CSS/SVG. ~60% of the frame width
  (594-702 px at 1080 MEASURED ON THE FINAL FRAMES, `card-fill.mjs <project> <final>`; the look's `cards.width`;
  class `card`). Type on cards (`cards.textSize`): headline 44 px, every other run (labels, pills, checklist rows)
  >= 34 px (`card-text.mjs` measures it on the final frames). Lower-middle above the caption or beside the face with
  the card's top edge BELOW THE CHIN LINE at that scene's punch scale, never over the chin / mouth
  (`caption-face-final.mjs` checks every card's measured box); while a card sits low-middle the captions go to the top
  18% only if that clears the head zone, else a side zone. Never in a top corner (`cards.placement`), each with a visible depth cue (a
  layered second card offset 12-16 px behind, a slight offset / tilt, or the shoulder-overlap mask; `cards.depth`),
  styled by the look's `cards` block (white, radius, shadow, ink text, key word on a yellow marker, mono ink icons
  in a yellow circle, ink pills; spring overshoot only here), at most 1 card on screen, each with one small moving detail (a check ticking, a counter
  rolling, typing dots). Typing dots must RESOLVE into a short reply bubble (2-4 words, inside the card's hold);
  dots that never resolve read as a stalled chat, so use no typing bubble at all rather than dots alone. A route
  card (a path / line between places) needs an ink START DOT or a home icon at its origin so the route reads as
  going from somewhere. No static overlays: every card / icon, once settled, keeps subtle life until it exits (a 1-2% float or
  drift, bars rising, a counter, a route drawing; the look's `motion.settledLife`). `overlay-life.mjs` FAILs a card
  whose settled box on the final frames is frozen (mean abs change < 1 level) over any 0.5 s window. At least one card sits partly BEHIND the speaker: the kit has no
  segmentation, so fake the depth with a shoulder mask from `face.box` (a copy of the speaker video above the
  card, clip-path ellipse / rect of the head + shoulder region) and say so in DESIGN.md.
- 2-3 idea beats, NEVER a solid slate (supersedes the earlier full-screen ink scene): an INK (#0E1116) panel at
  ~72% opacity OVER a blurred, dimmed copy of the live footage that keeps playing underneath, with the footage
  texture visibly through. Recipe (the look's `scenes.panel`, proven in a hyperframes render): NO backdrop-filter;
  inside the panel (overflow hidden) a second muted `<video>` of the same clip (its own data-start / data-duration /
  data-track-index, same transform as the speaker) with `filter: blur(8px) brightness(.8); transform: scale(1.08)`,
  clipped to the panel, under `background: rgba(14, 17, 22, 0.72)`. Measured: 85% ink over a 24 px blur (backdrop or
  copy) leaves 15% of a featureless blur and reads OPAQUE (gen_th_style2c); `panel-through.mjs` FAILs it. With 28 px TOP
  corners (`border-radius: 28px 28px 0 0`) when it is not full-bleed; white + yellow elements, pills white with ink
  text. It SLIDES UP from the bottom edge with an ease (`power2.out`, 8-10 frames, 0.27-0.33 s) and exits with the
  same ease reversed (slides back down, `power2.in`; `scenes.enter` / `scenes.exit`). Never a cut, never a hard
  cut to a solid frame.
  Panel text contrast (`scenes.panel.contrast`): every white / yellow text on a panel must reach 4.5:1 (WCAG) against
  the footage behind it on the final frames (`panel-contrast.mjs`). If a text zone over bright footage loses
  contrast, add a soft ink gradient behind THAT text zone only (up to 85% ink); never raise the whole panel.
  Panel icons (`scenes.panel.icons`): icons inside an ink panel sit in ONE row centred horizontally in the panel
  (row centre within 5% of the panel centre), ABOVE the panel's word, each at least 100 px at 1080 wide (default
  ~120 px). Never a bare tiny icon in a corner (`panel-icons.mjs` FAILs it on the final frames).
  `look-check.mjs` FAILs any fully opaque full-frame graphic (any color) and any light full frame / white flash;
  `layout-jump.mjs` FAILs the final on a jump from footage to a solid frame and on any single-frame layout swap that
  is not a source cut under a punch-in. No split, no top square. Otherwise the speaker is always on screen with integrated overlays.
- Ambiguous audio: no kinetic text from a phrase with low transcript confidence or where the delivery ASR hears
  something else. Exception, confirmed by the reviewer (2026-10-17): the talk_30s phrase at ~22 s is "TRUST IN US"
  (the transcript's "trusted us" is the mishearing). TRUST IN US is correct on screen; do not block or rewrite it.
- ONE caption treatment: yellow (#FFD60A) is only the single key-word accent inside the same stroked caption style.
  No captions on solid slates (there are none: idea beats are ~72% ink panels). Kinetic words over an idea panel use
  the IDENTICAL caption treatment (same family, weight, stroke, shadow; white + the one yellow key word), never ink
  text on a marker or an unshadowed variant. `text-style.mjs --one-caption` FAILs a kinetic word whose family,
  weight, text-shadow (stroke) or colour differs from the captions (KINETIC TREATMENT).
- Captions: 2-3 words per group (never one word at a time; a single word only for the key-word hit or the lone
  remaining word of a sentence; never > 3; `readability.mjs --groups` FAILs > 20% one-word groups) and FULL
  verbatim: every spoken word in exactly one caption chunk, in order (`caption-cover.mjs`); kinetic words may be
  keywords but never replace the caption (do not hide the caption under a kinetic hit), in the look's ONE `captions` style, inside its fixed `captions.band` (78-84% height,
  below the kinetic zone; not per layout), no box (no background / padding / radius / border), pop without
  overshoot and hard cut. Every on-screen text that shows spoken words (chips and pills included) counts as a
  caption: the single caption style, or no chip (`text-style.mjs --one-caption`). Labels are ink pills with white
  uppercase text (`cards.pill`) at caption size or inside a card; no small (~24 px) pills outside cards. Clear of
  the face and the graphics. Chin rule (`captions.chinClear`): per scene, when face.box + 35% chin + 4% margin
  (at the punched-in scale) reaches the caption band, ease the punch first; move that scene's captions to the top
  18% only if the top band clears the head zone (+45% upward for forehead / cap) at that punch scale, else to a
  side zone. Never on the cap / forehead.

## GRAPHICS SHOT LIST (write it in DESIGN.md before building)

Before writing `build.mjs`, write a table in DESIGN.md of 10-14 bespoke elements, each with: the spoken word it is
tied to (exact transcript word), its time (edited seconds), its type, its position in frame, and its entry motion.
Use at least 6 distinct types from: kinetic word, icon, diagram, number/counter, emoji-style glyph,
callout/arrow, chip, punch-in, concept card, transition. Every element is drawn for THIS script (no generic
pills reused across lines). Build from the list; after each draft, update it with what changed.

`layoutCaptions` knows only face/punch/split: pass `face` for face scenes and `punch` for punch-ins and concept cards.

Rules:
- The speaker is full-frame for all of the runtime except the 2-3 idea cards. The shot list has >= 6 distinct element types.
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
  ("HYDROLOGY LAB"), but a chip that quotes speech uses the spoken words. `easy-edits/tools/verbatim-guard.mjs .`
  must PASS. Captions too: every caption group and kinetic word equals the transcript words in order, token for
  token, each word mapped to a transcript word said while it is on screen (verbatim-guard caption tier). The
  transcript can be wrong: gen_th_style2b showed "AND BE ABLE" where the audio says "and being able" (Scribe wrote
  "be"). Listen to every caption against the audio, fix `assets/transcript.json` to the words as said, and rebuild.
  `easy-edits/check/verbatim-final.mjs . <final> --swaps` (edit.sh gate) FAILs a caption / kinetic word the final
  audio says inflected (BE vs "being") or with a swapped preposition; confirmed phrases (look `verbatim.confirmed`:
  TRUST IN US) are exempt, reviewer hearings (look `verbatim.heard`: talk_30s ~0:03 "to our group", which both
  ASRs hear as "for") override the ASR. Caption what was heard.
  It runs on the FINAL audio, so the captions must match the spoken words ("AND BEING ABLE"): where the final ASR
  contradicts the transcript, fix `assets/transcript.json` to the words as said and rebuild the captions.
  Give kinetic text a class or ancestor class `paper`/`kinetic`/`quote`/`stack`/`type` and chips a
  class `chip`/`pill`/`tag`/`label`/`kick`, so the guard reads each one in the right tier.
- One visual language per video: the look's palette, one type family and one illustration style for panels, chips and
  type. Do not mix flat SVG with photos or 3D renders.
- Screen-recording sources: never put a widescreen desktop capture into a phone mockup (it shrinks the UI to
  unreadable). Frame it in a browser window or laptop frame and crop-zoom to the active area: use each event's
  `zoom` rect (scale the capture by `zoom.scale` and translate so the rect fills the frame's screen), moving the
  zoom with the action, and pull out to the full screen for page-sized changes (`scale` 1).
- Screen-recording sources: retime the screen inside the EDL so each on-screen action lands on the words that
  describe it (the click on "click", the typing on "type", the scroll on "scroll"). Use `events[]` to find each
  action, then trim, freeze (hold a frame) or speed-ramp that screen segment while the voice stays continuous;
  the video track's total length must equal the voice's. Record every retime in `assets/edit-decisions.json`.
- SFX (EMBEDDED rule): synth SFX ONLY on card / graphic entries (card-in, paper, chip-pop, icon-pop, glyph-pop,
  diagram / arrow / underline draw, lower-third): a TRANSIENT pop (`click2`, `click`, `tap`, `stop`; `HOUSE.pop`)
  on every card, chip and icon entry, at -12..-15 dB re the voice peak (house -13.5). NO swish (`whoosh`, `whoosh_low`, `wrap`):
  noise sweeps are masked under speech and fail sfx-mix detection. One exception: the look's key-word pop
  (`kinetic.keyWordSfx`): one soft pop on each yellow key word, logged as a plan event of type `keyword-pop`
  (sfx-mix counts it as a graphic entry). NEVER put an `sfx` on any other kinetic word, a caption, a
  word pop, a punch-in, a zoom or a cut back to the face (set `sfx: null` there). Mix with `mixSfx` into
  `assets/mix.wav`; the root `<audio>` plays `assets/mix.wav` (not `voice.wav`). Every cue sits 12-15 dB under
  the voice PEAKS (whole-file voice peak): `mixSfx` puts each at -13.5 dB re the voice peak and clamps a cue's `db`
  to -15..-12, so leave `db` out. No ducking: the voice stays untouched under every cue. Every cue goes in
  plan.json `events[]` with its `sfx`. `easy-edits/check/sfx-audible.mjs <render> .` must PASS, and
  `easy-edits/check/sfx-mix.mjs <final post mp4> .` must PASS: it finds each cue in the final audio by matched filter
  against `assets/sfx/<sfx>.wav` and fails a missing cue, a cue outside -15..-12 dB re the voice peak, a
  ducked voice, or a cue on anything but a card / graphic entry.
- No stutter or restart left in the speech: `easy-edits/check/disfluency.mjs <render>` must PASS (a repeated word
  or 2-3 word phrase heard by >= 2 ASR windows fails).
- Captions never cover the face, chin included. They sit in the look's fixed `captions.band`; check that band
  against the prep face box ({{PREP}}/source-prep.json `scenes[].face.box`, source px) pushed through
  the transform you give `#spk` / `#spkwrap` in that scene (cover scale and offset, punch scale and origin). On a
  big punch-in where the chin reaches the caption band, ease the punch (the band does not move).
  `easy-edits/check/caption-face.mjs <project> --prep {{PREP}}/source-prep.json` must PASS, and on the render
  `easy-edits/check/caption-face-final.mjs . <render>` (Haar face + 35% chin + 4% margin per frame) must PASS.
- Keep the source in order: `assets/edit-decisions.json` keeps play in rising `sourceStart`. Opening on a later
  line (a cold-open hook) is allowed only when plan.json says so: `"hook": {"deliberate": true, "reason": "..."}`.
  `easy-edits/check/edl-order.mjs .` must PASS.
- One caption size for the whole video: the look's `captions.size` (100 px Montserrat 900, as the preset), the same in every
  layout. Never shrink captions per layout or per caption; the pop may start small but settles at scale 1. Keep
  groups to 1-3 words within the preset's 13 chars so they fit the 960 px box. `easy-edits/check/caption-size.mjs .`
  must PASS.
- Motion density: a new visual event at least every ~2.5 s, never more than 3.0 s without one: a punch-in or
  zoom, a chip / tag pop, a kinetic word, a layout change. Captions do not count, and a slow drift is not a
  punch. On a long face or punch hold, add a punch-in on a stressed word or a chip on a key noun. Put every
  such beat in plan.json (`scenes[]` start or `events[]` time); `easy-edits/check/motion-density.mjs . <render>`
  must PASS.
- One text style per role: captions use ONE font and ONE size; kinetic words use ONE family sized by
  emphasis within 120-160 px: every kinetic word >= 120 px, the key word up to 160 px, nothing above 160 (look
  `kinetic.size`). `easy-edits/check/text-style.mjs . --kinetic-free` must PASS (FAIL KINETIC SIZE < 120 or > 160).
- Readable groups: every caption group and kinetic word stays settled (full opacity, scale 1) for at least 0.3 s;
  merge a fast pair into the next group rather than flash it. A kinetic stack shows a contiguous spoken phrase,
  never with a word left out mid-phrase. `easy-edits/check/readability.mjs .` must PASS.
- In DESIGN.md, the GRAPHICS SHOT LIST, then every scene with its layout and a one-line reason, the speaker %
  and the element types used. Fix the plan before building if a rule fails.

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
   `easy-edits/tools/cut-guard.mjs <project> --source {{SOURCE}}` checks edit-decisions.json keeps against the source transcript
   and the speech-band audio and must PASS.
2. Design: write the GRAPHICS SHOT LIST, then copy the structure of `easy-edits-full-30s/scripts/build.mjs` with
   the EMBEDDED style. Tie every graphic to an exact transcript word. Place captions in the look's fixed `captions.band`, and put synth SFX
   only on card / idea-card / icon entries and key-word pops (plan event type `keyword-pop`; see the SFX rule). Educational speech gets room to breathe.
3. Build `index.html`. Follow the composition rules in CLAUDE.md: muted video plus sibling audio, one paused GSAP
   timeline registered as `window.__timelines['<id>']`, and no overlapping clips on the same track.

## Verify and render

```bash
cd {{PROJECT}}
npx hyperframes lint .
node ../../scripts/preflight.mjs .            # known root/inline-video data-start false positive is OK
node ../../.claude/skills/short-form-edit/scripts/validate-plan.mjs .
node ../../.claude/skills/short-form-edit/scripts/validate-footage.mjs .
node ../../easy-edits/tools/name-guard.mjs . --names {{NAMES}}   # FAIL = a person name not from a trusted source, or a near-miss spelling (captions too)
node ../../easy-edits/tools/verbatim-guard.mjs .                  # FAIL = kinetic / quoted text not the spoken words
(cd ../.. && node easy-edits/tools/cut-guard.mjs {{PROJECT}} --source {{SOURCE}})  # FAIL = a cut inside a word / through speech
node ../../easy-edits/check/caption-size.mjs .                 # FAIL = captions below / off the preset size
(cd ../.. && node easy-edits/check/caption-face.mjs {{PROJECT}} --prep {{PREP}}/source-prep.json)  # FAIL = a caption over the face

# draft (intermediates): draft quality, 4 workers
../../easy-edits/bin/render.sh draft . renders/draft1.mp4
#   = npx hyperframes render . -o renders/draft1.mp4 --quality draft --workers 4
node ../../easy-edits/tools/gates.mjs renders/draft1.mp4 . --sheet renders/draft1-sheet.png
node ../../easy-edits/check/sfx-audible.mjs renders/draft1.mp4 .   # FAIL = planned SFX not audible in the render
node ../../easy-edits/check/motion-density.mjs . renders/draft1.mp4  # FAIL = > 3.0 s without a visual event
node ../../easy-edits/check/caption-face-final.mjs . renders/draft1.mp4  # FAIL = a caption inside face + chin on the frames
node ../../easy-edits/check/readability.mjs .                   # FAIL = a group settled < 0.3 s or a kinetic phrase skipping words
node ../../easy-edits/check/text-style.mjs . --kinetic-free     # FAIL = mixed families or >1 caption size
node ../../easy-edits/check/look-check.mjs .                    # FAIL = a light full frame, white flash, settled card outside 55-65% / in a top corner, white-on-white caption
node ../../easy-edits/check/sfx-mix.mjs renders/draft1.mp4 .      # FAIL = an SFX too loud or off a card entry
node ../../easy-edits/check/disfluency.mjs renders/draft1.mp4     # FAIL = a stutter / repeated phrase still heard
```

Review draft1: the gates JSON, its contact sheet (`gates.mjs ... --sheet renders/draft1-sheet.png`) and frames at
the shot-list times (max 20 looks total). Blocking issues are: a failed gate, a cropped face, overflow,
unreadable text, a caption over a face or a graphic, and a black flash.

- After draft1, always: fix every blocking issue, check each shot-list element in its frame (present, in frame,
  beside not over the face, readable, popping on its word) and add or upgrade elements where the frame looks
  bare or generic. Render `renders/draft2.mp4` (same command) and rerun the checks above.
- A third draft (`renders/draft3.mp4`) only if draft2 still has a blocking issue or a missing shot-list element.
  At most 3 drafts. List non-blocking nits as open issues in the reply.

Render the final once:

```bash
../../easy-edits/bin/render.sh final . {{OUT}}
#   = npx hyperframes render . -o {{OUT}} --quality high --workers 4
```

Loudness in the gates output will be pre-master. That is expected; do not fix it in the composition.

## Done

Reply with: the `{{OUT}}` path, its duration, the cuts made (one line each), the shot list (element, word, time, type),
each scene's layout with its anchor phrase, and any open issue. Then stop.

The operator then runs:

```bash
node easy-edits/post.mjs {{OUT}}        # lead-in 0.2 s -> loudness master -> delivery check, per-stage timings
```

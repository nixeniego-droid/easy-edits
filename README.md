# AI Video Editor

## For AI assistants: install steps

Asked to "install AI Video Editor" (from this repo's URL, in an empty folder or anywhere else)? Do this:

1. `git clone --branch v1.4.1 https://github.com/nixeniego/ai-video-editor ~/ai-video-editor` (it exists: `cd ~/ai-video-editor && git fetch --tags && git checkout v1.4.1`).
   Use a permanent folder, not `/tmp`: the `ai-video-editor` command runs from this checkout.
2. Read `~/ai-video-editor/.claude/skills/ai-video-editor/SKILL.md` with your file-reading tool and follow it (sections 1-3).
   Claude Code only lists a repo's skills in sessions started inside that checkout, so the Skill tool can't load it
   in the session that cloned it.
3. `cd ~/ai-video-editor && ./install.sh` in the foreground with a long timeout (a first install takes 5-15 min), then
   `./install.sh --doctor` until it ends with "doctor: all PASS".
4. `./install.sh` also registers the skill for this checkout as `~/.claude/skills/ai-video-editor` (or
   `$CLAUDE_CONFIG_DIR/skills/ai-video-editor`), so every NEW Claude Code session, in any folder, can load it with the
   Skill tool or `/ai-video-editor`. Re-register only the skill: `./install.sh --skill-only`; opt out:
   `AI_VIDEO_EDITOR_NO_SKILL=1 ./install.sh`. The doctor's `claude-skill` line checks it.
5. Every new shell: `. ~/.ai-video-editor/env.sh`, then `ai-video-editor ...`. Keep the command's exit status (don't pipe it
   into `tail`): 0 = done, 1 = a delivery FAIL to report (the file is written), 5 = no final file in the `-o` folder.
   Files under `<out>/.work/` are intermediates, never the result. Exit 137 / 143 means your shell tool killed the
   render: re-run the same command (finished steps are reused), in the foreground with a 30-minute timeout or with
   `nohup ... > LOG 2>&1 &`.

## Quickstart

**One line** (Claude Code, in any folder):

```sh
claude -p "Install AI Video Editor from https://github.com/nixeniego/ai-video-editor (tag v1.4.1)"
```

It clones to `~/ai-video-editor`, runs the install and the doctor, and registers the skill, so the next session can just
say *"Use AI Video Editor to add captions to clip.mp4"*.

**Use with Claude Code**

```sh
git clone --branch v1.4.1 https://github.com/nixeniego/ai-video-editor ai-video-editor
cd ai-video-editor
claude
```

Then say: *"set up AI Video Editor"*. Claude Code reads [CLAUDE.md](CLAUDE.md) and the repo skill
(`.claude/skills/ai-video-editor/SKILL.md`), runs the install and the doctor, fixes what's missing, and makes a first
edit of a video you give it. `/ai-video-editor [video]` runs the same getting-started flow.

**Use with Grok Bot**

A template is coming soon.

**Zero-instruction video editing. Point it at a talking-head video and get a finished edit back: clean cuts,
captions, motion design, explainers and shorts.**

```sh
ai-video-editor samples/talk.mp4 -o out/        # samples/talk.mp4: a tiny synthetic clip; point it at your own video
```

That's the whole brief. No prompt, no timeline, no settings: AI Video Editor transcribes the video locally, cuts the
fillers, dead air and slips (it never invents words or changes the meaning), adds clean captions, masters the
audio to -14 LUFS, checks the result and writes a 9:16 mp4, a contact sheet and `.srt` / `.vtt` captions to `out/`.
Ask for more with one word (the mode) when you want it.

AI Video Editor is built on **Herk Edit Kit** by **Nate Herk** (https://github.com/nateherkai/herk-edit-kit): its editing
playbook, house style, style library and HyperFrames (HTML-to-video) render workflow are what AI Video Editor automates.

## Install

Needs `git`, `curl` and Linux (Debian/Ubuntu; `sudo` for apt) or macOS (Homebrew).

```sh
git clone --branch v1.4.1 https://github.com/nixeniego/ai-video-editor ai-video-editor
cd ai-video-editor
./install.sh              # one command, safe to re-run; ~2.5 GB (Whisper models, Chrome for rendering)
. ~/.ai-video-editor/env.sh       # in every new shell: puts ai-video-editor, Node 22 and the Python venv on your PATH
./install.sh --doctor     # PASS/FAIL per dependency
ai-video-editor --help
```

Renamed from Easy Edits: the old `easy-edits` command still works as an alias of `ai-video-editor` for one release,
and so do the old `EASY_EDITS_*` env vars and an existing `~/.easy-edits` folder (the new `AI_VIDEO_EDITOR_*` names
win when both are set). The GitHub repo keeps its `easy-edits` name for now.

`install.sh` installs, or verifies: Node 22 (into `~/.ai-video-editor/node` unless you already have Node >= 22),
ffmpeg, a Python venv with faster-whisper, OpenCV and yt-dlp, the Whisper `small` + `medium` models, the YuNet face
model, the npm packages, HyperFrames' headless Chrome and the fonts (Montserrat for the captions, Playfair Display
and JetBrains Mono for the style packs; all SIL OFL, pinned and checksummed). Everything goes into `~/.ai-video-editor`
and this folder (plus the fonts in `~/.local/share/fonts`). `./install.sh --help` lists the options.

HyperFrames (the renderer) sends anonymous usage telemetry by default. `install.sh` turns it off: it exports
`HYPERFRAMES_NO_TELEMETRY=1` (and `DO_NOT_TRACK=1`) before anything runs, writes both into `~/.ai-video-editor/env.sh`, and
runs `hyperframes telemetry disable`. The doctor's `telemetry-off` line checks it.

## Try it (public-domain sample, ~1 min)

A 15 s clip from a NASA interview (public domain, NASA Scientific Visualization Studio,
[source](https://commons.wikimedia.org/wiki/File:The_Numbers_Are_In-_Where_Does_2021_Rank_for_Global_Temperatures_Live_Shots_(SVS14069_-_Gavin_Canned_Interview_pt_2).webm)):

```sh
curl -fL -o nasa.webm "https://upload.wikimedia.org/wikipedia/commons/b/b8/The_Numbers_Are_In-_Where_Does_2021_Rank_for_Global_Temperatures_Live_Shots_%28SVS14069_-_Gavin_Canned_Interview_pt_2%29.webm"
ffmpeg -v error -ss 5.5 -i nasa.webm -t 15.3 -c:v libx264 -c:a aac sample.mp4
ai-video-editor captions sample.mp4 -o out/
ls out/                   # ai-video-editor_captions_sample.mp4, _sheet.png, .srt, .vtt, report.json
```

Then try the default mode on the same clip: `ai-video-editor sample.mp4 -o out/ --no-review`.

## Modes

```sh
ai-video-editor <mode> <video-or-url> -o <out-dir> [--format 9x16|1x1|16x9|all] [--notes "..."]
```

| Mode | What you get |
| --- | --- |
| `clean-cut` (default, **approved**) | Fillers, dead air and clear slips removed (never invents words or changes meaning), clean minimal captions. |
| `talking-head` | The clean cut plus motion design: title card, kinetic captions, a lower third, punch-ins on emphasis, icon pops, a progress bar, top-box cards (quotes, lists, comparisons) keyed to the transcript, end card, an Openverse music bed and whooshes. |
| `explainer` | Script or transcript to scenes: cards, lists and diagrams, zooms that follow screen activity on screen recordings, voiceover-synced reveals. Takes a video, or a `.txt` script (voiced locally with Kokoro TTS). |
| `shorts` | Long talk or podcast to ranked 9:16 shorts: proposes standalone moments, you pick, it renders them with a reframe that follows the active speaker and captions. |
| `captions` | Captions only, no cuts: burned in, plus `.srt` / `.vtt`. |

```sh
ai-video-editor samples/talk.mp4 -o out/                                  # clean cut, 9:16
ai-video-editor talking-head samples/talk.mp4 -o out/ --format all --speaker "Ana Cruz" --role "Founder"
ai-video-editor explainer screen-recording.mp4 -o out/ --script script.md
ai-video-editor shorts podcast.mp4 -o out/ --propose                      # PROPOSALS.txt + proposals.json + a preview per candidate
ai-video-editor shorts podcast.mp4 -o out/ --pick 1,3 --hook              # render proposals 1 and 3 with a hook card
ai-video-editor captions samples/talk.mp4 -o out/ --format 16x9
ai-video-editor captions samples/talk.mp4 -o out/ --preview             # a quick ~20 s look in out/preview/ first
```

Every export is mastered to -14 LUFS / -1.5 dBTP and goes through a delivery check (speech at the edges, dead tail,
dropouts, repeated phrases, loudness). Per format you get `ai-video-editor_<mode>_<clip>[_<fmt>].mp4`, a `_sheet.png`
contact sheet, `.srt` / `.vtt`, a `report.json`, and a `CREDITS.txt` when music is used.

Useful options (`ai-video-editor --help` has them all): `--title`, `--speaker` / `--role` (names are never guessed),
`--preview [SECONDS]` (captions / clean-cut / talking-head: about 20 s from the first speech to a pause, into
`out/preview/`, exit 0), `--plan-only` then `--plan FILE` (review or hand-edit the motion plan), `--transcript FILE`, `--review-patch FILE`,
`--no-review`, `--style PACK` (below), `--face top|center|bottom|X,Y`, `--caption-color auto|white|black|#RRGGBB`,
`--music "query"` / `--no-music`, `--preset FILE` (your own watermark / accent / call to action; keep
it outside the repo), `--lang`, `--agent claude|codex|none`.

### Shorts

1. `--propose` reads the whole transcript (with an agent CLI if one is installed, else the built-in scorer) and
   writes `PROPOSALS.txt`: ranked candidates with a 0-100 score, timestamps, the hook line and why, plus a
   low-res preview of each. `proposals.json` has the same list for an assistant's pick cards: `id` (the number
   for `--pick`), `start`, `end`, `durationSec`, `hook`, `hookCard`, `reason`, `previewPath`. `--clips N`, `--min` / `--max` seconds, `--range 22:05-26:00`, `--notes` steer it.
2. `--pick 1,3` renders those proposals: clean cut, speaker-following 9:16 reframe, captions, -14 LUFS.
   `--hook ["text"]` adds a hook card over the first 3 s. `--speaker "Name" --role "Role" --speaker-at 25:40`
   (or `--people people.json`) adds lower thirds.
3. Rendered clips are logged in `out/<source-id>/used_clips.json` so later proposals don't repeat them
   (`--reset-used` clears it).

AI Video Editor never posts or schedules for you. With `--post-draft` it only writes a local `POST_DRAFT.txt` (labelled DRAFT) for you to edit and publish yourself — it never publishes on your behalf.

### Styles

A style pack is one JSON file that defines a whole editing style: palette, fonts, caption look (font, case, words
per caption, highlight, animation), transitions, how numbers animate, a signature move, pacing (how often pops and
punch-ins may land, how far punch-ins zoom), which scenes it allows, and its sound. Three ship with AI Video Editor:

| Style | Look | Transitions | Numbers | Signature move |
| --- | --- | --- | --- | --- |
| `punch` | black + safety yellow, heavy uppercase Montserrat, 1-2 words at a time, spoken word lit | whip-pan smear with motion blur | slam in from 3x with a hit | zoom hit + camera shake on every punch-in |
| `broadsheet` | warm paper, ink and red, Playfair Display, sentence-case phrases rising in, key words underlined | dip through paper | count up like a ticker | cinematic letterbox bars on punch-ins |
| `terminal` | near-black navy, cyan / magenta, JetBrains Mono, lowercase captions typed on, glowing key words | RGB-split glitch | digits decode through random numbers | HUD brackets lock onto the face |

```sh
ai-video-editor talking-head samples/talk.mp4 -o out/ --style broadsheet    # captions / talking-head / explainer / shorts
ai-video-editor style list                                          # built-in packs and yours
ai-video-editor style validate my-brand.json                        # schema + readability checks, every problem listed
ai-video-editor style skill punch                                   # a Claude Code skill that edits in that style
```

Your own packs go in `~/.ai-video-editor/styles/<id>.json` (or pass a path). Start from a copy of a built-in pack in
`ai-video-editor/styles/packs/`; the schema is `ai-video-editor/styles/pack.schema.json`. The renderer validates the pack and
refuses, with the reason, anything it doesn't support: an unknown key or value, unreadable colours, a mode or format
the pack doesn't list, a `--plan` beat outside its scenes, `--hook` without a hook scene, a font that isn't
installed. `clean-cut` keeps its approved look and takes no style.

`ai-video-editor style skill <pack>` writes `~/.claude/skills/ai-video-editor-style-<id>/SKILL.md` (`--project` for
`./.claude/skills`, `-o DIR`, or `--print`): a skill that tells Claude Code to add `--style <id>` to every render,
plan only the beats the style allows, and review the result against that style.

### Smarter captions

- **Auto contrast.** Each caption samples the footage behind it (a small greyscale grid of the clip) and uses
  white text with a dark edge, or near-black text with a light edge over bright footage such as a white wall or
  sky. A hysteresis band stops neighbouring captions flickering between the two, busy backgrounds get a heavier
  edge, and a highlight colour that would vanish into the background becomes a highlight box. `--caption-color
  white|black|#RRGGBB` fixes the colour instead (the approved clean-cut 9:16 keeps white).
- **Manual face position.** When face detection is wrong (a poster, a second person, a dark shot), `--face
  top|center|bottom` or `--face X,Y` (fractions of the frame, e.g. `--face 0.3,0.4`) puts the framing, punch-ins,
  caption keep-out and pops on that point.

### Make a video from a brief: `ai-video-editor new`

`ai-video-editor new <type>` builds a video without source footage:

| Type | From | What you get |
| --- | --- | --- |
| `explainer-cited` | `--source URL\|FILE` (repeatable), `--topic` | every claim quotes a passage from a source; `[n] Source title` chips, a Sources end card, `SOURCES.txt`; zero video generations |
| `presenter` | `--script FILE` | a 9:16, 15-90 s short read by a synthetic host (fictional, or your own face / voice with a consent record) |
| `podcast` | `--script FILE` with `A:` / `B:` lines | two voices, turn gaps, room tone; waveform video with speaker-named captions, or `--audio-only` WAV + MP3 at -16 LUFS |
| `story` | `--brief`, `--script` or `--shotlist FILE`, `--characters FILE` | a multi-shot video, characters kept consistent with reference images, per-shot QA |
| `promo` | `--brand brand.json --assets DIR` | code-drawn scenes, zero generations, brand colours contrast-checked |
| `music-video` | `--song FILE --i-own-this-music`, `--lyrics FILE` | cuts snapped to the beat, length = the song, lyric captions |
| `other` | `--brief "..."` | mapped to the closest type; the plan shows the mapping |

**Plan, approve, generate, resume.** `new` always stops after planning: `plan.json`, `PLAN.txt` (generation count,
estimated cost and time, what would be sent to any online backend) and a `storyboard.png`. Nothing is generated
until you approve the pinned plan. Images and video clips are made by **your AI assistant's built-in image/video
generation** (the default `host` backend): after `--approve`, AI Video Editor writes `GENERATION_MANIFEST.json` in the
output folder (one entry per asset: id, type, prompt, duration, aspect, reference images, first frame, file) and
exits with code 3. The assistant generates each asset and saves it at its `file`; `ai-video-editor resume` then checks
the approved plan and the assets and finishes the edit, captions, QA, `report.json` and `DELIVERY.json`. Voice
comes from the local TTS. Hosted APIs are opt-in with your own key (`--backend NAME`,
[ai-video-editor/gen/BACKENDS.md](ai-video-editor/gen/BACKENDS.md)); none is used unless you choose it.

```sh
ai-video-editor new story -o out/story --brief "A lighthouse at dusk. Waves hit the rocks. The light turns on."
cat out/story/PLAN.txt                                   # and look at out/story/storyboard.png
ai-video-editor new --approve out/story/plan.json             # exit 3: out/story/GENERATION_MANIFEST.json lists the clips
#   ... the assistant generates each clip and saves it at its "file" ...
ai-video-editor resume out/story                              # exit 3 + the list while any are missing; then renders

ai-video-editor new promo -o out/promo --brand brand.json --assets brand/ --format 9x16,1x1   # zero generations
ai-video-editor new podcast -o out/pod --script episode.txt --audio-only
ai-video-editor new explainer-cited -o out/bees --source notes.pdf --source https://example.org/article --topic "how bees find food"
```

Formats: 9:16, 16:9, 1:1, 4:5 or a custom `WxH` (presenter is 9:16; story, presenter and music-video make one format
per plan). `--length S|MIN-MAX` is checked at delivery, `--loudness social|podcast|LUFS` picks the finish (social -14
LUFS, podcast -16 LUFS, both -1.5 dBTP, BT.709 video), `--max-generations N` and `--offline` refuse plans over budget
or needing the network, and `--post-draft` writes a `POST_DRAFT.txt` labelled DRAFT (never posted). Generated clips'
own ambient audio is dropped under narration or a song, ducked -18 dB under music and kept when it is the only sound
(`--clip-audio keep|duck|drop`). Each run writes `report.json` (with `WEAK_SHOTS`), `REVIEW.txt` and
`DELIVERY.json`; weak shots are named plainly so you can regenerate them. Details:
[ai-video-editor/new/README.md](ai-video-editor/new/README.md).

- **Cited explainer.** A claim whose quoted passage isn't found word for word in its source FAILs the `citation`
  check. Details: [ai-video-editor/research/README.md](ai-video-editor/research/README.md).
- **Presenter.** Every presenter is labelled synthetic. Your own face and voice need a consent record you create
  as the subject; third-party and public-figure likeness is always refused. Details: [docs/CONSENT.md](docs/CONSENT.md).

  ```sh
  ai-video-editor consent create --subject "Your Name" --allow face,voice --ref me.jpg --ref voice.wav --expires 2027-06-30 --i-am-the-subject
  ai-video-editor new presenter -o out/me --script script.md --likeness self --consent ~/.ai-video-editor/consent/your-name.json --subject "Your Name"
  ```
- **Story and music video.** Music video takes only music you own or have licensed (`--i-own-this-music`, recorded in
  `report.json`). Every shot is checked (black / frozen frames, duration, flicker, character drift). Details:
  [ai-video-editor/story/README.md](ai-video-editor/story/README.md).
- The standalone runners still work: `node ai-video-editor/research/run.mjs`, `node ai-video-editor/presenter/run.mjs`,
  `node ai-video-editor/story/run.mjs story|music-video`.

### From a URL

Every mode also takes a YouTube (or other yt-dlp-supported) link instead of a file:

```sh
ai-video-editor https://www.youtube.com/watch?v=VIDEO_ID -o out/
```

**Use this only on videos you own or have the rights to edit.** If the site asks you to sign in, re-run with
`--cookies cookies.txt` (exported from your browser; keep it private) or download the video yourself and pass the
file. Details: [docs/URL_INPUT.md](docs/URL_INPUT.md).

## Use it with any AI agent

AI Video Editor is a plain CLI, so any agent with a terminal can drive it. The agent's job is judgement: pick the mode,
read `report.json`, look at the `_sheet.png` contact sheets, and tell you about every FAIL. The repo ships
[AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) (same content) with the rules agents should follow, and
[docs/AGENTS_GUIDE.md](docs/AGENTS_GUIDE.md) with the review loops.

First, in any case: install AI Video Editor as above (`./install.sh`, then `. ~/.ai-video-editor/env.sh`).

**Claude Code**

1. Install Claude Code (https://code.claude.com/docs/en/setup) and run `claude` once to log in.
2. `cd ai-video-editor && claude`
3. Say: *"Read CLAUDE.md, then use ai-video-editor to make a talking-head edit of ~/talk.mp4 in all formats."*

Claude Code reads `CLAUDE.md` on its own. When `claude` is installed, AI Video Editor also uses `claude -p` for the motion
plan and the short clean-cut review.

**Codex**

1. Install the Codex CLI (https://github.com/openai/codex) and log in once.
2. `cd ai-video-editor && codex`
3. Say: *"Read AGENTS.md, then use ai-video-editor to make a clean cut of ~/talk.mp4."*

Codex reads `AGENTS.md` on its own. If `claude` is not installed, AI Video Editor plans with `codex exec`.

**Cursor**

1. Open the `ai-video-editor` folder in Cursor (File > Open Folder).
2. Open the agent chat in Agent mode (it needs the terminal).
3. Say: *"Read @AGENTS.md, then run `. ~/.ai-video-editor/env.sh && ai-video-editor captions ~/talk.mp4 -o out/` and review the
   result."*

Cursor's agent has no AI Video Editor CLI integration of its own; add `--agent none` if neither `claude` nor `codex` is
installed.

**Any other agent with a shell**

1. Give it a shell with this repo cloned and a video it may use.
2. Paste: *"In the ai-video-editor folder, run `./install.sh`, then `. ~/.ai-video-editor/env.sh`. Read AGENTS.md and
   docs/AGENTS_GUIDE.md. Run `ai-video-editor <mode> <video> -o out/ --agent none --plan-only`, review and edit the plan
   JSON it prints, re-run with `--plan FILE`, then show me the contact sheet and every check result. Never upload
   or publish anything."*

For a reviewed clean cut, the agent can review the cut itself: see "Agent review" in
[docs/AGENTS_GUIDE.md](docs/AGENTS_GUIDE.md).

No agent at all: `--agent none` uses the built-in heuristic planner, and `--no-review` keeps the deterministic
clean cut.

## How it works

`bin/ai-video-editor` runs `ai-video-editor/cli/main.mjs`, which dispatches to `ai-video-editor/modes/<mode>.mjs`. The shared stages
in `ai-video-editor/engine/` are: source normalisation, faster-whisper word transcripts, the approved clean cut
(`ai-video-editor/bin/clean-cut.sh`), a YuNet face track or a screen-activity track, the motion plan, one HyperFrames
composition per format (GSAP), the soundtrack (voice, an Openverse bed fetched at render time, synthesised SFX),
the loudness master and the delivery check. Details: [ai-video-editor/README.md](ai-video-editor/README.md).

Tests: `npm test` (tests that need media not shipped in the repo are reported as skipped).
Generation backends (bring your own key; local ones need none): `ai-video-editor backends`, docs in
[ai-video-editor/gen/BACKENDS.md](ai-video-editor/gen/BACKENDS.md). `npm run lint` is the open-source check (no keys, no home paths).
Known limitations: [KNOWN_ISSUES.txt](KNOWN_ISSUES.txt).

## Credits and licence

Built on Herk Edit Kit by Nate Herk (MIT). AI Video Editor is MIT licensed: [LICENSE](LICENSE). Credits:
[CREDITS.txt](CREDITS.txt). Third-party software and licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
No music, footage or fonts are bundled: music is fetched from Openverse (CC0 / CC BY only) at render time and
credited in the `CREDITS.txt` next to each export.

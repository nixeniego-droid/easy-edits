# Easy Edits

## Quickstart

**Use with Claude Code**

```sh
git clone https://github.com/nixeniego-droid/easy-edits
cd easy-edits
claude
```

Then say: *"set up Easy Edits"*. Claude Code reads [CLAUDE.md](CLAUDE.md) and the repo skill
(`.claude/skills/easy-edits/SKILL.md`), runs the install and the doctor, fixes what's missing, and makes a first
edit of a video you give it. `/easy-edits [video]` runs the same getting-started flow.

**Use with Grok Bot**

A template is coming soon.

**Zero-instruction video editing. Point it at a talking-head video and get a finished edit back: clean cuts,
captions, motion design, explainers and shorts.**

```sh
easy-edits talk.mp4 -o out/
```

That's the whole brief. No prompt, no timeline, no settings: Easy Edits transcribes the video locally, cuts the
fillers, dead air and slips (it never invents words or changes the meaning), adds clean captions, masters the
audio to -14 LUFS, checks the result and writes a 9:16 mp4, a contact sheet and `.srt` / `.vtt` captions to `out/`.
Ask for more with one word (the mode) when you want it.

Easy Edits is built on **Herk Edit Kit** by **Nate Herk** (https://github.com/nateherkai/herk-edit-kit): its editing
playbook, house style, style library and HyperFrames (HTML-to-video) render workflow are what Easy Edits automates.

## Install

Needs `git`, `curl` and Linux (Debian/Ubuntu; `sudo` for apt) or macOS (Homebrew).

```sh
git clone https://github.com/nixeniego-droid/easy-edits
cd easy-edits
./install.sh              # one command, safe to re-run; ~2.5 GB (Whisper models, Chrome for rendering)
. ~/.easy-edits/env.sh       # in every new shell: puts easy-edits, Node 22 and the Python venv on your PATH
./install.sh --doctor     # PASS/FAIL per dependency
easy-edits --help
```

`install.sh` installs, or verifies: Node 22 (into `~/.easy-edits/node` unless you already have Node >= 22),
ffmpeg, a Python venv with faster-whisper, OpenCV and yt-dlp, the Whisper `small` + `medium` models, the YuNet face
model, the npm packages, HyperFrames' headless Chrome and the fonts (Montserrat for the captions, Playfair Display
and JetBrains Mono for the style packs; all SIL OFL, pinned and checksummed). Everything goes into `~/.easy-edits`
and this folder (plus the fonts in `~/.local/share/fonts`). `./install.sh --help` lists the options.

HyperFrames (the renderer) sends anonymous usage telemetry by default. `install.sh` turns it off: it exports
`HYPERFRAMES_NO_TELEMETRY=1` (and `DO_NOT_TRACK=1`) before anything runs, writes both into `~/.easy-edits/env.sh`, and
runs `hyperframes telemetry disable`. The doctor's `telemetry-off` line checks it.

## Try it (public-domain sample, ~1 min)

A 15 s clip from a NASA interview (public domain, NASA Scientific Visualization Studio,
[source](https://commons.wikimedia.org/wiki/File:The_Numbers_Are_In-_Where_Does_2021_Rank_for_Global_Temperatures_Live_Shots_(SVS14069_-_Gavin_Canned_Interview_pt_2).webm)):

```sh
curl -fL -o nasa.webm "https://upload.wikimedia.org/wikipedia/commons/b/b8/The_Numbers_Are_In-_Where_Does_2021_Rank_for_Global_Temperatures_Live_Shots_%28SVS14069_-_Gavin_Canned_Interview_pt_2%29.webm"
ffmpeg -v error -ss 5.5 -i nasa.webm -t 15.3 -c:v libx264 -c:a aac sample.mp4
easy-edits captions sample.mp4 -o out/
ls out/                   # easy-edits_captions_sample.mp4, _sheet.png, .srt, .vtt, report.json
```

Then try the default mode on the same clip: `easy-edits sample.mp4 -o out/ --no-review`.

## Modes

```sh
easy-edits <mode> <video-or-url> -o <out-dir> [--format 9x16|1x1|16x9|all] [--notes "..."]
```

| Mode | What you get |
| --- | --- |
| `clean-cut` (default, **approved**) | Fillers, dead air and clear slips removed (never invents words or changes meaning), clean minimal captions. |
| `talking-head` | The clean cut plus motion design: title card, kinetic captions, a lower third, punch-ins on emphasis, icon pops, a progress bar, top-box cards (quotes, lists, comparisons) keyed to the transcript, end card, an Openverse music bed and whooshes. |
| `explainer` | Script or transcript to scenes: cards, lists and diagrams, zooms that follow screen activity on screen recordings, voiceover-synced reveals. Takes a video, or a `.txt` script (voiced locally with Kokoro TTS). |
| `shorts` | Long talk or podcast to ranked 9:16 shorts: proposes standalone moments, you pick, it renders them with a reframe that follows the active speaker and captions. |
| `captions` | Captions only, no cuts: burned in, plus `.srt` / `.vtt`. |

```sh
easy-edits talk.mp4 -o out/                                          # clean cut, 9:16
easy-edits talking-head talk.mp4 -o out/ --format all --speaker "Ana Cruz" --role "Founder"
easy-edits explainer screen-recording.mp4 -o out/ --script script.md
easy-edits shorts podcast.mp4 -o out/ --propose                      # PROPOSALS.txt + a preview per candidate
easy-edits shorts podcast.mp4 -o out/ --pick 1,3 --hook              # render proposals 1 and 3 with a hook card
easy-edits captions talk.mp4 -o out/ --format 16x9
```

Every export is mastered to -14 LUFS / -1.5 dBTP and goes through a delivery check (speech at the edges, dead tail,
dropouts, repeated phrases, loudness). Per format you get `easy-edits_<mode>_<clip>[_<fmt>].mp4`, a `_sheet.png`
contact sheet, `.srt` / `.vtt`, a `report.json`, and a `CREDITS.txt` when music is used.

Useful options (`easy-edits --help` has them all): `--title`, `--speaker` / `--role` (names are never guessed),
`--plan-only` then `--plan FILE` (review or hand-edit the motion plan), `--transcript FILE`, `--review-patch FILE`,
`--no-review`, `--style PACK` (below), `--face top|center|bottom|X,Y`, `--caption-color auto|white|black|#RRGGBB`,
`--music "query"` / `--no-music`, `--preset FILE` (your own watermark / accent / call to action; keep
it outside the repo), `--lang`, `--agent claude|codex|none`.

### Shorts

1. `--propose` reads the whole transcript (with an agent CLI if one is installed, else the built-in scorer) and
   writes `PROPOSALS.txt`: ranked candidates with a 0-100 score, timestamps, the hook line and why, plus a
   low-res preview of each. `--clips N`, `--min` / `--max` seconds, `--range 22:05-26:00`, `--notes` steer it.
2. `--pick 1,3` renders those proposals: clean cut, speaker-following 9:16 reframe, captions, -14 LUFS.
   `--hook ["text"]` adds a hook card over the first 3 s. `--speaker "Name" --role "Role" --speaker-at 25:40`
   (or `--people people.json`) adds lower thirds.
3. Rendered clips are logged in `out/<source-id>/used_clips.json` so later proposals don't repeat them
   (`--reset-used` clears it).

Easy Edits never posts, schedules or writes social copy: it writes files for you to review.

### Styles

A style pack is one JSON file that defines a whole editing style: palette, fonts, caption look (font, case, words
per caption, highlight, animation), transitions, how numbers animate, a signature move, pacing (how often pops and
punch-ins may land, how far punch-ins zoom), which scenes it allows, and its sound. Three ship with Easy Edits:

| Style | Look | Transitions | Numbers | Signature move |
| --- | --- | --- | --- | --- |
| `punch` | black + safety yellow, heavy uppercase Montserrat, 1-2 words at a time, spoken word lit | whip-pan smear with motion blur | slam in from 3x with a hit | zoom hit + camera shake on every punch-in |
| `broadsheet` | warm paper, ink and red, Playfair Display, sentence-case phrases rising in, key words underlined | dip through paper | count up like a ticker | cinematic letterbox bars on punch-ins |
| `terminal` | near-black navy, cyan / magenta, JetBrains Mono, lowercase captions typed on, glowing key words | RGB-split glitch | digits decode through random numbers | HUD brackets lock onto the face |

```sh
easy-edits talking-head talk.mp4 -o out/ --style broadsheet    # captions / talking-head / explainer / shorts
easy-edits style list                                          # built-in packs and yours
easy-edits style validate my-brand.json                        # schema + readability checks, every problem listed
easy-edits style skill punch                                   # a Claude Code skill that edits in that style
```

Your own packs go in `~/.easy-edits/styles/<id>.json` (or pass a path). Start from a copy of a built-in pack in
`easy-edits/styles/packs/`; the schema is `easy-edits/styles/pack.schema.json`. The renderer validates the pack and
refuses, with the reason, anything it doesn't support: an unknown key or value, unreadable colours, a mode or format
the pack doesn't list, a `--plan` beat outside its scenes, `--hook` without a hook scene, a font that isn't
installed. `clean-cut` keeps its approved look and takes no style.

`easy-edits style skill <pack>` writes `~/.claude/skills/easy-edits-style-<id>/SKILL.md` (`--project` for
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

### Make a video from a brief: `easy-edits new`

`easy-edits new <type>` builds a video without source footage: `explainer-cited`, `presenter`, `podcast`, `story`,
`promo`, `music-video`, or `other` (a `--brief` mapped to the closest type; the plan shows the mapping). It always
stops after planning: `plan.json`, `PLAN.txt` (generation count, estimated cost and time, what would be sent to any
online backend) and a `storyboard.png`. Nothing is generated until you approve the pinned plan.

```sh
easy-edits new promo -o out/promo --brand brand.json --assets brand/ --format 9x16,1x1   # zero generations
easy-edits new podcast -o out/pod --script episode.txt --audio-only                       # "A: ..." / "B: ..." lines
easy-edits new --approve out/promo/plan.json                                              # render it
```

Formats: 9:16, 16:9, 1:1, 4:5 or a custom `WxH`. `--length S|MIN-MAX` is checked at delivery, `--loudness
social|podcast|LUFS` picks the finish (social -14 LUFS, podcast -16 LUFS, both -1.5 dBTP, BT.709 video),
`--max-generations N` and `--offline` refuse plans over budget or needing the network, and `--post-draft` writes a
`POST_DRAFT.txt` labelled DRAFT (never posted). Each run writes `report.json` (with `WEAK_SHOTS`), `REVIEW.txt` and
`DELIVERY.json`. Details: [easy-edits/new/README.md](easy-edits/new/README.md).

### Presenter shorts (preview)

A 9:16, 15-90 s short read by a synthetic presenter, captioned from the script: a fictional host (generated, or a
licensed image you supply) or your own face and voice with a consent record. Every one is labelled synthetic.

```sh
node easy-edits/presenter/run.mjs --script script.md -o out/ --length 30
easy-edits consent create --subject "Your Name" --allow face,voice --ref me.jpg --ref voice.wav --expires 2027-06-30 --i-am-the-subject
```

Third-party and public-figure likeness is always refused. Details: [docs/CONSENT.md](docs/CONSENT.md).

### From a URL

Every mode also takes a YouTube (or other yt-dlp-supported) link instead of a file:

```sh
easy-edits https://www.youtube.com/watch?v=VIDEO_ID -o out/
```

**Use this only on videos you own or have the rights to edit.** If the site asks you to sign in, re-run with
`--cookies cookies.txt` (exported from your browser; keep it private) or download the video yourself and pass the
file. Details: [docs/URL_INPUT.md](docs/URL_INPUT.md).

### Cited explainer (preview)

A narrated explainer made from sources instead of footage: every claim quotes a passage from a web page, PDF or
document, an on-screen chip `[n] Source title` names the source while the claim is spoken, and a `Sources` end
card plus `SOURCES.txt` list them. It will become `easy-edits new explainer-cited`; until then:

```sh
node easy-edits/research/run.mjs --source notes.pdf --source https://example.org/article --topic "..." -o out/ --format all
```

A claim whose quoted passage isn't found word for word in its source FAILs the `citation` check. Details:
[easy-edits/research/README.md](easy-edits/research/README.md).

## Use it with any AI agent

Easy Edits is a plain CLI, so any agent with a terminal can drive it. The agent's job is judgement: pick the mode,
read `report.json`, look at the `_sheet.png` contact sheets, and tell you about every FAIL. The repo ships
[AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) (same content) with the rules agents should follow, and
[docs/AGENTS_GUIDE.md](docs/AGENTS_GUIDE.md) with the review loops.

First, in any case: install Easy Edits as above (`./install.sh`, then `. ~/.easy-edits/env.sh`).

**Claude Code**

1. Install Claude Code (https://code.claude.com/docs/en/setup) and run `claude` once to log in.
2. `cd easy-edits && claude`
3. Say: *"Read CLAUDE.md, then use easy-edits to make a talking-head edit of ~/talk.mp4 in all formats."*

Claude Code reads `CLAUDE.md` on its own. When `claude` is installed, Easy Edits also uses `claude -p` for the motion
plan and the short clean-cut review.

**Codex**

1. Install the Codex CLI (https://github.com/openai/codex) and log in once.
2. `cd easy-edits && codex`
3. Say: *"Read AGENTS.md, then use easy-edits to make a clean cut of ~/talk.mp4."*

Codex reads `AGENTS.md` on its own. If `claude` is not installed, Easy Edits plans with `codex exec`.

**Cursor**

1. Open the `easy-edits` folder in Cursor (File > Open Folder).
2. Open the agent chat in Agent mode (it needs the terminal).
3. Say: *"Read @AGENTS.md, then run `. ~/.easy-edits/env.sh && easy-edits captions ~/talk.mp4 -o out/` and review the
   result."*

Cursor's agent has no Easy Edits CLI integration of its own; add `--agent none` if neither `claude` nor `codex` is
installed.

**Any other agent with a shell**

1. Give it a shell with this repo cloned and a video it may use.
2. Paste: *"In the easy-edits folder, run `./install.sh`, then `. ~/.easy-edits/env.sh`. Read AGENTS.md and
   docs/AGENTS_GUIDE.md. Run `easy-edits <mode> <video> -o out/ --agent none --plan-only`, review and edit the plan
   JSON it prints, re-run with `--plan FILE`, then show me the contact sheet and every check result. Never upload
   or publish anything."*

For a reviewed clean cut, the agent can review the cut itself: see "Agent review" in
[docs/AGENTS_GUIDE.md](docs/AGENTS_GUIDE.md).

No agent at all: `--agent none` uses the built-in heuristic planner, and `--no-review` keeps the deterministic
clean cut.

## How it works

`bin/easy-edits` runs `easy-edits/cli/main.mjs`, which dispatches to `easy-edits/modes/<mode>.mjs`. The shared stages
in `easy-edits/engine/` are: source normalisation, faster-whisper word transcripts, the approved clean cut
(`easy-edits/bin/clean-cut.sh`), a YuNet face track or a screen-activity track, the motion plan, one HyperFrames
composition per format (GSAP), the soundtrack (voice, an Openverse bed fetched at render time, synthesised SFX),
the loudness master and the delivery check. Details: [easy-edits/README.md](easy-edits/README.md).

Tests: `npm test` (tests that need media not shipped in the repo are reported as skipped).
Generation backends (bring your own key; local ones need none): `easy-edits backends`, docs in
[easy-edits/gen/BACKENDS.md](easy-edits/gen/BACKENDS.md). `npm run lint` is the open-source check (no keys, no home paths).
Known limitations: [KNOWN_ISSUES.txt](KNOWN_ISSUES.txt).

## Credits and licence

Built on Herk Edit Kit by Nate Herk (MIT). Easy Edits is MIT licensed: [LICENSE](LICENSE). Credits:
[CREDITS.txt](CREDITS.txt). Third-party software and licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
No music, footage or fonts are bundled: music is fetched from Openverse (CC0 / CC BY only) at render time and
credited in the `CREDITS.txt` next to each export.

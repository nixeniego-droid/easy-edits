---
name: ai-video-editor
description: Use when someone says "set up AI Video Editor" or "install AI Video Editor" (also from its GitHub URL), wants to edit a talking-head video on a Linux machine with AI Video Editor (captioned 9:16 shorts, a clean cut, captions), or wants AI Video Editor to make a new video from a brief, script, sources or brand assets (cited explainer, presenter short, podcast, multi-shot story, promo, music video). It covers installing AI Video Editor, fixing its dependencies, proposing and rendering shorts, the plan -> approve -> generate -> resume flow for new videos, and reviewing the results.
---

# AI Video Editor

AI Video Editor is a command-line video editor for talking-head footage. One command does the cutting (fillers and dead
air), the captions, a face-tracked 9:16 reframe, loudness and a delivery check. You run the commands, read the
outputs, and make the choices with the user.

Assumes a Linux machine with a shell, `git`, `curl`, and internet access for the first install.

## Rules

- Only edit videos the user owns or has the rights to edit.
- Never upload, post or publish anything, and never send the user's media to an online service, unless the user
  explicitly asks you to. AI Video Editor itself only renders local files.
- Never guess a person's name. Pass `--speaker` / `--role` only with names the user gave you.
- Keep the user's videos and renders out of the AI Video Editor checkout (use a separate folder such as `~/ai-video-editor-work/`).
- When a run uses music it writes a `CREDITS.txt` next to the export. Keep it with the video. Shorts have no
  music by default, so they don't get one.
- New videos (`ai-video-editor new`, section 6): nothing is generated before the user has seen the plan and said yes.
  A presenter with the user's own face or voice needs their consent record; a song needs `--i-own-this-music`, and
  only on the user's word. Never synthesise anyone else's likeness.

## 0. Talking with the user (read first)

The user may never have used a terminal. You run every command yourself; they only chat, tap choices and
watch results. Everything below the "internal" column is for you, never for them.

**Always attach the results to the chat: every finished video, its captions file (`.srt`) and its contact sheet
(`_sheet.png`). Never reply with only a file path.** If your chat can't attach a file (too big, no upload
tool), say so in one plain sentence, attach what you can (the sheet, the `.srt`, a short preview) and offer a
choice card of other ways to get the video (a smaller copy, a folder they can open).

### Plain words only

- One short, plain sentence per step. No flags, subcommands, file paths, exit codes, log lines or stack traces in
  what the user reads. Say "vertical" (not 9x16), "square" (1x1), "widescreen" (16x9), "hook line" (not `--hook`),
  "a quick preview" (not `--preview`).
- Never ask the user to open a terminal, run a command, install anything or edit a file. If something needs their
  hands (a password for `sudo`, a file only they have), ask for exactly that in one sentence.

### What they say -> what you run

Match the user's words to a row; ask (with a choice card) only when two rows fit. Their saved preferences
(format, hook, name for a lower third) fill the gaps.

| the user says (examples)                                             | you do (say it like this)                                      | internal: what you run |
|----------------------------------------------------------------------|----------------------------------------------------------------|------------------------|
| "make 3 shorts from this", "clip the best moments", "find the good bits", "shorts", "reels" | find moments to clip, show them as pick cards, render the picks | `shorts VIDEO -o OUT --propose --clips 3` -> read `OUT/proposals.json` -> pick card -> `shorts VIDEO -o OUT --pick N[,M] [--hook]` |
| "clean this up", "tighten this", "cut the ums", "remove the pauses", "just edit it" | a clean cut: fillers, long pauses and slips out, with captions | `clean-cut VIDEO -o OUT` (the default; no mode = clean-cut) |
| "add captions", "subtitle this", "put text on it", "I need an .srt"  | captions only, nothing cut                                     | `captions VIDEO -o OUT` |
| "talking head", "follow my face", "make it look pro", "motion graphics", "animated titles" | a motion-graphics edit that follows your face            | `talking-head VIDEO -o OUT` (+ `--speaker/--role` only with names they gave) |
| "screen recording", "tutorial", "explain this with diagrams"         | an explainer edit over your recording                         | `explainer VIDEO -o OUT [--script FILE]` |
| "make a new video", "from scratch", "I don't have footage", "promo", "ad for my brand" | plan a new video first; nothing gets made until you say yes | `new promo -o OUT --brand F --assets DIR` (section 6) |
| "presenter", "an AI host reads my script", "avatar"                  | plan a presenter video                                         | `new presenter -o OUT --script F` (own face/voice: consent first) |
| "explainer about X", "explain this topic with sources"               | plan an explainer that cites your sources                                       | `new explainer-cited -o OUT --source F --topic "..."` |
| "podcast", "two voices"                                              | plan a two-voice podcast                                       | `new podcast -o OUT --script F` |
| "a story", "short film", "music video" (their own song)              | plan a story or music video                                    | `new story ...` / `new music-video --song F --i-own-this-music` (only on their word) |
| "fix this", "vertical", "for TikTok", "for Reels", "for Shorts"      | make it vertical                                               | `--format 9x16` (the default) |
| "square", "for Instagram feed"; "widescreen", "for YouTube"; "all sizes" | square, widescreen or all three                           | `--format 1x1` / `--format 16x9` / `--format all` |
| "add a hook", "big text at the start"                                | a big hook line over the first 3 seconds                           | shorts: `--hook` |
| "put my name on it" (with the name)                                  | your name and title on screen                                   | `--speaker "Name" --role "Role"` (never guess a name) |
| "make it look like X", "punchy", "calm", "techy"                     | offer the look that matches                                        | `--style punch` / `broadsheet` / `terminal` (not clean-cut) |
| "show me first", "preview"                                           | a quick preview before the full video                         | `--preview` (captions / clean-cut / talking-head); shorts previews come with `--propose` |
| a link to their video                                                | fetch it, then the same flow                                   | pass the URL as VIDEO (only their own or public-domain / CC videos) |

`ai-video-editor` is the command in every row (`ai-video-editor shorts ...`). Use `-o` folders outside the
checkout, e.g. `~/ai-video-editor-work/<name>`.

### Choice cards at every decision (mandatory)

**At every decision you MUST send a question / choice widget** (your chat's tap-to-pick card). If the chat has no
widget, send a short numbered list with the same options. Do not improvise different wording: use the **exact**
question and option strings from the table below (and from getting-started for first-run cards). Put the recommended
option first and mark it "(recommended)". One plain question per card.

If the user has a saved preference, make that the recommended option. The decisions and their default:

| decision                 | card                                                                                              |
|--------------------------|---------------------------------------------------------------------------------------------------|
| intent                   | What should we make? / Clean up a video (recommended) \| Make short clips \| Add captions \| Make a new video from scratch |
| format                   | Which shape? / Vertical: TikTok, Reels, Shorts (recommended) \| Square \| Widescreen: YouTube \| All three |
| hook (shorts)            | Big hook line over the first seconds? / Yes (recommended) \| No                                    |
| new-video type           | What kind of video? / Promo for my brand (recommended when they gave a brand) \| Presenter reads my script \| Explainer with sources \| Story \| Podcast |
| shorts pick              | Which clips? / one option per candidate: `#id "hookCard" · durationSec s` (recommended = rank 1) \| All of them |
| preview check            | Look good? / Make the full version (recommended) \| Change the shape \| Try a different look      |
| after delivery           | What's next? / one or two fitting next steps (recommended first) \| I'm good                      |
| an error                 | How should we fix this? / the fixes from the error table below (likeliest first)                   |

After `shorts … --propose`, you MUST send a choice widget built from `OUT/proposals.json` (written by `--propose`, next to `PROPOSALS.txt`): a list of
`{id, rank, score, start, end, durationSec, sourceDurationSec, hook, hookCard, reason, previewPath}`. Show the
short `hookCard` text and `durationSec` (the length after the clean cut) on each option; attach each
`previewPath` clip so they can watch before picking; `id` is the number for `--pick`.

### Progress while they wait

Long steps (install, transcribing, rendering) get a plain update when they start. **For any render that may
take more than about a minute, start the command in the background** (or otherwise keep the chat free), then
relay a short plain-English update in chat **every 30–60 seconds** from the progress lines on stderr
(`ai-video-editor: …` or `ai-video-editor-progress: {…}` JSON when `--progress json` / `AI_VIDEO_EDITOR_PROGRESS=json`).
Never paste raw logs. Prefer `--progress plain` (default). Report version with `ai-video-editor --version`
(reads package.json — never `git describe`).

Stage lines look like:

| what's happening (log)                         | say                                                                     |
|------------------------------------------------|-------------------------------------------------------------------------|
| `./install.sh` starting                        | "Setting things up. The first time takes a few minutes. I'll tell you when it's ready." |
| install: Node / Python / packages              | "Installing the editing tools…"                                         |
| install: Whisper models (~2 GB)                | "Downloading the speech model that writes your captions. This is the slow part." |
| install: Chrome / fonts                        | "Almost there: adding the video renderer and caption font."                   |
| doctor: all PASS                               | "Ready."                                                                |
| `transcribing` / ASR                           | "Listening to your video and writing the captions…"                     |
| `picking` / proposals                          | "Finding moments to clip…"                                             |
| `render` / HyperFrames frames                  | "Rendering your video…"                                                 |
| delivery check / loudness                      | "Checking the sound level and captions…"                                |
| `ai-video-editor: … N% (M:SS elapsed)`           | "Still working — about N% / M:SS so far."                               |

### Quick preview, then the full render

Before a full render of captions, a clean cut or a talking-head edit, make a quick preview (about 20
seconds, from the first words to a pause), attach it with its sheet, then MUST send the exact "Look good?" card below. Then run the
same command without `--preview`.

```sh
ai-video-editor captions VIDEO -o OUT --preview          # OUT/preview/: ~20 s from the first speech, first format; exits 0
ai-video-editor captions VIDEO -o OUT                    # the full render once they say yes
```

Skip the preview when the video is under ~30 seconds (the full render is the preview), or when the user says to
go straight to the final. A delivery-check FAIL on the preview slice doesn't change its exit code (0); the full
render checks again. Shorts already preview: `--propose` writes one low-res preview per candidate.

### After delivery

Attach the files (bold rule above), say in one sentence what you made, then a "What's next?" card that
fits, e.g. "Make 3 shorts from this", "Add a hook line", "Try a different look", "Same video in square",
"Start another video", "I'm good". When delivery PASSed (`pass: true` / "DELIVERY PASS"), do **not** mention
internal gate FAIL lines (cuts, disfl, room, face, …) — those live under `diagnostics` in report.json for you.
Relay a FAIL in plain words only when delivery failed (`pass: false` / exit 1); see section 3 and the error card.

### Errors: a choice card, never the raw error

Read the log yourself. Tell the user what went wrong in one plain sentence and offer the fixes as a card. Fix
on your own anything that needs no decision from them (a missing `env.sh`, a re-run after a timeout).

| what happened (internal)                                   | say + card                                                                                  |
|------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| a link won't download (bot check, private, geo-blocked)    | "I couldn't download that link." / Upload the file instead (recommended) \| Try a different link \| Use the sample clip |
| exit 1, a delivery check FAIL (files written)              | "I made the video, but one check flagged <plain reason>." / Keep it (recommended if KNOWN_ISSUES says false alarm) \| Fix and render again \| Show me the details |
| exit 2, refused (style can't do it, bad option)            | "That look doesn't support <thing>." / Skip <thing> (recommended) \| Try another look \| Keep it plain |
| exit 5 / 137 / 143, the run stopped                        | "The render stopped before it finished." / Try again (recommended) \| Try a shorter part \| Make a smaller version |
| no shorts found (`no ... moment left`)                     | "I couldn't find a moment of that length that starts and ends cleanly." / Allow shorter or longer clips (recommended) \| Use the whole video \| Clean it up instead |
| doctor FAIL that needs `sudo`                              | "To install <tool>, I need your computer password once." / I'll type it (recommended) \| Skip for now |

### First run: fewest taps to a result

1. Install (section 1) while you ask their name and the intent card.
2. Ask for a video ("Drop a video here, or paste a link to one you own."), or offer the built-in sample clip.
3. Format card (vertical recommended), then the quick preview, then "Look good?".
4. Full render; attach video + `.srt` + sheet; "What's next?" card.

## 1. Install (once per machine)

You run the install yourself, from the chat, in one go; the user never opens a terminal. Tell them first, in
plain words: "I'm setting up the video editor on this computer. The first time takes a few minutes because it
downloads a speech model of about 2 GB. I'll tell you when it's ready." Give the progress lines from section 0
while it runs, ask the first-run questions meanwhile, and say "Ready." only after the doctor prints "doctor: all PASS".

If you are already inside an AI Video Editor checkout (the folder has `install.sh` and `ai-video-editor/cli/main.mjs`, for
example when Claude Code was started in the cloned repo), skip the `git clone` and `cd` and run the other
commands in that folder.

```sh
git clone --branch v1.4.3 https://github.com/nixeniego/ai-video-editor ~/ai-video-editor
cd ~/ai-video-editor
./install.sh            # safe to re-run; takes a while (downloads ~2 GB of Whisper models)
. ~/.ai-video-editor/env.sh  # run in EVERY new shell: puts ai-video-editor, Node 22 and the venv python on PATH
./install.sh --doctor   # must end with "doctor: all PASS"
```

Run `./install.sh` in the foreground and wait for it to return before the doctor: don't start it in the
background. A first install takes about 5-15 minutes, so give the command a long timeout (30 minutes). It ends
with the line `[ai-video-editor] first edit: ...`. If your shell tool still times out, run `./install.sh` again: it
skips what is already installed. Only call setup done after `./install.sh --doctor` prints "doctor: all PASS".

`./install.sh` turns off the renderer's (HyperFrames) anonymous usage telemetry itself: it sets
`HYPERFRAMES_NO_TELEMETRY=1` and `DO_NOT_TRACK=1` before anything runs and keeps them in `~/.ai-video-editor/env.sh`.

If the clone fails because `~/ai-video-editor` already exists, run `cd ~/ai-video-editor && git fetch --tags && git checkout v1.4.3` instead.

`./install.sh` also registers this skill as `~/.claude/skills/ai-video-editor` (a copy that names the checkout), so new
Claude Code sessions in any folder can load it; `./install.sh --skill-only` refreshes just that, and the doctor's
`claude-skill` line checks it.
Use `./install.sh --no-models` on a slow or metered connection; the models then download on the first edit.

## 2. Check dependencies and fix them

`./install.sh` installs or verifies all of these. `./install.sh --doctor` prints PASS or FAIL for each one. Fix
every FAIL, then run `./install.sh` and `./install.sh --doctor` again.

| doctor line          | what it is                                          | fix when it FAILs |
|----------------------|-----------------------------------------------------|-------------------|
| `node>=22`, `npm`    | Node.js 22+                                         | `./install.sh` downloads Node 22 into `~/.ai-video-editor/node` (needs `curl`). If it still fails, run `. ~/.ai-video-editor/env.sh` in this shell. |
| `ffmpeg`, `ffprobe`  | video tools                                         | Debian/Ubuntu: `sudo apt-get install -y ffmpeg`. Fedora: `sudo dnf install -y ffmpeg`. No sudo: put static builds of `ffmpeg` and `ffprobe` in `~/.local/bin` and add it to PATH. |
| `python3`            | Python 3 with `venv`                                | Debian/Ubuntu: `sudo apt-get install -y python3 python3-venv`. Fedora: `sudo dnf install -y python3`. |
| `faster-whisper`     | speech recognition (pinned 1.2.1, in the venv)      | `./install.sh`. If pip fails, check the network, then `rm -rf ~/.ai-video-editor/venv && ./install.sh`. |
| `opencv`             | face detection (in the venv)                        | `./install.sh` |
| `yunet-model`        | face model file                                     | `./install.sh` (downloads from GitHub, checksum-verified) |
| `yt-dlp`             | URL input only (optional for local files)           | `./install.sh` upgrades it |
| `whisper-models`     | Whisper `small` + `medium`                          | `./install.sh` (needs ~2 GB of disk and network) |
| `npm-deps`, `hyperframes`, `gsap` | the renderer and its packages          | `./install.sh` (runs `npm ci`) |
| `hyperframes-chrome` | the headless Chrome the renderer uses               | `./install.sh`. If renders later fail with a missing `.so` library, install Chrome's system libraries; Debian/Ubuntu: `cd ~/ai-video-editor && sudo npx playwright install-deps chromium`. |
| `caption-font`       | Montserrat for the captions                         | `./install.sh` (Linux: installs into `~/.local/share/fonts`; needs `fontconfig`, Debian/Ubuntu: `sudo apt-get install -y fontconfig`. macOS: installs into `~/Library/Fonts`; if it still FAILs, check `ls ~/Library/Fonts \| grep Montserrat` and `git pull` for the latest checks) |
| `style-fonts`        | Playfair Display + JetBrains Mono for the style packs | `./install.sh` (same place and needs as the caption font) |
| `env.sh`, `ai-video-editor-cli` | the `ai-video-editor` command                     | `./install.sh`, then `. ~/.ai-video-editor/env.sh` |
| `telemetry-off`      | env.sh opts out of HyperFrames telemetry            | `./install.sh` (rewrites env.sh), then `. ~/.ai-video-editor/env.sh` |
| `agent`              | optional `claude` / `codex` CLI (always PASS)       | nothing to fix; see "Picker agent" below |
| `backends`           | generation backends for `ai-video-editor new` (never FAILs on a missing config; shows key present yes/no only) | nothing to fix for the default flow (your built-in image/video generation + local voice); see `ai-video-editor/gen/BACKENDS.md` for optional hosted ones |

### Picker agent

When a `claude` or `codex` CLI is installed, AI Video Editor calls it to pick clips and review cuts. If that CLI is not
signed in or not usable in this shell, add `--agent none` to every `ai-video-editor` command; AI Video Editor then uses
its built-in heuristic picker. Check it first with `claude -p "say ok"` (or `codex exec "say ok"`). If that
fails or hangs, use `--agent none`. If neither command is installed (doctor shows `agent CLIs on PATH: none`),
AI Video Editor already uses the heuristic, and `--agent none` just makes that explicit.

## 3. Getting started (new user)

Ask the user for a video if they haven't given one yet, then do a quick first run so they see what AI Video Editor does:

```sh
. ~/.ai-video-editor/env.sh
mkdir -p ~/ai-video-editor-work/out
ai-video-editor --help                                         # every mode and option
ai-video-editor captions VIDEO.mp4 -o ~/ai-video-editor-work/out    # captions only, no cuts: the quickest first result
```

**Read the result, even when the command exits 1.** When it finishes, the CLI prints one line per export
(`ok FILE` or `CHECK FAIL FILE (FAIL <check>)`) and `done in ... s; report .../ai-video-editor_captions_VIDEO.report.json`.
It exits 1 when any export has a delivery FAIL, even though the mp4, `.srt`, `.vtt` and contact sheet were all
written and the video may be fine. So on exit 1 don't stop and don't re-run; review it:

1. Open `~/ai-video-editor-work/out/ai-video-editor_captions_VIDEO.report.json`. For each entry in `exports`: `pass`
   (false = a FAIL), `note` (which checks failed, e.g. `FAIL no-repeat`), `check` (the last lines of the delivery
   check: one `PASS` / `FAIL` / `NOTE` line per check, with the reason), `duration` (seconds), `loudness`
   (`I` LUFS, `TP` dBTP; the ceiling is -1.5 dBTP) and `overlaps` (captions that cover a face).
2. Look up each FAIL in `KNOWN_ISSUES.txt` in the checkout (section "Delivery check"). Example: `no-repeat` FAILs
   when the speaker deliberately says the same phrase twice close together ("so stop, stop it now. So stop, stop
   it now"); that is a known false alarm, not a retake.
3. Open the `_sheet.png` contact sheet, **attach the video, the `.srt` and the sheet to the chat** (never just
   a path), then tell the user every FAIL with its check text and whether it matches a
   known issue. Never hide a FAIL and never call a run with a FAIL "done"; let the user decide.

The length the CLI prints (`9x16: FILE (30.6 s, delivery ...)`) and the report's `duration` are the delivered
file's length, including the 0.2 s lead-in. Before v1.2.0 the CLI printed the length without the lead-in (30.4 s for
a 30.6 s file); if in doubt, check the file: `ffprobe -v error -show_entries format=duration -of csv=p=0 FILE.mp4`.

The modes are:

- `clean-cut` (the default when no mode is given): fillers, dead air and slips removed, clean captions.
- `captions`: burned-in captions plus `.srt` / `.vtt`, no cuts.
- `shorts`: a long video becomes ranked 9:16 shorts with captions (section 4).
- `talking-head`, `explainer`: motion-graphics edits (see `ai-video-editor --help`).
- `ai-video-editor new <type>`: a new video without source footage (section 6).

Output formats: `--format 9x16` (the default), `1x1`, `16x9` or `all`. Only ask the user about mode or format if
it isn't clear from the request.

## 4. Captioned shorts from an uploaded video

1. **Find the video.** Get the full path of the file the user uploaded or pointed to, and check it plays:
   ```sh
   ffprobe -v error -show_entries format=duration -of csv=p=0 "VIDEO.mp4"   # length in seconds
   ```
   If the user gave a URL instead, `ai-video-editor` accepts it directly, but only for videos they own or have the rights to.
2. **Propose.** This transcribes the whole video, then writes ranked candidates plus a quick low-res preview of each:
   ```sh
   . ~/.ai-video-editor/env.sh
   OUT=~/ai-video-editor-work/shorts-out
   mkdir -p "$OUT"
   nohup ai-video-editor shorts "VIDEO.mp4" -o "$OUT" --propose > "$OUT/propose.log" 2>&1 &
   tail -f "$OUT/propose.log"     # wait for the line "proposals: .../PROPOSALS.txt"
   ```
   This is slow on a CPU: on an 8-core machine an 87-minute video took about 35 minutes. Always run it in the
   background and check the log now and then. If the user only cares about one part, add `--range 12:00-20:00`.
   Add `--clips N` for more or fewer candidates (the default with `--propose` is 4).
3. **Show the proposals.** Read `$OUT/proposals.json` (the same candidates as `PROPOSALS.txt`, as a list of
   `{id, rank, score, start, end, durationSec, hook, hookCard, reason, previewPath}`) and show one pick card per
   candidate: its hook line (`hookCard`) and length (`durationSec`), with the reason in a few plain words. Attach each `previewPath` clip (`proposal_<n>_*_preview.mp4`) so they can watch before choosing. Let the
   user pick. If they ask you to choose, pick the highest-scoring candidate and say that you chose it.
4. **Render the picked clips** at full quality. Use the same video and `-o` folder so the transcript and proposals are reused:
   ```sh
   nohup ai-video-editor shorts "VIDEO.mp4" -o "$OUT" --pick 1 > "$OUT/render.log" 2>&1 &   # e.g. --pick 1,3
   tail -f "$OUT/render.log"     # wait for "done in ... s"; each clip takes roughly 30 minutes on a CPU
   ```
   The log prints "transcribing the whole source ..." again, but it reuses the saved transcript.
   Options: `--hook` adds a big hook card over the first 3 seconds. `--speaker "Name" --speaker-at mm:ss` adds a
   lower third, but only with a name the user gave you.
5. **Review before calling it done.**
   - Open every `*_sheet.png` contact sheet in `$OUT` and check the faces are in frame, captions are readable and
     not covering faces, and crops look right.
   - Read `$OUT/ai-video-editor_shorts_*.report.json`: each export's `pass`, its `check` text (the delivery check),
     `overlaps` (caption overlaps) and any FAIL lines. `$OUT/PICKS.txt` sums up each rendered clip.
   - Report every FAIL to the user with its text. Some are known false alarms (listed in `KNOWN_ISSUES.txt` in the
     checkout); say so if one matches, but never hide a FAIL and never call a run with a FAIL "done".
   - **Attach each short, `$OUT/short_<n>_<slug>.mp4`, its `.srt` and its contact sheet to the chat** (never
     just a path), and tell them its length: `ffprobe -v error -show_entries format=duration -of csv=p=0 FILE.mp4`. The length can
     run a few seconds over the 75 s target because the end snaps to a finished sentence.
6. **More clips later:** run `--pick` with other numbers. Rendered clips are marked as used, so a new `--propose`
   skips them. Use `--reset-used` to start fresh.

## 5. Styles, caption colour and face position

Only when the user asks for a style or a look (or names one):

```sh
ai-video-editor style list                                   # punch, broadsheet, terminal + the user's own packs
ai-video-editor talking-head VIDEO.mp4 -o OUT --style punch  # also captions / explainer / shorts; not clean-cut
ai-video-editor style skill broadsheet                       # writes ~/.claude/skills/ai-video-editor-style-broadsheet/SKILL.md
```

- `punch`: loud creator shorts. `broadsheet`: calm editorial. `terminal`: dark tech. Each has its own captions,
  transitions, number animation and signature move.
- If the CLI refuses a style (exit 2, "style ... can't render this run"), tell the user the reason it printed and
  fix the command (drop `--hook`, pick another mode or format, remove a plan beat). Don't edit a built-in pack.
- A user's own pack: `ai-video-editor style validate their-pack.json` lists every problem; fix them before rendering.
- `report.json` per export: `style`, `transitions`, `signatures`, `styleDropped` (beats the style left out).

Captions pick white or dark text from the footage behind them on their own (`contrast` in `report.json`). Only if
the user wants a fixed colour: `--caption-color white|black|#RRGGBB`.

If a contact sheet shows the framing on the wrong thing (a poster, a second person, a dark shot), re-run with
`--face top|center|bottom` or `--face X,Y` (fractions of the frame, e.g. `--face 0.3,0.4`).

## 6. A new video from a brief: `ai-video-editor new`

Types: `explainer-cited` (sources -> sourced script, citation chips, SOURCES.txt), `presenter` (a synthetic host
reads a script, 9:16, 15-90 s), `podcast` ("A: ..." / "B: ..." script, two voices, -16 LUFS; `--audio-only` for
WAV + MP3), `story` (multi-shot, `--characters` for character lock), `promo` (`--brand brand.json --assets DIR`,
zero generations), `music-video` (`--song FILE --i-own-this-music`, cut to the beat) and `other` (`--brief` mapped
to the closest type; the plan shows the mapping). `ai-video-editor new --help` lists every option.

Images and video clips are made by **your own built-in image/video generation** (the `host` backend: AI Video Editor
writes what it needs into a manifest and you make the files). Voice comes from the local TTS. Hosted APIs are
opt-in only (`--backend NAME`, configured by the user; see `ai-video-editor/gen/BACKENDS.md`). Follow these steps in
order:

1. **Plan.** Nothing is generated or sent anywhere:
   ```sh
   ai-video-editor new story -o ~/ai-video-editor-work/story --brief "A lighthouse at dusk. Waves hit the rocks. The light turns on." --format 9x16
   ai-video-editor new explainer-cited -o ~/ai-video-editor-work/bees --source notes.md --source https://example.org/page --topic "how bees find food"
   ai-video-editor new podcast -o ~/ai-video-editor-work/pod --script episode.txt --speakers "A=Host,B=Guest"
   ```
2. **Show the plan.** Give the user `PLAN.txt` (it starts with `generations: N video, M image, K TTS`, the cost and
   time estimate, `host generation: N asset(s)` and any `will send:` lines, then every shot) and open
   `storyboard.png` (one cell per shot) with them. If they want changes, re-plan with new options, or edit
   `plan.json` and run `ai-video-editor new repin <out>/plan.json`, then show the plan again.
3. **Approve only when the user says yes**:
   ```sh
   ai-video-editor new --approve ~/ai-video-editor-work/story/plan.json
   ```
   With no images or video to make (promo, podcast), this renders straight away. Otherwise it stops with **exit
   code 3** and prints the path of `GENERATION_MANIFEST.json` in the output folder: this is expected, not an error.
4. **Generate each asset in the manifest** with your built-in image/video generation. Every entry has `id`,
   `type` (`image` or `video`), `prompt`, `aspect`, `durationSec` (video), `referenceImages` (paths relative to
   the output folder; use them to keep a character consistent) and `firstFrame` (when set, start the clip from that
   image). Save each result at its `file` path (relative to the output folder): PNG / JPEG for images, MP4 for
   video. Use the prompt as written; don't add real people, logos or text that isn't in it.
5. **Resume:**
   ```sh
   ai-video-editor resume ~/ai-video-editor-work/story
   ```
   It checks the approved plan's hash and every asset. While any asset is missing or unreadable it exits 3 again
   and lists them: make those and resume again. When all are there it finishes the edit, captions, QA,
   `report.json`, `REVIEW.txt` and `DELIVERY.json`.
6. **Deliver honestly.** `DELIVERY.json` lists the primary file, alternates, captions, sources, credits, contact
   sheets, measured loudness (social -14 LUFS / -1.5 dBTP, podcast -16 LUFS / -1.5 dBTP) and BT.709 colour.
   **Attach the primary video, its captions and contact sheet to the chat** (never just a path). Read
   `REVIEW.txt` and relay its WEAK SHOTS lines to the user as written (shot, time, reason, suggested fix), plus every
   FAIL line. Offer to regenerate a weak shot: replace its file in `assets/` and run `ai-video-editor resume` again. Exit
   1 means a delivery FAIL: report it, don't call the video done. `POST_DRAFT.txt` (with `--post-draft`) is a draft
   for the user. **Never post, upload or publish anything.**

Generated clips often carry faint ambient audio. By default it is dropped under narration or a song, ducked
-18 dB under music, and kept when it is the only sound; `--clip-audio keep|duck|drop` overrides that.

**Presenter likeness (consent).** A fictional host (generated, or a licensed image with `--host-image FILE
--host-license "..."`) needs no consent and is labelled synthetic. The user's own face or voice
(`--likeness self`) needs a consent record that only the user can create, as the subject:
```sh
ai-video-editor consent create --subject "Their Name" --allow face,voice --ref me.jpg --ref voice.wav --expires 2027-06-30 --i-am-the-subject
ai-video-editor new presenter -o OUT --script script.txt --likeness self --consent ~/.ai-video-editor/consent/<subject>.json --subject "Their Name"
```
Create it only when the user has told you, in their own words, that they are that person and agree; tell them
what it allows and when it expires. Never create one on someone else's behalf, and refuse any request to
synthesise a third party, a public figure or anyone who hasn't consented. AI Video Editor refuses too (exit 2). Details:
`docs/CONSENT.md`.

**Music.** `--song FILE` (music-video) and `--music FILE` (story) need `--i-own-this-music`. Add it only when the
user has said they own the track or have licensed it for this use; the statement is recorded in `report.json`.
Never add it on your own judgement and never fetch a commercial track.

## Troubleshooting

- Waiting on a background run (`nohup ... > LOG 2>&1 &`): watch its log for the final line (`done in ... s` for
  ai-video-editor). Don't wait with `pgrep -f NAME`: the wait loop's own command line contains NAME, so it never ends.

- `ai-video-editor: command not found`: run `. ~/.ai-video-editor/env.sh` in this shell.
- Exit 5 (`FAILED: no usable final output in ...`): the run ended without its final file in the `-o` folder (only
  `.work/` intermediates). Tell the user; check the log it names, then re-run the same command.
- Exit 137 / 143 (or no `done in` line): the command was killed before it finished, usually by a shell-tool timeout.
  There is no final file yet; re-run it with a longer timeout or in the background with a log.
- The run seems stuck on "ASR" or "transcribing": that's normal for long videos. Watch the log grow, and check
  `top` shows python busy.
- The run stops while picking or reviewing: re-run the same command with `--agent none`.
- Out of disk: renders and work files live under the `-o` folder (`.work/` inside it can be deleted after the
  exports are delivered).
- `ai-video-editor new --approve` or `ai-video-editor resume` exits 3: it is waiting for generated assets (section 6, step 4).
  Exit 2 with "changed after it was approved": the plan was edited; show it to the user and `--approve` it again.
- Anything else: run `./install.sh --doctor` in the checkout, fix the FAILs, and re-run the same command (finished
  steps are cached and reused).

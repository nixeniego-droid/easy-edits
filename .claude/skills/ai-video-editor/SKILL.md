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

## 1. Install (once per machine)

If you are already inside an AI Video Editor checkout (the folder has `install.sh` and `ai-video-editor/cli/main.mjs`, for
example when Claude Code was started in the cloned repo), skip the `git clone` and `cd` and run the other
commands in that folder.

```sh
git clone https://github.com/nixeniego-droid/easy-edits ~/ai-video-editor
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

If the clone fails because `~/ai-video-editor` already exists, run `cd ~/ai-video-editor && git pull` instead.

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
3. Open the `_sheet.png` contact sheet, then tell the user every FAIL with its check text and whether it matches a
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
3. **Show the proposals.** Read `$OUT/PROPOSALS.txt` and give the user each candidate's rank, score, timestamps,
   hook line and reason. The `preview:` files it lists (`proposal_<n>_*_preview.mp4`) are in `$OUT`; point the
   user to them so they can watch before choosing. Let the
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
   - Give the user the path of each short, `$OUT/short_<n>_<slug>.mp4` (with `.srt` / `.vtt` subtitles next to
     it), and its length: `ffprobe -v error -show_entries format=duration -of csv=p=0 FILE.mp4`. The length can
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
   sheets, measured loudness (social -14 LUFS / -1.5 dBTP, podcast -16 LUFS / -1.5 dBTP) and BT.709 colour. Read
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

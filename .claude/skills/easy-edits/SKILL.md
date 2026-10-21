---
name: easy-edits
description: Use when someone says "set up Easy Edits" or wants to edit a talking-head video on a Linux machine with Easy Edits, for example to turn a long video into captioned 9:16 shorts, make a clean cut, or add captions. It covers installing Easy Edits, checking and fixing its dependencies, proposing short clips, rendering the picked ones, and reviewing the results.
---

# Easy Edits

Easy Edits is a command-line video editor for talking-head footage. One command does the cutting (fillers and dead
air), the captions, a face-tracked 9:16 reframe, loudness and a delivery check. You run the commands, read the
outputs, and make the choices with the user.

Assumes a Linux machine with a shell, `git`, `curl`, and internet access for the first install.

## Rules

- Only edit videos the user owns or has the rights to edit.
- Never upload, post or publish anything, and never send the user's media to an online service, unless the user
  explicitly asks you to. Easy Edits itself only renders local files.
- Never guess a person's name. Pass `--speaker` / `--role` only with names the user gave you.
- Keep the user's videos and renders out of the Easy Edits checkout (use a separate folder such as `~/easy-edits-work/`).
- When a run uses music it writes a `CREDITS.txt` next to the export. Keep it with the video. Shorts have no
  music by default, so they don't get one.

## 1. Install (once per machine)

If you are already inside an Easy Edits checkout (the folder has `install.sh` and `easy-edits/cli/main.mjs`, for
example when Claude Code was started in the cloned repo), skip the `git clone` and `cd` and run the other
commands in that folder.

```sh
git clone https://github.com/nixeniego-droid/easy-edits ~/easy-edits
cd ~/easy-edits
./install.sh            # safe to re-run; takes a while (downloads ~2 GB of Whisper models)
. ~/.easy-edits/env.sh  # run in EVERY new shell: puts easy-edits, Node 22 and the venv python on PATH
./install.sh --doctor   # must end with "doctor: all PASS"
```

`./install.sh` turns off the renderer's (HyperFrames) anonymous usage telemetry itself: it sets
`HYPERFRAMES_NO_TELEMETRY=1` and `DO_NOT_TRACK=1` before anything runs and keeps them in `~/.easy-edits/env.sh`.

If the clone fails because `~/easy-edits` already exists, run `cd ~/easy-edits && git pull` instead.
Use `./install.sh --no-models` on a slow or metered connection; the models then download on the first edit.

## 2. Check dependencies and fix them

`./install.sh` installs or verifies all of these. `./install.sh --doctor` prints PASS or FAIL for each one. Fix
every FAIL, then run `./install.sh` and `./install.sh --doctor` again.

| doctor line          | what it is                                          | fix when it FAILs |
|----------------------|-----------------------------------------------------|-------------------|
| `node>=22`, `npm`    | Node.js 22+                                         | `./install.sh` downloads Node 22 into `~/.easy-edits/node` (needs `curl`). If it still fails, run `. ~/.easy-edits/env.sh` in this shell. |
| `ffmpeg`, `ffprobe`  | video tools                                         | Debian/Ubuntu: `sudo apt-get install -y ffmpeg`. Fedora: `sudo dnf install -y ffmpeg`. No sudo: put static builds of `ffmpeg` and `ffprobe` in `~/.local/bin` and add it to PATH. |
| `python3`            | Python 3 with `venv`                                | Debian/Ubuntu: `sudo apt-get install -y python3 python3-venv`. Fedora: `sudo dnf install -y python3`. |
| `faster-whisper`     | speech recognition (pinned 1.2.1, in the venv)      | `./install.sh`. If pip fails, check the network, then `rm -rf ~/.easy-edits/venv && ./install.sh`. |
| `opencv`             | face detection (in the venv)                        | `./install.sh` |
| `yunet-model`        | face model file                                     | `./install.sh` (downloads from GitHub, checksum-verified) |
| `yt-dlp`             | URL input only (optional for local files)           | `./install.sh` upgrades it |
| `whisper-models`     | Whisper `small` + `medium`                          | `./install.sh` (needs ~2 GB of disk and network) |
| `npm-deps`, `hyperframes`, `gsap` | the renderer and its packages          | `./install.sh` (runs `npm ci`) |
| `hyperframes-chrome` | the headless Chrome the renderer uses               | `./install.sh`. If renders later fail with a missing `.so` library, install Chrome's system libraries; Debian/Ubuntu: `cd ~/easy-edits && sudo npx playwright install-deps chromium`. |
| `caption-font`       | Montserrat for the captions                         | `./install.sh` (installs into `~/.local/share/fonts`; needs `fontconfig`, Debian/Ubuntu: `sudo apt-get install -y fontconfig`) |
| `env.sh`, `easy-edits-cli` | the `easy-edits` command                     | `./install.sh`, then `. ~/.easy-edits/env.sh` |
| `telemetry-off`      | env.sh opts out of HyperFrames telemetry            | `./install.sh` (rewrites env.sh), then `. ~/.easy-edits/env.sh` |
| `agent`              | optional `claude` / `codex` CLI (always PASS)       | nothing to fix; see "Picker agent" below |

### Picker agent

When a `claude` or `codex` CLI is installed, Easy Edits calls it to pick clips and review cuts. If that CLI is not
signed in or not usable in this shell, add `--agent none` to every `easy-edits` command; Easy Edits then uses
its built-in heuristic picker. Check it first with `claude -p "say ok"` (or `codex exec "say ok"`). If that
fails or hangs, use `--agent none`. If neither command is installed (doctor shows `agent CLIs on PATH: none`),
Easy Edits already uses the heuristic, and `--agent none` just makes that explicit.

## 3. Getting started (new user)

Ask the user for a video if they haven't given one yet, then do a quick first run so they see what Easy Edits does:

```sh
. ~/.easy-edits/env.sh
mkdir -p ~/easy-edits-work/out
easy-edits --help                                         # every mode and option
easy-edits captions VIDEO.mp4 -o ~/easy-edits-work/out    # captions only, no cuts: the quickest first result
```

**Read the result, even when the command exits 1.** When it finishes, the CLI prints one line per export
(`ok FILE` or `CHECK FAIL FILE (FAIL <check>)`) and `done in ... s; report .../easy-edits_captions_VIDEO.report.json`.
It exits 1 when any export has a delivery FAIL, even though the mp4, `.srt`, `.vtt` and contact sheet were all
written and the video may be fine. So on exit 1 don't stop and don't re-run; review it:

1. Open `~/easy-edits-work/out/easy-edits_captions_VIDEO.report.json`. For each entry in `exports`: `pass`
   (false = a FAIL), `note` (which checks failed, e.g. `FAIL no-repeat`), `check` (the last lines of the delivery
   check: one `PASS` / `FAIL` / `NOTE` line per check, with the reason), `duration` (seconds), `loudness`
   (`I` LUFS, `TP` dBTP) and `overlaps` (captions that cover a face).
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
- `talking-head`, `explainer`: motion-graphics edits (see `easy-edits --help`).

Output formats: `--format 9x16` (the default), `1x1`, `16x9` or `all`. Only ask the user about mode or format if
it isn't clear from the request.

## 4. Captioned shorts from an uploaded video

1. **Find the video.** Get the full path of the file the user uploaded or pointed to, and check it plays:
   ```sh
   ffprobe -v error -show_entries format=duration -of csv=p=0 "VIDEO.mp4"   # length in seconds
   ```
   If the user gave a URL instead, `easy-edits` accepts it directly, but only for videos they own or have the rights to.
2. **Propose.** This transcribes the whole video, then writes ranked candidates plus a quick low-res preview of each:
   ```sh
   . ~/.easy-edits/env.sh
   OUT=~/easy-edits-work/shorts-out
   mkdir -p "$OUT"
   nohup easy-edits shorts "VIDEO.mp4" -o "$OUT" --propose > "$OUT/propose.log" 2>&1 &
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
   nohup easy-edits shorts "VIDEO.mp4" -o "$OUT" --pick 1 > "$OUT/render.log" 2>&1 &   # e.g. --pick 1,3
   tail -f "$OUT/render.log"     # wait for "done in ... s"; each clip takes roughly 30 minutes on a CPU
   ```
   The log prints "transcribing the whole source ..." again, but it reuses the saved transcript.
   Options: `--hook` adds a big hook card over the first 3 seconds. `--speaker "Name" --speaker-at mm:ss` adds a
   lower third, but only with a name the user gave you.
5. **Review before calling it done.**
   - Open every `*_sheet.png` contact sheet in `$OUT` and check the faces are in frame, captions are readable and
     not covering faces, and crops look right.
   - Read `$OUT/easy-edits_shorts_*.report.json`: each export's `pass`, its `check` text (the delivery check),
     `overlaps` (caption overlaps) and any FAIL lines. `$OUT/PICKS.txt` sums up each rendered clip.
   - Report every FAIL to the user with its text. Some are known false alarms (listed in `KNOWN_ISSUES.txt` in the
     checkout); say so if one matches, but never hide a FAIL and never call a run with a FAIL "done".
   - Give the user the path of each short, `$OUT/short_<n>_<slug>.mp4` (with `.srt` / `.vtt` subtitles next to
     it), and its length: `ffprobe -v error -show_entries format=duration -of csv=p=0 FILE.mp4`. The length can
     run a few seconds over the 75 s target because the end snaps to a finished sentence.
6. **More clips later:** run `--pick` with other numbers. Rendered clips are marked as used, so a new `--propose`
   skips them. Use `--reset-used` to start fresh.

## Troubleshooting

- `easy-edits: command not found`: run `. ~/.easy-edits/env.sh` in this shell.
- The run seems stuck on "ASR" or "transcribing": that's normal for long videos. Watch the log grow, and check
  `top` shows python busy.
- The run stops while picking or reviewing: re-run the same command with `--agent none`.
- Out of disk: renders and work files live under the `-o` folder (`.work/` inside it can be deleted after the
  exports are delivered).
- Anything else: run `./install.sh --doctor` in the checkout, fix the FAILs, and re-run the same command (finished
  steps are cached and reused).

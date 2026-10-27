# URL input

Every AI Video Editor mode can take a YouTube link, or any other link that
[yt-dlp](https://github.com/yt-dlp/yt-dlp) supports, in place of a local file:

```bash
ai-video-editor https://www.youtube.com/watch?v=VIDEO_ID -o out/
ai-video-editor shorts https://youtu.be/VIDEO_ID -o out/ --clips 3
ai-video-editor captions https://www.youtube.com/watch?v=VIDEO_ID -o out/ --cookies cookies.txt
```

**Only use this on videos you own or have the rights to edit.** Downloading
other people's videos can break the site's terms and copyright law.

## What happens

1. `ai-video-editor/bin/fetch-input.sh` downloads the best video up to 1080p plus the
   best audio, preferring H.264/AAC. ffmpeg merges them into one mp4 at
   `<out-dir>/.work/downloads/<Site>-<id>.mp4`, for example
   `Youtube-7oBhvnB5lAU.mp4`.
2. The download must have both a video and an audio stream.
3. AI Video Editor then edits that local file, the same as if you had passed its path.
   The clip name in the output files is `<Site>-<id>`.
4. If you run it again with the same URL and `-o`, it reuses the file without
   touching the network. `<out-dir>/.work/downloads/url-<hash>.txt` records
   which URL each file came from. Delete the mp4 to force a fresh download.

The script also works on its own. It prints only the local path on stdout:

```bash
ai-video-editor/bin/fetch-input.sh <url> [--work-dir DIR] [--cookies cookies.txt]
```

| Exit code | Meaning |
| --- | --- |
| 0 | OK; the path is on stdout |
| 2 | Usage error, or the cookies file is missing or not in Netscape format |
| 3 | yt-dlp or ffmpeg is missing (run `./install.sh`) |
| 4 | The download failed (the reason and your options are on stderr) |
| 5 | A file was downloaded but has no video+audio |

## When the download fails

YouTube often blocks server and cloud IPs with "Sign in to confirm you're not a
bot". Downloads also fail for age-restricted, private, members-only and
geo-blocked videos. In every case AI Video Editor stops before editing, says what
happened, and gives you two options:

1. **Use your browser's cookies.** Sign in to the site in your browser and
   export `cookies.txt` (Netscape format) with an extension such as
   "Get cookies.txt LOCALLY". Then re-run with `--cookies cookies.txt`. AI Video Editor
   passes yt-dlp a copy, so your file is never changed. Treat `cookies.txt` like
   a password: don't commit it or share it. Export it again if it expires.
2. **Download the video yourself** and pass the file path instead of the URL:
   `ai-video-editor <mode> /path/to/video.mp4 -o out/`.

## yt-dlp

`./install.sh` installs `yt-dlp[default]` into AI Video Editor's venv
(`$AI_VIDEO_EDITOR_HOME/venv/bin/yt-dlp`). Re-run it to update yt-dlp; YouTube changes
often, and old versions stop working. The script looks for yt-dlp in this order:

1. `$AI_VIDEO_EDITOR_YTDLP`
2. the venv
3. `yt-dlp` on `PATH`

It passes Node to yt-dlp as the JavaScript runtime that YouTube's format
signatures need.

#!/usr/bin/env bash
# Easy Edits URL input: download a YouTube (or any yt-dlp-supported) video so every mode can take a URL as <input>.
#   easy-edits/bin/fetch-input.sh <url> [--work-dir DIR] [--cookies cookies.txt] [-h|--help]
# Downloads the best <=1080p video + best audio (H.264/AAC preferred), merged to one mp4 by ffmpeg, into
# DIR (default ./.work/downloads; the CLI passes <out-dir>/.work/downloads). Prints ONLY the local mp4 path on stdout;
# progress and errors go to stderr. A URL already fetched into DIR is reused without touching the network
# (DIR/url-<sha1>.txt maps the URL to its file). Use it only on videos you own or have the rights to edit.
# --cookies FILE: a Netscape cookies.txt exported from your browser (for sign-in / bot checks). It is copied first,
#   because yt-dlp writes cookies back to the file it is given.
# yt-dlp: $EASY_EDITS_YTDLP, else $EASY_EDITS_HOME/venv/bin/yt-dlp (install.sh), else yt-dlp on PATH.
# Exit: 0 ok, 2 usage / bad cookies file, 3 yt-dlp or ffmpeg missing, 4 download failed, 5 downloaded file unusable.
set -euo pipefail

EASY_EDITS_HOME="${EASY_EDITS_HOME:-$HOME/.easy-edits}"
say() { printf '[easy-edits] %s\n' "$*" >&2; }
usage() { sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit "${1:-2}"; }

URL="" WORK="" COOKIES=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --work-dir) [ $# -ge 2 ] || usage; WORK="$2"; shift 2 ;;
    --cookies) [ $# -ge 2 ] || usage; COOKIES="$2"; shift 2 ;;
    -*) say "unknown option $1"; usage ;;
    *) [ -z "$URL" ] || { say "only one URL, got '$URL' and '$1'"; usage; }; URL="$1"; shift ;;
  esac
done
[ -n "$URL" ] || usage
[[ "$URL" =~ ^https?:// ]] || { say "not a URL: $URL (local files are passed to easy-edits directly)"; exit 2; }
WORK="${WORK:-$PWD/.work/downloads}"

if [ -n "$COOKIES" ]; then
  [ -f "$COOKIES" ] && [ -r "$COOKIES" ] || { say "cookies file not found or unreadable: $COOKIES"; exit 2; }
  # Netscape format: a '# Netscape HTTP Cookie File' / '# HTTP Cookie File' header, or tab-separated 7-field lines
  if ! head -n 1 "$COOKIES" | grep -q '^# \(Netscape \)\{0,1\}HTTP Cookie File' \
     && ! grep -v '^#' "$COOKIES" | awk -F'\t' 'NF==7 {ok=1} END {exit !ok}'; then
    say "$COOKIES does not look like a Netscape cookies.txt (export it with a 'Get cookies.txt' browser extension)"; exit 2
  fi
fi

YTDLP="${EASY_EDITS_YTDLP:-}"
[ -n "$YTDLP" ] || { [ -x "$EASY_EDITS_HOME/venv/bin/yt-dlp" ] && YTDLP="$EASY_EDITS_HOME/venv/bin/yt-dlp"; } || true
[ -n "$YTDLP" ] || YTDLP="$(command -v yt-dlp 2>/dev/null || true)"
[ -n "$YTDLP" ] || { say "yt-dlp is not installed. Run ./install.sh (it puts yt-dlp in $EASY_EDITS_HOME/venv), or download the video yourself and pass the file path."; exit 3; }
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || { say "ffmpeg/ffprobe missing (needed to merge video + audio). Run ./install.sh."; exit 3; }

# "video audio" if the file has both streams, for the reuse check and the final check
streams() { ffprobe -v error -show_entries stream=codec_type -of csv=p=0 "$1" 2>/dev/null | sort -u | tr '\n' ' '; }
usable() { [ -s "$1" ] && case "$(streams "$1")" in *audio*video*) return 0 ;; *) return 1 ;; esac; }

mkdir -p "$WORK"; WORK="$(cd "$WORK" && pwd)"
KEY="$(printf '%s' "$URL" | { sha1sum 2>/dev/null || shasum; } | cut -c1-12)"
MAP="$WORK/url-$KEY.txt"
if [ -f "$MAP" ]; then
  prev="$(sed -n 2p "$MAP")"
  if [ -n "$prev" ] && usable "$prev"; then say "reusing $prev"; printf '%s\n' "$prev"; exit 0; fi
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
args=(--no-playlist --restrict-filenames --no-mtime --retries 3 --fragment-retries 3
      -f 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b' -S 'res:1080,vcodec:h264,acodec:aac,ext:mp4:m4a'
      --merge-output-format mp4 -P "$WORK" -o '%(extractor_key)s-%(id)s.%(ext)s'
      --print after_move:filepath)
[ -t 2 ] || args+=(--no-progress)
# YouTube needs a JS runtime for its signature challenges (formats go missing without one). yt-dlp-ejs wants Node >= 20:
# the first of $EASY_EDITS_NODE, node on PATH, Easy Edits' own ($EASY_EDITS_HOME/node, install.sh), ~/.local/node*/bin/node.
node_ok() { [ -x "$1" ] && [ "$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]; }
JSNODE=""
for n in "${EASY_EDITS_NODE:-}" "$(command -v node 2>/dev/null || true)" "$EASY_EDITS_HOME/node/bin/node" "$HOME"/.local/node*/bin/node; do
  [ -n "$n" ] && node_ok "$n" && { JSNODE="$n"; break; }
done
if [ -n "$JSNODE" ]; then args+=(--js-runtimes "node:$JSNODE")
else say "no Node >= 20 found: yt-dlp runs without a JS runtime, so some YouTube formats may be missing (set EASY_EDITS_NODE)"; fi
if [ -n "$COOKIES" ]; then cp "$COOKIES" "$TMP/cookies.txt"; args+=(--cookies "$TMP/cookies.txt"); fi

say "downloading $URL (best <=1080p mp4 with audio) into $WORK"
set +e
"$YTDLP" "${args[@]}" -- "$URL" >"$TMP/out" 2> >(tee "$TMP/err" >&2)
rc=$?
set -e
wait  # let the stderr tee finish
FILE="$(grep -v '^\s*$' "$TMP/out" | tail -n 1 || true)"

if [ "$rc" -ne 0 ] || [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  err="$(grep -i 'ERROR' "$TMP/err" | tail -n 1)"; [ -n "$err" ] || err="$(tail -n 1 "$TMP/err")"
  shopt -s nocasematch
  case "$err" in
    *"confirm your age"*|*age-restricted*|*"inappropriate for some users"*)
      why="The video is age-restricted, so YouTube needs a signed-in account to serve it." ;;
    *"not a bot"*|*"Sign in to confirm"*)
      why="YouTube asked for a sign-in to confirm you're not a bot. It does this to many server and cloud IPs." ;;
    *"Private video"*|*"is private"*)
      why="The video is private. Only accounts it was shared with can download it." ;;
    *members-only*|*"Join this channel"*|*"members only"*)
      why="The video is for channel members only." ;;
    *"not available in your country"*|*"geo restrict"*|*geo-restrict*|*"not made this video available in your country"*)
      why="The video is geo-blocked: it isn't available from this server's country." ;;
    *"HTTP Error 429"*|*"Too Many Requests"*)
      why="The site is rate-limiting this server's IP (HTTP 429)." ;;
    *"HTTP Error 403"*|*Forbidden*)
      why="The site refused the download (HTTP 403). This often means it is blocking this server's IP." ;;
    *"Unsupported URL"*)
      why="yt-dlp doesn't know how to download from this URL." ;;
    *"Video unavailable"*|*"video is unavailable"*|*"has been removed"*|*"does not exist"*|*"HTTP Error 404"*)
      why="The video is unavailable: removed, deleted or the link is wrong." ;;
    *"Unable to download webpage"*|*"Name or service not known"*|*"timed out"*|*"Temporary failure in name resolution"*|*"Connection refused"*)
      why="The download couldn't reach the site (network error)." ;;
    *) why="The download failed." ;;
  esac
  shopt -u nocasematch
  [ -n "$COOKIES" ] && cookie_tip="  1. Export a FRESH cookies.txt from a browser where you're signed in (yours may be expired or from a
     different account), then re-run with --cookies cookies.txt." \
    || cookie_tip="  1. Export cookies.txt from a browser where you're signed in (a 'Get cookies.txt' extension; Netscape
     format), then re-run with:  --cookies cookies.txt"
  cat >&2 <<MSG

[easy-edits] Couldn't download $URL
[easy-edits] $why
[easy-edits] yt-dlp said: ${err:-<no error output>}

What you can do:
$cookie_tip
  2. Or download the video yourself and pass the file path instead of the URL:
       easy-edits <mode> /path/to/video.mp4 -o <out-dir>
MSG
  exit 4
fi

if ! usable "$FILE"; then
  say "downloaded $FILE but it has no video+audio streams ($(streams "$FILE")). Download the video yourself and pass the file path instead."
  exit 5
fi
printf '%s\n%s\n' "$URL" "$FILE" > "$MAP"
say "downloaded $FILE"
printf '%s\n' "$FILE"

#!/usr/bin/env sh
# Rebuilds samples/talk.mp4: a 15.4 s trim (0:05.5 to 0:20.9) of NASA SVS14069, Gavin Schmidt's "Where does 2021 rank"
# interview, downloaded from Wikimedia Commons. Public domain (NASA / US government work); see LICENSE.
# Needs ffmpeg and curl. Pass a local copy of the .webm as $1 to skip the download.
set -eu
cd "$(dirname "$0")"
url='https://commons.wikimedia.org/wiki/Special:FilePath/The_Numbers_Are_In-_Where_Does_2021_Rank_for_Global_Temperatures_Live_Shots_(SVS14069_-_Gavin_Canned_Interview_pt_2).webm'
src=${1:-}
if [ -z "$src" ]; then
  src=$(mktemp "${TMPDIR:-/tmp}/svs14069.XXXXXX.webm")
  trap 'rm -f "$src"' EXIT
  curl -fL --retry 3 -o "$src" "$url"
fi
ffmpeg -hide_banner -loglevel error -y -ss 5.5 -i "$src" -t 15.4 \
  -vf "scale=1280:720:flags=lanczos,format=yuv420p" -r 30 \
  -c:v libx264 -preset slow -crf 30 -c:a aac -b:a 64k -ac 1 -ar 48000 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -movflags +faststart talk.mp4

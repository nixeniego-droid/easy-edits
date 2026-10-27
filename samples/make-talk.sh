#!/usr/bin/env sh
# Regenerates samples/talk.mp4: 6 s of colour bars with a "SAMPLE" label and a speech-like tone (a wobbling ~160 Hz
# voice with syllable bursts and two pauses). Synthetic, made only with ffmpeg's lavfi sources; CC0 (see LICENSE).
set -eu
cd "$(dirname "$0")"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "smptebars=s=540x960:r=30:d=6" \
  -f lavfi -i "aevalsrc='0.35*sin(2*PI*(160+25*sin(2*PI*3*t))*t)*(0.55+0.45*sin(2*PI*4.5*t))*lt(mod(t,3),2.3)':s=48000:d=6" \
  -vf "drawtext=font=Sans:text='SAMPLE':fontsize=72:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=18:x=(w-tw)/2:y=h*0.12,drawtext=font=Sans:text='synthetic test clip (CC0)':fontsize=30:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10:x=(w-tw)/2:y=h*0.12+110,format=yuv420p" \
  -c:v libx264 -preset slow -crf 30 -c:a aac -b:a 64k -ac 1 -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -movflags +faststart -shortest talk.mp4

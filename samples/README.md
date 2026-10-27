# samples

`talk.mp4`: a 15-second 16:9 talking-head clip (1280x720, about 650 KB) with a real face and clear speech, for
trying the commands in the help and README, e.g. `ai-video-editor samples/talk.mp4 -o out/`. It's NASA climate
scientist Gavin Schmidt saying:

> Last year was the sixth warmest year on record, which is slightly down from the warmest year on record that we had
> last year, but it's just part of the ups and downs of what's going on in the climate system, but the long-term
> trends are very, very clearly still up.

`script.txt` holds those words, so you can check the captions against them.

Public domain: a NASA (US government) work, trimmed for this demo (see `LICENSE`). `./samples/make-talk.sh` rebuilds
it from the Wikimedia Commons original (needs ffmpeg and curl; it downloads about 3 MB).

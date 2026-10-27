Easy Edits v1.4.0
==============

Zero-instruction video editing: point it at a talking-head video, get a finished edit back.

  easy-edits talk.mp4 -o out/

Built on Herk Edit Kit by Nate Herk + HyperFrames. README.md has the full docs; this is the short version.
Known flaws: KNOWN_ISSUES.txt.


INSTALL (Linux or macOS; needs git and curl)

  git clone https://github.com/nixeniego-droid/easy-edits
  cd easy-edits
  ./install.sh                     # Node 22, ffmpeg, faster-whisper + models, OpenCV, yt-dlp, npm deps, Chrome, fonts
  . ~/.easy-edits/env.sh              # in every new shell (puts easy-edits on your PATH)
  ./install.sh --doctor            # PASS/FAIL per dependency
  easy-edits --help


TRY IT (public-domain NASA clip, 15 s)

  curl -fL -o nasa.webm "https://upload.wikimedia.org/wikipedia/commons/b/b8/The_Numbers_Are_In-_Where_Does_2021_Rank_for_Global_Temperatures_Live_Shots_%28SVS14069_-_Gavin_Canned_Interview_pt_2%29.webm"
  ffmpeg -v error -ss 5.5 -i nasa.webm -t 15.3 -c:v libx264 -c:a aac sample.mp4
  easy-edits captions sample.mp4 -o out/


MODES

  clean-cut     (default) Removes fillers, dead air and clear slips, adds clean minimal captions.
                easy-edits talk.mp4 -o out/

  talking-head  The clean cut plus motion design: title card, kinetic captions, lower third, punch-ins,
                icon pops, top-box cards, end card, music bed.
                easy-edits talking-head talk.mp4 -o out/ --speaker "Ana Cruz" --role "Founder"

  explainer     Turns a script or transcript into scenes (cards, lists, diagrams, zooms on screen activity),
                synced to the voiceover. Takes a video, or a .txt script (voiced with local TTS).
                easy-edits explainer screen-recording.mp4 -o out/ --script script.md

  shorts        Finds standalone moments in a long talk or podcast and renders them as 9:16 shorts with a
                speaker-following reframe and captions.
                easy-edits shorts podcast.mp4 -o out/ --propose

  captions      Captions only, no cuts: burned in plus .srt / .vtt.
                easy-edits captions talk.mp4 -o out/


FORMAT

  --format 9x16 | 1x1 | 16x9 | all      (default 9x16)


SHORTS FLAGS

  --propose        write PROPOSALS.txt (ranked candidates) + a low-res preview per candidate, then stop
  --pick 1,3       render only those proposals at full quality (and log them as used)
  --hook ["text"]  big hook card over the first 3 s (no text = the clip's own hook line)
  --reset-used     clear the used-clips log, so earlier picks can be proposed again

  Rendering one format at a time writes the same file name each time, so move each output before the next run.


STYLES (captions, talking-head, explainer, shorts)

  --style punch | broadsheet | terminal | PATH.json
                   punch: loud creator look, whip transitions, numbers slam in, punch-in camera shake
                   broadsheet: calm editorial serif, dips through paper, numbers count up, letterbox bars
                   terminal: dark mono tech look, RGB glitch, numbers decode, HUD brackets on the face
  easy-edits style list                  every pack (built-in + ~/.easy-edits/styles)
  easy-edits style validate <pack>       check a pack; every problem listed
  easy-edits style skill <pack>          write a Claude Code skill that edits in that style
  The renderer refuses anything a pack doesn't support and says why.


CAPTIONS

  Captions pick white or dark text from the footage behind them (auto contrast).
  --caption-color auto | white | black | #RRGGBB     fix the colour instead
  --face top | center | bottom | X,Y                  where the face is, when face detection gets it wrong


URL INPUT

  Every mode also takes a YouTube (or other video) link instead of a file (downloaded first, <= 1080p).
  Use this ONLY on videos you own or have the rights to edit. docs/URL_INPUT.md has the details.

  easy-edits https://www.youtube.com/watch?v=VIDEO_ID -o out/
  --cookies FILE   a Netscape cookies.txt exported from your browser, for sign-in / bot checks. Keep it private.


AI AGENTS

  Claude Code, Codex, Cursor or any other agent with a shell: see "Use it with any AI agent" in README.md.
  Agents read AGENTS.md / CLAUDE.md.


TESTS

  npm test


LICENCE

  MIT (LICENSE). Credits: CREDITS.txt. Third-party licences: THIRD_PARTY_NOTICES.md.

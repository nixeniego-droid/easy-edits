# Multi-shot story and music video

Two generation-first recipes (they become `easy-edits new story` / `easy-edits new music-video`; until then run
them with `node easy-edits/story/run.mjs`, `--help` lists every option). Both go through the generation backend
layer (`../gen/CONTRACT.md`): `EASY_EDITS_BACKEND` / `--backend`, keys only from env or `~/.easy-edits/providers.json`.

```sh
# story: a brief (one shot per sentence / bullet) or a shotlist
node easy-edits/story/run.mjs story --shotlist shotlist.json --characters characters.json -o out/ --aspect 9:16
node easy-edits/story/run.mjs story --brief "A lighthouse at dusk. Waves hit the rocks. The light turns on." --narrate -o out/ --aspect 16:9

# music video: your own song, cut to the beat (refused without --i-own-this-music)
node easy-edits/story/run.mjs music-video --song song.wav --i-own-this-music --lyrics song.lrc --brief brief.txt -o out/ --aspect 4:5

# review the plan first, then render it
node easy-edits/story/run.mjs story --shotlist shotlist.json -o out/ --plan-only
node easy-edits/story/run.mjs story --plan out/story.plan.json -o out/
```

Try it offline with the mock backend: `EASY_EDITS_BACKEND=mock node easy-edits/story/run.mjs story --brief "..." -o out/`.

## Inputs

- `shotlist.json`: `{title?, style?, shots:[{id, durationSec, prompt, characters:[names], camera, transition,
  transitionSec?, narration?, caption?, clip?, source?, seed?}]}`. `transition` is how the shot comes in: `cut`,
  `fade`, `dissolve`, `fadeblack`, `fadewhite`, `wipeleft`, `slideleft`, `smoothleft`, `circleopen`, ... (ffmpeg
  xfade names; aliases `crossfade`, `dip`, `whip`). `clip` is your own footage for that shot.
- `characters.json`: `[{name, refs:[image files], description}]`. Every shot that lists a character gets the
  description in its prompt; the reference images go to backends whose `capabilities.references` is true.
- Lyrics (music video): LRC (`[mm:ss.xx] line`), SRT, or plain lines (spread evenly, with a note). User-supplied only.
- `--aspect`: `9:16` (default), `16:9`, `1:1`, `4:5`, any `W:H`, or an exact `WxH` such as `1080x1350`.

## What happens

1. **Plan.** Shots get a source: generated video when a video backend is configured, else a generated still with
   a Ken Burns move, else a code-drawn text card; `clip` shots use your footage. A beat longer than the video
   backend's `maxClipSeconds` is split into equal parts (`s3.1`, `s3.2`, ...; hard cuts between them). The plan
   counts generations (`video`, `image`, `TTS`) and the estimated cost from the backend's `costPerCall`.
2. **Music video only.** `beats.mjs` decodes the song with ffmpeg and finds onsets (log-energy rise, full band +
   high band), the tempo (envelope autocorrelation) and the beats (dynamic-programming beat tracking, each beat
   moved onto the nearest strong onset), downbeats every 4th beat. Cuts walk the song in ~4-beat steps and snap to
   the nearest beat (a downbeat when about as close) within the tolerance. The video is the song's length.
3. **Generate + conform.** Each shot is generated (falling back video -> still -> card per shot, with the reason),
   then conformed to WxH, 30 fps, BT.709 yuv420p at exactly its timeline length.
4. **Per-shot QA.** Black frames (`blackdetect`), frozen frames (`freezedetect`), duration match (what the backend
   returned vs the request), a flicker score (signalstats YDIF spikes over their rolling median + YAVG up-down
   oscillation) and identity drift (colour-histogram Bhattacharyya distance + average-hash distance to the
   character's reference images; a cheap proxy, not face recognition). Problems go to `WEAK_SHOTS`.
5. **Assemble.** Cuts or xfade transitions centred on the planned cut times, captions burned from the shot
   narration / captions or the lyrics, soundtrack (TTS narration per shot, your `--narration` audio, your song or
   `--music` bed, or a quiet synthesised ambient bed), mastered with `audio/master.mjs` to -14 LUFS / -1.5 dBTP.

## Outputs (in `-o DIR`)

`easy-edits_<recipe>_<title>.mp4`, `_sheet.png` (one frame per shot), `.srt` / `.vtt` when there are captions,
`<recipe>.plan.json`, `easy-edits_<recipe>_<title>.report.json` and `REVIEW.txt` (plain sentences an agent can relay).
`report.json` has `shots` (source, prompt, refs passed, fallbacks, QA metrics), `splits`, `WEAK_SHOTS` (`shot`,
`timestamp`, `reason`, `fix`), `loudness` (measured I / TP), `color` (ffprobe tags), `checks`, `generations`, and
for music video `music.attestation` (flag, song name, sha256, time), `beats`, `cuts` (target, beat, `snapErrorMs`)
and `snap` (mean / max error). The runner exits 1 when a finishing check (loudness, colour, duration) FAILs and 2
on a refusal or a bad request. Weak shots are reported, not failures.

## Limits

- The QA can't tell whether a shot matches its prompt, and the identity score is a colour / layout proxy: look at
  the sheet. A real face-identity model is future work (its licence has to be checked first).
- The ownership attestation is the user's claim; Easy Edits records it but can't verify it.
- Beat tracking is energy based: clear percussive music works best; rubato or beatless tracks fall back to even cuts.

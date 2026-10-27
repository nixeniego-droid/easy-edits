# Presenter shorts and likeness consent

The presenter recipe makes a 9:16, 15-90 s short read by a synthetic presenter: script -> voice (tts backend) ->
host (avatar backend) -> captions from the script -> -14 LUFS / -1.5 dBTP, BT.709. Every presenter video is
marked `synthetic: true` in `report.json`, and an on-screen "AI-generated presenter" label is on by default
(`--no-disclosure` turns the label off; the report still says synthetic).

```sh
node ai-video-editor/presenter/run.mjs --script script.md -o out/ --length 30            # fictional host
node ai-video-editor/presenter/run.mjs --script script.md -o out/ --host-image host.png \
  --host-license "Own work, CC0"                                                    # licensed host image
node ai-video-editor/presenter/run.mjs --script script.md -o out/ --likeness self \
  --consent ~/.ai-video-editor/consent/ana-cruz.json --subject "Ana Cruz"                 # your own face + voice
```

(`ai-video-editor new presenter ...` once the `new` command lands; the flags are the same.)

## Hosts

- **Fictional** (`--likeness fictional`, the default): an image from the image backend, or your own
  `--host-image FILE` with `--host-license "..."` (who made it and the licence that lets you use it). A licensed
  image must not show a real, identifiable person who hasn't consented; for that, use `--likeness self` (it's you)
  or don't.
- **Self** (`--likeness self`): your face and/or voice (`--use face|voice|both`, default both), only with a
  consent record. Any other value of `--likeness` (a name, a celebrity) is refused.

With the avatar backend `none` the host is a local still with a slow breathing zoom and sway (no lip-sync).

## Consent records

```sh
ai-video-editor consent create --subject "Ana Cruz" --allow face,voice \
  --ref me.jpg --ref my-voice.wav --expires 2027-06-30 --i-am-the-subject
ai-video-editor consent verify ~/.ai-video-editor/consent/ana-cruz.json --use both
```

`consent.json` holds the subject, what is allowed (`face`, `voice` or `both`), `granted_at`, `expires_at`, the
subject's statement, how it was attested (`cli`, or `agent-relay` with the user's own words from `--relay "..."`)
and every reference file with its sha256. It is written to `~/.ai-video-editor/consent/<subject>.json` with mode 600
(`-o FILE` to choose); keep it and the reference media out of the repo.

A `--likeness self` run refuses **before any generation** when:

- there is no record, or it isn't valid JSON, or it isn't self-attested;
- it has expired (or was granted in the future);
- it doesn't allow what the run needs (a face-only record can't clone a voice);
- `--subject` doesn't match the record;
- a reference file is missing or changed since consent was given (sha256 mismatch);
- the tts backend can't clone a voice (`voiceClone` capability) when voice is used.

The record is checked again just before rendering. `consent create` refuses without `--i-am-the-subject`
and refuses `--on-behalf-of`: consent only ever comes from the person themselves, never for a third party or a
public figure. An agent may create a record for its user only when the user is that person and says so; pass their
words with `--relay`.

## What leaves the machine

Reference media and the script stay local with local backends (mock, local). When a backend has
`capabilities.network`, the plan lists exactly what it would receive under `will send:` (for example "the script
text and 1 voice reference file(s) of Ana Cruz to tts backend ..."), and the run stops after planning until you
re-run with `--approve <plan.json>` (hash-checked against the current run). `--offline` refuses any network
backend.

## Outputs

`ai-video-editor_presenter_<name>.mp4`, `_sheet.png`, `.srt` / `.vtt` (from the script, nothing is transcribed),
`.plan.json`, `PLAN.txt` (generation count, est. cost, host, voice, consent, will send) and `.report.json`
(`synthetic`, `disclosure`, `likeness`, `consent` summary with reference names and hashes, `avatar`, `calls`,
`loudness`, `length`, and the checks: aspect, length 15-90 s, loudness -14 +-1 LUFS / <= -1.5 dBTP, colour
bt709/bt709/bt709).

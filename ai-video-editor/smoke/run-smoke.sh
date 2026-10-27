#!/usr/bin/env bash
# AI Video Editor smoke test: trim a source clip to ~10 s (ending in a pause), transcribe it
# locally with faster-whisper, build a HyperFrames composition with the default
# caption preset (ai-video-editor/presets/captions-default), lint and render it with the
# kit's pinned HyperFrames, then master loudness to -14 LUFS / -1.5 dBTP.
#
#   ai-video-editor/smoke/run-smoke.sh <source.mp4> <output.mp4> [target-seconds]
#   AI_VIDEO_EDITOR_MUSIC="calm piano" adds an Openverse music bed (off by default).
#   AI_VIDEO_EDITOR_LEADIN=0.3 sets the post-pass lead-in (default 0.2 s; 0 disables).
#
# Work dir: video-projects/ai-video-editor-smoke/ (gitignored upstream; media never enters git).
set -euo pipefail
SRC="$(realpath "$1")"; OUT="$(realpath -m "$2")"; TARGET="${3:-10}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PROJ="$REPO/video-projects/ai-video-editor-smoke"
AI_VIDEO_EDITOR_HOME="${AI_VIDEO_EDITOR_HOME:-$HOME/.ai-video-editor}"
[ -f "$AI_VIDEO_EDITOR_HOME/env.sh" ] && . "$AI_VIDEO_EDITOR_HOME/env.sh"
PY="${AI_VIDEO_EDITOR_PYTHON:-$AI_VIDEO_EDITOR_HOME/venv/bin/python}"
HF="$REPO/node_modules/.bin/hyperframes"
mkdir -p "$PROJ/assets" "$PROJ/renders"
cd "$PROJ"

# 1. transcribe a slightly longer window, then end the clip in the first pause after TARGET-0.5 s
ffmpeg -v error -y -t "$((TARGET + 3))" -i "$SRC" -vn -ac 1 -ar 16000 assets/probe.wav
"$PY" "$HERE/asr_words.py" assets/probe.wav assets/probe-words.json "${WHISPER_MODEL:-small}"
DUR="$(node -e '
const w=require("./assets/probe-words.json").words, T=+process.argv[1];
let end=T;
for(let i=0;i<w.length;i++){const n=w[i+1]; if(w[i].end>=T-0.5 && (!n || n.start-w[i].end>=0.15)){end=w[i].end+0.12; break;}}
console.log((Math.round(end*30)/30).toFixed(3));' "$TARGET")"
echo "clip duration: $DUR s"

# 2. frame-exact trim (1080x1920 30 fps H.264 video + 48 kHz PCM audio)
ffmpeg -v error -y -i "$SRC" -t "$DUR" -an -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30" \
  -c:v libx264 -preset veryfast -crf 16 -g 30 -keyint_min 30 -movflags +faststart -pix_fmt yuv420p assets/clip.mp4
ffmpeg -v error -y -i "$SRC" -t "$DUR" -vn -ac 2 -ar 48000 -af "afade=t=out:st=$(node -p "($DUR-0.05).toFixed(3)"):d=0.05" assets/voice-raw.wav
"$PY" "$HERE/asr_words.py" assets/voice-raw.wav assets/transcript.json "${WHISPER_MODEL:-small}"

# 3. voice goes into the composition unprocessed; loudness is mastered after render (step 6)
cp assets/voice-raw.wav assets/mix.wav

# 4. composition
cp "$REPO/node_modules/gsap/dist/gsap.min.js" assets/
[ -f hyperframes.json ] || cat > hyperframes.json <<'JSON'
{ "$schema": "https://hyperframes.heygen.com/schema/hyperframes.json", "paths": { "assets": "assets" } }
JSON
node "$HERE/build.mjs" "$DUR"

# 5. lint (stock kit checks) + render
"$HF" lint . || { echo "lint failed"; exit 1; }
# Stock preflight and lint disagree about root data-start next to an inline <video> (same as the
# upstream reference projects); lint wins, so a preflight failure is reported, not fatal.
node "$REPO/scripts/preflight.mjs" "$PROJ" || echo "(preflight reported issues; see above)"
"$HF" render . -o renders/smoke.mp4 --quality high
mkdir -p "$(dirname "$OUT")"; cp renders/smoke.mp4 "$OUT"

# 6. AI Video Editor post-pass (ai-video-editor/post/postpass.mjs): lead-in (AI_VIDEO_EDITOR_LEADIN, default 0.2 s, 0 = off),
# optional Openverse CC0/CC BY music bed (AI_VIDEO_EDITOR_MUSIC, CREDITS.txt next to the output), then the
# two-pass loudness master to -14 LUFS, true peak <= -1.5 dBTP, then the delivery check (exit status kept)
CHECK=0; node "$HERE/../post/postpass.mjs" "$OUT" || CHECK=$?

# 7. report
echo "output: $OUT"
echo "duration: $(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT") s"
ffmpeg -hide_banner -nostats -i "$OUT" -filter_complex ebur128=peak=true -f null - 2>&1 | sed -n '/Summary:/,$p'
exit "$CHECK"

#!/usr/bin/env bash
# AI Video Editor CLEAN CUT, the APPROVED style (locked: ai-video-editor/presets/clean-cut-default.json;
# every other style is EXPERIMENTAL). Fast path, no DESIGN.md, no creative agent. Usually `edit.sh --style clean-cut`.
#   ai-video-editor/bin/clean-cut.sh <source.mp4> <project-dir> <out.mp4> [--lang auto|en|tl|...] [--mode clean|light|strict]
#                            [--transcript words.json] [--no-review] [--review-patch FILE] [--names FILE] [--claude BIN]
#                            [--review-only] [--dry-run] [-h|--help]
# --review-patch FILE: a human or agent review patch ({"keep":[i],"remove":[i],"text":{i:"word"},"notes":".."}, word
#   indices of cut-review.md) applied instead of the claude light review.
# --build-only: stop after the build (assets/clip.mp4 + mix.wav + transcript.json + index.html; the ai-video-editor CLI's
#   motion modes layer on it); no caption verify, render, gates or post.
# --review-only: stop after the cut and print <project>/assets/cut-review.md (any agent reviews it against
#   styles/clean-cut/brief-<mode>.md, writes the patch, then re-runs with --review-patch; prep is cached).
# Style: ai-video-editor/styles/clean-cut/ (style.json, brief.md, look.json, captions.json). Run dir <out>.run/.
#   prep    tools/source-prep.mjs (face boxes, 9:16 cover crop) || tools/cut-candidates.mjs (in parallel: the whole-file disfluent decode via
#           check/asr_excerpts.py + window-confirmed stutters / restarts / fillers, cached by source sha1)
#   asr     the transcript = that whole-file disfluent decode (fillers and repeats kept; talk_30s: 87 words, complete),
#           so no second decode. Fallback (no candidates, e.g. AI_VIDEO_EDITOR_CUTCAND=0): smoke/asr_words.py medium
#           --disfluent --lang L. (A plain asr_words.py medium decode of talk_30s returned 6 words.) --transcript
#           FILE reuses a transcript.
#   cut     styles/clean-cut/cut.mjs -> assets/edit-decisions.json, transcript.json, cut-review.md
#   review  ONE short `claude -p` (bin/claude-watchdog.mjs, --max-turns 3, the word table inlined in the prompt, cap
#           AI_VIDEO_EDITOR_REVIEW_CAP=120 s, model AI_VIDEO_EDITOR_REVIEW_MODEL=sonnet; ~10 s) writes <out>.run/review-patch.json;
#           a patch with changes re-runs cut.mjs --patch. --no-review skips it; a timeout or failure keeps the
#           deterministic cut.
#   build   styles/clean-cut/build.mjs (clip.mp4 + crossfaded mix.wav + held / faded tail + index.html)
#   render  styles/clean-cut/burn.mjs: each caption drawn once by HyperFrames' own Chrome from the same index.html CSS,
#           overlaid on assets/clip.mp4 for its exact window, one x264 encode (veryfast, crf 15) + mix.wav (~10 s for
#           a 30-40 s clip; the per-frame HyperFrames render took 73-477 s). AI_VIDEO_EDITOR_RENDER=hyperframes uses
#           bin/render.sh final instead.
#   gates   fault-only gates of style.json, in parallel (logs <out>.run/gates/<label>.log); skipped gates printed
#   post    post.mjs (lead-in, -14 LUFS, delivery check) -> <out>.post.mp4, then the phone copy <out>.phone.mp4
# Language: --lang, else ~/.ai-video-editor/profile.json language, else style.json language (auto); exported as
# AI_VIDEO_EDITOR_LANG for every check. Timing per phase -> <out>.run/timing.json and the summary line.
# Exit: 1 if a gate fails, else post's status.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ -f "${AI_VIDEO_EDITOR_HOME:-$HOME/.ai-video-editor}/env.sh" ] && . "${AI_VIDEO_EDITOR_HOME:-$HOME/.ai-video-editor}/env.sh"
STYLE="$REPO/ai-video-editor/styles/clean-cut" C="$REPO/ai-video-editor/check" T="$REPO/ai-video-editor/tools"
DRY=0 REVIEW=1 RONLY=0 BONLY=0 LANGV= TRIN= RPATCH= MODE= NAMES=none CLAUDE=() POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    --dry-run) DRY=1; shift ;;
    --no-review) REVIEW=0; shift ;;
    --review-only) RONLY=1; shift ;;
    --build-only) BONLY=1; shift ;;
    --mode) MODE="${2:?--mode needs clean, light or strict}"; shift 2 ;;
    --review-patch) RPATCH="$(realpath -m "${2:?--review-patch needs a file}")"; [ -f "$RPATCH" ] || { echo "clean-cut: missing review patch $2" >&2; exit 2; }; shift 2 ;;
    --lang) LANGV="${2:?--lang needs a value}"; shift 2 ;;
    --transcript) TRIN="$(realpath -m "${2:?--transcript needs a file}")"; [ -f "$TRIN" ] || { echo "clean-cut: missing transcript $2" >&2; exit 2; }; shift 2 ;;
    --names) NAMES="$(realpath -m "${2:?--names needs a file}")"; [ -f "$NAMES" ] || { echo "clean-cut: missing names file $2" >&2; exit 2; }; shift 2 ;;
    --claude) CLAUDE=(--claude "${2:?--claude needs a binary}"); shift 2 ;;
    --style) [ "${2:-}" = clean-cut ] || { echo "clean-cut: --style must be clean-cut" >&2; exit 2; }; shift 2 ;;
    *) POS+=("$1"); shift ;;
  esac
done
[ ${#POS[@]} -eq 3 ] || { echo "usage: edit.sh --style clean-cut <source.mp4> <project-dir> <out.mp4> [--lang L] [--transcript words.json] [--mode M] [--no-review | --review-only | --review-patch FILE] [--names FILE] [--claude BIN] [--dry-run] (--help)" >&2; exit 2; }
SRC="$(realpath -m "${POS[0]}")" PROJ="$(realpath -m "${POS[1]}")" OUT="$(realpath -m "${POS[2]}")"
[ -f "$SRC" ] || { echo "clean-cut: missing $SRC" >&2; exit 2; }
RUN="${OUT%.mp4}.run"; PREP="$RUN/prep"; WORDS="${TRIN:-$RUN/source.words.json}"; PATCH="$RUN/review-patch.json"
# Source normalisation: phone footage carries extra streams (iPhone: a 4-channel APAC spatial-audio track ffmpeg
# cannot decode, mebx metadata) and display rotation (coded 1920x1080 + rotation -90 = a 1080x1920 picture). Every
# tool here opens the source with default stream selection and some read the coded size, so the run works on
# <run>/source.mov: video 0:v:0 and audio 0:a:0 only (explicit maps); rotation baked in by a re-encode (x264 crf 14)
# when the source is rotated, else stream copy. Skipped for a plain source (one video + one audio stream, no
# rotation) and on --dry-run.
if [ $DRY = 0 ]; then
  NSTREAM=$(ffprobe -v error -show_entries stream=index -of csv=p=0 "$SRC" | wc -l)
  ROT=$(ffprobe -v error -select_streams v:0 -show_entries stream_side_data=rotation -of csv=p=0 "$SRC" | tr -d ' ,\n'); ROT=${ROT:-0}
  if [ "$NSTREAM" -gt 2 ] || [ "$ROT" != 0 ]; then
    mkdir -p "$RUN"; NSRC="$RUN/source.mov"
    if [ "$ROT" != 0 ]; then VC=(-c:v libx264 -preset veryfast -crf 14 -pix_fmt yuv420p); else VC=(-c:v copy); fi
    ffmpeg -v error -y -i "$SRC" -map 0:v:0 -map 0:a:0 "${VC[@]}" -c:a copy -map_metadata -1 -dn "$NSRC" \
      || { echo "clean-cut: source normalisation failed" >&2; exit 2; }
    echo "clean-cut: source normalised -> $NSRC ($NSTREAM streams, rotation $ROT; mapped 0:v:0 + 0:a:0)" >&2
    SRC="$NSRC"
  fi
fi
if [ -z "$LANGV" ]; then
  LANGV="$(node -e 'const fs=require("fs");let l;try{l=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).language}catch{};console.log(l||JSON.parse(fs.readFileSync(process.argv[2],"utf8")).language||"auto")' "${AI_VIDEO_EDITOR_HOME:-$HOME/.ai-video-editor}/profile.json" "$STYLE/style.json")"
fi
export AI_VIDEO_EDITOR_LANG="$LANGV"
# cut mode: --mode, else style.json cutMode (clean). clean = fillers + dead air > 0.8 s + clear slips (stutters,
# false starts, repeats; self-corrections via the review; approved 2026-10-18); light = fillers + dead air
# only (repeats and self-corrections stay); strict = the original repeat / false-start rules with pauses > 0.3 s.
[ -n "$MODE" ] || MODE="$(node -e 'console.log(require(process.argv[1]).cutMode||"clean")' "$STYLE/style.json")"
case "$MODE" in clean) AIRMAX=0.9 DISFL=() RULES="$STYLE/brief-clean.md" ;; light) AIRMAX=0.9 DISFL=(--fillers-only) RULES="$STYLE/brief-light.md" ;; strict) AIRMAX=0.3 DISFL=() RULES="$STYLE/brief-strict.md" ;; *) echo "clean-cut: --mode must be clean, light or strict" >&2; exit 2 ;; esac
PY="${AI_VIDEO_EDITOR_PYTHON:-${AI_VIDEO_EDITOR_HOME:-$HOME/.ai-video-editor}/venv/bin/python}"
VERB="$REPO/ai-video-editor/presets/verbatim-heard.json"
CONFIRMED="$(node -e 'try { console.log((JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).verbatim?.confirmed || []).join(",")) } catch { console.log("") }' "$VERB")"
HEARD="$(node -e 'try { console.log((JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).verbatim?.heard || []).join(",")) } catch { console.log("") }' "$VERB")"

PREPC=(node "$T/source-prep.mjs" "$SRC" "$PREP")
CANDC=(env OMP_NUM_THREADS="${AI_VIDEO_EDITOR_CANDC_THREADS:-4}" node "$T/cut-candidates.mjs" "$SRC" "$PREP")
ASRC=("$PY" -I "$REPO/ai-video-editor/smoke/asr_words.py" "$SRC" "$WORDS" "${AI_VIDEO_EDITOR_ASR_MODEL:-medium}" --disfluent --lang "$LANGV")
FROMCAND=(node -e 'const fs = require("fs"), [c, o, l] = process.argv.slice(1); const j = JSON.parse(fs.readFileSync(c, "utf8"));
if (!j.whole?.length) process.exit(1);
fs.writeFileSync(o, JSON.stringify({ language_code: l, produced_by: "cut-candidates whole-file disfluent decode (check/asr_excerpts.py)", words: j.whole.map((w) => ({ ...w, type: "word" })) }, null, 1));' "$PREP/source.cut-candidates.json" "$WORDS" "$LANGV")
CUTC=(node "$STYLE/cut.mjs" "$WORDS" "$PROJ" --source "$SRC" --candidates "$PREP/source.cut-candidates.json" --mode "$MODE")
REVC=(node "$REPO/ai-video-editor/bin/claude-watchdog.mjs" --prompt-file "$RUN/review.md" --log "$RUN/review.log" --stream-log "$RUN/review.jsonl" "${CLAUDE[@]}" -- --model "${AI_VIDEO_EDITOR_REVIEW_MODEL:-sonnet}" --max-turns 3 --permission-mode bypassPermissions)
# AI_VIDEO_EDITOR_FACE (ai-video-editor --face top|center|bottom|X,Y): the build and the face gates read a copy of the prep with
# every scene's face box and 9:16 crop on that point (engine/face-override.mjs), for when face detection is wrong
PREPJ="$PREP/source-prep.json"; [ -n "${AI_VIDEO_EDITOR_FACE:-}" ] && PREPJ="$PREP/source-prep.face.json"
BUILDC=(node "$STYLE/build.mjs" "$PROJ" --source "$SRC" --prep "$PREPJ")
# caption verify (review aid, never a gate): a second decode of the built audio (plain + disfluent, 10 s windows)
# flags caption words it did not hear; with the claude review on, one short text-only pass (brief-captions.md) may
# fix them (caption-only: a text fix never moves a cut), then cut + build again, before the render. --review-patch /
# --no-review: report only, run alongside the render and gates. AI_VIDEO_EDITOR_CAPVERIFY=0 skips it.
CVC=(env OMP_NUM_THREADS="${AI_VIDEO_EDITOR_ASR_THREADS:-6}" node "$C/caption-verify.mjs" "$PROJ" --lang "$LANGV" --json)
CPATCH="$RUN/caption-patch.json"
REVC2=(node "$REPO/ai-video-editor/bin/claude-watchdog.mjs" --prompt-file "$RUN/caption-review.md" --log "$RUN/caption-review.log" --stream-log "$RUN/caption-review.jsonl" "${CLAUDE[@]}" -- --model "${AI_VIDEO_EDITOR_REVIEW_MODEL:-sonnet}" --max-turns 3 --permission-mode bypassPermissions)
if [ "${AI_VIDEO_EDITOR_RENDER:-burn}" = hyperframes ]; then RENDERC=("$REPO/ai-video-editor/bin/render.sh" final "$PROJ" "$OUT")
else RENDERC=(node "$STYLE/burn.mjs" "$PROJ" "$OUT" --color-from "$SRC"); fi
POSTC=(env AI_VIDEO_EDITOR_LEADIN_PRESET="${AI_VIDEO_EDITOR_LEADIN_PRESET:-veryfast}" node "$REPO/ai-video-editor/post.mjs" "$OUT")
if [ "${AI_VIDEO_EDITOR_POST_NO_CHECK:-0}" = 1 ]; then POSTC+=(--no-check); fi

# gates: stage + label + command; the labels must match style.json "gates" (bin/test/clean-cut.test.mjs checks it).
# Stages: "pre" gates run WHILE the video renders: project-only checks, and the audio checks on assets/mix.wav (the
# render only muxes that mix; the final-stage gate mixmatch proves the final carries it unchanged, and post's
# delivery check transcribes the final itself). "final" gates need the rendered video and run alongside post.
# Speed (8 cores): the two ASR gates run with OMP_NUM_THREADS=AI_VIDEO_EDITOR_GATE_THREADS (3); caption-face-final runs as
# AI_VIDEO_EDITOR_FACE_SLICES (3) parallel time slices (bin/lib/finalface-split.sh).
MIX="$PROJ/assets/mix.wav" TH="${AI_VIDEO_EDITOR_GATE_THREADS:-3}"
G_STG=() G_LBL=() G_CMD=()
gate() { G_STG+=("$1"); G_LBL+=("$2"); shift 2; G_CMD+=("$(printf '%q ' "$@")"); }
gate final stale     node "$C/final-fresh.mjs" "$PROJ" "$OUT"
gate final mixmatch  node "$C/mix-match.mjs" "$MIX" "$OUT"
gate pre   names     node "$T/name-guard.mjs" "$PROJ" --names "$NAMES"
gate pre   verbatim  node "$T/verbatim-guard.mjs" "$PROJ"
gate pre   verbatim  env OMP_NUM_THREADS="$TH" node "$C/verbatim-final.mjs" "$PROJ" "$MIX" --swaps --confirmed "$CONFIRMED" --heard "$HEARD" --lang "$LANGV"
gate pre   verbatim  node "$C/caption-cover.mjs" "$PROJ"
gate pre   cuts      node "$T/cut-guard.mjs" "$PROJ" --source "$SRC"
gate pre   disfl     env OMP_NUM_THREADS="${AI_VIDEO_EDITOR_DISFL_THREADS:-4}" node "$C/disfluency.mjs" "$MIX" --lang "$LANGV" "${DISFL[@]}"
gate pre   air       node "$C/dead-air.mjs" "$MIX" --max "$AIRMAX"
gate pre   room      node "$C/room-tone.mjs" "$PROJ" "$MIX"
gate pre   face      node "$C/caption-face.mjs" "$PROJ" --prep "$PREPJ"
gate final finalface "$REPO/ai-video-editor/bin/lib/finalface-split.sh" "${AI_VIDEO_EDITOR_FACE_SLICES:-3}" "$PROJ" "$OUT" --prep "$PREPJ"
gate pre   style     node "$C/text-style.mjs" "$PROJ" --one-caption --no-kinetic-size
gate pre   capsize   node "$C/caption-size.mjs" "$PROJ" --preset "$STYLE/captions.json"
gate pre   read      node "$C/readability.mjs" "$PROJ"
gate final aspect    node "$C/aspect.mjs" "$PROJ" "$OUT"
gate final content   env OMP_NUM_THREADS="$TH" node "$C/content-kept.mjs" "$PROJ" "$OUT" --source "$SRC" --lang "$LANGV"
# AI_VIDEO_EDITOR_GATES=delivery (CLI default): skip ASR-heavy fault gates; CLI delivery check covers the final.
# full = every gate in style.json (CI / polish).
if [ "${AI_VIDEO_EDITOR_GATES:-full}" = "delivery" ]; then
  DROP="content|disfl|verbatim"
  NEW_STG=() NEW_LBL=() NEW_CMD=()
  for i in "${!G_LBL[@]}"; do
    # keep verbatim-guard + caption-cover (fast); drop verbatim-final (ASR) which shares label "verbatim" and uses verbatim-final.mjs
    case "${G_CMD[$i]}" in
      *verbatim-final.mjs*|*disfluency.mjs*|*content-kept.mjs*) continue ;;
    esac
    NEW_STG+=("${G_STG[$i]}"); NEW_LBL+=("${G_LBL[$i]}"); NEW_CMD+=("${G_CMD[$i]}")
  done
  G_STG=("${NEW_STG[@]}"); G_LBL=("${NEW_LBL[@]}"); G_CMD=("${NEW_CMD[@]}")
  echo "clean-cut: gates mode=delivery (skipped ASR-heavy content/disfl/verbatim-final; CLI delivery check still runs)" >&2
fi
SKIPPED="$(node -e 'const s=require(process.argv[1]).skipped;console.log(Object.entries(s).map(([k,v])=>`  skip ${k}: ${v}`).join("\n"))' "$STYLE/style.json")"

if [ $DRY = 1 ]; then
  echo "dry run: style clean-cut, mode $MODE, language $LANGV, review $([ $REVIEW = 1 ] && echo on || echo off), run dir $RUN"
  printf 'prep: AI_VIDEO_EDITOR_CUTCAND=0'; printf ' %q' "${PREPC[@]}"; printf ' || '; printf ' %q' "${CANDC[@]}"; echo
  if [ -n "$TRIN" ]; then echo "asr: reuse $TRIN"; else echo "asr: prep's cut-candidates whole-file disfluent decode -> $WORDS"; printf 'asr fallback:'; printf ' %q' "${ASRC[@]}"; echo; fi
  printf 'cut:'; printf ' %q' "${CUTC[@]}"; echo
  if [ $REVIEW = 1 ]; then printf 'review:'; printf ' %q' "${REVC[@]}"; echo; else echo "review: skipped (--no-review)"; fi
  printf 'build:'; printf ' %q' "${BUILDC[@]}"; echo
  if [ "${AI_VIDEO_EDITOR_CAPVERIFY:-1}" = 0 ]; then echo "caption verify: skipped (AI_VIDEO_EDITOR_CAPVERIFY=0)"; else printf 'caption verify:'; printf ' %q' "${CVC[@]}"; echo " -> $RUN/caption-verify.{json,txt}; flags -> $([ $REVIEW = 1 ] && [ -z "$RPATCH" ] && echo "text-only review (brief-captions.md), cut --patch + build" || echo "report only")"; fi
  printf 'render:'; printf ' %q' "${RENDERC[@]}"; echo
  echo "gates (fault-only, ${#G_LBL[@]}):"
  for i in "${!G_LBL[@]}"; do printf '  %-10s %s\n' "${G_LBL[$i]}:" "[${G_STG[$i]}] ${G_CMD[$i]}"; done
  echo "skipped gates:"; echo "$SKIPPED"
  printf 'post:'; printf ' %q' "${POSTC[@]}"; echo; echo "phone: ffmpeg scale 720x1280 -> ${OUT%.mp4}.phone.mp4"
  exit 0
fi

mkdir -p "$RUN" "$PROJ/assets" "$RUN/gates"
T0=$SECONDS; declare -A DT=()
phase() { DT[$1]=$((SECONDS - $2)); echo "clean-cut: $1 ${DT[$1]} s" >&2; echo "ai-video-editor-progress: {\"stage\":\"$1\",\"elapsedSec\":${DT[$1]},\"done\":false}" >&2; }

# prep: source-prep (faces, scenes, crop) and cut-candidates (the disfluent decode = the transcript) in parallel
t=$SECONDS
( "${CANDC[@]}" > "$RUN/cutcand.log" 2>&1 ) & CPID=$!
AI_VIDEO_EDITOR_CUTCAND=0 "${PREPC[@]}" > "$RUN/prep.log" 2>&1 || { echo "clean-cut: source prep failed (see $RUN/prep.log)" >&2; exit 2; }
wait "$CPID" || echo "clean-cut: cut-candidates failed (see $RUN/cutcand.log); ASR fallback" >&2
if [ -n "${AI_VIDEO_EDITOR_FACE:-}" ]; then node "$REPO/ai-video-editor/engine/face-override.mjs" prep "$PREP/source-prep.json" "$PREPJ" "$AI_VIDEO_EDITOR_FACE" || exit 2; fi
phase prep $t
t=$SECONDS
if [ -z "$TRIN" ] && ! "${FROMCAND[@]}" 2>/dev/null; then
  echo "clean-cut: no cut-candidates transcript; running ASR" >&2
  "${ASRC[@]}" > "$RUN/asr.log" 2>&1 || { echo "clean-cut: ASR failed (see $RUN/asr.log)" >&2; exit 2; }
fi
phase asr $t

t=$SECONDS; "${CUTC[@]}" >&2; phase cut $t
if [ $RONLY = 1 ]; then
  echo "clean-cut: review-only: cut table $PROJ/assets/cut-review.md (rules: $RULES)." >&2
  echo "clean-cut: write a patch {\"keep\":[i],\"remove\":[i],\"text\":{\"i\":\"word\"},\"notes\":\"..\"} and re-run with --review-patch FILE (prep and transcript are cached)." >&2
  echo "$PROJ/assets/cut-review.md"; exit 0
fi

# light review first (one short claude -p, ~10 s), then build + render once: a review patch re-cuts before the build
PATCHED=0
t=$SECONDS
if [ -n "$RPATCH" ]; then
  # a human review (the editor's own decisions, same JSON as the light review writes) replaces the claude pass
  cp "$RPATCH" "$PATCH"; echo "clean-cut: review patch (human, $RPATCH) $(tr -d '\n' < "$PATCH" | cut -c1-300)" >&2
  "${CUTC[@]}" --patch "$PATCH" >&2; PATCHED=1
elif [ $REVIEW = 1 ]; then
  node -e '
const fs = require("fs"); const [tpl, out, table, ...kv] = process.argv.slice(1);
let s = fs.readFileSync(tpl, "utf8").split("{{REVIEW_TABLE}}").join(fs.readFileSync(table, "utf8").trim());
for (let i = 0; i < kv.length; i += 2) s = s.split(`{{${kv[i]}}}`).join(kv[i + 1]);
fs.writeFileSync(out, s);' "$STYLE/brief.md" "$RUN/review.md" "$PROJ/assets/cut-review.md" RULES "$(cat "$RULES")" NAMES "$NAMES" PATCH "$PATCH" CONFIRMED "${CONFIRMED:-none}"
  rm -f "$PATCH"
  set +e; timeout --signal=TERM "${AI_VIDEO_EDITOR_REVIEW_CAP:-120}" "${REVC[@]}" > "$RUN/review.out" 2>&1; RS=$?; set -e
  if [ -s "$PATCH" ] && node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit((p.keep||[]).length+(p.remove||[]).length+Object.keys(p.text||{}).length ? 0 : 1)' "$PATCH" 2>/dev/null; then
    echo "clean-cut: review patch $(tr -d '\n' < "$PATCH" | cut -c1-300)" >&2
    "${CUTC[@]}" --patch "$PATCH" >&2; PATCHED=1
  else echo "clean-cut: review: no change (exit $RS); keeping the deterministic cut" >&2; fi
fi
phase review $t
t=$SECONDS; "${BUILDC[@]}" >&2; phase build $t
if [ $BONLY = 1 ]; then echo "clean-cut: build-only: $PROJ (assets/clip.mp4, mix.wav, transcript.json); no render, gates or post" >&2; echo "$PROJ"; exit 0; fi
DT[verify]=0
capverify() {
  if "${CVC[@]}" > "$RUN/caption-verify.json" 2> "$RUN/caption-verify.log"; then
    node -e 'const r=require(process.argv[1]); const f=r.captions.filter((c)=>c.flags.length);
const fl=(ws)=>ws.map((w)=>`${w.i ?? "?"}:${w.text}`).join(" ");
console.log(f.map((c)=>`FLAG cap ${c.i} [${c.start.toFixed(2)}-${c.end.toFixed(2)}] "${c.text}" not heard: ${fl(c.flags)} | caption words: ${fl(c.words)} | heard: ${c.heard}`).concat(`caption-verify: ${f.length} of ${r.captions.length} captions flagged, ${f.reduce((n,c)=>n+c.flags.length,0)} words`).join("\n"))' "$RUN/caption-verify.json" > "$RUN/caption-verify.txt"
    echo "clean-cut: $(tail -n 1 "$RUN/caption-verify.txt")" >&2
    NF=$(node -e 'console.log(require(process.argv[1]).flagged)' "$RUN/caption-verify.json")
    if [ "$NF" -gt 0 ] && [ $REVIEW = 1 ] && [ -z "$RPATCH" ]; then
      node -e 'const fs=require("fs"); const [tpl,out,flags,patch]=process.argv.slice(1);
fs.writeFileSync(out, fs.readFileSync(tpl,"utf8").split("{{FLAGS}}").join(fs.readFileSync(flags,"utf8").trim()).split("{{PATCH}}").join(patch));' "$STYLE/brief-captions.md" "$RUN/caption-review.md" "$RUN/caption-verify.txt" "$CPATCH"
      rm -f "$CPATCH"
      set +e; timeout --signal=TERM "${AI_VIDEO_EDITOR_REVIEW_CAP:-120}" "${REVC2[@]}" > "$RUN/caption-review.out" 2>&1; set -e
      if [ -s "$CPATCH" ] && node -e 'const fs=require("fs"),[c,p]=process.argv.slice(1); const t=JSON.parse(fs.readFileSync(c,"utf8")).text||{};
if(!Object.keys(t).length) process.exit(1); let b={}; try{b=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}
b.text={...(b.text||{}),...t}; b.captionNotes=JSON.parse(fs.readFileSync(c,"utf8")).notes||""; fs.writeFileSync(p,JSON.stringify(b,null,1));' "$CPATCH" "$PATCH" 2>/dev/null; then
        echo "clean-cut: caption review patch $(tr -d '\n' < "$CPATCH" | cut -c1-300)" >&2
        "${CUTC[@]}" --patch "$PATCH" >&2 && "${BUILDC[@]}" >&2
      else echo "clean-cut: caption review: no change" >&2; fi
    elif [ "$NF" -gt 0 ]; then echo "clean-cut: caption flags reported only ($([ -n "$RPATCH" ] && echo "--review-patch" || echo "--no-review")); see $RUN/caption-verify.txt" >&2; fi
  else echo "clean-cut: caption verify failed (see $RUN/caption-verify.log); continuing" >&2; fi
}
# caption verify: before the render when its flags can still change the captions (the claude review is on);
# report-only (--review-patch / --no-review) it runs alongside the render and the gates instead (same decode)
CVBG=0
if [ "${AI_VIDEO_EDITOR_CAPVERIFY:-1}" != 0 ]; then
  if [ $REVIEW = 1 ] && [ -z "$RPATCH" ]; then t=$SECONDS; capverify; phase verify $t
  else CVBG=1; tv=$SECONDS; ( capverify; echo $((SECONDS - tv)) > "$RUN/verify.secs" ) & CVPID=$!; fi
fi
runstage() { for i in "${!G_LBL[@]}"; do [ "${G_STG[$i]}" = "$1" ] || continue; ( set +e; s0=$SECONDS; eval "${G_CMD[$i]}" > "$RUN/gates/$i-${G_LBL[$i]}.log" 2>&1; echo $? > "$RUN/gates/$i.status"; echo $((SECONDS - s0)) > "$RUN/gates/$i.secs" ) & PIDS+=($!); done; }
PIDS=(); tg=$SECONDS; runstage pre
t=$SECONDS; "${RENDERC[@]}" > "$RUN/render.log" 2>&1 || { echo "clean-cut: render failed (see $RUN/render.log)" >&2; exit 2; }; phase render $t

# gates (parallel) and post (parallel with them; post never touches <out>)
t=$SECONDS
tp=$SECONDS; ( set +e; "${POSTC[@]}" > "$RUN/post.log" 2>&1; echo $? > "$RUN/post.status"; echo $((SECONDS - tp)) > "$RUN/post.secs" ) &
runstage final
for p in "${PIDS[@]}"; do wait "$p" || true; done
# content retry: a content FAIL is re-checked once alone, after every other gate (concurrent int8 decodes under load
# have returned junk transcripts); both logs are kept and the retry's verdict stands
for i in "${!G_LBL[@]}"; do
  [ "${G_LBL[$i]}" = content ] && [ "$(cat "$RUN/gates/$i.status" 2>/dev/null)" != 0 ] || continue
  [ $CVBG = 1 ] && wait "$CVPID" 2>/dev/null || true
  echo "clean-cut: content FAIL under load; one retry alone (first log kept: $RUN/gates/$i-content.first.log)" >&2
  cp "$RUN/gates/$i-content.log" "$RUN/gates/$i-content.first.log"
  ( set +e; s0=$SECONDS; eval "${G_CMD[$i]}" > "$RUN/gates/$i-content.log" 2>&1; echo $? > "$RUN/gates/$i.status"; echo $((SECONDS - s0)) > "$RUN/gates/$i.secs" )
done
phase gates $t
[ $CVBG = 1 ] && { wait "$CVPID" 2>/dev/null || true; DT[verify]=$(cat "$RUN/verify.secs" 2>/dev/null || echo 0); }
DT[gates_all]=$((SECONDS - tg))
declare -A GS=(); GORDER=(); GF=0
for i in "${!G_LBL[@]}"; do
  l=${G_LBL[$i]} rc=$(cat "$RUN/gates/$i.status" 2>/dev/null || echo 99)
  [ -n "${GS[$l]+x}" ] || { GS[$l]=0; GORDER+=("$l"); }
  [ "${GS[$l]}" != 0 ] || GS[$l]=$rc
  [ "$rc" = 0 ] || { GF=1; echo "clean-cut: gate $l FAIL ($rc): $(tail -n 3 "$RUN/gates/$i-$l.log" | tr '\n' ' ' | cut -c1-300)" >&2; }
done
wait
PS=$(cat "$RUN/post.status" 2>/dev/null || echo 1); DT[post]=$(cat "$RUN/post.secs" 2>/dev/null || echo 0)
[ -f "${OUT%.mp4}.post.mp4" ] && ffmpeg -v error -y -i "${OUT%.mp4}.post.mp4" -vf scale=720:1280 -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${OUT%.mp4}.phone.mp4" || true
DT[total]=$((SECONDS - T0))
SUM=""; for l in "${GORDER[@]}"; do SUM+="; $l $([ "${GS[$l]}" = 0 ] && echo PASS || echo "FAIL (${GS[$l]})")"; done
SKIPS="$(node -e 'console.log(Object.keys(require(process.argv[1]).skipped).join(","))' "$STYLE/style.json")"
node -e 'const [f, ...kv] = process.argv.slice(1); const o = {}; for (let i = 0; i < kv.length; i += 2) o[kv[i]] = Number(kv[i + 1]); require("fs").writeFileSync(f, JSON.stringify({ style: "clean-cut", seconds: o, targetSeconds: 300 }, null, 1));' \
  "$RUN/timing.json" prep "${DT[prep]}" asr "${DT[asr]}" cut "${DT[cut]}" review "${DT[review]}" build "${DT[build]}" verify "${DT[verify]}" render "${DT[render]}" gates_after_render "${DT[gates]}" gates_from_render_start "${DT[gates_all]}" post "${DT[post]}" total "${DT[total]}"
GT=""; for i in "${!G_LBL[@]}"; do GT+=" ${G_LBL[$i]}=$(cat "$RUN/gates/$i.secs" 2>/dev/null || echo ?)"; done
echo "clean-cut: gate seconds:$GT" >&2
echo "clean-cut: total ${DT[total]} s (prep ${DT[prep]}, asr ${DT[asr]}, cut ${DT[cut]}, review ${DT[review]}, build ${DT[build]}, verify ${DT[verify]}, render ${DT[render]} || pre-stage gates, gates after render ${DT[gates]} || post ${DT[post]}; all gates ${DT[gates_all]} from the render start); gates fault-only$SUM; skipped $SKIPS; post exit $PS; out ${OUT%.mp4}.post.mp4 + ${OUT%.mp4}.phone.mp4"
[ $GF = 1 ] && exit 1
exit "$PS"

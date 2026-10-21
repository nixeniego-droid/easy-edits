#!/usr/bin/env bash
# One-shot Easy Edits edit: measure the source, fill the 30 s brief, run headless Claude under the watchdog, then post.
#   easy-edits/bin/edit.sh <source.mp4> <transcript.json> <project-dir> <out.mp4> [--brief FILE] [--look FILE] [--heard-file FILE] [--names FILE] [--claude BIN] [--dry-run]
#                       [--draft-only [--draft-sheet FILE] | --plan-only [--plan-out FILE] | --resume-notes FILE] [--strict-look]
#   --draft-only   appends a DRAFT-ONLY section to the brief: build the composition, render ONE fast low-res draft
#                  (render.sh draft), write a 12-frame contact sheet to --draft-sheet FILE (default
#                  <out>.run/draft-sheet.png), then STOP. No final, no post; only the project guards run (none that
#                  need <out>). Exit 0 when the sheet exists.
#   --plan-only    appends a PLAN-ONLY section: read the kit, study the source facts, write <project>/DESIGN.md (the
#                  full creative plan) and copy it to --plan-out FILE (default <out>.run/DESIGN.plan.md), then STOP:
#                  no build, no render, no guards, no post. Exit 0 when the plan file exists. A later normal run on
#                  the same project (or --resume-notes) builds from that DESIGN.md.
#   --strict-look  also runs the CREATIVE-STEERING gates (off by default; see 3.)
#   --resume-notes FILE  re-runs the edit agent on the SAME project (no prep: reuses <out>.run/prep; the project is
#                  never hidden or wiped) with the brief plus a RESUME section quoting FILE, so it finishes the
#                  final; then guards + post as usual. Files: <out>.run/brief.resume.md, stream.resume.jsonl,
#                  watchdog.resume.log.
#   0. prep   node easy-edits/tools/source-prep.mjs <source> <out>.run/prep --transcript <transcript>
#               -> source-prep.json + source-prep-sheet.png (scenes, kinds, face boxes, 9:16 crops, head slates)
#               + source.cut-candidates.json/.md (stutters / restarts; a cache miss runs the decode, ~35 s;
#               EASY_EDITS_CUTCAND=0 skips), copied to
#               <project>/assets/
#   1. fill   --brief FILE (default easy-edits/briefs/edit-30s-v2.md; edit-30s.md / edit-30s-embedded.md stay selectable) ({{SOURCE}} {{TRANSCRIPT}} {{PROJECT}} {{OUT}} {{PREP}} {{NAMES}} {{LOOK}}) -> <out>.run/brief.md
#   2. edit   node easy-edits/bin/claude-watchdog.mjs --prompt-file <brief> --log <out>.run/watchdog.log
#               --stream-log <out>.run/stream.jsonl [--claude BIN] -- --model opus --permission-mode bypassPermissions
#             Sibling projects made from the same source (easy-edits/tools/sibling-guard.mjs find: same basename or
#             size+sha1 in raw/ or assets/; not <project>, not easy-edits-full-30s) are moved to
#             ${EASY_EDITS_HOME:-~/.easy-edits}/hidden/<run-id>/ for the edit and moved back after it (trap on EXIT INT TERM;
#             an existing restore target is never clobbered). Root: $EASY_EDITS_VIDEO_PROJECTS or <repo>/video-projects.
#             Then sibling-guard scan flags cp/rsync/cat/sed of other video-projects/<p> in the stream
#             (summary "fresh PASS|FAIL", WARN copied-from lines).
#   3. guards (registry `gate <label> <fault|strict> <proj|final|draft> <cmd>`; --dry-run prints it as a table)
#             FAULT-ONLY (always on; a FAIL is a defect, never "off-style"):
#               stale final-fresh | names name-guard | verbatim verbatim-guard + verbatim-final + caption-cover |
#               cuts cut-guard | disfl disfluency (cut candidates come from prep) | air dead-air |
#               face caption-face | finalface caption-face-final (captions AND cards vs face / chin / head zone) |
#               style text-style --one-caption --no-kinetic-size | capsize caption-size | read readability (min time) |
#               contrast panel-contrast | jump layout-jump --flash-only | grade grade-continuity | order edl-order |
#               kdup kinetic-dup | sfx sfx-audible (presence only) | topbox top-box-justified
#             CREATIVE-STEERING (--strict-look only): motion motion-density (graphic rate) | shot shot-length |
#               life overlay-life | look look-check | fill card-fill | cardtext card-text | items card-items |
#               panel panel-through | icons panel-icons | sfxmix sfx-mix (dB window, entry-only); and the strict
#               variants: text-style kinetic presets / --kinetic-free bands, readability --groups, layout-jump hard swaps
#   4. post   node easy-edits/post.mjs <out>   (lead-in, loudness master, delivery check) -> <out>.post.mp4
# Paths are written into the brief repo-relative when inside the repo. Prints per-stage and total wall-clock
# seconds. --names FILE: trusted proper-name spellings, one per line ({{NAMES}} = its absolute path, else `none`).
# Exit: the post stage's (delivery check) status, else 1 if a guard fails; the watchdog's status if the
# edit fails or <out> is missing. --claude BIN swaps the claude binary (e.g. a fake for testing); --dry-run fills
# the brief and prints the commands (prep and names included) without running them.
#   --style ID     a style's fast path. clean-cut: easy-edits/bin/clean-cut.sh (no DESIGN.md, no creative loop; no
#                  transcript argument: local disfluent ASR) ->
#                  edit.sh --style clean-cut <source.mp4> <project-dir> <out.mp4> [--lang L] [--no-review] [--dry-run]
# STATUS: --style clean-cut is the only APPROVED style (locked: easy-edits/presets/clean-cut-default.json). The full creative edit (no --style: creator talking head / kinetic captions, cards,
# explainer and podcast looks, style-library styles) is EXPERIMENTAL: not approved, output may need manual fixes.
set -euo pipefail
help() { cat <<'HELP'
Easy Edits edit

  APPROVED  easy-edits/bin/edit.sh --style clean-cut <source> <project-dir> <out.mp4> [--lang L] [--mode clean|light|strict]
            Clean cut: fillers, dead air and clear slips removed, captions-minimal. Locked default
            (easy-edits/presets/clean-cut-default.json). See: easy-edits/bin/clean-cut.sh --help

  EXPERIMENTAL (not approved; output may need manual fixes)
            easy-edits/bin/edit.sh <source.mp4> <transcript.json> <project-dir> <out.mp4> [--brief FILE] [--look FILE]
            [--names FILE] [--claude BIN] [--dry-run] [--strict-look] [--draft-only | --plan-only | --resume-notes FILE]
            The full creative edit with headless Claude Code (creator talking head / kinetic captions, cards,
            explainer / podcast looks, style-library styles).
HELP
}
for a in "$@"; do case "$a" in --style) break ;; -h|--help) help; exit 0 ;; esac; done
for ((i = 1; i <= $#; i++)); do
  if [ "${!i}" = --style ]; then
    j=$((i + 1)); case "${!j:-}" in
      clean-cut) exec "$(dirname "${BASH_SOURCE[0]}")/clean-cut.sh" "$@" ;;
      *) echo "edit.sh: unknown style '${!j:-}' (approved: clean-cut; run edit.sh --help)" >&2; exit 2 ;;
    esac
  fi
done
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ -f "${EASY_EDITS_HOME:-$HOME/.easy-edits}/env.sh" ] && . "${EASY_EDITS_HOME:-$HOME/.easy-edits}/env.sh"
CLAUDE_FLAG=() DRY=0 DRAFT=0 SHEET= NOTES= PLAN=0 PLAN_OUT= STRICT=0 POS=() NAMES=none TPL="$REPO/easy-edits/briefs/edit-30s-v2.md" LOOK= VERB="$REPO/easy-edits/presets/verbatim-heard.json"
while [ $# -gt 0 ]; do
  case "$1" in
    --claude) CLAUDE_FLAG=(--claude "${2:?--claude needs a binary}"); shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --draft-only) DRAFT=1; shift ;;
    --plan-only) PLAN=1; shift ;;
    --plan-out) PLAN_OUT="$(realpath -m "${2:?--plan-out needs a file}")"; shift 2 ;;
    --strict-look) STRICT=1; shift ;;
    --draft-sheet) SHEET="$(realpath -m "${2:?--draft-sheet needs a file}")"; shift 2 ;;
    --resume-notes) NOTES="$(realpath -m "${2:?--resume-notes needs a file}")"; [ -f "$NOTES" ] || { echo "edit.sh: missing notes $2" >&2; exit 2; }; shift 2 ;;
    --brief) TPL="$(realpath -m "${2:?--brief needs a file}")"; [ -f "$TPL" ] || { echo "edit.sh: missing brief $2" >&2; exit 2; }; shift 2 ;;
    --heard-file) VERB="$(realpath -m "${2:?--heard-file needs a file}")"; [ -f "$VERB" ] || { echo "edit.sh: missing heard file $2" >&2; exit 2; }; shift 2 ;;
    --look) LOOK="$(realpath -m "${2:?--look needs a file}")"; [ -f "$LOOK" ] || { echo "edit.sh: missing look $2" >&2; exit 2; }; shift 2 ;;
    --names) NAMES="$(realpath -m "${2:?--names needs a file}")"; [ -f "$NAMES" ] || { echo "edit.sh: missing names file $2" >&2; exit 2; }; shift 2 ;;
    *) POS+=("$1"); shift ;;
  esac
done
# look: optional palette/grade/type guidance; --strict-look uses the archived full style2 spec unless --look is given
[ -n "$LOOK" ] || { [ $STRICT = 1 ] && LOOK="$REPO/easy-edits/presets/look-strict.json" || LOOK="$REPO/easy-edits/presets/look-bright.json"; }
echo "edit.sh: EXPERIMENTAL: the full creative edit is not approved (approved: --style clean-cut; see --help)" >&2
[ ${#POS[@]} -eq 4 ] || { echo "usage (EXPERIMENTAL full edit): edit.sh <source.mp4> <transcript.json> <project-dir> <out.mp4> [--brief FILE] [--look FILE] [--names FILE] [--claude BIN] [--dry-run] [--strict-look] [--draft-only | --plan-only [--plan-out FILE] | --resume-notes FILE]" >&2; exit 2; }
rel() { local p; p="$(realpath -m "$1")"; case "$p" in "$REPO"/*) echo "${p#"$REPO"/}" ;; *) echo "$p" ;; esac; }
SRC="$(rel "${POS[0]}")" TR="$(rel "${POS[1]}")" PROJ="$(rel "${POS[2]}")" OUT="$(realpath -m "${POS[3]}")"
for f in "${POS[0]}" "${POS[1]}"; do [ -f "$f" ] || { echo "edit.sh: missing $f" >&2; exit 2; }; done
RUN="${OUT%.mp4}.run"; mkdir -p "$RUN"
BRIEF="$RUN/brief.md" LOG="$RUN/watchdog.log" PREP_DIR="$RUN/prep" STREAM="$RUN/stream.jsonl"
[ $((DRAFT + PLAN + $([ -n "$NOTES" ] && echo 1 || echo 0))) -gt 1 ] && { echo "edit.sh: --draft-only, --plan-only and --resume-notes are exclusive" >&2; exit 2; }
[ -n "$PLAN_OUT" ] && [ $PLAN = 0 ] && { echo "edit.sh: --plan-out needs --plan-only" >&2; exit 2; }
[ $PLAN = 1 ] && [ -z "$PLAN_OUT" ] && PLAN_OUT="$RUN/DESIGN.plan.md"
[ -n "$SHEET" ] && [ $DRAFT = 0 ] && { echo "edit.sh: --draft-sheet needs --draft-only" >&2; exit 2; }
[ $DRAFT = 1 ] && [ -z "$SHEET" ] && SHEET="$RUN/draft-sheet.png"
if [ -n "$NOTES" ]; then
  [ -f "$PREP_DIR/source-prep.json" ] || { echo "edit.sh: --resume-notes needs the earlier run's prep ($PREP_DIR)" >&2; exit 2; }
  [ -d "${POS[2]}" ] || { echo "edit.sh: --resume-notes needs the existing project ${POS[2]}" >&2; exit 2; }
  BRIEF="$RUN/brief.resume.md" LOG="$RUN/watchdog.resume.log" STREAM="$RUN/stream.resume.jsonl"
fi

PROJECTS="$(realpath -m "${EASY_EDITS_VIDEO_PROJECTS:-$REPO/video-projects}")" PNAME="$(basename "$PROJ")"
STASH="${EASY_EDITS_HOME:-$HOME/.easy-edits}/hidden/$(date +%Y%m%d-%H%M%S)-$$"
SIBG=(node "$REPO/easy-edits/tools/sibling-guard.mjs")
HIDDEN=() EPID=
restore_siblings() {
  local s n=0
  for s in "${HIDDEN[@]}"; do
    if [ -e "$PROJECTS/$s" ]; then echo "edit.sh: not restoring $s ($PROJECTS/$s exists); left in $STASH/$s" >&2
    elif mv "$STASH/$s" "$PROJECTS/$s"; then n=$((n + 1))
    else echo "edit.sh: restoring $s failed; left in $STASH/$s" >&2; fi
  done
  [ ${#HIDDEN[@]} -eq 0 ] || echo "edit.sh: restored $n/${#HIDDEN[@]} sibling project(s)" >&2
  HIDDEN=(); rmdir "$STASH" 2>/dev/null || true
}
on_signal() { [ -z "$EPID" ] || kill "$EPID" 2>/dev/null || true; restore_siblings; exit "$1"; }
trap restore_siblings EXIT; trap 'on_signal 130' INT; trap 'on_signal 143' TERM

T0=$SECONDS; declare -A DT=([prep]=0)
stage_end() { DT[$1]=$((SECONDS - $2)); echo "edit.sh: $1 ${DT[$1]} s" >&2; }

PREP=(node "$REPO/easy-edits/tools/source-prep.mjs" "${POS[0]}" "$PREP_DIR" --transcript "${POS[1]}")
if [ -n "$NOTES" ]; then echo "edit.sh: resume: reusing prep $PREP_DIR and project $PROJ" >&2
elif [ $DRY = 0 ]; then
  rm -f "$PREP_DIR"/source.cut-candidates.*; t=$SECONDS; "${PREP[@]}" >&2 || { echo "edit.sh: source prep failed" >&2; exit 2; }; stage_end prep $t
  if [ -f "$PREP_DIR/source.cut-candidates.json" ]; then
    A="$(realpath -m "${POS[2]}")/assets"; mkdir -p "$A" && cp "$PREP_DIR"/source.cut-candidates.{json,md} "$A/"
  else echo "edit.sh: WARN no cut candidates (EASY_EDITS_CUTCAND=0 or the decode failed; see prep notes)" >&2; fi
fi

t=$SECONDS
node -e '
const fs = require("fs"); const [tpl, out, ...kv] = process.argv.slice(1);
let s = fs.readFileSync(tpl, "utf8");
for (let i = 0; i < kv.length; i += 2) s = s.split(`{{${kv[i]}}}`).join(kv[i + 1]);
const left = s.match(/\{\{[A-Z_]+\}\}/g); if (left) { console.error("unfilled placeholders: " + [...new Set(left)].join(" ")); process.exit(2); }
fs.writeFileSync(out, s);' "$TPL" "$BRIEF" SOURCE "$SRC" TRANSCRIPT "$TR" PROJECT "$PROJ" OUT "$(rel "$OUT")" PREP "$(rel "$PREP_DIR")" NAMES "$NAMES" LOOK "$(rel "$LOOK")"
if [ $DRAFT = 1 ]; then cat >> "$BRIEF" <<EOF

## DRAFT-ONLY (this run overrides the steps above)

Build the composition in \`$PROJ\` (cuts, clip, DESIGN.md, shot list, index.html) and run its lint / preflight. Then
render ONE fast low-res draft and its 12-frame contact sheet, and STOP:

\`\`\`bash
../../easy-edits/bin/render.sh draft . renders/draft1.mp4
D=\$(ffprobe -v error -show_entries format=duration -of csv=p=0 renders/draft1.mp4)
ffmpeg -v error -y -i renders/draft1.mp4 -vf "fps=12/\$D,scale=270:-1,tile=6x2" -frames:v 1 $SHEET
\`\`\`

Do NOT render the final, do NOT write $(rel "$OUT"), do NOT run post. Write what is unfinished in VERIFY.md and end.
A later run resumes this project with review notes.
EOF
fi
if [ $PLAN = 1 ]; then cat >> "$BRIEF" <<EOF

## PLAN-ONLY (this run overrides the steps above)

Do ONLY the planning step. Read the kit docs listed under "Follow the kit", study the source facts (prep sheet,
cut candidates, transcript; look at the footage where framing matters), then write \`$PROJ/DESIGN.md\`, the full
creative plan:
- one-line mood / story, and the story arc;
- 2-3 key moments, each with its treatment and why;
- where to hold back (clean footage, no graphic), with timestamps;
- every planned graphic: \`line | time | format | idea | reason\` (a top box names its process, comparison or scene);
- the caption and pacing approach;
- "the one thing that would make a top editor post this".
Copy it to \`$PLAN_OUT\`. Then STOP: no cuts rendered, no composition build, no render, no guards, no post. A later
run on this project builds from this DESIGN.md.
EOF
fi
if [ -n "$NOTES" ]; then
  { printf '\n## RESUME (this run overrides the steps above)\n\nThe project `%s` already exists with a draft from an earlier run: continue it; do NOT recreate,\nwipe or re-prep it, and do not copy from other projects. Apply these review notes, render the draft again if they\nchange visuals, then finish the final to %s per the brief.\n\n```text\n' "$PROJ" "$(rel "$OUT")"; cat "$NOTES"; printf '\n```\n'; } >> "$BRIEF"
fi
stage_end fill $t

mapfile -t SIBS < <("${SIBG[@]}" find "$PROJECTS" "${POS[0]}" --exclude "$PNAME,easy-edits-full-30s")
EDIT=(node "$REPO/easy-edits/bin/claude-watchdog.mjs" --prompt-file "$BRIEF" --log "$LOG" --stream-log "$STREAM" "${CLAUDE_FLAG[@]}" -- --model opus --permission-mode bypassPermissions)
CONFIRMED="$(node -e 'try { console.log((JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).verbatim?.confirmed || []).join(",")) } catch { console.log("") }' "$VERB")"
HEARD="$(node -e 'try { console.log((JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).verbatim?.heard || []).join(",")) } catch { console.log("") }' "$VERB")"
EMB=0; grep -q '<!-- easy-edits: embedded -->' "$TPL" && EMB=1
C="$REPO/easy-edits/check" T="$REPO/easy-edits/tools" FACEP="$PREP_DIR/source-prep.json"
# Gate registry: gate <label> <fault|strict> <proj|final|draft> <cmd...>. proj gates run after a draft and a final,
# final gates need <out>, draft gates replace their final twin in --draft-only. strict gates run only with --strict-look.
G_LBL=() G_TIER=() G_ST=() G_CMD=()
gate() { local l=$1 tier=$2 st=$3; shift 3; [ "$tier" = strict ] && [ $STRICT = 0 ] && return 0; G_LBL+=("$l"); G_TIER+=("$tier"); G_ST+=("$st"); G_CMD+=("$(printf '%q ' "$@")"); }
STYLEX=(--one-caption --no-kinetic-size) READX=() JUMPX=(--flash-only)
if [ $STRICT = 1 ]; then
  STYLEX=(--one-caption); grep -q '<!-- easy-edits: kinetic-free -->' "$TPL" && STYLEX+=(--kinetic-free); READX=(--groups) JUMPX=()
fi
# FAULT-ONLY (always on): a failure is a defect, never "off-style"
gate stale    fault final node "$C/final-fresh.mjs" "$PROJ" "$OUT"
gate names    fault proj  node "$T/name-guard.mjs" "$PROJ" --names "$NAMES"
gate verbatim fault proj  node "$T/verbatim-guard.mjs" "$PROJ"
gate verbatim fault final node "$C/verbatim-final.mjs" "$PROJ" "$OUT" --swaps --confirmed "$CONFIRMED" --heard "$HEARD"
gate verbatim fault proj  node "$C/caption-cover.mjs" "$PROJ"
gate cuts     fault proj  node "$T/cut-guard.mjs" "$PROJ" --source "$(realpath "${POS[0]}")"
gate disfl    fault final node "$C/disfluency.mjs" "$OUT"
gate air      fault final node "$C/dead-air.mjs" "$OUT"
gate face     fault proj  node "$C/caption-face.mjs" "$PROJ" --prep "$FACEP"
gate finalface fault final node "$C/caption-face-final.mjs" "$PROJ" "$OUT" --prep "$FACEP"
gate style    fault proj  node "$C/text-style.mjs" "$PROJ" "${STYLEX[@]}"
gate capsize  fault proj  node "$C/caption-size.mjs" "$PROJ"
gate read     fault proj  node "$C/readability.mjs" "$PROJ" "${READX[@]}"
gate contrast fault final node "$C/panel-contrast.mjs" "$PROJ" "$OUT"
gate jump     fault final node "$C/layout-jump.mjs" "$PROJ" "$OUT" "${JUMPX[@]}"
gate grade    fault final node "$C/grade-continuity.mjs" "$PROJ" "$OUT"
gate order    fault proj  node "$C/edl-order.mjs" "$PROJ"
gate kdup     fault proj  node "$C/kinetic-dup.mjs" "$PROJ"
gate sfx      fault final node "$C/sfx-audible.mjs" "$OUT" "$PROJ"
gate room     fault final node "$C/room-tone.mjs" "$PROJ" "$OUT"
gate topbox   fault proj  node "$C/top-box-justified.mjs" "$PROJ"
gate aspect   fault final node "$C/aspect.mjs" "$PROJ" "$OUT"
# CREATIVE-STEERING (--strict-look only): taste values written as pass/fail limits
MOTIONX=(); [ $EMB = 1 ] && MOTIONX=(--max 2.0)
gate motion   strict final node "$C/motion-density.mjs" "$PROJ" "$OUT" "${MOTIONX[@]}"
gate shot     strict final node "$C/shot-length.mjs" "$PROJ" "$OUT" --max 1.5
gate life     strict final node "$C/overlay-life.mjs" "$PROJ" "$OUT"
gate look     strict proj  node "$C/look-check.mjs" "$PROJ"
gate fill     strict draft node "$C/card-fill.mjs" "$PROJ"
gate fill     strict final node "$C/card-fill.mjs" "$PROJ" "$OUT"
gate cardtext strict final node "$C/card-text.mjs" "$PROJ" "$OUT"
gate items    strict proj  node "$C/card-items.mjs" "$PROJ"
gate panel    strict final node "$C/panel-through.mjs" "$PROJ" "$OUT"
gate icons    strict final node "$C/panel-icons.mjs" "$PROJ" "$OUT"
gate sfxmix   strict final node "$C/sfx-mix.mjs" "$OUT" "$PROJ"
POST=(node "$REPO/easy-edits/post.mjs" "$OUT")
MODE="$([ $STRICT = 1 ] && echo strict-look || echo fault-only)"
if [ $DRY = 1 ]; then
  echo "dry run: brief $BRIEF$([ $DRAFT = 1 ] && echo " (draft-only, sheet $SHEET)")$([ -n "$NOTES" ] && echo " (resume, notes $NOTES)")$([ $PLAN = 1 ] && echo " (plan-only, plan $PLAN_OUT)")"; echo "would hide ${#SIBS[@]} sibling project(s): ${SIBS[*]}"; printf 'prep:'; printf ' %q' "${PREP[@]}"; printf '\nedit:'; printf ' %q' "${EDIT[@]}"; echo
  if [ $PLAN = 1 ]; then echo "gates: none (plan-only: no build, no render, no guards, no post)"; exit 0; fi
  echo "gates ($MODE, ${#G_LBL[@]}):"
  for i in "${!G_LBL[@]}"; do printf '  %-6s %-5s %-10s %s\n' "${G_TIER[$i]}" "${G_ST[$i]}" "${G_LBL[$i]}:" "${G_CMD[$i]}"; done
  printf 'post:'; printf ' %q' "${POST[@]}"; echo
  exit 0
fi

cd "$REPO"
mkdir -p "$STASH"; : > "$STREAM"
for s in "${SIBS[@]}"; do
  if mv "$PROJECTS/$s" "$STASH/$s"; then HIDDEN+=("$s"); else echo "edit.sh: could not hide $s" >&2; fi
done
echo "edit.sh: hid ${#HIDDEN[@]} sibling project(s)${HIDDEN[*]:+: ${HIDDEN[*]} -> $STASH}" >&2
t=$SECONDS; set +e; "${EDIT[@]}" & EPID=$!; wait $EPID; ES=$?; EPID=; set -e; stage_end edit $t
restore_siblings
FR=0; COPIED="$("${SIBG[@]}" scan "$STREAM" --allow "$PNAME,easy-edits-full-30s,may-shorts-18,may-shorts-19")" || FR=1
[ -z "$COPIED" ] || sed 's/^/edit.sh: WARN /' <<<"$COPIED"
FRESH="$([ $FR = 0 ] && echo PASS || echo FAIL)"
declare -A GS=(); GORDER=()
# run_gates proj|final: the registered gates of that phase (proj: proj + draft; final: proj + final); a label's
# status is its first failing script
run_gates() {
  local i st rc
  for i in "${!G_LBL[@]}"; do
    st=${G_ST[$i]}
    case "$1:$st" in proj:proj|proj:draft|final:proj|final:final) ;; *) continue ;; esac
    set +e; eval "${G_CMD[$i]}"; rc=$?; set -e
    [ -n "${GS[${G_LBL[$i]}]+x}" ] || { GS[${G_LBL[$i]}]=0; GORDER+=("${G_LBL[$i]}"); }
    [ "${GS[${G_LBL[$i]}]}" != 0 ] || GS[${G_LBL[$i]}]=$rc
  done
}
gate_summary() { local l out=""; for l in "${GORDER[@]}"; do out+="; $l $([ "${GS[$l]}" = 0 ] && echo PASS || echo "FAIL (${GS[$l]})")"; done; echo "gates $MODE$out"; }
gates_failed() { local l; for l in "${GORDER[@]}"; do [ "${GS[$l]}" = 0 ] || return 0; done; return 1; }
if [ $PLAN = 1 ]; then
  if [ $ES -ne 0 ] || [ ! -s "$PLAN_OUT" ]; then
    echo "edit.sh: plan failed (watchdog exit $ES, plan $([ -s "$PLAN_OUT" ] && echo present || echo missing))" >&2
    echo "edit.sh: total $((SECONDS - T0)) s (prep ${DT[prep]}, fill ${DT[fill]}, edit ${DT[edit]}); plan-only; fresh $FRESH"; exit $((ES ? ES : 1))
  fi
  echo "edit.sh: plan ready: $PLAN_OUT (no build, no render, no guards, no post); total $((SECONDS - T0)) s (prep ${DT[prep]}, fill ${DT[fill]}, edit ${DT[edit]}); fresh $FRESH"
  exit 0
fi
if [ $DRAFT = 1 ]; then
  if [ $ES -ne 0 ] || [ ! -s "$SHEET" ]; then
    echo "edit.sh: draft failed (watchdog exit $ES, sheet $([ -s "$SHEET" ] && echo present || echo missing))" >&2
    echo "edit.sh: total $((SECONDS - T0)) s (prep ${DT[prep]}, fill ${DT[fill]}, edit ${DT[edit]}); draft-only; fresh $FRESH"; exit $((ES ? ES : 1))
  fi
  run_gates proj   # project-only guards; the ones that need the final, and post, are skipped
  echo "edit.sh: draft ready: $SHEET (no final, no post); total $((SECONDS - T0)) s (prep ${DT[prep]}, fill ${DT[fill]}, edit ${DT[edit]}); $(gate_summary); fresh $FRESH"
  exit 0
fi
if [ $ES -ne 0 ] || [ ! -f "$OUT" ]; then
  echo "edit.sh: edit failed (watchdog exit $ES, out $([ -f "$OUT" ] && echo present || echo missing)); skipping post" >&2
  echo "edit.sh: total $((SECONDS - T0)) s (prep ${DT[prep]}, fill ${DT[fill]}, edit ${DT[edit]}); fresh $FRESH"; exit $((ES ? ES : 1))
fi
run_gates final
t=$SECONDS; set +e; "${POST[@]}"; PS=$?; set -e; stage_end post $t
echo "edit.sh: total $((SECONDS - T0)) s (prep ${DT[prep]}, fill ${DT[fill]}, edit ${DT[edit]}, post ${DT[post]}); $(gate_summary); fresh $FRESH; check exit $PS"
[ $PS -ne 0 ] && exit $PS
{ gates_failed || [ $FR -ne 0 ]; } && exit 1
exit 0

#!/usr/bin/env bash
# check/caption-face-final.mjs over N equal time slices of <final.mp4> in parallel (the Haar pass is one core per
# process); exit 0 only when every slice passes. Same frames, same rule as one whole-file run.
#   ai-video-editor/bin/lib/finalface-split.sh <N> <project-dir> <final.mp4> [caption-face-final args...]
set -u
N=$1 PROJ=$2 OUT=$3; shift 3
FF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../check" && pwd)/caption-face-final.mjs"
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
PIDS=()
for ((k = 0; k < N; k++)); do
  A=$(awk -v d="$D" -v k=$k -v n=$N 'BEGIN { printf "%.3f", d * k / n }')
  B=$(awk -v d="$D" -v k=$k -v n=$N 'BEGIN { printf "%.3f", d * (k + 1) / n }')
  if [ $k = $((N - 1)) ]; then node "$FF" "$PROJ" "$OUT" --from "$A" "$@" & else node "$FF" "$PROJ" "$OUT" --from "$A" --to "$B" "$@" & fi
  PIDS+=($!)
done
RC=0; for p in "${PIDS[@]}"; do wait "$p" || RC=1; done
echo "finalface-split: $([ $RC = 0 ] && echo PASS || echo FAIL) ($N slices of ${D} s)"
exit $RC

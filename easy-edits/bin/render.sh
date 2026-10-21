#!/usr/bin/env bash
# Render a HyperFrames project with the kit's pinned CLI (hyperframes 0.7.109).
#   easy-edits/bin/render.sh draft|final <project-dir> <out.mp4> [extra hyperframes render flags]
#   draft: hyperframes render <dir> -o <out> --quality draft --workers 4   (intermediates / review)
#   final: hyperframes render <dir> -o <out> --quality high --workers 4    (delivery; then run easy-edits/post.mjs)
# Flags checked against `npx hyperframes render --help`: -q/--quality draft|standard|high, -w/--workers N|auto.
# Workers 4 (REPORT: high 52 s at 4 workers vs 68 s at auto on 8 cores). EASY_EDITS_WORKERS overrides.
set -euo pipefail
MODE="${1:?usage: render.sh draft|final <project-dir> <out.mp4>}"; DIR="$(realpath "${2:?project dir}")"; OUT="$(realpath -m "${3:?out.mp4}")"; shift 3
case "$MODE" in draft) Q=draft ;; final) Q=high ;; *) echo "mode must be draft or final" >&2; exit 2 ;; esac
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ -f "${EASY_EDITS_HOME:-$HOME/.easy-edits}/env.sh" ] && . "${EASY_EDITS_HOME:-$HOME/.easy-edits}/env.sh"
mkdir -p "$(dirname "$OUT")"
cd "$DIR"
T0=$SECONDS
"$REPO/node_modules/.bin/hyperframes" render . -o "$OUT" --quality "$Q" --workers "${EASY_EDITS_WORKERS:-4}" "$@"
echo "render.sh: $MODE ($Q, ${EASY_EDITS_WORKERS:-4} workers) -> $OUT in $((SECONDS - T0)) s"

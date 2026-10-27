#!/usr/bin/env bash
# Render a HyperFrames project with the kit's pinned CLI (hyperframes 0.7.109).
#   ai-video-editor/bin/render.sh draft|final <project-dir> <out.mp4> [extra hyperframes render flags]
#   draft: hyperframes render <dir> -o <out> --quality draft --workers 4   (intermediates / review)
#   final: hyperframes render <dir> -o <out> --quality high --workers 4    (delivery; then run ai-video-editor/post.mjs)
# Flags checked against `npx hyperframes render --help`: -q/--quality draft|standard|high, -w/--workers N|auto.
# Workers 4 (REPORT: high 52 s at 4 workers vs 68 s at auto on 8 cores). AI_VIDEO_EDITOR_WORKERS overrides.
set -euo pipefail
MODE="${1:?usage: render.sh draft|final <project-dir> <out.mp4>}"; DIR="$(realpath "${2:?project dir}")"; OUT="$(realpath -m "${3:?out.mp4}")"; shift 3
case "$MODE" in draft) Q=draft ;; final) Q=high ;; *) echo "mode must be draft or final" >&2; exit 2 ;; esac
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ -f "${AI_VIDEO_EDITOR_HOME:-$HOME/.ai-video-editor}/env.sh" ] && . "${AI_VIDEO_EDITOR_HOME:-$HOME/.ai-video-editor}/env.sh"
mkdir -p "$(dirname "$OUT")"
cd "$DIR"
T0=$SECONDS
"$REPO/node_modules/.bin/hyperframes" render . -o "$OUT" --quality "$Q" --workers "${AI_VIDEO_EDITOR_WORKERS:-4}" "$@"
echo "render.sh: $MODE ($Q, ${AI_VIDEO_EDITOR_WORKERS:-4} workers) -> $OUT in $((SECONDS - T0)) s"

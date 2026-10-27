#!/usr/bin/env bash
# AI Video Editor installer: one command, idempotent, safe to re-run. Installs or verifies everything AI Video Editor needs:
# Node 22 (official nodejs.org build in $AI_VIDEO_EDITOR_HOME/node unless a Node >= 22 is already on PATH; no nvm),
# ffmpeg/ffprobe, a python venv with faster-whisper + OpenCV, the Whisper models (small + medium, ~2 GB, in a known dir),
# the npm deps, HyperFrames' Chrome and the fonts (Montserrat for the captions; Playfair Display and JetBrains Mono
# for the style packs; all OFL). Writes $AI_VIDEO_EDITOR_HOME/env.sh.
#
#   ./install.sh               install / verify everything
#   ./install.sh --no-models   skip the Whisper model download (they then download on first use)
#   ./install.sh --doctor      print PASS/FAIL per dependency, exit nonzero on any FAIL
#   ./install.sh --skill-only  only (re-)register the Claude Code skill (see install_skill)
#
# Env overrides:
#   AI_VIDEO_EDITOR_HOME      (default ~/.ai-video-editor)   venv, node and env.sh live here
#   AI_VIDEO_EDITOR_MODELS    (default $HF_HOME if set, else $AI_VIDEO_EDITOR_HOME/models)   Whisper model cache (HF_HOME layout)
#   AI_VIDEO_EDITOR_WHISPER   (default "small medium")       which faster-whisper models to fetch
#   FASTER_WHISPER_VERSION    (default 1.2.1)
#   CLAUDE_CONFIG_DIR         (default ~/.claude)            the skill goes to $CLAUDE_CONFIG_DIR/skills/ai-video-editor
#   AI_VIDEO_EDITOR_NO_SKILL=1                               don't register the Claude Code skill
#   AI_VIDEO_EDITOR_PIPER_MODEL (default $AI_VIDEO_EDITOR_HOME/models/piper/en_US-amy-low.onnx)   Piper voice for the local TTS
#   AI_VIDEO_EDITOR_PIPER_CACHE  a folder already holding en_US-amy-low.onnx(.json): copied instead of downloaded
#
# Renamed from Easy Edits (compat for one release): every old EASY_EDITS_<X> (EASY_EDITS_HOME, EASY_EDITS_MODELS,
# EASY_EDITS_WHISPER, EASY_EDITS_NO_SKILL, ...) still works as AI_VIDEO_EDITOR_<X>; the new name wins when both are set.
# With no AI_VIDEO_EDITOR_HOME / EASY_EDITS_HOME the home is always ~/.ai-video-editor: an install moves a pre-rename
# ~/.easy-edits there (no re-download) and leaves ~/.easy-edits as a symlink to it, so `. ~/.easy-edits/env.sh` still
# works. A ~/.easy-edits that still holds files next to an existing ~/.ai-video-editor is left alone (never deleted).
# AI_VIDEO_EDITOR_HOME / EASY_EDITS_HOME set to ~/.easy-edits itself (a stale shell or an old env.sh) counts as the
# default home too, so that move still happens. Until that move, --doctor checks the old ~/.easy-edits. The `easy-edits` command is an alias of `ai-video-editor`.
set -euo pipefail
# HyperFrames sends anonymous usage telemetry unless opted out; opt out before anything below can run it.
# (env.sh exports the same, and install_npm also records the opt-out in ~/.hyperframes/config.json)
export HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for _v in $(compgen -e | grep '^EASY_EDITS_' || true); do   # old EASY_EDITS_<X> -> AI_VIDEO_EDITOR_<X> unless set
  _n="AI_VIDEO_EDITOR_${_v#EASY_EDITS_}"; [ -n "${!_n+x}" ] || export "$_n=${!_v}"
done; unset _v _n
DEFAULT_HOME="$HOME/.ai-video-editor" LEGACY_HOME="$HOME/.easy-edits"
AI_VIDEO_EDITOR_HOME="${AI_VIDEO_EDITOR_HOME:-$DEFAULT_HOME}"
USER_MODELS="${AI_VIDEO_EDITOR_MODELS:-}"
USER_PIPER_MODEL="${AI_VIDEO_EDITOR_PIPER_MODEL:-}"
# A home (or model path) pointing at the pre-rename ~/.easy-edits is the default home under its old name: use
# ~/.ai-video-editor so migrate_home moves it and env.sh lands there (else install kept writing into ~/.easy-edits).
same_dir() { [ -e "$1" ] && [ -e "$2" ] && [ "$(cd "$1" && pwd -P)" = "$(cd "$2" && pwd -P)" ]; }
if [ "${AI_VIDEO_EDITOR_HOME%/}" = "$LEGACY_HOME" ] || same_dir "$AI_VIDEO_EDITOR_HOME" "$LEGACY_HOME"; then
  AI_VIDEO_EDITOR_HOME="$DEFAULT_HOME"
  case "$USER_MODELS" in "$LEGACY_HOME"/*) USER_MODELS="$DEFAULT_HOME/${USER_MODELS#"$LEGACY_HOME"/}" ;; esac
  case "$USER_PIPER_MODEL" in "$LEGACY_HOME"/*) USER_PIPER_MODEL="$DEFAULT_HOME/${USER_PIPER_MODEL#"$LEGACY_HOME"/}" ;; esac
fi
NODE_MAJOR=22
FASTER_WHISPER_VERSION="${FASTER_WHISPER_VERSION:-1.2.1}"
OPENCV_VERSION="${OPENCV_VERSION:-4.14.0.94}"
YUNET_COMMIT="main"   # the file is pinned by its sha256 below
YUNET_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
# Piper (local TTS for `ai-video-editor new` voice-overs): one small US English voice, ~60 MB, pinned by sha256.
PIPER_TTS_VERSION="${PIPER_TTS_VERSION:-1.8.0}"
PIPER_VOICE="en_US-amy-low"
PIPER_VOICE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/low"
PIPER_ONNX_SHA="a5a91abb7de0f104358a25aded480ddacf1ff0762886325886ec406a2e86aab3"
PIPER_JSON_SHA="2250a9a605b8dc35a116717fadc5056695dd809e34a15d02f72a0f52d53d3ebb"
LOCK_STAMP="$REPO/node_modules/.ai-video-editor-lock.sha256"
# The paths under $AI_VIDEO_EDITOR_HOME (again after migrate_home / the doctor's fallback to the old home).
set_paths() {
  VENV="$AI_VIDEO_EDITOR_HOME/venv"
  NODE_HOME="$AI_VIDEO_EDITOR_HOME/node"
  BIN_DIR="$AI_VIDEO_EDITOR_HOME/bin"   # tools the venv provides that must be on PATH (piper)
  PIPER_MODEL="${USER_PIPER_MODEL:-$AI_VIDEO_EDITOR_HOME/models/piper/$PIPER_VOICE.onnx}"
  # an earlier env.sh records the model dir; keep it on re-runs
  PREV_MODELS=""   # (a missing env.sh must not trip set -e/pipefail: the fresh-user install died here silently)
  [ -f "$AI_VIDEO_EDITOR_HOME/env.sh" ] && PREV_MODELS="$(sed -n 's/^export \(AI_VIDEO_EDITOR\|EASY_EDITS\)_MODELS="\(.*\)"$/\2/p' "$AI_VIDEO_EDITOR_HOME/env.sh" | head -n1)" || true
  # models recorded under the old home moved with it
  [ "$AI_VIDEO_EDITOR_HOME" = "$DEFAULT_HOME" ] && case "$PREV_MODELS" in "$LEGACY_HOME"/*) PREV_MODELS="$DEFAULT_HOME/${PREV_MODELS#"$LEGACY_HOME"/}" ;; esac
  AI_VIDEO_EDITOR_MODELS="${USER_MODELS:-${PREV_MODELS:-${HF_HOME:-$AI_VIDEO_EDITOR_HOME/models}}}"
}
set_paths
AI_VIDEO_EDITOR_WHISPER="${AI_VIDEO_EDITOR_WHISPER:-small medium}"
# nvm and npm refuse to work together when these are set; npm ci here is project-local
unset NPM_CONFIG_PREFIX npm_config_prefix 2>/dev/null || true

log()  { printf '[ai-video-editor] %s\n' "$*"; }
die()  { printf '[ai-video-editor] ERROR: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
node_major() { have node && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# Put a Node >= 22 on PATH: one already on PATH, else AI Video Editor's own ($AI_VIDEO_EDITOR_HOME/node).
load_node() {
  [ "$(node_major)" -ge "$NODE_MAJOR" ] && return 0
  [ -x "$NODE_HOME/bin/node" ] && export PATH="$NODE_HOME/bin:$PATH"
  [ "$(node_major)" -ge "$NODE_MAJOR" ]
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif have sudo && sudo -n true 2>/dev/null; then sudo "$@"
  else return 1; fi
}

lock_hash() { sha256sum "$REPO/package-lock.json" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$REPO/package-lock.json" | cut -d' ' -f1; }

# ---------------------------------------------------------------- install steps
install_node() {
  if load_node; then log "node $(node -v) OK ($(command -v node))"; return; fi
  have curl || die "curl is required to download Node $NODE_MAJOR"
  local os arch
  case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) die "unsupported OS $(uname -s); install Node $NODE_MAJOR yourself" ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) die "unsupported CPU $(uname -m); install Node $NODE_MAJOR yourself" ;; esac
  local base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x" tmp; tmp="$(mktemp -d)"
  local name; name="$(curl -fsSL "$base/SHASUMS256.txt" | awk -v p="node-v[0-9.]+-$os-$arch.tar.xz" '$2 ~ "^"p"$" {print $2; exit}')"
  [ -n "$name" ] || die "no Node $NODE_MAJOR build for $os-$arch at $base"
  log "downloading $name into $NODE_HOME"
  curl -fsSL "$base/$name" -o "$tmp/$name"
  curl -fsSL "$base/SHASUMS256.txt" | grep " $name\$" | (cd "$tmp" && { sha256sum -c - 2>/dev/null || shasum -a 256 -c -; }) >/dev/null || die "checksum mismatch for $name"
  rm -rf "$NODE_HOME.new"; mkdir -p "$NODE_HOME.new"
  tar -xJf "$tmp/$name" -C "$NODE_HOME.new" --strip-components=1
  rm -rf "$NODE_HOME"; mv "$NODE_HOME.new" "$NODE_HOME"; rm -rf "$tmp"
  load_node || die "Node $NODE_MAJOR install failed"
  log "node $(node -v) installed"
}

install_ffmpeg() {
  if have ffmpeg && have ffprobe; then log "ffmpeg/ffprobe OK"; return; fi
  if have apt-get && as_root true; then
    log "installing ffmpeg via apt"
    as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg
  elif have brew; then brew install ffmpeg
  else
    cat >&2 <<'MSG'
[ai-video-editor] ffmpeg/ffprobe missing and no root/sudo available. Install them, then re-run ./install.sh:
    Debian/Ubuntu:  sudo apt-get install -y ffmpeg
    Fedora:         sudo dnf install -y ffmpeg
    macOS:          brew install ffmpeg
    Or put static builds (https://johnvansickle.com/ffmpeg/) in ~/.local/bin
MSG
    exit 1
  fi
}

# faster-whisper needs ctranslate2, whose wheels cover CPython 3.$PY_MIN..3.$PY_MAX. A newer python3 (a fresh Homebrew
# python, say) makes pip fail with "No matching distribution found for ctranslate2", so pick a supported interpreter.
PY_MIN=9 PY_MAX=14
# (version only: a python without venv/ensurepip gets its own error when the venv is created)
py_ok() { "$1" -c "import sys; sys.exit(not ((3, $PY_MIN) <= sys.version_info[:2] <= (3, $PY_MAX)))" >/dev/null 2>&1; }
pick_python() {
  local c m
  for c in python3 $(m=$PY_MAX; while [ "$m" -ge "$PY_MIN" ]; do printf 'python3.%s ' "$m"; m=$((m - 1)); done); do
    have "$c" && py_ok "$c" && { command -v "$c"; return 0; }
  done
  return 1
}
install_python() {
  if ! have python3; then
    if have apt-get && as_root true; then
      as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 python3-venv
    elif ! have brew; then die "python3 missing; install Python 3.$PY_MIN-3.$PY_MAX (+ python3-venv) and re-run"; fi
  fi
  if have python3 && ! python3 -c 'import venv, ensurepip' 2>/dev/null && have apt-get && as_root true; then
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv
  fi
  # a venv left by an unsupported python (an earlier failed run) is rebuilt
  if [ -x "$VENV/bin/python" ] && ! py_ok "$VENV/bin/python"; then
    log "venv $VENV uses $("$VENV/bin/python" --version 2>&1), which faster-whisper can't install on; rebuilding it"
    rm -rf "$VENV"
  fi
  if [ ! -x "$VENV/bin/python" ]; then
    local py
    if ! py="$(pick_python)"; then
      if have brew; then
        log "no Python 3.$PY_MIN-3.$PY_MAX found (python3 is $(python3 --version 2>&1)); installing python@3.13 with Homebrew"
        brew install python@3.13 && py="$(brew --prefix python@3.13)/bin/python3.13" && py_ok "$py" || die "brew install python@3.13 failed"
      else die "need Python 3.$PY_MIN-3.$PY_MAX (python3 is $(python3 --version 2>&1)); install one (e.g. python3.12 python3.12-venv) and re-run"; fi
    fi
    "$py" -c 'import venv, ensurepip' >/dev/null 2>&1 \
      || die "$py ($("$py" --version 2>&1)) can't create a venv: its venv/ensurepip module is missing; install it (e.g. python3-venv or python3.12-venv) and re-run"
    log "creating venv $VENV ($("$py" --version 2>&1))"
    mkdir -p "$AI_VIDEO_EDITOR_HOME"
    "$py" -m venv "$VENV" || die "creating the venv $VENV with $py failed (see the error above)"
  fi
  if "$VENV/bin/python" -c "import faster_whisper,sys; sys.exit(faster_whisper.__version__!='$FASTER_WHISPER_VERSION')" 2>/dev/null; then
    log "faster-whisper $FASTER_WHISPER_VERSION OK"
  else
    log "installing faster-whisper $FASTER_WHISPER_VERSION into venv"
    "$VENV/bin/python" -m pip install -q --upgrade pip
    "$VENV/bin/python" -m pip install -q "faster-whisper==$FASTER_WHISPER_VERSION"
  fi
  # OpenCV (Haar faces: source-prep crop, the face gates, the aspect gate). Without it in the venv a fresh user's
  # source-prep silently fell back to a centre crop and the finalface gate crashed (exit 3) (found by a fresh-user install test).
  if "$VENV/bin/python" -c "import cv2, numpy" 2>/dev/null; then log "opencv OK"
  else log "installing opencv-python-headless $OPENCV_VERSION into venv"; "$VENV/bin/python" -m pip install -q "opencv-python-headless==$OPENCV_VERSION"; fi
  # yt-dlp (URL input, ai-video-editor/bin/fetch-input.sh; docs/URL_INPUT.md). Unpinned and upgraded on every run: YouTube
  # changes often and an old yt-dlp stops working. [default] adds yt-dlp-ejs (YouTube's JS challenges, run with Node).
  log "yt-dlp: install / upgrade into venv"
  "$VENV/bin/python" -m pip install -q -U "yt-dlp[default]" || log "WARNING: yt-dlp install failed (URL input unavailable; local files still work)"
  # YuNet face model (OpenCV Zoo, MIT) for the ai-video-editor face track (engine/facetrack.py); Haar is the fallback
  local yd="$AI_VIDEO_EDITOR_HOME/models-cv" yf="face_detection_yunet_2023mar.onnx"
  if [ -f "$yd/$yf" ]; then log "YuNet face model OK"
  else
    log "downloading the YuNet face model"; mkdir -p "$yd"
    curl -fsSL -o "$yd/$yf.part" "https://github.com/opencv/opencv_zoo/raw/$YUNET_COMMIT/models/face_detection_yunet/$yf" || die "YuNet download failed"
    echo "$YUNET_SHA  $yd/$yf.part" | { have sha256sum && sha256sum -c --quiet - || shasum -a 256 -c --quiet -; } || die "YuNet checksum mismatch"
    mv "$yd/$yf.part" "$yd/$yf"
  fi
}

# Whisper models into $AI_VIDEO_EDITOR_MODELS (Hugging Face cache layout; env.sh exports HF_HOME there), so a reboot,
# a cleared ~/.cache or the first edit never waits on a 1.5 GB download.
install_models() {
  [ "${NO_MODELS:-0}" = 1 ] && { log "Whisper models: skipped (--no-models; they download on first use into $AI_VIDEO_EDITOR_MODELS)"; return; }
  mkdir -p "$AI_VIDEO_EDITOR_MODELS"
  local m
  for m in $AI_VIDEO_EDITOR_WHISPER; do
    if HF_HOME="$AI_VIDEO_EDITOR_MODELS" HF_HUB_OFFLINE=1 "$VENV/bin/python" -c "from faster_whisper.utils import download_model; download_model('$m')" >/dev/null 2>&1; then
      log "whisper $m OK ($AI_VIDEO_EDITOR_MODELS)"
    else
      log "downloading whisper $m into $AI_VIDEO_EDITOR_MODELS"
      HF_HOME="$AI_VIDEO_EDITOR_MODELS" "$VENV/bin/python" -c "from faster_whisper.utils import download_model; download_model('$m')" >/dev/null \
        || die "whisper $m download failed (network?); re-run ./install.sh, or ./install.sh --no-models"
    fi
  done
}

sha_ok() { echo "$1  $2" | { have sha256sum && sha256sum -c --quiet - || shasum -a 256 -c --quiet -; } >/dev/null 2>&1; }
# A piper CLI (one already on PATH, else piper-tts in the venv, linked into $BIN_DIR, which env.sh puts on PATH) and
# the en_US-amy-low voice at $PIPER_MODEL: copied from $AI_VIDEO_EDITOR_PIPER_CACHE when it has it, else downloaded.
# A custom AI_VIDEO_EDITOR_PIPER_MODEL is used as is. Without them the local TTS falls back to eSpeak / flite.
install_piper() {
  mkdir -p "$BIN_DIR"
  if [ -x "$VENV/bin/piper" ]; then ln -sfn "$VENV/bin/piper" "$BIN_DIR/piper"; log "piper OK (venv)"
  elif have piper && piper --help >/dev/null 2>&1; then log "piper OK ($(command -v piper))"
  else
    log "installing piper-tts $PIPER_TTS_VERSION into venv"
    if "$VENV/bin/python" -m pip install -q "piper-tts==$PIPER_TTS_VERSION"; then ln -sfn "$VENV/bin/piper" "$BIN_DIR/piper"
    else log "WARNING: piper-tts install failed (the local TTS falls back to eSpeak / flite; --doctor shows it)"; fi
  fi
  [ -n "$USER_PIPER_MODEL" ] && { log "piper voice: $PIPER_MODEL (AI_VIDEO_EDITOR_PIPER_MODEL)"; return; }
  local d f sha src; d="$(dirname "$PIPER_MODEL")"; mkdir -p "$d"
  for f in "$PIPER_VOICE.onnx" "$PIPER_VOICE.onnx.json"; do
    sha="$PIPER_ONNX_SHA"; [ "$f" = "$PIPER_VOICE.onnx.json" ] && sha="$PIPER_JSON_SHA"
    sha_ok "$sha" "$d/$f" && continue
    src="${AI_VIDEO_EDITOR_PIPER_CACHE:-}/$f"
    if [ -n "${AI_VIDEO_EDITOR_PIPER_CACHE:-}" ] && sha_ok "$sha" "$src"; then log "piper voice: copying $f"; cp "$src" "$d/$f.part"
    else log "downloading the piper voice $f (~60 MB in all)"; curl -fsSL -o "$d/$f.part" "$PIPER_VOICE_URL/$f" || die "piper voice download failed (network?); re-run ./install.sh"; fi
    sha_ok "$sha" "$d/$f.part" || { rm -f "$d/$f.part"; die "piper voice $f checksum mismatch"; }
    mv "$d/$f.part" "$d/$f"
  done
  log "piper voice OK ($PIPER_MODEL)"
}

install_npm() {
  load_node || die "node $NODE_MAJOR not available"
  cd "$REPO"
  if [ -f "$LOCK_STAMP" ] && [ "$(cat "$LOCK_STAMP")" = "$(lock_hash)" ] && [ -x node_modules/.bin/hyperframes ]; then
    log "npm deps OK (package-lock unchanged)"
  else
    log "npm ci"
    npm ci --no-audit --no-fund --loglevel=error
    lock_hash > "$LOCK_STAMP"
  fi
  node_modules/.bin/hyperframes telemetry disable >/dev/null
  # HyperFrames renders with its own pinned chrome-headless-shell (Playwright browsers are not used by the kit's scripts).
  log "hyperframes browser ensure"
  node_modules/.bin/hyperframes browser ensure >/dev/null
}

write_env() {
  load_node || die "node $NODE_MAJOR not available"
  mkdir -p "$AI_VIDEO_EDITOR_HOME"
  local nd; nd="$(dirname "$(command -v node)")"
  cat > "$AI_VIDEO_EDITOR_HOME/env.sh" <<ENV
# AI Video Editor toolchain (written by install.sh; re-run it to update). Source it:  . "$AI_VIDEO_EDITOR_HOME/env.sh"
# Node $(node -v):
case ":\$PATH:" in *":$nd:"*) ;; *) export PATH="$nd:\$PATH" ;; esac
# the ai-video-editor command (this checkout's bin/):
case ":\$PATH:" in *":$REPO/bin:"*) ;; *) export PATH="$REPO/bin:\$PATH" ;; esac
export AI_VIDEO_EDITOR_HOME="$AI_VIDEO_EDITOR_HOME"
export AI_VIDEO_EDITOR_PYTHON="$VENV/bin/python"
# Whisper models (faster-whisper / Hugging Face cache):
export AI_VIDEO_EDITOR_MODELS="$AI_VIDEO_EDITOR_MODELS"
export HF_HOME="$AI_VIDEO_EDITOR_MODELS"
# local TTS: the piper CLI (when installed here) and its voice
case ":\$PATH:" in *":$BIN_DIR:"*) ;; *) export PATH="$BIN_DIR:\$PATH" ;; esac
export AI_VIDEO_EDITOR_PIPER_MODEL="$PIPER_MODEL"
# the pre-rename names, for one release (scripts that still read EASY_EDITS_*):
export EASY_EDITS_HOME="$AI_VIDEO_EDITOR_HOME"
export EASY_EDITS_PYTHON="$VENV/bin/python"
export EASY_EDITS_MODELS="$AI_VIDEO_EDITOR_MODELS"
export EASY_EDITS_PIPER_MODEL="$PIPER_MODEL"
# no HyperFrames usage telemetry:
export HYPERFRAMES_NO_TELEMETRY=1
export DO_NOT_TRACK=1
ENV
}

# ---------------------------------------------------------------- home (renamed from ~/.easy-edits)
# Only for the default home: a custom AI_VIDEO_EDITOR_HOME / EASY_EDITS_HOME leaves ~/.easy-edits alone.
# Before the install steps: a pre-rename ~/.easy-edits (a real dir) becomes ~/.ai-video-editor (venv, node, models kept).
migrate_home() {
  [ "$AI_VIDEO_EDITOR_HOME" = "$DEFAULT_HOME" ] || return 0
  if [ -d "$LEGACY_HOME" ] && [ ! -L "$LEGACY_HOME" ] && [ ! -e "$DEFAULT_HOME" ] && [ ! -L "$DEFAULT_HOME" ]; then
    mv "$LEGACY_HOME" "$DEFAULT_HOME"
    ln -sfn .ai-video-editor "$LEGACY_HOME"
    log "moved $LEGACY_HOME to $DEFAULT_HOME ($LEGACY_HOME is now a symlink to it)"
  fi
  set_paths
}
# After write_env: ~/.easy-edits is a symlink to ~/.ai-video-editor, so `. ~/.easy-edits/env.sh` keeps working.
link_legacy_home() {
  [ "$AI_VIDEO_EDITOR_HOME" = "$DEFAULT_HOME" ] || return 0
  if [ -L "$LEGACY_HOME" ]; then
    [ "$(cd "$LEGACY_HOME" 2>/dev/null && pwd -P)" = "$(cd "$DEFAULT_HOME" && pwd -P)" ] && return 0
    ln -sfn .ai-video-editor "$LEGACY_HOME"; log "$LEGACY_HOME now links to $DEFAULT_HOME"
  elif [ -d "$LEGACY_HOME" ] && rmdir "$LEGACY_HOME" 2>/dev/null; then
    ln -s .ai-video-editor "$LEGACY_HOME"; log "$LEGACY_HOME (empty) is now a symlink to $DEFAULT_HOME"
  elif [ -e "$LEGACY_HOME" ]; then
    log "note: $LEGACY_HOME is a legacy home next to $DEFAULT_HOME; left as is (nothing written there; remove it when you no longer need it)"
  else
    ln -s .ai-video-editor "$LEGACY_HOME"
  fi
}

# ---------------------------------------------------------------- Claude Code skill
# The repo skill (.claude/skills/ai-video-editor) only loads in a Claude Code session started inside this checkout. An
# assistant that cloned the repo from another folder ("Install AI Video Editor from <url>") and every later session
# started elsewhere never see it, so the Skill tool can't load it. Register a personal copy in
# $CLAUDE_CONFIG_DIR/skills/ai-video-editor (loaded by every new session) that names this checkout. A copy, not a
# symlink: it tells the assistant where the checkout is; re-running ./install.sh (e.g. after git pull) refreshes it.
# A SKILL.md there without our marker line is the user's own and is left alone.
SKILL_MARK="<!-- ai-video-editor: installed by install.sh; re-run ./install.sh to refresh -->"
OLD_SKILL_MARK="<!-- easy-edits: installed by install.sh; re-run ./install.sh to refresh -->"   # before the rename
skill_dir() { printf '%s/skills/ai-video-editor' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; }
install_skill() {
  [ "${AI_VIDEO_EDITOR_NO_SKILL:-0}" = 1 ] && { log "Claude Code skill: skipped (AI_VIDEO_EDITOR_NO_SKILL=1)"; return 0; }
  local src="$REPO/.claude/skills/ai-video-editor/SKILL.md" d; d="$(skill_dir)"
  [ -f "$src" ] || { log "WARNING: $src missing; Claude Code skill not registered"; return 0; }
  if [ -f "$d/SKILL.md" ] && ! grep -qxF "$SKILL_MARK" "$d/SKILL.md"; then
    log "Claude Code skill: $d/SKILL.md is not ours; left alone"; return 0
  fi
  mkdir -p "$d"
  # the frontmatter stays first; the note goes right after it
  awk -v mark="$SKILL_MARK" -v repo="$REPO" -v home="$AI_VIDEO_EDITOR_HOME" '
    { print }
    /^---$/ && ++n == 2 {
      print ""; print mark
      print "> This copy was registered by `" repo "/install.sh`. AI Video Editor is already cloned at `" repo "`:"
      print "> skip the `git clone` in section 1, run `./install.sh` / `./install.sh --doctor` in that folder, and"
      print "> `. " home "/env.sh` before any `ai-video-editor` command. The rest of this skill applies as written."
    }' "$src" > "$d/SKILL.md.part"
  mv "$d/SKILL.md.part" "$d/SKILL.md"
  # the copy an install from before the rename registered as skills/easy-edits (ours only: it has the old marker)
  local old; old="$(dirname "$d")/easy-edits"
  if [ -f "$old/SKILL.md" ] && grep -qxF "$OLD_SKILL_MARK" "$old/SKILL.md"; then
    rm -f "$old/SKILL.md"; rmdir "$old" 2>/dev/null || true; log "Claude Code skill: removed the old $old (now ai-video-editor)"
  fi
  log "Claude Code skill registered: $d/SKILL.md (new Claude Code sessions can load it: /ai-video-editor)"
}

# ---------------------------------------------------------------- caption font
# The Clean cut captions are Montserrat 700 (captions-minimal). Chrome only draws it if fontconfig (Linux) or macOS
# has it; otherwise the captions silently fall back to another sans. Montserrat is SIL OFL 1.1 (google/fonts, pinned
# commit, sha256-checked); installed per user with its licence next to it.
FONT_COMMIT=47d54ca1ebb14fd864695f1d39dc734f39017c33
FONT_SHA=0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7
MONTSERRAT_FILE='Montserrat[wght].ttf'   # the exact file name the macOS check looks for (FONT_FILES in style-pack.mjs)
# macOS: Chrome finds fonts through CoreText (~/Library/Fonts, /Library/Fonts), so check those folders first; a
# Homebrew fc-list may not index ~/Library/Fonts and would report an installed font as missing.
font_file_present() { [ -e "$HOME/Library/Fonts/$1" ] || [ -e "/Library/Fonts/$1" ]; }
have_montserrat() {
  [ "$(uname)" = Darwin ] && font_file_present "$MONTSERRAT_FILE" && return 0
  have fc-list && fc-list : family | grep -x 'Montserrat\(,.*\)\{0,1\}' >/dev/null
}
install_font() {
  if have_montserrat; then log "font Montserrat OK"; return 0; fi
  local d="$HOME/.local/share/fonts/ai-video-editor"; [ "$(uname)" = Darwin ] && d="$HOME/Library/Fonts"
  local base="https://raw.githubusercontent.com/google/fonts/$FONT_COMMIT/ofl/montserrat"
  mkdir -p "$d"; log "installing font Montserrat (OFL) into $d"
  curl -fsSL -o "$d/$MONTSERRAT_FILE.part" "$base/Montserrat%5Bwght%5D.ttf" || die "font download failed"
  echo "$FONT_SHA  $d/$MONTSERRAT_FILE.part" | { have sha256sum && sha256sum -c --quiet - || shasum -a 256 -c --quiet -; } || die "font checksum mismatch"
  mv "$d/$MONTSERRAT_FILE.part" "$d/$MONTSERRAT_FILE"
  curl -fsSL -o "$d/Montserrat-OFL.txt" "$base/OFL.txt" || true
  have fc-cache && fc-cache -f "$d" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------- style pack fonts
# The style packs (ai-video-editor/styles/packs) also use Playfair Display (Broadsheet) and JetBrains Mono (Terminal); the
# renderer refuses a pack whose fonts are missing. Same source, pinned commit and checksums as Montserrat (SIL OFL 1.1).
#   family|google/fonts dir|file|sha256
STYLE_FONTS="Playfair Display|playfairdisplay|PlayfairDisplay[wght].ttf|c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6
JetBrains Mono|jetbrainsmono|JetBrainsMono[wght].ttf|48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda"
# (grep >/dev/null, not grep -q: -q exits on the first match, fc-list gets SIGPIPE and pipefail calls it missing)
have_family() {
  [ "$(uname)" = Darwin ] && font_file_present "$2" && return 0
  have fc-list && fc-list : family | tr ',' '\n' | grep -x "$1" >/dev/null
}
install_style_fonts() {
  local d="$HOME/.local/share/fonts/ai-video-editor"; [ "$(uname)" = Darwin ] && d="$HOME/Library/Fonts"
  local fam dir file sha url added=0
  while IFS='|' read -r fam dir file sha; do
    if have_family "$fam" "$file"; then log "font $fam OK"; continue; fi
    mkdir -p "$d"; log "installing font $fam (OFL) into $d"
    url="https://raw.githubusercontent.com/google/fonts/$FONT_COMMIT/ofl/$dir"
    curl -fsSL -o "$d/$file.part" "$url/$(printf '%s' "$file" | sed 's/\[/%5B/; s/\]/%5D/')" || die "font download failed ($fam)"
    echo "$sha  $d/$file.part" | { have sha256sum && sha256sum -c --quiet - || shasum -a 256 -c --quiet -; } || die "font checksum mismatch ($fam)"
    mv "$d/$file.part" "$d/$file"
    curl -fsSL -o "$d/${file%%[*}-OFL.txt" "$url/OFL.txt" || true
    added=1
  done <<< "$STYLE_FONTS"
  [ "$added" = 1 ] && { have fc-cache && fc-cache -f "$d" >/dev/null 2>&1 || true; }
  return 0
}

# ---------------------------------------------------------------- doctor
FAILS=0
check() { # name, command...
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then printf 'PASS  %-22s %s\n' "$name" "$(printf '%s' "$out" | head -n1)"
  else printf 'FAIL  %-22s %s\n' "$name" "$(printf '%s' "$out" | head -n1)"; FAILS=$((FAILS + 1)); fi
}
c_node()    { load_node || { echo "need node >= $NODE_MAJOR (have $(have node && node -v || echo none))"; return 1; }; node -v; }
c_npm()     { load_node && npm -v; }
c_ffmpeg()  { ffmpeg -hide_banner -version | head -n1; }
c_ffprobe() { ffprobe -hide_banner -version | head -n1; }
c_python()  { [ -x "$VENV/bin/python" ] && py_ok "$VENV/bin/python" && { "$VENV/bin/python" --version; return; }; echo "venv python missing or not 3.$PY_MIN-3.$PY_MAX (run ./install.sh)"; return 1; }
c_fw()      { "$VENV/bin/python" -c 'import faster_whisper,ctranslate2; print("faster-whisper", faster_whisper.__version__, "ctranslate2", ctranslate2.__version__)'; }
c_yunet()   { f="$AI_VIDEO_EDITOR_HOME/models-cv/face_detection_yunet_2023mar.onnx"; [ -f "$f" ] && echo "$f"; }
c_ytdlp()   { "$VENV/bin/yt-dlp" --version | sed 's/^/yt-dlp /'; }
c_cv2()     { "$VENV/bin/python" -c "import cv2; print(\"opencv\", cv2.__version__)"; }
c_models()  { local m; for m in $AI_VIDEO_EDITOR_WHISPER; do HF_HOME="$AI_VIDEO_EDITOR_MODELS" HF_HUB_OFFLINE=1 "$VENV/bin/python" -c "from faster_whisper.utils import download_model; download_model('$m')" >/dev/null 2>&1 || { echo "whisper $m not in $AI_VIDEO_EDITOR_MODELS (run ./install.sh)"; return 1; }; done; echo "$AI_VIDEO_EDITOR_WHISPER in $AI_VIDEO_EDITOR_MODELS"; }
c_deps()    { load_node && cd "$REPO" && npm ls --depth=0 >/dev/null && echo "node_modules matches package.json"; }
c_hf()      { load_node && cd "$REPO" && node_modules/.bin/hyperframes --version; }
c_gsap()    { load_node && cd "$REPO" && node -p 'require("gsap/package.json").version'; }
c_chrome()  { load_node && cd "$REPO" && p="$(node_modules/.bin/hyperframes browser path 2>/dev/null | tail -n1)" && [ -x "$p" ] && echo "$p"; }
font_where() { [ "$(uname)" = Darwin ] && echo "~/Library/Fonts, /Library/Fonts or fc-list" || echo "fc-list (fontconfig)"; }
c_font()    { have_montserrat && echo "Montserrat (Clean cut captions)" || { echo "Montserrat not found in $(font_where): captions would fall back (run ./install.sh)"; return 1; }; }
c_sfonts()  { local fam dir file sha miss=(); while IFS='|' read -r fam dir file sha; do have_family "$fam" "$file" || miss+=("$fam"); done <<< "$STYLE_FONTS"
              [ ${#miss[@]} -eq 0 ] && echo "Playfair Display, JetBrains Mono (style packs)" || { echo "not found in $(font_where): ${miss[*]}: style packs that use them are refused (run ./install.sh)"; return 1; }; }
c_cli()     { load_node && "$REPO/bin/ai-video-editor" --help | head -n1; }
c_alias()   { [ -x "$REPO/bin/easy-edits" ] && "$REPO/bin/easy-edits" --help >/dev/null && echo "easy-edits (alias of ai-video-editor)"; }
c_env()     { [ -f "$AI_VIDEO_EDITOR_HOME/env.sh" ] && echo "$AI_VIDEO_EDITOR_HOME/env.sh"; }
c_telem()   { grep -qx 'export HYPERFRAMES_NO_TELEMETRY=1' "$AI_VIDEO_EDITOR_HOME/env.sh" 2>/dev/null || { echo "env.sh does not opt out of HyperFrames telemetry (run ./install.sh)"; return 1; }; echo "HyperFrames telemetry off (HYPERFRAMES_NO_TELEMETRY=1)"; }
c_piper()   { [ -f "$PIPER_MODEL" ] || { echo "no piper voice at $PIPER_MODEL (run ./install.sh)"; return 1; }
              have piper || { echo "piper not on PATH (run ./install.sh)"; return 1; }
              echo "piper $(basename "$PIPER_MODEL" .onnx) ($(( $(wc -c < "$PIPER_MODEL") / 1048576 )) MB)"; }
c_backends() { load_node && node "$REPO/ai-video-editor/cli/backends.mjs" --doctor; }   # key present: yes/no only, never a key
c_skill()   { local d; d="$(skill_dir)"
              if [ "${AI_VIDEO_EDITOR_NO_SKILL:-0}" = 1 ]; then echo "skipped (AI_VIDEO_EDITOR_NO_SKILL=1)"
              elif [ -f "$d/SKILL.md" ] && grep -qF "$REPO" "$d/SKILL.md"; then echo "$d/SKILL.md"
              elif [ -f "$d/SKILL.md" ] && ! grep -qxF "$SKILL_MARK" "$d/SKILL.md"; then echo "$d/SKILL.md (your own copy)"
              elif ! have claude && [ ! -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" ]; then echo "Claude Code not found (skill not needed)"
              else echo "not registered for this checkout in $d (run ./install.sh)"; return 1; fi; }
c_agent()   { local a=(); for b in claude codex; do have "$b" && a+=("$b"); done; echo "optional agent CLIs on PATH: ${a[*]:-none} (Clean cut runs without one: --no-review)"; }

doctor() {
  echo "AI Video Editor doctor ($REPO)"
  check "node>=$NODE_MAJOR" c_node
  check npm c_npm
  check ffmpeg c_ffmpeg
  check ffprobe c_ffprobe
  check python3 c_python
  check faster-whisper c_fw
  check opencv c_cv2
  check yunet-model c_yunet
  check yt-dlp c_ytdlp
  check whisper-models c_models
  check npm-deps c_deps
  check hyperframes c_hf
  check gsap c_gsap
  check hyperframes-chrome c_chrome
  check caption-font c_font
  check style-fonts c_sfonts
  check env.sh c_env
  check telemetry-off c_telem
  check ai-video-editor-cli c_cli
  check easy-edits-alias c_alias
  check claude-skill c_skill
  check agent c_agent
  check piper-voice c_piper
  check backends c_backends
  if [ "$FAILS" -gt 0 ]; then echo "doctor: $FAILS FAIL"; exit 1; fi
  echo "doctor: all PASS"
}

# Sourced (`. ./install.sh`, as the tests do): only define the functions and settings above, run nothing.
(return 0 2>/dev/null) && return 0

NO_MODELS=0 MODE=install
for a in "$@"; do
  case "$a" in
    --doctor) MODE=doctor ;;
    --install) ;;
    --no-models) NO_MODELS=1 ;;
    --skill-only) MODE=skill ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $a (see ./install.sh --help)" ;;
  esac
done
if [ "$MODE" = doctor ]; then
  if [ "$AI_VIDEO_EDITOR_HOME" = "$DEFAULT_HOME" ] && [ ! -e "$DEFAULT_HOME" ] && [ -d "$LEGACY_HOME" ]; then
    echo "note: checking the pre-rename home $LEGACY_HOME (./install.sh moves it to $DEFAULT_HOME)"
    AI_VIDEO_EDITOR_HOME="$LEGACY_HOME"; set_paths
  fi
  # what env.sh sets, so a shell that has not sourced it sees the same TTS
  case ":$PATH:" in *":$BIN_DIR:"*) ;; *) [ -d "$BIN_DIR" ] && PATH="$BIN_DIR:$PATH" ;; esac
  [ -f "$PIPER_MODEL" ] && export AI_VIDEO_EDITOR_PIPER_MODEL="$PIPER_MODEL"
  doctor; exit
fi
if [ "$MODE" = skill ]; then install_skill; exit; fi
migrate_home
install_node; install_ffmpeg; install_python; install_models; install_piper; install_npm; install_font; install_style_fonts; write_env; link_legacy_home; install_skill
log "done. In each new shell:  . $AI_VIDEO_EDITOR_HOME/env.sh     Verify:  ./install.sh --doctor"
log "first edit:  ai-video-editor samples/talk.mp4 -o out/        (ai-video-editor --help lists every mode)"

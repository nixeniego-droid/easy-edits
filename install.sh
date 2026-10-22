#!/usr/bin/env bash
# Easy Edits installer: one command, idempotent, safe to re-run. Installs or verifies everything Easy Edits needs:
# Node 22 (official nodejs.org build in $EASY_EDITS_HOME/node unless a Node >= 22 is already on PATH; no nvm),
# ffmpeg/ffprobe, a python venv with faster-whisper + OpenCV, the Whisper models (small + medium, ~2 GB, in a known dir),
# the npm deps, HyperFrames' Chrome and the fonts (Montserrat for the captions; Playfair Display and JetBrains Mono
# for the style packs; all OFL). Writes $EASY_EDITS_HOME/env.sh.
#
#   ./install.sh               install / verify everything
#   ./install.sh --no-models   skip the Whisper model download (they then download on first use)
#   ./install.sh --doctor      print PASS/FAIL per dependency, exit nonzero on any FAIL
#
# Env overrides:
#   EASY_EDITS_HOME     (default ~/.easy-edits)          venv, node and env.sh live here
#   EASY_EDITS_MODELS   (default $HF_HOME if set, else $EASY_EDITS_HOME/models)   Whisper model cache (HF_HOME layout)
#   EASY_EDITS_WHISPER  (default "small medium")      which faster-whisper models to fetch
#   FASTER_WHISPER_VERSION (default 1.2.1)
set -euo pipefail
# HyperFrames sends anonymous usage telemetry unless opted out; opt out before anything below can run it.
# (env.sh exports the same, and install_npm also records the opt-out in ~/.hyperframes/config.json)
export HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EASY_EDITS_HOME="${EASY_EDITS_HOME:-$HOME/.easy-edits}"
VENV="$EASY_EDITS_HOME/venv"
NODE_HOME="$EASY_EDITS_HOME/node"
NODE_MAJOR=22
FASTER_WHISPER_VERSION="${FASTER_WHISPER_VERSION:-1.2.1}"
OPENCV_VERSION="${OPENCV_VERSION:-4.14.0.94}"
YUNET_COMMIT="main"   # the file is pinned by its sha256 below
YUNET_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
LOCK_STAMP="$REPO/node_modules/.easy-edits-lock.sha256"
# an earlier env.sh records the model dir; keep it on re-runs
PREV_MODELS=""   # (a missing env.sh must not trip set -e/pipefail: the fresh-user install died here silently)
[ -f "$EASY_EDITS_HOME/env.sh" ] && PREV_MODELS="$(sed -n 's/^export EASY_EDITS_MODELS="\(.*\)"$/\1/p' "$EASY_EDITS_HOME/env.sh" | head -n1)" || true
EASY_EDITS_MODELS="${EASY_EDITS_MODELS:-${PREV_MODELS:-${HF_HOME:-$EASY_EDITS_HOME/models}}}"
EASY_EDITS_WHISPER="${EASY_EDITS_WHISPER:-small medium}"
# nvm and npm refuse to work together when these are set; npm ci here is project-local
unset NPM_CONFIG_PREFIX npm_config_prefix 2>/dev/null || true

log()  { printf '[easy-edits] %s\n' "$*"; }
die()  { printf '[easy-edits] ERROR: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
node_major() { have node && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# Put a Node >= 22 on PATH: one already on PATH, else Easy Edits' own ($EASY_EDITS_HOME/node).
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
[easy-edits] ffmpeg/ffprobe missing and no root/sudo available. Install them, then re-run ./install.sh:
    Debian/Ubuntu:  sudo apt-get install -y ffmpeg
    Fedora:         sudo dnf install -y ffmpeg
    macOS:          brew install ffmpeg
    Or put static builds (https://johnvansickle.com/ffmpeg/) in ~/.local/bin
MSG
    exit 1
  fi
}

install_python() {
  if ! have python3; then
    if have apt-get && as_root true; then
      as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 python3-venv
    else die "python3 missing; install python3 (+ python3-venv) and re-run"; fi
  fi
  if ! python3 -c 'import venv, ensurepip' 2>/dev/null; then
    if have apt-get && as_root true; then
      as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv
    else die "python3 venv/ensurepip missing; install python3-venv and re-run"; fi
  fi
  if [ ! -x "$VENV/bin/python" ]; then
    log "creating venv $VENV"
    mkdir -p "$EASY_EDITS_HOME"
    python3 -m venv "$VENV"
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
  # yt-dlp (URL input, easy-edits/bin/fetch-input.sh; docs/URL_INPUT.md). Unpinned and upgraded on every run: YouTube
  # changes often and an old yt-dlp stops working. [default] adds yt-dlp-ejs (YouTube's JS challenges, run with Node).
  log "yt-dlp: install / upgrade into venv"
  "$VENV/bin/python" -m pip install -q -U "yt-dlp[default]" || log "WARNING: yt-dlp install failed (URL input unavailable; local files still work)"
  # YuNet face model (OpenCV Zoo, MIT) for the easy-edits face track (engine/facetrack.py); Haar is the fallback
  local yd="$EASY_EDITS_HOME/models-cv" yf="face_detection_yunet_2023mar.onnx"
  if [ -f "$yd/$yf" ]; then log "YuNet face model OK"
  else
    log "downloading the YuNet face model"; mkdir -p "$yd"
    curl -fsSL -o "$yd/$yf.part" "https://github.com/opencv/opencv_zoo/raw/$YUNET_COMMIT/models/face_detection_yunet/$yf" || die "YuNet download failed"
    echo "$YUNET_SHA  $yd/$yf.part" | { have sha256sum && sha256sum -c --quiet - || shasum -a 256 -c --quiet -; } || die "YuNet checksum mismatch"
    mv "$yd/$yf.part" "$yd/$yf"
  fi
}

# Whisper models into $EASY_EDITS_MODELS (Hugging Face cache layout; env.sh exports HF_HOME there), so a reboot,
# a cleared ~/.cache or the first edit never waits on a 1.5 GB download.
install_models() {
  [ "${NO_MODELS:-0}" = 1 ] && { log "Whisper models: skipped (--no-models; they download on first use into $EASY_EDITS_MODELS)"; return; }
  mkdir -p "$EASY_EDITS_MODELS"
  local m
  for m in $EASY_EDITS_WHISPER; do
    if HF_HOME="$EASY_EDITS_MODELS" HF_HUB_OFFLINE=1 "$VENV/bin/python" -c "from faster_whisper.utils import download_model; download_model('$m')" >/dev/null 2>&1; then
      log "whisper $m OK ($EASY_EDITS_MODELS)"
    else
      log "downloading whisper $m into $EASY_EDITS_MODELS"
      HF_HOME="$EASY_EDITS_MODELS" "$VENV/bin/python" -c "from faster_whisper.utils import download_model; download_model('$m')" >/dev/null \
        || die "whisper $m download failed (network?); re-run ./install.sh, or ./install.sh --no-models"
    fi
  done
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
  mkdir -p "$EASY_EDITS_HOME"
  local nd; nd="$(dirname "$(command -v node)")"
  cat > "$EASY_EDITS_HOME/env.sh" <<ENV
# Easy Edits toolchain (written by install.sh; re-run it to update). Source it:  . "$EASY_EDITS_HOME/env.sh"
# Node $(node -v):
case ":\$PATH:" in *":$nd:"*) ;; *) export PATH="$nd:\$PATH" ;; esac
# the easy-edits command (this checkout's bin/):
case ":\$PATH:" in *":$REPO/bin:"*) ;; *) export PATH="$REPO/bin:\$PATH" ;; esac
export EASY_EDITS_HOME="$EASY_EDITS_HOME"
export EASY_EDITS_PYTHON="$VENV/bin/python"
# Whisper models (faster-whisper / Hugging Face cache):
export EASY_EDITS_MODELS="$EASY_EDITS_MODELS"
export HF_HOME="$EASY_EDITS_MODELS"
# no HyperFrames usage telemetry:
export HYPERFRAMES_NO_TELEMETRY=1
export DO_NOT_TRACK=1
ENV
}

# ---------------------------------------------------------------- caption font
# The Clean cut captions are Montserrat 700 (captions-minimal). Chrome only draws it if fontconfig (Linux) or macOS
# has it; otherwise the captions silently fall back to another sans. Montserrat is SIL OFL 1.1 (google/fonts, pinned
# commit, sha256-checked); installed per user with its licence next to it.
FONT_COMMIT=47d54ca1ebb14fd864695f1d39dc734f39017c33
FONT_SHA=0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7
# macOS: Chrome finds fonts through CoreText (~/Library/Fonts, /Library/Fonts), so check those folders first; a
# Homebrew fc-list may not index ~/Library/Fonts and would report an installed font as missing.
font_file_present() { [ -e "$HOME/Library/Fonts/$1" ] || [ -e "/Library/Fonts/$1" ]; }
have_montserrat() {
  [ "$(uname)" = Darwin ] && font_file_present 'Montserrat[wght].ttf' && return 0
  have fc-list && fc-list : family | grep -x 'Montserrat\(,.*\)\{0,1\}' >/dev/null
}
install_font() {
  if have_montserrat; then log "font Montserrat OK"; return 0; fi
  local d="$HOME/.local/share/fonts/easy-edits"; [ "$(uname)" = Darwin ] && d="$HOME/Library/Fonts"
  local base="https://raw.githubusercontent.com/google/fonts/$FONT_COMMIT/ofl/montserrat"
  mkdir -p "$d"; log "installing font Montserrat (OFL) into $d"
  curl -fsSL -o "$d/Montserrat[wght].ttf.part" "$base/Montserrat%5Bwght%5D.ttf" || die "font download failed"
  echo "$FONT_SHA  $d/Montserrat[wght].ttf.part" | { have sha256sum && sha256sum -c --quiet - || shasum -a 256 -c --quiet -; } || die "font checksum mismatch"
  mv "$d/Montserrat[wght].ttf.part" "$d/Montserrat[wght].ttf"
  curl -fsSL -o "$d/Montserrat-OFL.txt" "$base/OFL.txt" || true
  have fc-cache && fc-cache -f "$d" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------- style pack fonts
# The style packs (easy-edits/styles/packs) also use Playfair Display (Broadsheet) and JetBrains Mono (Terminal); the
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
  local d="$HOME/.local/share/fonts/easy-edits"; [ "$(uname)" = Darwin ] && d="$HOME/Library/Fonts"
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
c_python()  { python3 --version; }
c_fw()      { "$VENV/bin/python" -c 'import faster_whisper,ctranslate2; print("faster-whisper", faster_whisper.__version__, "ctranslate2", ctranslate2.__version__)'; }
c_yunet()   { f="$EASY_EDITS_HOME/models-cv/face_detection_yunet_2023mar.onnx"; [ -f "$f" ] && echo "$f"; }
c_ytdlp()   { "$VENV/bin/yt-dlp" --version | sed 's/^/yt-dlp /'; }
c_cv2()     { "$VENV/bin/python" -c "import cv2; print(\"opencv\", cv2.__version__)"; }
c_models()  { local m; for m in $EASY_EDITS_WHISPER; do HF_HOME="$EASY_EDITS_MODELS" HF_HUB_OFFLINE=1 "$VENV/bin/python" -c "from faster_whisper.utils import download_model; download_model('$m')" >/dev/null 2>&1 || { echo "whisper $m not in $EASY_EDITS_MODELS (run ./install.sh)"; return 1; }; done; echo "$EASY_EDITS_WHISPER in $EASY_EDITS_MODELS"; }
c_deps()    { load_node && cd "$REPO" && npm ls --depth=0 >/dev/null && echo "node_modules matches package.json"; }
c_hf()      { load_node && cd "$REPO" && node_modules/.bin/hyperframes --version; }
c_gsap()    { load_node && cd "$REPO" && node -p 'require("gsap/package.json").version'; }
c_chrome()  { load_node && cd "$REPO" && p="$(node_modules/.bin/hyperframes browser path 2>/dev/null | tail -n1)" && [ -x "$p" ] && echo "$p"; }
font_where() { [ "$(uname)" = Darwin ] && echo "~/Library/Fonts, /Library/Fonts or fc-list" || echo "fc-list (fontconfig)"; }
c_font()    { have_montserrat && echo "Montserrat (Clean cut captions)" || { echo "Montserrat not found in $(font_where): captions would fall back (run ./install.sh)"; return 1; }; }
c_sfonts()  { local fam dir file sha miss=(); while IFS='|' read -r fam dir file sha; do have_family "$fam" "$file" || miss+=("$fam"); done <<< "$STYLE_FONTS"
              [ ${#miss[@]} -eq 0 ] && echo "Playfair Display, JetBrains Mono (style packs)" || { echo "not found in $(font_where): ${miss[*]}: style packs that use them are refused (run ./install.sh)"; return 1; }; }
c_cli()     { load_node && "$REPO/bin/easy-edits" --help | head -n1; }
c_env()     { [ -f "$EASY_EDITS_HOME/env.sh" ] && echo "$EASY_EDITS_HOME/env.sh"; }
c_telem()   { grep -qx 'export HYPERFRAMES_NO_TELEMETRY=1' "$EASY_EDITS_HOME/env.sh" 2>/dev/null || { echo "env.sh does not opt out of HyperFrames telemetry (run ./install.sh)"; return 1; }; echo "HyperFrames telemetry off (HYPERFRAMES_NO_TELEMETRY=1)"; }
c_agent()   { local a=(); for b in claude codex; do have "$b" && a+=("$b"); done; echo "optional agent CLIs on PATH: ${a[*]:-none} (Clean cut runs without one: --no-review)"; }

doctor() {
  echo "Easy Edits doctor ($REPO)"
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
  check easy-edits-cli c_cli
  check agent c_agent
  if [ "$FAILS" -gt 0 ]; then echo "doctor: $FAILS FAIL"; exit 1; fi
  echo "doctor: all PASS"
}

NO_MODELS=0 MODE=install
for a in "$@"; do
  case "$a" in
    --doctor) MODE=doctor ;;
    --install) ;;
    --no-models) NO_MODELS=1 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $a (see ./install.sh --help)" ;;
  esac
done
if [ "$MODE" = doctor ]; then doctor; exit; fi
install_node; install_ffmpeg; install_python; install_models; install_npm; install_font; install_style_fonts; write_env
log "done. In each new shell:  . $EASY_EDITS_HOME/env.sh     Verify:  ./install.sh --doctor"
log "first edit:  easy-edits talk.mp4 -o out/        (easy-edits --help lists every mode)"

# Third-party notices

**Nothing third-party is bundled in this repository.** No `node_modules`, Python packages, models, fonts, music,
sound samples or footage are committed. `install.sh` and `npm ci` download the components below onto *your*
machine from their official sources, under their own licences. If you redistribute a build that includes them,
you take on their licence terms (for example the LGPL notices for FFmpeg and libvips, and the GSAP licence).

Checked for Easy Edits v1.1.0 (v1.0.0 under its earlier name; same components) against `package-lock.json` and the packages `install.sh` installs. No component is
under a licence that restricts using Easy Edits or the videos you make with it.

## Repository contents

| Part | Origin | Licence |
| --- | --- | --- |
| `easy-edits/`, `bin/`, `install.sh`, `docs/`, tests | Easy Edits | MIT (`LICENSE`) |
| `style-library/`, `style-templates/` | Herk Edit Kit (Nate Herk) | MIT (`LICENSE`) + `licenses/PIPELINE-USE-PERMISSION.txt` |
| Caption preset (`easy-edits/presets/captions-default.*`) | adapted from Herk Edit Kit | MIT |
| Test fixtures (`easy-edits/**/test/fixtures/`) | word timings, short transcript snippets, face boxes and DOM samples measured by Easy Edits on its test clips; no audio, video or image frames | MIT |

Style-library notes (from Herk Edit Kit): "Vox" and "Kallaway" are aesthetic reference names only; the templates
are not official brand assets and are not endorsed by those creators or organisations. Names, handles, figures and
source labels on the cards (e.g. "Acme") are placeholders: replace them with your own verified copy. Some styles
load fonts from Google Fonts at preview time (Plus Jakarta Sans, Inter, Space Mono and others, SIL OFL 1.1); no
font files are included.

## Installed by `install.sh`

| Component | Licence | How it is obtained |
| --- | --- | --- |
| Node.js 22 | MIT (bundled third-party code under its own licences, see its LICENSE) | nodejs.org official build, sha256-checked, into `~/.easy-edits/node` (skipped if Node >= 22 is on PATH) |
| FFmpeg / ffprobe | LGPL-2.1+ / GPL-2+ depending on the build | your system package manager (apt / brew) |
| Python 3 + venv | PSF-2.0 | your system package manager |
| faster-whisper 1.2.1 | MIT | pip, into `~/.easy-edits/venv` |
| CTranslate2 | MIT | pip (faster-whisper dependency) |
| PyAV (`av`) | BSD-3-Clause (wheels include FFmpeg libraries, LGPL) | pip (faster-whisper dependency) |
| onnxruntime | MIT | pip (faster-whisper dependency, voice activity detection) |
| huggingface_hub, tokenizers, hf-xet | Apache-2.0 | pip (faster-whisper dependencies) |
| numpy | BSD-3-Clause (and 0BSD / MIT / Zlib / CC0 parts) | pip |
| opencv-python-headless 4.14 | Apache-2.0 (wheel includes FFmpeg, LGPL; Haar cascades, Intel BSD-style licence) | pip |
| yt-dlp + yt-dlp-ejs (`yt-dlp[default]`) | Unlicense (yt-dlp-ejs: Unlicense AND MIT AND ISC) | pip, upgraded on each install |
| `yt-dlp[default]` extras: brotli, certifi, mutagen, pycryptodomex, requests, urllib3, websockets | MIT, MPL-2.0, **GPL-2.0-or-later (mutagen)**, BSD / public domain, Apache-2.0, MIT, BSD-3-Clause | pip; mutagen is used by yt-dlp only, never linked into Easy Edits' code |
| Other pip dependencies (anyio, click, filelock, fsspec, h11, httpx2 / httpcore2, idna, packaging, protobuf, PyYAML, tqdm, typing_extensions, flatbuffers, charset-normalizer, truststore) | MIT / BSD / Apache-2.0 / MPL-2.0 AND MIT (tqdm) / PSF-2.0 | pip |
| Whisper models `small`, `medium` (CTranslate2 conversions by SYSTRAN of OpenAI Whisper) | MIT | Hugging Face Hub, into `~/.easy-edits/models` |
| YuNet face detector `face_detection_yunet_2023mar.onnx` (OpenCV Zoo) | MIT | github.com/opencv/opencv_zoo, sha256-pinned, into `~/.easy-edits/models-cv` |
| Montserrat (Julieta Ulanovsky et al.) | SIL Open Font License 1.1 (OFL.txt installed next to it) | github.com/google/fonts at a pinned commit, sha256-checked, into your user fonts dir |
| HyperFrames' headless Chrome (`chrome-headless-shell`) | Chromium: BSD-3-Clause plus bundled third-party licences | downloaded by `hyperframes browser ensure` |

## Used at run time

| Component | Licence | When |
| --- | --- | --- |
| Kokoro-82M TTS voice (via HyperFrames) | Apache-2.0 | explainer mode with a `.txt` script; downloaded on first use |
| Openverse API (WordPress.org) | API terms of use; each track keeps its own licence | music beds: only **CC0** or **CC BY** tracks are accepted, fetched at render time, never bundled; every export with music gets a `CREDITS.txt` (title, creator, licence, licence URL, source) |
| `claude` / `codex` CLIs | their vendors' terms | optional; only if you installed them yourself |
| Piper TTS (`piper`) and its voice models | Piper: MIT (rhasspy/piper) or GPL-3.0 (piper1-gpl); each voice model has its own licence (check its model card) | optional `local` TTS engine, only if you installed `piper` and set `EASY_EDITS_PIPER_MODEL`; no voice is bundled or downloaded by Easy Edits |
| eSpeak NG (`espeak-ng`) / eSpeak | GPL-3.0-or-later | optional `local` TTS fallback, run as a separate program if it is on PATH |
| Flite (via FFmpeg's `flite` filter) | Flite: BSD-style (CMU) licence | optional `local` TTS fallback, only when your FFmpeg build includes libflite |
| Hosted generation APIs you configure (`http-generic`) | each provider's terms | optional; only providers you add to `~/.easy-edits/providers.json`, with your own key |

Not used: Remotion (its licence is not plain open source for companies).

## npm packages (`npm ci`, from `package-lock.json`)

Direct dependencies: `hyperframes` 0.7.109 (Apache-2.0, HeyGen: HTML-to-video render and TTS wrapper), `gsap`
3.14.2 (GSAP Standard "No Charge" licence, https://gsap.com/standard-license: free, including commercial use; it is
installed from npm and copied into each render project at render time; this repo only contains a symlink to it in
a test fixture), `playwright` 1.63.0 (Apache-2.0, DOM sampling in the quality gates).

The `@img/sharp-libvips-*` packages are prebuilt libvips binaries under LGPL-3.0-or-later, installed by npm as a
dependency of `sharp`; they are dynamically loaded and not modified.

Full list:

189 packages (115 MIT, 29 Apache-2.0, 16 BSD-3-Clause, 10 LGPL-3.0-or-later, 8 ISC, 4 BlueOak-1.0.0, 3 Apache-2.0 AND LGPL-3.0-or-later, 1 Apache-2.0 AND LGPL-3.0-or-later AND MIT, 1 Standard 'no charge' license: https://gsap.com/standard-license., 1 0BSD, 1 (MIT OR CC0-1.0)).

| Package | Version | Licence | Note |
| --- | --- | --- | --- |
| @emnapi/runtime | 1.11.3 | MIT | optional dependency |
| @esbuild/aix-ppc64 | 0.25.12 | MIT | optional dependency |
| @esbuild/android-arm | 0.25.12 | MIT | optional dependency |
| @esbuild/android-arm64 | 0.25.12 | MIT | optional dependency |
| @esbuild/android-x64 | 0.25.12 | MIT | optional dependency |
| @esbuild/darwin-arm64 | 0.25.12 | MIT | optional dependency |
| @esbuild/darwin-x64 | 0.25.12 | MIT | optional dependency |
| @esbuild/freebsd-arm64 | 0.25.12 | MIT | optional dependency |
| @esbuild/freebsd-x64 | 0.25.12 | MIT | optional dependency |
| @esbuild/linux-arm | 0.25.12 | MIT | optional dependency |
| @esbuild/linux-arm64 | 0.25.12 | MIT | optional dependency |
| @esbuild/linux-ia32 | 0.25.12 | MIT | optional dependency |
| @esbuild/linux-loong64 | 0.25.12 | MIT | optional dependency |
| @esbuild/linux-mips64el | 0.25.12 | MIT | optional dependency |
| @esbuild/linux-ppc64 | 0.25.12 | MIT | optional dependency |
| @esbuild/linux-riscv64 | 0.25.12 | MIT | optional dependency |
| @esbuild/linux-s390x | 0.25.12 | MIT | optional dependency |
| @esbuild/linux-x64 | 0.25.12 | MIT | optional dependency |
| @esbuild/netbsd-arm64 | 0.25.12 | MIT | optional dependency |
| @esbuild/netbsd-x64 | 0.25.12 | MIT | optional dependency |
| @esbuild/openbsd-arm64 | 0.25.12 | MIT | optional dependency |
| @esbuild/openbsd-x64 | 0.25.12 | MIT | optional dependency |
| @esbuild/openharmony-arm64 | 0.25.12 | MIT | optional dependency |
| @esbuild/sunos-x64 | 0.25.12 | MIT | optional dependency |
| @esbuild/win32-arm64 | 0.25.12 | MIT | optional dependency |
| @esbuild/win32-ia32 | 0.25.12 | MIT | optional dependency |
| @esbuild/win32-x64 | 0.25.12 | MIT | optional dependency |
| @google/genai | 1.52.0 | Apache-2.0 | optional dependency |
| @hono/node-server | 2.1.1 | MIT |  |
| @img/colour | 1.1.0 | MIT |  |
| @img/sharp-darwin-arm64 | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-darwin-x64 | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-freebsd-wasm32 | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-libvips-darwin-arm64 | 1.3.2 | LGPL-3.0-or-later | optional dependency |
| @img/sharp-libvips-darwin-x64 | 1.3.2 | LGPL-3.0-or-later | optional dependency |
| @img/sharp-libvips-linux-arm | 1.3.2 | LGPL-3.0-or-later | optional dependency |
| @img/sharp-libvips-linux-arm64 | 1.3.2 | LGPL-3.0-or-later | optional dependency |
| @img/sharp-libvips-linux-ppc64 | 1.3.2 | LGPL-3.0-or-later | optional dependency |
| @img/sharp-libvips-linux-riscv64 | 1.3.2 | LGPL-3.0-or-later | optional dependency |
| @img/sharp-libvips-linux-s390x | 1.3.2 | LGPL-3.0-or-later | optional dependency |
| @img/sharp-libvips-linux-x64 | 1.3.2 | LGPL-3.0-or-later | optional dependency |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.2 | LGPL-3.0-or-later | optional dependency |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.2 | LGPL-3.0-or-later | optional dependency |
| @img/sharp-linux-arm | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-linux-arm64 | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-linux-ppc64 | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-linux-riscv64 | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-linux-s390x | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-linux-x64 | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-linuxmusl-arm64 | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-linuxmusl-x64 | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-wasm32 | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | optional dependency |
| @img/sharp-webcontainers-wasm32 | 0.35.3 | Apache-2.0 | optional dependency |
| @img/sharp-win32-arm64 | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later | optional dependency |
| @img/sharp-win32-ia32 | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later | optional dependency |
| @img/sharp-win32-x64 | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later | optional dependency |
| @isaacs/fs-minipass | 4.0.1 | ISC |  |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | optional dependency |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | optional dependency |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | optional dependency |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | optional dependency |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | optional dependency |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | optional dependency |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | optional dependency |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | optional dependency |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause | optional dependency |
| @puppeteer/browsers | 3.2.0 | Apache-2.0 |  |
| @swc/helpers | 0.5.23 | Apache-2.0 |  |
| @types/node | 26.2.0 | MIT | optional dependency |
| @types/retry | 0.12.0 | MIT | optional dependency |
| adm-zip | 0.6.0 | MIT |  |
| agent-base | 7.1.4 | MIT | optional dependency |
| ansi-regex | 6.3.0 | MIT |  |
| ansi-styles | 6.2.3 | MIT |  |
| base64-js | 1.5.1 | MIT |  |
| bignumber.js | 9.3.1 | MIT | optional dependency |
| boolean | 3.2.0 | MIT |  |
| brotli | 1.3.3 | MIT |  |
| buffer-equal-constant-time | 1.0.1 | BSD-3-Clause | optional dependency |
| bundle-name | 4.1.0 | MIT |  |
| chownr | 3.0.0 | BlueOak-1.0.0 |  |
| chromium-bidi | 17.0.2 | Apache-2.0 |  |
| citty | 0.2.2 | MIT |  |
| cliui | 9.0.1 | ISC |  |
| clone | 2.1.2 | MIT |  |
| compare-versions | 6.1.1 | MIT |  |
| data-uri-to-buffer | 4.0.1 | MIT | optional dependency |
| debug | 4.4.3 | MIT |  |
| default-browser | 5.5.0 | MIT |  |
| default-browser-id | 5.0.1 | MIT |  |
| define-data-property | 1.1.4 | MIT |  |
| define-lazy-prop | 3.0.0 | MIT |  |
| define-properties | 1.2.1 | MIT |  |
| detect-libc | 2.1.2 | Apache-2.0 |  |
| detect-node | 2.1.0 | MIT |  |
| devtools-protocol | 0.0.1666840 | BSD-3-Clause |  |
| dfa | 1.2.0 | MIT |  |
| ecdsa-sig-formatter | 1.0.11 | Apache-2.0 | optional dependency |
| emoji-regex | 10.6.0 | MIT |  |
| es-define-property | 1.0.1 | MIT |  |
| es-errors | 1.3.0 | MIT |  |
| es6-error | 4.1.1 | MIT |  |
| esbuild | 0.25.12 | MIT |  |
| escalade | 3.2.0 | MIT |  |
| escape-string-regexp | 4.0.0 | MIT |  |
| extend | 3.0.2 | MIT | optional dependency |
| fast-deep-equal | 3.1.3 | MIT |  |
| fetch-blob | 3.2.0 | MIT | optional dependency |
| fontkit | 2.0.4 | MIT |  |
| formdata-polyfill | 4.0.10 | MIT | optional dependency |
| gaxios | 7.3.1 | Apache-2.0 | optional dependency |
| gcp-metadata | 8.1.2 | Apache-2.0 | optional dependency |
| get-caller-file | 2.0.5 | ISC |  |
| get-east-asian-width | 1.6.0 | MIT |  |
| giget | 3.3.1 | MIT |  |
| global-agent | 3.0.0 | BSD-3-Clause |  |
| globalthis | 1.0.4 | MIT |  |
| google-auth-library | 10.9.1 | Apache-2.0 | optional dependency |
| google-logging-utils | 1.1.3 | Apache-2.0 | optional dependency |
| gopd | 1.2.0 | MIT |  |
| gsap | 3.14.2 | Standard 'no charge' license: https://gsap.com/standard-license. |  |
| has-property-descriptors | 1.0.2 | MIT |  |
| hono | 4.13.2 | MIT |  |
| https-proxy-agent | 7.0.6 | MIT | optional dependency |
| hyperframes | 0.7.109 | Apache-2.0 |  |
| ignore | 5.3.2 | MIT |  |
| is-docker | 3.0.0 | MIT |  |
| is-inside-container | 1.0.0 | MIT |  |
| is-wsl | 3.1.1 | MIT |  |
| json-bigint | 1.0.0 | MIT | optional dependency |
| json-stringify-safe | 5.0.1 | ISC |  |
| jwa | 2.0.1 | MIT | optional dependency |
| jws | 4.0.1 | MIT | optional dependency |
| long | 5.3.2 | Apache-2.0 | optional dependency |
| matcher | 3.0.0 | MIT |  |
| minipass | 7.1.3 | BlueOak-1.0.0 |  |
| minizlib | 3.1.0 | MIT |  |
| mitt | 3.0.1 | MIT |  |
| modern-tar | 0.8.4 | MIT |  |
| ms | 2.1.3 | MIT |  |
| nanoid | 3.3.18 | MIT |  |
| node-domexception | 1.0.0 | MIT | optional dependency |
| node-fetch | 3.3.2 | MIT | optional dependency |
| object-keys | 1.1.1 | MIT |  |
| onnxruntime-common | 1.21.1 | MIT |  |
| onnxruntime-node | 1.21.1 | MIT |  |
| open | 10.2.0 | MIT |  |
| p-retry | 4.6.2 | MIT | optional dependency |
| pako | 0.2.9 | MIT |  |
| picocolors | 1.1.1 | ISC |  |
| playwright | 1.63.0 | Apache-2.0 |  |
| playwright-core | 1.63.0 | Apache-2.0 |  |
| postcss | 8.5.26 | MIT |  |
| prettier | 3.9.6 | MIT |  |
| protobufjs | 7.6.5 | BSD-3-Clause | optional dependency |
| puppeteer-core | 25.7.0 | Apache-2.0 |  |
| restructure | 3.0.2 | MIT |  |
| retry | 0.13.1 | MIT | optional dependency |
| roarr | 2.15.4 | BSD-3-Clause |  |
| run-applescript | 7.1.0 | MIT |  |
| safe-buffer | 5.2.1 | MIT | optional dependency |
| semver | 7.8.5 | ISC |  |
| semver-compare | 1.0.0 | MIT |  |
| serialize-error | 7.0.1 | MIT |  |
| sharp | 0.35.3 | Apache-2.0 |  |
| source-map-js | 1.2.1 | BSD-3-Clause |  |
| sprintf-js | 1.1.3 | BSD-3-Clause |  |
| string-width | 7.2.0 | MIT |  |
| string-width | 7.2.0 | MIT |  |
| string-width | 8.2.2 | MIT |  |
| strip-ansi | 7.2.0 | MIT |  |
| tar | 7.5.22 | BlueOak-1.0.0 |  |
| tiny-inflate | 1.0.3 | MIT |  |
| tslib | 2.8.1 | 0BSD |  |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) |  |
| typed-query-selector | 2.12.2 | MIT |  |
| undici-types | 8.3.0 | MIT | optional dependency |
| unicode-properties | 1.4.1 | MIT |  |
| unicode-trie | 2.0.0 | MIT |  |
| web-streams-polyfill | 3.3.3 | MIT | optional dependency |
| webdriver-bidi-protocol | 0.4.2 | Apache-2.0 |  |
| wrap-ansi | 9.0.2 | MIT |  |
| ws | 8.21.3 | MIT |  |
| wsl-utils | 0.1.0 | MIT |  |
| y18n | 5.0.8 | ISC |  |
| yallist | 5.0.0 | BlueOak-1.0.0 |  |
| yargs | 18.1.0 | MIT |  |
| yargs-parser | 22.0.0 | ISC |  |
| zod | 3.25.76 | MIT |  |

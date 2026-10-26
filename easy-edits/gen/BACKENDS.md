# Generation backends (bring your own key)

Easy Edits generates images, video clips, voice and avatar clips through pluggable adapters
(`easy-edits/gen/index.mjs`, contract in [CONTRACT.md](CONTRACT.md)). For `easy-edits new`, images and video
default to `host` (your AI assistant's built-in image/video generation, below) and voice and avatar to `local`.
Hosted APIs are opt-in, configured by you, with your own key. No vendor is hard-wired and no model ID ships in the code.

```sh
easy-edits backends                       # adapters, capabilities per kind, providers.json entries, key present yes/no
easy-edits backends try video --backend local -o out/gen --prompt "How solar panels work" --duration 4
easy-edits backends try avatar --backend local -o out/gen --text "Hi, I'm a synthetic host."
easy-edits backends init                  # writes ~/.easy-edits/providers.json (mode 600, no keys) if missing
```

## Adapters

| Adapter | Kinds | Network | What it does |
| --- | --- | --- | --- |
| `host` (default for image, video in `easy-edits new`) | image, video | no | The assistant driving Easy Edits generates the asset with its own built-in tools. Each request goes into `<out>/GENERATION_MANIFEST.json` and comes back pending; the run stops with exit 3 until the files exist, then `easy-edits resume <out>` finishes it (below). |
| `none` | all | no | Refuses every generation; the planner falls back to stills and code-drawn graphics. The default of `getBackend()` without a name and of the standalone runners. |
| `mock` | all | no | Deterministic placeholders (ffmpeg test patterns, sine tones) for tests and CI. |
| `local` | image, video, tts, avatar | no | image: an ffmpeg title card from the prompt (an image ref becomes its background). video: a Ken Burns zoom over the image ref or a generated title card (H.264, BT.709, up to 20 s). tts: Kokoro-82M (HyperFrames, as explainer mode), else Piper (`piper` on PATH + `EASY_EDITS_PIPER_MODEL=<voice>.onnx`), else eSpeak NG / eSpeak, else ffmpeg's `flite` filter, else a clear error; `EASY_EDITS_LOCAL_TTS=kokoro\|piper\|espeak-ng\|espeak\|flite` forces one. avatar: host image + audio with a subtle zoom, labelled **SYNTHETIC** on screen and `synthetic: true` in meta, audio mastered to -14 LUFS / -1.5 dBTP. Not lip-synced. |
| `http-generic` | any | yes | Any REST API, from a providers.json entry (below). |
| `xai` | image, video | yes | Optional hosted image + video adapter for running outside an assistant. Opt-in only (`--backend xai` or `--image-backend` / `--video-backend xai`), never a default. Key from env `XAI_API_KEY`; model ids in the `xai` section of providers.json. |

Choosing per kind in `easy-edits new`: `--backend NAME` (every kind), `--video-backend`, `--image-backend`,
`--tts-backend`, `--avatar-backend`, `--llm-backend`, `--search-backend` (one kind). The plan records the names
and PLAN.txt shows them with any `will send:` lines before you approve.

## Host generation: your assistant's built-in image/video generation

When Easy Edits runs inside an AI assistant that can make images and video, that assistant is the generator:
nothing is sent to a third party by Easy Edits and no key is needed.

1. `easy-edits new <type> -o OUT ...` plans: show the user `OUT/PLAN.txt` and `OUT/storyboard.png`.
2. When the user approves: `easy-edits new --approve OUT/plan.json`. It makes every image/video request of the plan,
   writes them to `OUT/GENERATION_MANIFEST.json` and exits **3** before rendering anything. Each asset has `id`, `type` (`image` | `video`), `prompt`,
   `durationSec` (video), `aspect`, `width` / `height`, `referenceImages` and `firstFrame` (paths relative to `OUT`)
   and `file` (where to save it, e.g. `assets/s1-1a2b3c4d.mp4`).
3. Generate each asset with your built-in image/video generation from its prompt and settings, and save it at
   `OUT/<file>` (images PNG / JPEG, video MP4; any faint ambient audio in a clip is handled by `--clip-audio`).
4. `easy-edits resume OUT`: exit 3 with the list while any asset is missing or unreadable; otherwise it finishes the
   edit, captions, QA, `report.json`, `REVIEW.txt` and `DELIVERY.json`. To redo one shot, replace its file and resume.
5. Deliver with the weak-shot notes from `REVIEW.txt`; never publish anything.

Pick one with `getBackend(kind, { name })`; `"http-generic:<provider>"` picks a providers.json entry by name, plain
`"http-generic"` takes `defaults[kind]` or the first provider that lists the kind. `EASY_EDITS_BACKEND=mock` forces
mock for every kind (tests). `offline: true` (`--offline`) refuses every adapter with `capabilities.network`.

Every adapter reports `capabilities`: `maxClipSeconds`, `aspects`, `references`, `voiceClone`, `costPerCall`,
`secondsPerCall` (an estimate for the planner's cost and time lines) and `network`. Every result has `cost` and
`cached`.

## providers.json

`~/.easy-edits/providers.json` (or `EASY_EDITS_CONFIG`). Keep it mode 600 (`chmod 600`); the loader, `easy-edits
backends` and the doctor warn when it is readable by others. Never put it in the repo.

```json
{
  "defaults": { "image": "my-images" },
  "providers": {
    "my-images": {
      "adapter": "http-generic",
      "kinds": ["image"],
      "endpoint": "https://api.example.com/v1/images",
      "method": "POST",
      "authHeader": "Authorization",
      "authPrefix": "Bearer ",
      "keyEnv": "MY_IMAGES_KEY",
      "model": "<the provider's model id>",
      "body": { "model": "{{model}}", "prompt": "{{prompt}}", "size": "{{width}}x{{height}}", "seed": "{{seed}}" },
      "response": { "type": "base64", "path": "data.0.b64_json" },
      "ext": ".png",
      "costPerCall": 0.04,
      "secondsPerCall": 15
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `kinds` | which of video / image / tts / avatar / llm / search this provider serves |
| `endpoint`, `method` | the URL (templates allowed) and HTTP method (default POST) |
| `authHeader`, `authPrefix` | header that carries the key (default `Authorization` with `Bearer `) |
| `keyEnv` | the env var holding the key (preferred). `key` in the file also works; `keyOptional: true` for keyless local servers |
| `headers` | extra static headers |
| `body` | the JSON body template. `"{{x}}"` as a whole string keeps the value's type; inside text it is substituted. Names: `prompt text voice speaker rate width height aspect durationSec seed model system query limit json ref0_base64 audio_base64 hostImage_base64` |
| `response.type` | `base64` (a string at `path`), `url` (a media URL at `path`, fetched **without** the key), `binary` (the body is the file), `text` / `json` (llm, search) |
| `response.path` | dotted path into the JSON (`data.0.url`, `output[0].url`); search also takes `response.map` `{title,url,snippet}` |
| `ext`, `costPerCall`, `secondsPerCall`, `maxClipSeconds`, `aspects`, `references`, `voiceClone` | capabilities for the planner |
| `timeoutMs`, `retries` | default 120000 ms, 1 retry on 429 / 5xx / network errors |
| `network: false` | only honoured for a loopback endpoint (127.0.0.1 / localhost): a model server you run yourself then counts as local for `--offline` |

Synchronous APIs only for now: a provider that returns a job id to poll needs a small proxy in front of it.

## Keys

- Keys come only from env vars (`keyEnv`) or `providers.json`. They go only into the auth header of the
  configured endpoint.
- They are never logged or written to results, meta, errors, reports or plans: errors pass through `redact()`
  (`config.mjs`), which also strips key-shaped tokens, `Bearer ...` values and `?key=` style query params.
- `easy-edits backends` and `./install.sh --doctor` show only `key present: yes/no`.

## Cache

`~/.easy-edits/cache` (or `EASY_EDITS_CACHE`; `off` disables it). The key is sha256 of (adapter, model, kind,
request) with reference files replaced by their content hashes. A re-run of the same request copies the cached
file and returns `cached: true, cost: 0`, so an approved plan is never billed twice. `{ noCache: true }` skips it
for one call.

## Lint

`npm run lint` (`easy-edits/tools/lint-repo.mjs`, also in CI: `.github/workflows/lint.yml`) fails on key-like
strings, absolute home / machine paths, and the competitor bot's name outside the one README "Use with ... Bot"
line. A line with `lint-repo: allow` is exempt from the key and path checks.

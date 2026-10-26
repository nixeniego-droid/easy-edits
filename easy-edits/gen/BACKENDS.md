# Generation backends (bring your own key)

Easy Edits generates images, video clips, voice and avatar clips through pluggable adapters
(`easy-edits/gen/index.mjs`, contract in [CONTRACT.md](CONTRACT.md)). Local adapters are the default; hosted APIs are
opt-in, configured by you, with your own key. No vendor is hard-wired and no model ID ships in the code.

```sh
easy-edits backends                       # adapters, capabilities per kind, providers.json entries, key present yes/no
easy-edits backends try video --backend local -o out/gen --prompt "How solar panels work" --duration 4
easy-edits backends try avatar --backend local -o out/gen --text "Hi, I'm a synthetic host."
easy-edits backends init                  # writes ~/.easy-edits/providers.json (mode 600, no keys) if missing
```

## Adapters

| Adapter | Kinds | Network | What it does |
| --- | --- | --- | --- |
| `none` (default) | all | no | Refuses every generation; the planner falls back to stills and code-drawn graphics. |
| `mock` | all | no | Deterministic placeholders (ffmpeg test patterns, sine tones) for tests and CI. |
| `local` | image, video, tts, avatar | no | image: an ffmpeg title card from the prompt (an image ref becomes its background). video: a Ken Burns zoom over the image ref or a generated title card (H.264, BT.709, up to 20 s). tts: Kokoro-82M (HyperFrames, as explainer mode), else Piper (`piper` on PATH + `EASY_EDITS_PIPER_MODEL=<voice>.onnx`), else eSpeak NG / eSpeak, else ffmpeg's `flite` filter, else a clear error; `EASY_EDITS_LOCAL_TTS=kokoro\|piper\|espeak-ng\|espeak\|flite` forces one. avatar: host image + audio with a subtle zoom, labelled **SYNTHETIC** on screen and `synthetic: true` in meta, audio mastered to -14 LUFS / -1.5 dBTP. Not lip-synced. |
| `http-generic` | any | yes | Any REST API, from a providers.json entry (below). |

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

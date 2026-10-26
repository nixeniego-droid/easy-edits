# Generation backend contract (v1.4)

All generation goes through `easy-edits/gen/index.mjs`:

```js
import { getBackend, listBackends } from '../gen/index.mjs';
const b = getBackend('image', { name: 'mock' });   // kind: video | image | tts | avatar | llm | search
b.capabilities   // { maxClipSeconds, aspects:[], references:bool, voiceClone:bool, costPerCall:number, network:bool }
await b.generate(request, { outDir, offline })   // -> { file, durationSec?, cost, cached:bool, meta }
```

Request shapes:
- video:  { prompt, durationSec, aspect, width, height, refs:[files], seed }
- image:  { prompt, aspect, width, height, refs:[files], seed }
- tts:    { text, voice, speaker, rate }  -> wav file
- avatar: { audio, hostImage, aspect, likeness:'fictional'|'self', consent }  -> mp4
- llm:    { system, prompt, json:bool } -> { text }
- search: { query, limit } -> { results:[{title,url,snippet}] }

Built-in adapters: `none` (refuses cleanly), `mock` (deterministic, offline, ffmpeg testsrc/sine, cost 0),
`local` (ffmpeg stills + Ken Burns, Kokoro/Piper TTS, still+audio avatar), `http-generic` (REST config), `xai` (hosted image + video, BYO key XAI_API_KEY; model ids in providers.json).
Config: env vars and `~/.easy-edits/providers.json` (mode 600) only. Keys never logged or written to outputs.
Cache: `~/.easy-edits/cache` (override EASY_EDITS_CACHE) keyed by sha256 of (adapter, model, request).
`offline:true` makes any adapter with capabilities.network refuse.
Env override for tests: EASY_EDITS_BACKEND=mock forces mock for every kind.

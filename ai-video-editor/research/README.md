# Research and the cited explainer

A narrated explainer made from sources, not footage (SPEC recipe 1: R1-R4, S1). It runs with zero video
generations: TTS narration over a still or a code-drawn card per claim, drawn by ffmpeg (libass), so it needs no
browser. It will be wired in as `ai-video-editor new explainer-cited` (recipe file
`../new/recipes/explainer-cited.mjs`: `{name, plan(opts), render(plan, ctx)}`); until then use the runner:

```sh
node ai-video-editor/research/run.mjs --source report.pdf --source https://example.org/article --source notes.md \
  --topic "how honeybees find flowers" -o out/ --format all --length 45
node ai-video-editor/research/run.mjs ... -o out/ --plan-only        # stop after planning: PLAN.txt, script.json
node ai-video-editor/research/run.mjs --plan out/plan.json            # render the reviewed plan
node ai-video-editor/research/run.mjs --script out/script.json -o out/   # render an edited script (re-checked)
```

`node ai-video-editor/research/run.mjs --help` lists every option.

## Stages

| Module | What |
| --- | --- |
| `sources.mjs` | Sources store. `--source URL\|FILE` (repeatable) and `--topic` through `getBackend('search')`. Text goes to `out/sources/S<n>.txt`, metadata (id, title, URL, retrieved date, kind, sha256) to `S<n>.json` and `sources.json`. Local files are recorded as `file:<name>` (no machine paths). `--offline` refuses URL sources and skips search. |
| `extract.mjs` | HTML (article / main / body; scripts, nav, header, footer dropped; entities decoded), Markdown, text, PDF (`pdftotext` / `pdfinfo` from poppler-utils). Sentence splitter and the whitespace normaliser shared by the writer and the check. |
| `script.mjs` | Scriptwriter. With an LLM backend (`getBackend('llm')`) it asks for JSON claims with exact quotes and rejects any claim whose quote isn't verbatim in the named source (`script.rejected`). Without one, or if the LLM gives nothing usable, a deterministic extractive writer picks sentences (topic overlap, readable length, numbers, early position), round-robin over the sources. Length: `--length` seconds x `--wps` words/s (default 2.5). |
| `citations.mjs` | The `citation` check: every claim names a source in the store and quotes >= 4 words found verbatim in it (whitespace runs are the only difference allowed). Standalone: `node ai-video-editor/research/citations.mjs script.json out/sources` (exit 1 on FAIL). |
| `render.mjs` | Narration per claim (`getBackend('tts')`, else local Kokoro through HyperFrames), a still per claim (`getBackend('image')`, slow push-in) or a code card, the chip `[n] Source title` for each claim's time, captions from the known script text (no ASR), the `Sources` end card, `SOURCES.txt`, `.srt` / `.vtt`, contact sheet; master to -14 LUFS / -1.5 dBTP (`audio/master.mjs`), BT.709 tags. |
| `pipeline.mjs` | `planExplainer()` (sources -> script -> shots, `plan.json`, `PLAN.txt` with the generation count) and `renderPlan()` (exports + `report.json`). |

`[n]` numbers follow the order in which the video first cites a source, the same numbers as `SOURCES.txt` and the
end card. With `--style PACK` the chip, cards and captions use the pack's palette and fonts.

## Delivery checks (report.json, per export)

| Check | Fails when |
| --- | --- |
| `citation` | a claim has no source, an unknown source, a quote under 4 words, or a quote not found verbatim |
| `loudness` | integrated loudness is outside -14 +-1 LUFS or true peak is above -1.5 dBTP |
| `color` | the video isn't tagged bt709 primaries / transfer / matrix |
| `captions` | a caption group is on screen < 0.3 s, or groups overlap |
| `citation-chip` | a chip shows < 1 s, or chip text < 4.5:1, chip number < 3:1, captions < 4.5:1 (WCAG, worst case over white or black) |
| `sources` | a cited source is missing from `SOURCES.txt` / the end card |
| `av` | audio and video durations differ by > 0.15 s |
| `length` | never fails; a NOTE outside the 30-120 s explainer range |

The export is written even when a check FAILs; the runner then exits 1. Report every FAIL.

## Backends

`--backend NAME` (every kind) or `--tts-backend`, `--image-backend`, `--llm-backend`, `--search-backend`;
`AI_VIDEO_EDITOR_BACKEND` overrides all (tests use `mock`). With `none` (the default): no search (provided documents
only), the extractive writer, code cards, and local Kokoro for the voice when `./install.sh` has installed it.
`PLAN.txt` / `plan.json` list the generation count (`0 video, M image, K TTS`) before anything renders.

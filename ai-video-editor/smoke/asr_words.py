"""Local word-level ASR with faster-whisper -> Herk transcript JSON ({words:[{text,start,end,type}]}).
usage: python asr_words.py <media> <out.json> [model] [--exact] [--vad] [--lang auto|en|tl|...]
--lang (default auto): auto detects the language once with faster-whisper (on the unpadded audio, VAD-filtered
with --vad), then transcribes with it. Forcing "en" on Taglish dropped the Tagalog and translated the rest
(word error rate 84% vs 9-19% with tl). A non-English result with no explicit model uses "medium" instead
of "small" (Taglish WER 9% vs 18%). The resolved language and model go into language_code and model.
A 1 s silence pad is prepended so the first word's onset is not swallowed; times are shifted back.
Each word carries cr: the compression ratio of its decoding window (Whisper treats > 2.4 as a failed,
looping decode; e.g. "Have a great week." x5 decoded from a silent tail scores 16.6), seg: its segment index,
and nsp / lp: that segment's no_speech_prob and avg_logprob (ai-video-editor/check/delivery.mjs drops whole segments).
--exact: float32 + temperature 0 (reproducible; int8 and the temperature-fallback schedule can give a
different transcript on every run, e.g. a different invented outro in trailing silence).
--vad: vad_filter=True (Silero VAD drops non-speech before decoding, so silent stretches cannot be
decoded into invented or looped text; word times stay in the input's timeline).
--disfluent: an initial prompt full of fillers and stutters ("Umm, uh, I I, a a a, the the, ...") so Whisper
writes the repeats and false starts it otherwise cleans up (gen_talk_v5 0:02: plain medium "really a very large
importance", disfluent "really a a a gigantic, a very large, a very large, uh, importance"). Used by
ai-video-editor/check/disfluency.mjs; never for caption text."""
import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel

exact = "--exact" in sys.argv
vad = "--vad" in sys.argv
disfl = "--disfluent" in sys.argv
PROMPT = "Umm, uh, so, I I, I mean, a a a, the the, like, you know, hmm. We we were, uh, there."
argv = sys.argv[1:]
lang = "auto"
if "--lang" in argv:
    i = argv.index("--lang")
    lang = argv[i + 1]
    del argv[i:i + 2]
args = [a for a in argv if a not in ("--exact", "--vad", "--disfluent")]
media, out = args[0], args[1]
model = args[2] if len(args) > 2 else "small"
# decode with ffmpeg (faster-whisper's av.open rejects some files' metadata_errors) to 16 kHz mono s16le,
# then hand faster-whisper a float32 array
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", media, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                     capture_output=True, check=True).stdout
audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
pad = np.zeros(16000, np.float32)
ctype = "float32" if exact else "int8"
# One Whisper decode at a time on one machine (AI_VIDEO_EDITOR_ASR_LOCK, "0" = off): concurrent CTranslate2 int8 decodes return
# junk ("a? PETER்," / Thai glyphs for clear English; 4 parallel decodes of talk_30s 0-11 s, 2026-10-18), so every
# ASR process takes this lock before loading the model and decodes with AI_VIDEO_EDITOR_ASR_THREADS (6) threads.
import fcntl as _fcntl, os as _os
if _os.environ.get("AI_VIDEO_EDITOR_ASR_LOCK", "/tmp/ai-video-editor-asr.lock") != "0":
    # flock needs only a readable fd: another user's lock file (644) is shared read-only; /tmp's protected_regular
    # forbids opening it for writing ("w" failed for a second Linux user, 2026-10-19). Unreadable: a per-user lock.
    _LP = _os.environ.get("AI_VIDEO_EDITOR_ASR_LOCK", "/tmp/ai-video-editor-asr.lock")
    try:
        try: _LOCK = _os.open(_LP, _os.O_RDONLY)
        except FileNotFoundError: _LOCK = _os.open(_LP, _os.O_WRONLY | _os.O_CREAT, 0o644)
    except PermissionError:
        _LOCK = _os.open(f"{_LP}.{_os.getuid()}", _os.O_WRONLY | _os.O_CREAT, 0o644)
    _fcntl.flock(_LOCK, _fcntl.LOCK_EX)
_THREADS = int(_os.environ.get("AI_VIDEO_EDITOR_ASR_THREADS", "6"))
m = WhisperModel(model, device="cpu", compute_type=ctype, cpu_threads=_THREADS)
if lang == "auto":
    lang, p, _ = m.detect_language(audio, vad_filter=vad)
    print(f"detected language {lang} (p={p:.2f})")
if lang != "en" and len(args) <= 2:
    model = "medium"
    del m  # free small first: small + medium float32 (--exact) together were OOM-killed with ~6 GB free
    m = WhisperModel(model, device="cpu", compute_type=ctype, cpu_threads=_THREADS)
segs, _ = m.transcribe(np.concatenate([pad, audio]), word_timestamps=True, language=lang,
                       condition_on_previous_text=False, beam_size=5, vad_filter=vad, **({"initial_prompt": PROMPT} if disfl else {}), **({"temperature": 0.0} if exact else {}))



def join_hyphen(words):
    out = []
    for w in words:
        tx = str(w.get("text") or "")
        if out and tx.startswith("-") and len(tx) > 1:
            prev = out[-1]
            prev["text"] = prev["text"].rstrip("-") + tx
            prev["end"] = w.get("end", prev.get("end"))
            continue
        if out and tx == "-":
            out[-1]["text"] = out[-1]["text"].rstrip("-") + "-"
            out[-1]["_hj"] = True
            continue
        if out and out[-1].get("_hj") and tx and not tx.startswith("-"):
            prev = out[-1]
            prev.pop("_hj", None)
            prev["text"] = prev["text"] + tx
            prev["end"] = w.get("end", prev.get("end"))
            continue
        if out and out[-1].get("_hj"):
            out[-1].pop("_hj", None)
        out.append(dict(w))
    if out and out[-1].get("_hj"):
        out[-1].pop("_hj", None)
    return out

words = []
import time as _time
_asr_t0 = _time.time(); _asr_last = 0.0
_dur = max(0.1, len(audio) / 16000.0)
for k, s in enumerate(segs):
    now = _time.time()
    if now - _asr_last >= 10.0 or k == 0:
        _asr_last = now
        end_t = getattr(s, "end", None) or 0.0
        pct = min(99, int(100 * end_t / _dur)) if _dur else 0
        print(f"ai-video-editor: Listening… segment {k+1} ~{end_t:.0f}s/{_dur:.0f}s {pct}% ({int(now-_asr_t0)} s elapsed)", flush=True)
        print(f"out_time_ms={int(end_t * 1e6)}", flush=True)
    for w in s.words:
        t = w.word.strip()
        if t:
            a, b = round(max(0.0, w.start - 1), 3), round(max(0.0, w.end - 1), 3)
            words.append({"text": t, "start": a, "end": b, "type": "word",
                          "probability": round(w.probability, 3), "cr": round(s.compression_ratio, 2), "seg": k,
                          "nsp": round(s.no_speech_prob, 3), "lp": round(s.avg_logprob, 3)})
words = join_hyphen(words)
json.dump({"language_code": lang, "model": model, "audio_duration_secs": round(len(audio) / 16000, 3),
           "produced_by": f"faster-whisper {model}{' exact' if exact else ''}{' vad' if vad else ''}{' disfluent' if disfl else ''}", "text": " ".join(w["text"] for w in words),
           "words": words}, open(out, "w"), indent=1)
print(f"{len(words)} words -> {out}")

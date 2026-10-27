"""Independent content transcript of a media file for check/content-kept.mjs (one model load).
usage: python asr_content.py <media> <model> [--lang auto|en|...]  -> JSON {language, speech, words, redecoded}
- speech: Silero VAD speech segments (faster_whisper.vad; threshold 0.5, min silence 0.3 s, pad 0.1 s). Silero is a
  speech/non-speech model, not a band-energy rule, so music beds and room tone do not count as speech.
- words: plain (no disfluency prompt) faster-whisper decode in 10 s chunks with 1 s context either side, stitched
  by word start. Plain decoding writes the content words and drops most fillers, which is what this check compares.
- any VAD speech segment >= 0.5 s that no word touches (+-0.3 s) is decoded again on its own (1 s context, then
  temperature fallback); a chunk can return next to nothing for clear speech (talk_30s run #6: one word for 0-11 s).
- --lang auto: detect once for the whole file (VAD, 3 windows), never per chunk.
- a chunk that comes back as junk (letters outside the language's script, e.g. Thai/Vietnamese glyphs in English,
  or one token >= 5 times in a row) is decoded again with temperature fallback, up to twice; the least junky wins.
  Concurrent CTranslate2 int8 decodes on one machine are not deterministic: 4 parallel decodes of talk_30s 0-11 s
  gave "a? PETER்," / ". Relations" / two good transcripts (2026-10-18), so the check must not trust one pass."""
import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.vad import get_speech_timestamps, VadOptions

argv = sys.argv[1:]
lang = "en"
if "--lang" in argv:
    i = argv.index("--lang"); lang = argv[i + 1]; del argv[i:i + 2]
media, model = argv[0], argv[1]
SR = 16000
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", media, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
dur = len(audio) / SR
speech = [[round(s["start"] / SR, 2), round(s["end"] / SR, 2)] for s in
          get_speech_timestamps(audio, VadOptions(threshold=0.5, min_silence_duration_ms=300, speech_pad_ms=100))]
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
m = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=_THREADS)
if lang == "auto":
    lang = m.detect_language(audio, vad_filter=True, language_detection_segments=3)[0] if len(audio) else "en"


def decode(a, b, temp=0.0):
    a = max(0.0, a); seg = np.concatenate([np.zeros(SR // 2, np.float32), audio[int(a * SR):int(b * SR)]])
    segs, _ = m.transcribe(seg, language=lang, word_timestamps=True, beam_size=5, condition_on_previous_text=False, temperature=temp)
    return [{"text": w.word.strip(), "start": round(max(0.0, a + w.start - 0.5), 3), "end": round(max(0.0, a + w.end - 0.5), 3)}
            for s in segs for w in s.words if w.word.strip()]


LATIN = {"en", "tl", "es", "fr", "de", "it", "pt", "nl", "id", "ms", "sv", "da", "no", "fi", "pl", "cs", "ro", "hu", "tr", "vi"}


def junk(ws):
    bad, run = 0, 1
    for i, w in enumerate(ws):
        if lang in LATIN and lang != "vi" and any(c.isalpha() and not ("a" <= c.lower() <= "z" or "\u00c0" <= c <= "\u024f") for c in w["text"]):
            bad += 1
        if i and w["text"].lower().strip(",.!?") == ws[i - 1]["text"].lower().strip(",.!?"):
            run += 1
            bad += run >= 5
        else:
            run = 1
    return bad


def decode_ok(a, b):
    best = decode(a, b)
    for _ in range(2):
        if not junk(best):
            break
        alt = decode(a, b, (0.0, 0.2, 0.4, 0.6))
        if junk(alt) < junk(best):
            best = alt
    return best


words, CH, PAD = [], 10.0, 1.0
starts = list(np.arange(0, max(dur - 0.05, 0.0), CH))
for k, a in enumerate(starts):
    lo, hi = a, min(dur, a + CH)
    words += [w for w in decode_ok(a - PAD, hi + PAD) if (k == 0 or w["start"] >= lo) and (k == len(starts) - 1 or w["start"] < hi)]
touched = lambda a, b: any(w["start"] - 0.3 < b and w["end"] + 0.3 > a for w in words)
redecoded = []
for a, b in speech:
    if b - a >= 0.5 and not touched(a, b):
        new = [w for w in decode(a - 1, b + 1, (0.0, 0.2, 0.4)) if a - 1 <= w["start"] < b + 1
               and not any(w["start"] < x["end"] - 0.02 and w["end"] > x["start"] + 0.02 for x in words)]
        words += new; redecoded.append({"span": [a, b], "added": len(new)})
words.sort(key=lambda w: w["start"])
print(json.dumps({"language": lang, "duration": round(dur, 3), "speech": speech, "words": words, "redecoded": redecoded, "junk": junk(words)}))

"""Re-transcribe short excerpts of a media file with faster-whisper (one model load) -> JSON list of word lists.
usage: python asr_excerpts.py <media> <model> '<[[a,b],...]>' [--exact] [--vad] [--disfluent] [--lang auto|en|tl|...]
--lang (default en, the old fixed value): auto = detect once for the whole file (VAD, up to 3 x 30 s windows) and
decode every excerpt in that language; per-excerpt detection on a 10 s chunk that opens on music/noise picked
Vietnamese for talk_30s and the decode looped ("I'm I'm I'm ...").
Loop guard: an excerpt whose words look degenerate (one token >= 5 times in a row, or >= 5 words sharing a start)
(or holds letters outside a Latin-script language's alphabet) is decoded again without the disfluency prompt and
with temperature fallback; the less degenerate result wins.
Each excerpt is decoded on its own (Whisper on a 30 s file can drop or merge words that it hears in a 3 s clip:
gen_talk_v5 long-form medium lost "in us to go"; the 25-28 s excerpt hears "trust in us to go"). Word times are
in the file's timeline."""
import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
argv = sys.argv[1:]
exact = "--exact" in argv
vad = "--vad" in argv
argv = [a for a in argv if a not in ("--exact", "--vad")]
lang = "en"
if "--lang" in argv:
    i = argv.index("--lang")
    lang = argv[i + 1]
    del argv[i:i + 2]
lang = None if lang == "auto" else lang
media, model, spans = argv[0], argv[1], json.loads(argv[2])
PROMPT = "Umm, uh, so, I I, I mean, a a a, the the, like, you know, hmm. We we were, uh, there."
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", media, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True, check=True).stdout
audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
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
m = WhisperModel(model, device="cpu", compute_type=("float32" if exact else "int8"), cpu_threads=_THREADS)
if lang is None and len(audio) > 0:
    lang = m.detect_language(audio, vad_filter=True, language_detection_segments=3)[0]
    print(f"asr_excerpts: detected language {lang}", file=sys.stderr)


LATIN = {"en", "tl", "es", "fr", "de", "it", "pt", "nl", "id", "ms", "sv", "da", "no", "fi", "pl", "cs", "ro", "hu", "tr"}


def badness(ws):
    """Count of degenerate words: runs of one token >= 5 long, groups of >= 5 words with the same start, and words
    with letters outside a Latin-script language's alphabet (concurrent int8 decodes on one machine returned
    "a? PETER்," and Thai/Vietnamese glyphs for clear English, 2026-10-18)."""
    bad = sum(1 for w in ws if lang in LATIN and any(c.isalpha() and not ("a" <= c.lower() <= "z" or "\u00c0" <= c <= "\u024f") for c in w["text"]))
    run, same = 1, 1
    for i in range(1, len(ws)):
        run = run + 1 if ws[i]["text"].lower().strip(",.!?") == ws[i - 1]["text"].lower().strip(",.!?") else 1
        same = same + 1 if abs(ws[i]["start"] - ws[i - 1]["start"]) < 0.005 else 1
        if run >= 5 or same >= 5:
            bad += 1
    return bad


def decode(seg, a, prompt, temp):
    # --exact: temperature 0 only (reproducible). Else allow the caller's temp / fallback schedule.
    kw = {"initial_prompt": PROMPT} if prompt else {}
    segs, _ = m.transcribe(seg, language=lang, word_timestamps=True, beam_size=5, condition_on_previous_text=False,
                           temperature=(0.0 if exact else temp),
                           vad_filter=vad,
                           **kw)
    return [{"text": w.word.strip(), "start": round(a + w.start - 0.5, 3), "end": round(a + w.end - 0.5, 3)} for s in segs for w in s.words if w.word.strip()]


out = []
for a, b in spans:
    a = max(0.0, a); seg = np.concatenate([np.zeros(8000, np.float32), audio[int(a * 16000):int(b * 16000)]])
    ws = decode(seg, a, "--disfluent" in sys.argv, 0.0)
    if badness(ws):
        alt = decode(seg, a, False, (0.0, 0.2, 0.4))
        print(f"asr_excerpts: loop guard {a:.2f}-{b:.2f} s: {badness(ws)} degenerate -> {badness(alt)} without prompt", file=sys.stderr)
        if badness(alt) < badness(ws):
            ws = alt
    out.append(ws)
print(json.dumps(out))

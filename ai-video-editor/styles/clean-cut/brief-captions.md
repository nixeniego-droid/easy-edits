# Clean cut: caption check (one short pass, text only)

The captions of a clean cut come from one ASR decode. A second, independent decode of the final audio did not hear
some caption words. For each flagged caption below you get its words with their source index `i`, and what the
second decode heard around it (several windows, separated by `|`):

{{FLAGS}}

Decide per flagged word what the speaker actually says, from the heard text. Fix the caption text only when the
second decode clearly and consistently heard something else ("help" heard as "helps" in every window -> "helps").
Keep the speaker's own repeats and self-corrections. A word that was not spoken at all (a stray syllable the first
decode turned into a word) may become `""` (the audio stays, the caption drops it). Never paraphrase, never add a
word nobody heard, never change cuts. When unsure, leave it.

Then write `{{PATCH}}` (one Write call) and stop:

```json
{"text": {"14": "helps"}, "notes": "one line per change"}
```

`{"text": {}}` when nothing should change.

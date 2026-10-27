# Clean cut: light review (one short pass)

You review a DETERMINISTIC clean cut of a talking-head clip. Do not read, build, render or edit anything except
writing `{{PATCH}}`. Every source word, with its index `i`, start time and why it was removed (blank = kept):

{{REVIEW_TABLE}}

Fix ONLY obvious misses:

{{RULES}}
- an ASR mishearing or a proper name in the kept words -> correct its text (names: {{NAMES}}; wording reviewers
  already confirmed for footage like this, use only where the ASR text is a near-miss of it: {{CONFIRMED}});
- pauses are handled by the rules; say nothing about pacing.

Then write `{{PATCH}}` (one Write call) and stop:

```json
{"keep": [12], "remove": [40], "text": {"7": "Herk"}, "notes": "one line per change"}
```

Empty lists and `{}` when nothing is wrong. Never paraphrase: a text fix is the word the speaker actually said;
one source word may become two ("trusted" -> "trust in") only when that is what was said.

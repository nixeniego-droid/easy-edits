// Assert the shipped skill contains every mandatory choice card (exact option strings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skill = fs.readFileSync(path.join(ROOT, '.claude/skills/ai-video-editor/SKILL.md'), 'utf8');
const gs = fs.readFileSync(path.join(ROOT, '.claude/skills/ai-video-editor-getting-started/SKILL.md'), 'utf8');

const CARDS = [
  ['intent', 'What should we make?', 'Clean up a video (recommended)', 'Make short clips', 'Add captions', 'Make a new video from scratch'],
  ['format', 'Which shape?', 'Vertical: TikTok, Reels, Shorts (recommended)', 'Square', 'Widescreen: YouTube', 'All three'],
  ['hook', 'Big hook line over the first seconds?', 'Yes (recommended)', 'No'],
  ['new-video', 'What kind of video?', 'Promo for my brand', 'Presenter reads my script', 'Explainer with sources', 'Story', 'Podcast'],
  ['preview', 'Look good?', 'Make the full version (recommended)', 'Change the shape', 'Try a different look'],
  ['after', "What's next?", "I'm good"],
  ['error', 'How should we fix this?'],
];

test('SKILL.md mandates choice widgets and lists every card', () => {
  assert.match(skill, /Choice cards at every decision \(mandatory\)/);
  assert.match(skill, /MUST send a question \/ choice widget/);
  assert.match(skill, /MUST send a choice widget built from `OUT\/proposals\.json`/);
  assert.match(skill, /MUST send the exact "Look good\?" card/);
  for (const [name, ...parts] of CARDS) {
    for (const part of parts) {
      assert.ok(skill.includes(part), `skill missing ${name} fragment: ${part}`);
    }
  }
});

test('getting-started has generation approval card and MUST widgets', () => {
  assert.match(gs, /MUST be a choice widget/);
  assert.match(gs, /included in your bot plan\?/);
  assert.match(gs, /Yes \(recommended\)/);
  assert.match(gs, /tag v1\.4\.3/);
});

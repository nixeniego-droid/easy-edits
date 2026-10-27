// One-release compat for the rename from Easy Edits: every EASY_EDITS_<X> env var also sets AI_VIDEO_EDITOR_<X>
// (the new name wins when both are set), and with no AI_VIDEO_EDITOR_HOME the old ~/.easy-edits home is used while
// ~/.ai-video-editor doesn't exist yet. Import it first (side effect only): modules read the env at import time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function applyEnvCompat(env = process.env) {
  const OLD = 'EASY_EDITS_', NEW = 'AI_VIDEO_EDITOR_';
  for (const k of Object.keys(env)) if (k.startsWith(OLD) && env[NEW + k.slice(OLD.length)] === undefined) env[NEW + k.slice(OLD.length)] = env[k];
  if (!env.AI_VIDEO_EDITOR_HOME) {
    const home = env.HOME || os.homedir(), fresh = path.join(home, '.ai-video-editor'), old = path.join(home, '.easy-edits');
    if (!fs.existsSync(fresh) && fs.existsSync(old)) env.AI_VIDEO_EDITOR_HOME = old;
  }
  return env;
}

applyEnvCompat();

// The python that has AI Video Editor's packages (faster-whisper, OpenCV): $AI_VIDEO_EDITOR_PYTHON, else the install.sh venv
// (~/.ai-video-editor/venv), else python3 on PATH.
import '../../engine/env-compat.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function aiVideoEditorPython() {
  const venv = path.join(process.env.AI_VIDEO_EDITOR_HOME || path.join(os.homedir(), '.ai-video-editor'), 'venv/bin/python');
  return process.env.AI_VIDEO_EDITOR_PYTHON || (fs.existsSync(venv) ? venv : 'python3');
}

// The python that has Easy Edits' packages (faster-whisper, OpenCV): $EASY_EDITS_PYTHON, else the install.sh venv
// (~/.easy-edits/venv), else python3 on PATH.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function easyEditsPython() {
  const venv = path.join(process.env.EASY_EDITS_HOME || path.join(os.homedir(), '.easy-edits'), 'venv/bin/python');
  return process.env.EASY_EDITS_PYTHON || (fs.existsSync(venv) ? venv : 'python3');
}

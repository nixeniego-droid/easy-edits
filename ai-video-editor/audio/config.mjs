// Shared names/paths for AI Video Editor audio helpers.
import { homedir } from 'node:os';
import { join } from 'node:path';

export const NAME = 'ai-video-editor';
export const VERSION = '0.1.0';
export const CACHE_DIR = process.env.AI_VIDEO_EDITOR_CACHE || join(homedir(), '.cache', NAME);

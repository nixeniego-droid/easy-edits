// Shared names/paths for Easy Edits audio helpers.
import { homedir } from 'node:os';
import { join } from 'node:path';

export const NAME = 'easy-edits';
export const VERSION = '0.1.0';
export const CACHE_DIR = process.env.EASY_EDITS_CACHE || join(homedir(), '.cache', NAME);

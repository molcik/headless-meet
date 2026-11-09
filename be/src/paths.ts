import * as path from 'path';

// Correct from be/src (tests, ts-node) and from be/dist (production build).
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const GUIDE_PATH = path.join(REPO_ROOT, 'docs', 'mcp-guide.md');

export const EXTENSION_DIR = path.join(
  REPO_ROOT,
  'be',
  'src',
  'chromectl',
  'chrome-extension',
);

/**
 * Publish prep: writes the self-contained UI bundle + hover CSS into dist/.
 * index.js prefers dist/ when present (published package), and falls back to
 * reading extension/ live (monorepo dev). Run before `npx jsr publish`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveBundle, liveHoverCss } from './bundle.js';

const DIST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
mkdirSync(DIST_DIR, { recursive: true });
writeFileSync(path.join(DIST_DIR, 'ui-bundle.js'), liveBundle());
writeFileSync(path.join(DIST_DIR, 'hover.css'), liveHoverCss());
console.log('dist/ written:', DIST_DIR);

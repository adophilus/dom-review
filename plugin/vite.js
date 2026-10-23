/**
 * Vite plugin — import via `@adophilus/dom-review/plugin/vite`.
 *
 * Auto-injects the Widget Review dev UI (the visual code-review chrome from
 * extension/) into a Vite dev server. Dev-only (`apply: 'serve'`) — the
 * review tool belongs to development, mirroring widget_review's
 * kDebugMode default on the Flutter side.
 *
 * The UI modules are vanilla-JS IIFEs sharing the window.__domReview
 * namespace. Bundle assembly lives in bundle.js:
 *   - monorepo dev: concat live from extension/content/modules
 *   - published:    prebuilt dist/ (written by build.mjs)
 * The bundle is prefixed with a tiny `chrome.storage`/`chrome.runtime` shim
 * backed by localStorage, since the UI was written for an extension world.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveBundle, liveHoverCss } from './bundle.js';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(PLUGIN_DIR, 'dist');

// Prefer the prebuilt dist/ bundle (published package is self-contained);
// fall back to live concatenation from extension/ (monorepo dev mode).
function getBundle() {
  const dist = path.join(DIST_DIR, 'ui-bundle.js');
  if (existsSync(dist)) return readFileSync(dist, 'utf8');
  return liveBundle();
}

function getHoverCss() {
  const dist = path.join(DIST_DIR, 'hover.css');
  if (existsSync(dist)) return readFileSync(dist, 'utf8');
  return liveHoverCss();
}

export default function domReview(options = {}) {
  const enabled = options.enabled !== false;
  return {
    name: 'vite-plugin-dom-review',
    apply: 'serve',
    transformIndexHtml() {
      if (!enabled) return [];
      return [
        { tag: 'style', children: getHoverCss(), injectTo: 'head' },
        { tag: 'script', attrs: { src: '/@dom-review/review.js' }, injectTo: 'body' },
      ];
    },
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use('/@dom-review/review.js', (req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(getBundle());
      });
    },
  };
}

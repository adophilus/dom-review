/**
 * vite-plugin-dom-review
 *
 * Auto-injects the Widget Review dev UI (the visual code-review chrome from
 * extension/) into a Vite dev server. Dev-only (`apply: 'serve'`) — the
 * review tool belongs to development, mirroring widget_review's
 * kDebugMode default on the Flutter side.
 *
 * The UI modules are vanilla-JS IIFEs sharing the window.__domReview
 * namespace, read in manifest order from extension/content/modules so both
 * delivery paths (Chrome extension and this plugin) share one source.
 * They were written for an extension world, so the bundle is prefixed with
 * a tiny `chrome.storage`/`chrome.runtime` shim backed by localStorage.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(PLUGIN_DIR, '..', 'extension', 'content');
const MODULES_DIR = path.join(CONTENT_DIR, 'modules');
const HOVER_CSS = path.join(CONTENT_DIR, 'content-style.css');

// Injection order matches the extension manifest (MAIN-world bridges first,
// then the isolated-world modules, orchestrator last). Most modules live in
// modules/; the orchestrator sits one level up, next to content-style.css.
const MODULE_ORDER = [
  'framework-bridge.js',
  'agent-api-bridge.js',
  ['modules', 'review-store.js'],
  ['modules', 'selector-generator.js'],
  ['modules', 'framework-detector.js'],
  ['modules', 'context-capture.js'],
  ['modules', 'shadow-ui.js'],
  ['modules', 'comment-panel.js'],
  ['modules', 'badges.js'],
  ['modules', 'sidebar.js'],
  ['modules', 'selector-mode.js'],
  ['modules', 'export-import.js'],
  ['modules', 'agent-api-handler.js'],
  ['content-script.js'],
];
const MODULE_PATHS = MODULE_ORDER.map((seg) =>
  Array.isArray(seg) ? path.join(CONTENT_DIR, ...seg) : path.join(CONTENT_DIR, 'modules', seg),
);

// The UI expects a Chrome extension environment. In a plain page there is
// none, so provide the two surfaces it touches: storage.sync (backed by
// localStorage so toolbar position persists across reloads) and a stub
// runtime. content-script.js only reads `dr_enabled` (absent -> enabled).
const CHROME_SHIM = String.raw`
(function(){
  /* Private agent-API event channel: worlds have separate globals, so the
     old extension's isolated-world handler never sees these events. */
  window.__WR_API_EVENT = 'wr-plugin-api-request';
  if (!window.chrome) window.chrome = {};
  window.chrome.storage = window.chrome.storage || {};
  var mem = {};
  try { mem = JSON.parse(localStorage.getItem('wr-chrome-shim') || '{}'); } catch (e) {}
  var save = function(){ try { localStorage.setItem('wr-chrome-shim', JSON.stringify(mem)); } catch (e) {} };
  window.chrome.storage.sync = {
    get: function(keys, cb) {
      var result = {};
      if (typeof keys === 'string') keys = [keys];
      (keys || []).forEach(function(k){ if (k in mem) result[k] = mem[k]; });
      if (cb) { cb(result); return; }
      return Promise.resolve(result);
    },
    set: function(obj, cb) { Object.assign(mem, obj); save(); if (cb) cb(); else return Promise.resolve(); }
  };
  window.chrome.runtime = window.chrome.runtime || { lastError: null, onMessage: { addListener: function(){} } };
})();
`;

let bundleCache = null;
function getBundle() {
  if (!bundleCache) {
    const modules = MODULE_PATHS.map((p) => readFileSync(p, 'utf8'));
    const takeover = String.raw`
(function(){
  /* Keep the agent contract owned by this instance when the old DOM Review
     extension co-resides on localhost: it re-registers window.__domReviewAPI
     at document_idle, after this script. Re-claim for a few seconds. */
  var mine = window.__domReviewAPI;
  if (!mine) return;
  var n = 0;
  var t = setInterval(function(){
    if (window.__domReviewAPI !== mine) window.__domReviewAPI = mine;
    if (++n >= 50) clearInterval(t);
  }, 100);
})();
`;
    bundleCache = CHROME_SHIM + '\n' + modules.join('\n;\n') + '\n' + takeover;
  }
  return bundleCache;
}

function getHoverCss() {
  return readFileSync(HOVER_CSS, 'utf8');
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

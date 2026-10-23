/**
 * Widget Review UI bundle assembly.
 *
 * The UI modules are vanilla-JS IIFEs sharing the window.__domReview
 * namespace, read in manifest order from extension/content/modules so both
 * delivery paths (Chrome extension and this plugin) share one source.
 *
 * Two modes:
 *   - live:  concat from extension/ (monorepo dev — edits apply instantly)
 *   - dist:  prebuilt files in dist/ (published package — self-contained)
 *
 * build.mjs writes dist/; index.js prefers dist when it exists.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(PLUGIN_DIR, '..', 'extension', 'content');
const MODULES_DIR = path.join(CONTENT_DIR, 'modules');
const HOVER_CSS_PATH = path.join(CONTENT_DIR, 'content-style.css');

// Injection order matches the extension manifest (MAIN-world bridges first,
// then the isolated-world modules, orchestrator last).
const MODULE_PATHS = [
  path.join(MODULES_DIR, 'framework-bridge.js'),
  path.join(MODULES_DIR, 'agent-api-bridge.js'),
  path.join(MODULES_DIR, 'review-store.js'),
  path.join(MODULES_DIR, 'selector-generator.js'),
  path.join(MODULES_DIR, 'framework-detector.js'),
  path.join(MODULES_DIR, 'context-capture.js'),
  path.join(MODULES_DIR, 'shadow-ui.js'),
  path.join(MODULES_DIR, 'comment-panel.js'),
  path.join(MODULES_DIR, 'badges.js'),
  path.join(MODULES_DIR, 'sidebar.js'),
  path.join(MODULES_DIR, 'selector-mode.js'),
  path.join(MODULES_DIR, 'export-import.js'),
  path.join(MODULES_DIR, 'agent-api-handler.js'),
  path.join(CONTENT_DIR, 'content-script.js'),
];

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

const TAKEOVER = String.raw`
(function(){
  /* Keep the agent contract owned by this instance: an old DOM Review
     extension co-residing on localhost re-registers window.__domReviewAPI
     at document_idle — which on slow-loading apps can land well after this
     script. Re-claim forever (1s cadence, no-op when already owned; the
     interval only matters while an old extension co-resides). */
  var mine = window.__domReviewAPI;
  if (!mine) return;
  setInterval(function(){
    if (window.__domReviewAPI !== mine) window.__domReviewAPI = mine;
  }, 1000);
})();
`;

/** Concatenate the UI live from extension/. */
export function liveBundle() {
  const modules = MODULE_PATHS.map((p) => readFileSync(p, 'utf8'));
  return CHROME_SHIM + '\n' + modules.join('\n;\n') + '\n' + TAKEOVER + '\n';
}

export function liveHoverCss() {
  return readFileSync(HOVER_CSS_PATH, 'utf8');
}

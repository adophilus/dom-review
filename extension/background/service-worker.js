/**
 * DOM Review — Service Worker (Background)
 * Handles message relay between popup and content scripts,
 * and dynamic content script registration for custom URL patterns.
 */

const STORAGE_KEY = 'dr_custom_patterns';
const ENABLED_KEY = 'dr_enabled';

const MAIN_WORLD_SCRIPTS = ['content/modules/framework-bridge.js', 'content/modules/agent-api-bridge.js'];
const ISOLATED_WORLD_SCRIPTS = [
  'content/modules/review-store.js',
  'content/modules/selector-generator.js',
  'content/modules/framework-detector.js',
  'content/modules/context-capture.js',
  'content/modules/shadow-ui.js',
  'content/modules/comment-panel.js',
  'content/modules/badges.js',
  'content/modules/sidebar.js',
  'content/modules/selector-mode.js',
  'content/modules/export-import.js',
  'content/modules/agent-api-handler.js',
  'content/content-script.js'
];
const ISOLATED_WORLD_CSS = ['content/content-style.css'];

async function getCustomPatterns() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

async function saveCustomPatterns(patterns) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: patterns });
}

async function registerDynamicScripts() {
  // Unregister existing dynamic scripts first
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ['dr-custom-main', 'dr-custom-isolated'] });
  } catch {
    // Scripts may not exist yet — ignore
  }

  const patterns = await getCustomPatterns();
  if (patterns.length === 0) return;

  await chrome.scripting.registerContentScripts([
    {
      id: 'dr-custom-main',
      matches: patterns,
      js: MAIN_WORLD_SCRIPTS,
      runAt: 'document_idle',
      world: 'MAIN'
    },
    {
      id: 'dr-custom-isolated',
      matches: patterns,
      js: ISOLATED_WORLD_SCRIPTS,
      css: ISOLATED_WORLD_CSS,
      runAt: 'document_idle'
    }
  ]);
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('DOM Review extension installed');
  await registerDynamicScripts();
});

// Also re-register on service worker startup (survives SW restarts)
registerDynamicScripts();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_REVIEWS') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab) { sendResponse(null); return; }
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const el = document.getElementById('dom-review-data');
          return el ? el.textContent : null;
        }
      }).then(([result]) => {
        sendResponse(result?.result ?? null);
      }).catch(() => sendResponse(null));
    });
    return true; // async response
  }

  if (message.type === 'GET_REVIEW_COUNT') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab) { sendResponse(0); return; }
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const el = document.getElementById('dom-review-data');
          if (!el) return 0;
          try { return JSON.parse(el.textContent).reviews.length; }
          catch { return 0; }
        }
      }).then(([result]) => {
        sendResponse(result?.result ?? 0);
      }).catch(() => sendResponse(0));
    });
    return true;
  }

  if (message.type === 'GET_ENABLED') {
    chrome.storage.sync.get(ENABLED_KEY).then(result => {
      sendResponse(result[ENABLED_KEY] !== false); // default true
    });
    return true;
  }

  if (message.type === 'SET_ENABLED') {
    chrome.storage.sync.set({ [ENABLED_KEY]: message.enabled }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_CUSTOM_PATTERNS') {
    getCustomPatterns().then(sendResponse);
    return true;
  }

  if (message.type === 'ADD_CUSTOM_PATTERN') {
    (async () => {
      const pattern = message.pattern;
      const patterns = await getCustomPatterns();
      if (patterns.includes(pattern)) {
        sendResponse({ success: false, error: 'Pattern already exists' });
        return;
      }
      patterns.push(pattern);
      await saveCustomPatterns(patterns);
      await registerDynamicScripts();
      sendResponse({ success: true, patterns });
    })();
    return true;
  }

  if (message.type === 'REMOVE_CUSTOM_PATTERN') {
    (async () => {
      const pattern = message.pattern;
      let patterns = await getCustomPatterns();
      patterns = patterns.filter(p => p !== pattern);
      await saveCustomPatterns(patterns);
      await registerDynamicScripts();
      // Revoke host permission
      try {
        await chrome.permissions.remove({ origins: [pattern] });
      } catch {
        // Permission may not exist or can't be revoked — ignore
      }
      sendResponse({ success: true, patterns });
    })();
    return true;
  }
});

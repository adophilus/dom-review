/**
 * DOM Review — Popup Script
 *
 * Shows review count, provides copy-prompt templates,
 * export/import buttons, and allowed-sites management.
 */
(() => {
  'use strict';

  const countEl = document.getElementById('count');
  const statusEl = document.getElementById('status');
  const mainContent = document.getElementById('main-content');
  const noPage = document.getElementById('no-page');
  const toast = document.getElementById('toast');
  const promptToggle = document.getElementById('btn-prompt-toggle');
  const promptGroup = document.getElementById('prompt-group');

  const toggleBtn = document.getElementById('toggle-btn');

  const siteList = document.getElementById('site-list');
  const addSiteInput = document.getElementById('add-site-input');
  const addSiteBtn = document.getElementById('add-site-btn');
  const addSiteError = document.getElementById('add-site-error');

  const DEFAULT_PATTERNS = ['http://localhost/*', 'http://127.0.0.1/*'];

  let reviewData = null;
  let extensionEnabled = true;

  // --- Toggle ---

  function updateToggleUI(enabled) {
    extensionEnabled = enabled;
    toggleBtn.classList.toggle('active', enabled);
    toggleBtn.title = enabled ? 'Disable extension' : 'Enable extension';
    document.body.classList.toggle('disabled', !enabled);
  }

  async function toggleExtension() {
    const newState = !extensionEnabled;
    await chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: newState });
    updateToggleUI(newState);

    // Show/hide UI on active tab
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (enabled) => {
          const host = document.getElementById('dom-review-host');
          if (host) host.style.display = enabled ? '' : 'none';
        },
        args: [newState]
      }).catch(() => {});
    });

    showToast(newState ? 'Enabled. Reload tabs.' : 'Disabled. Reload tabs.');
  }

  // --- Prompt templates ---

  const PROMPTS = {
    'fix-all': (data) =>
`You are reviewing a web page. Below is a JSON array of code-review comments left on DOM elements.
For each review, fix the issue described in the comment. Pay attention to the CSS selector, priority, and category.

Page: ${data.page}
Reviews:
${JSON.stringify(data.reviews.filter(r => !r.resolved), null, 2)}

Instructions:
- Fix each issue based on its category (style, logic, a11y, text, layout, remove, add).
- Prioritize "high" items first.
- Provide the fix as code changes.`,

    'style-review': (data) =>
`You are doing a CSS/style review of a web page. Below are style-related review comments on DOM elements.

Page: ${data.page}
Style Reviews:
${JSON.stringify(data.reviews.filter(r => !r.resolved && r.category === 'style'), null, 2)}

Instructions:
- For each element (identified by CSS selector), suggest improved CSS.
- Consider the captured context (current styles, bounding box) when making suggestions.
- Focus on visual consistency, spacing, typography, and responsive design.`,

    'a11y-audit': (data) =>
`You are performing an accessibility audit on a web page. Below are accessibility-related review comments.

Page: ${data.page}
Accessibility Reviews:
${JSON.stringify(data.reviews.filter(r => !r.resolved && r.category === 'a11y'), null, 2)}

All Reviews (for context):
${JSON.stringify(data.reviews.filter(r => !r.resolved), null, 2)}

Instructions:
- For each flagged element, suggest WCAG-compliant fixes.
- Check for: proper ARIA roles, labels, keyboard navigation, color contrast, semantic HTML.
- Provide code changes with explanations.`
  };

  // --- Pattern helpers ---

  function normalizeInput(input) {
    let val = input.trim();
    if (!val) return null;

    // If already a full match pattern, return as-is
    if (/^https?:\/\/.+\/\*$/.test(val)) {
      // Force http only
      return val.replace(/^https:/, 'http:');
    }

    // Strip protocol if provided
    val = val.replace(/^https?:\/\//, '');
    // Strip trailing slash
    val = val.replace(/\/+$/, '');

    if (!val) return null;

    return `http://${val}/*`;
  }

  function isDefaultPattern(pattern) {
    return DEFAULT_PATTERNS.includes(pattern);
  }

  function urlMatchesPattern(url, pattern) {
    // Convert match pattern to regex: http://host:port/* -> ^http://host:port/.*$
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    try {
      return new RegExp('^' + escaped + '$').test(url);
    } catch {
      return false;
    }
  }

  function urlMatchesAnyPattern(url, patterns) {
    return patterns.some(p => urlMatchesPattern(url, p));
  }

  // --- Allowed Sites rendering ---

  function renderAllowedSites(customPatterns) {
    siteList.innerHTML = '';

    // Default patterns (non-removable)
    for (const pattern of DEFAULT_PATTERNS) {
      const li = document.createElement('li');
      li.className = 'site-item site-item--default';
      li.innerHTML = `<span class="site-label">${escapeHtml(pattern)}</span><span class="site-tag">default</span>`;
      siteList.appendChild(li);
    }

    // Custom patterns (removable)
    for (const pattern of customPatterns) {
      const li = document.createElement('li');
      li.className = 'site-item';
      li.innerHTML = `<span class="site-label">${escapeHtml(pattern)}</span>`;
      const removeBtn = document.createElement('button');
      removeBtn.className = 'site-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => removePattern(pattern));
      li.appendChild(removeBtn);
      siteList.appendChild(li);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showError(msg) {
    addSiteError.textContent = msg;
    addSiteError.style.display = 'block';
  }

  function clearError() {
    addSiteError.style.display = 'none';
    addSiteError.textContent = '';
  }

  // --- Add / Remove patterns ---

  async function addPattern() {
    clearError();
    const pattern = normalizeInput(addSiteInput.value);

    if (!pattern) {
      showError('Enter a host like 192.168.1.50:3000');
      return;
    }

    if (isDefaultPattern(pattern)) {
      showError('This site is already included by default.');
      return;
    }

    // Request host permission from the user
    let granted;
    try {
      granted = await chrome.permissions.request({ origins: [pattern] });
    } catch (err) {
      showError('Invalid pattern. Try: host:port or http://host/*');
      return;
    }

    if (!granted) {
      showError('Permission denied by browser.');
      return;
    }

    // Save via service worker
    const response = await chrome.runtime.sendMessage({ type: 'ADD_CUSTOM_PATTERN', pattern });
    if (response && response.success) {
      addSiteInput.value = '';
      renderAllowedSites(response.patterns);
      showToast('Site added! Reload open tabs.');
    } else if (response && response.error) {
      showError(response.error);
    }
  }

  async function removePattern(pattern) {
    const response = await chrome.runtime.sendMessage({ type: 'REMOVE_CUSTOM_PATTERN', pattern });
    if (response && response.success) {
      renderAllowedSites(response.patterns);
      showToast('Site removed.');
    }
  }

  // --- Init ---

  function init() {
    // Load enabled state
    chrome.runtime.sendMessage({ type: 'GET_ENABLED' }, (enabled) => {
      updateToggleUI(enabled !== false);
    });

    // Always load and render allowed sites
    chrome.runtime.sendMessage({ type: 'GET_CUSTOM_PATTERNS' }, (customPatterns) => {
      renderAllowedSites(customPatterns || []);
    });

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab || !tab.url) {
        showNoPage();
        return;
      }

      const url = tab.url;

      // Check against default + custom patterns
      chrome.runtime.sendMessage({ type: 'GET_CUSTOM_PATTERNS' }, (customPatterns) => {
        const allPatterns = [...DEFAULT_PATTERNS, ...(customPatterns || [])];

        if (!urlMatchesAnyPattern(url, allPatterns)) {
          showNoPage();
          return;
        }

        // Fetch review data from content script
        chrome.runtime.sendMessage({ type: 'GET_REVIEWS' }, (raw) => {
          if (chrome.runtime.lastError) {
            statusEl.textContent = 'Could not connect to page.';
            return;
          }

          if (!raw) {
            showReady(0);
            return;
          }

          try {
            reviewData = JSON.parse(raw);
            const total = reviewData.reviews.length;
            const open = reviewData.reviews.filter(r => !r.resolved).length;
            showReady(total, open);
          } catch {
            showReady(0);
          }
        });
      });
    });
  }

  function showNoPage() {
    statusEl.style.display = 'none';
    mainContent.style.display = 'none';
    noPage.style.display = '';
    countEl.textContent = '-';
    countEl.classList.add('badge--zero');
  }

  function showReady(total, open) {
    noPage.style.display = 'none';
    mainContent.style.display = '';

    if (total === 0) {
      statusEl.innerHTML = 'No reviews on this page yet.<br>Click <strong>Select</strong> in the toolbar to start.';
      countEl.textContent = '0';
      countEl.classList.add('badge--zero');
    } else {
      const resolved = total - (open || 0);
      statusEl.innerHTML = `<strong>${total}</strong> review${total !== 1 ? 's' : ''} on this page` +
        (resolved > 0 ? ` (<strong>${open}</strong> open, ${resolved} resolved)` : '');
      countEl.textContent = open || total;
      countEl.classList.toggle('badge--zero', total === 0);
    }
  }

  function showToast(text) {
    toast.textContent = text || 'Copied!';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1500);
  }

  // --- Event handlers ---

  promptToggle.addEventListener('click', () => {
    promptGroup.classList.toggle('open');
  });

  promptGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-prompt]');
    if (!btn) return;
    const key = btn.dataset.prompt;
    const template = PROMPTS[key];
    if (!template) return;

    if (!reviewData || !reviewData.reviews.length) {
      showToast('No reviews to copy');
      return;
    }

    const text = template(reviewData);
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied!');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Copied!');
    });
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (window.__domReview && window.__domReview.exportImport) {
            window.__domReview.exportImport.exportJSON();
          }
        }
      });
    });
  });

  // Import
  document.getElementById('btn-import').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (window.__domReview && window.__domReview.exportImport) {
            window.__domReview.exportImport.importJSON();
          }
        }
      });
    });
  });

  // Toggle
  toggleBtn.addEventListener('click', toggleExtension);

  // Add site
  addSiteBtn.addEventListener('click', addPattern);
  addSiteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPattern();
  });

  init();
})();

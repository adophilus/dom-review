
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

/**
 * DOM Review — Framework Bridge (MAIN world)
 *
 * This script runs in the PAGE's JavaScript context (world: "MAIN"),
 * NOT in the extension's isolated world. It has full access to
 * __vue__, __reactFiber$, __ngContext__ etc.
 *
 * Communication with the content script happens via:
 *   - Custom DOM events (synchronous via dispatchEvent)
 *   - DOM attributes (shared between worlds)
 */
(function() {
  'use strict';

  var MAX_DEPTH = 30;
  var MAX_KEYS = 20;

  // --- Utilities ---

  function summarize(val) {
    if (val === null || val === undefined) return val;
    if (typeof val === 'function') return '[Function]';
    if (typeof val === 'symbol') return '[Symbol]';
    if (val instanceof HTMLElement) return '[HTMLElement]';
    if (val instanceof Node) return '[Node]';
    if (Array.isArray(val)) return '[Array(' + val.length + ')]';
    if (typeof val === 'object') {
      try {
        var keys = Object.keys(val);
        if (keys.length <= 3) {
          var o = {};
          keys.forEach(function(k) {
            try { o[k] = typeof val[k] === 'object' ? '[Object]' : val[k]; }
            catch(e) { o[k] = '[err]'; }
          });
          return o;
        }
      } catch(e) {}
      return '[Object]';
    }
    return val;
  }

  function shallow(obj) {
    if (!obj || typeof obj !== 'object') return {};
    var result = {}, count = 0;
    try {
      var keys = Object.keys(obj);
      for (var i = 0; i < keys.length; i++) {
        if (count >= MAX_KEYS) break;
        var k = keys[i];
        if (k.charAt(0) === '_' || k.charAt(0) === '$') continue;
        if (k === 'children' || k === 'key' || k === 'ref') continue;
        try { result[k] = summarize(obj[k]); }
        catch(e) { result[k] = '[inaccessible]'; }
        count++;
      }
    } catch(e) {}
    return result;
  }

  // --- Framework Detectors ---

  function tryVue3(el) {
    var cur = el, depth = 0;
    while (cur && depth < MAX_DEPTH) {
      var inst = cur.__vueParentComponent;
      if (inst) {
        var type = inst.type || {};
        var name = type.name || type.__name || 'Anonymous';
        var filePath = type.__file || null;
        var props = shallow(inst.props);
        var stateSource = inst.setupState || inst.data || {};
        var state = shallow(typeof stateSource === 'function' ? {} : stateSource);
        var parentName = null;
        if (inst.parent && inst.parent.type) {
          parentName = inst.parent.type.name || inst.parent.type.__name || null;
        }
        return {
          framework: 'vue3', componentName: name, filePath: filePath,
          props: props, state: state, parentComponentName: parentName,
          componentRootElement: cur.tagName.toLowerCase()
        };
      }
      cur = cur.parentElement;
      depth++;
    }
    return null;
  }

  function tryVue2(el) {
    var cur = el, depth = 0;
    while (cur && depth < MAX_DEPTH) {
      if (cur.__vue__) {
        var vm = cur.__vue__;
        var opts = vm.$options || {};
        var name = opts.name || opts._componentTag || 'Anonymous';
        var filePath = opts.__file || null;
        var props = shallow(vm.$props);
        var state = shallow(vm.$data);
        var parentName = null;
        if (vm.$parent && vm.$parent.$options) {
          parentName = vm.$parent.$options.name || vm.$parent.$options._componentTag || null;
        }
        return {
          framework: 'vue2', componentName: name, filePath: filePath,
          props: props, state: state, parentComponentName: parentName,
          componentRootElement: cur.tagName.toLowerCase()
        };
      }
      cur = cur.parentElement;
      depth++;
    }
    return null;
  }

  function tryReact(el) {
    var fiberKey = null;
    function findKey(node) {
      if (fiberKey && node[fiberKey] !== undefined) return fiberKey;
      var keys = Object.keys(node);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) {
          fiberKey = keys[i]; return fiberKey;
        }
      }
      return null;
    }
    function findComp(fiber) {
      var c = fiber, d = 0;
      while (c && d < MAX_DEPTH) {
        if (c.type && typeof c.type !== 'string') return c;
        c = c.return; d++;
      }
      return null;
    }
    var cur = el, depth = 0;
    while (cur && depth < MAX_DEPTH) {
      var key = findKey(cur);
      if (key) {
        var comp = findComp(cur[key]);
        if (comp) {
          var name = comp.type.displayName || comp.type.name || 'Anonymous';
          var filePath = comp._debugSource ? comp._debugSource.fileName : null;
          var props = shallow(comp.memoizedProps);
          var state = {};
          if (comp.memoizedState && typeof comp.memoizedState === 'object'
              && !comp.memoizedState.memoizedState) {
            state = shallow(comp.memoizedState);
          }
          var parentName = null;
          if (comp.return) {
            var p = findComp(comp.return);
            if (p) parentName = p.type.displayName || p.type.name || null;
          }
          return {
            framework: 'react', componentName: name, filePath: filePath,
            props: props, state: state, parentComponentName: parentName,
            componentRootElement: cur.tagName.toLowerCase()
          };
        }
      }
      cur = cur.parentElement; depth++;
    }
    return null;
  }

  function tryAngular(el) {
    var cur = el, depth = 0;
    while (cur && depth < MAX_DEPTH) {
      var ctx = cur.__ngContext__;
      if (ctx && Array.isArray(ctx)) {
        for (var i = 0; i < ctx.length && i < 50; i++) {
          var item = ctx[i];
          if (item && typeof item === 'object' && !Array.isArray(item)
              && item.constructor && item.constructor.name
              && item.constructor.name !== 'Object'
              && !(item instanceof Node)) {
            var name = item.constructor.name;
            var props = shallow(item);
            return {
              framework: 'angular', componentName: name, filePath: null,
              props: props, state: props, parentComponentName: null,
              componentRootElement: cur.tagName.toLowerCase()
            };
          }
        }
      }
      cur = cur.parentElement; depth++;
    }
    return null;
  }

  function detectElement(el) {
    return tryVue3(el) || tryVue2(el) || tryReact(el) || tryAngular(el) || null;
  }

  function detectPage() {
    var frameworks = [];
    var app = document.getElementById('app') || document.body.firstElementChild;
    // Vue 3
    if (app && app.__vue_app__) frameworks.push('vue3');
    if (frameworks.indexOf('vue3') === -1 && app) {
      var c = app, d = 0;
      while (c && d < 8) {
        if (c.__vueParentComponent) { frameworks.push('vue3'); break; }
        c = c.firstElementChild; d++;
      }
    }
    // Vue 2
    if (app) {
      var c2 = app, d2 = 0;
      while (c2 && d2 < 8) {
        if (c2.__vue__) { frameworks.push('vue2'); break; }
        c2 = c2.firstElementChild; d2++;
      }
    }
    // React
    if (document.querySelector('[data-reactroot]')) {
      frameworks.push('react');
    } else {
      var roots = [document.getElementById('root'), document.getElementById('__next'), app];
      for (var r = 0; r < roots.length; r++) {
        if (!roots[r]) continue;
        var keys = Object.keys(roots[r]);
        for (var j = 0; j < keys.length; j++) {
          if (keys[j].indexOf('__reactFiber$') === 0) { frameworks.push('react'); break; }
        }
        if (frameworks.indexOf('react') !== -1) break;
      }
    }
    // Angular
    if (document.querySelector('[ng-version]')) frameworks.push('angular');
    return frameworks;
  }

  // --- Event listeners (communication with content script) ---

  document.addEventListener('dr-detect-element', function() {
    var target = document.querySelector('[data-dr-detect-target]');
    if (!target) return;
    var result = detectElement(target);
    target.setAttribute('data-dr-result', JSON.stringify(result));
  });

  document.addEventListener('dr-detect-page', function() {
    var result = detectPage();
    document.documentElement.setAttribute('data-dr-frameworks', JSON.stringify(result));
  });

})();

;
/**
 * DOM Review — Agent API Bridge (MAIN world)
 *
 * Exposes window.__domReviewAPI for programmatic access by AI agents
 * and automation tools. Communicates with the extension's ISOLATED world
 * via custom DOM events (same pattern as framework-bridge.js).
 *
 * Usage (from evaluate_script / DevTools console):
 *   window.__domReviewAPI.getReviews()
 *   window.__domReviewAPI.addComment({ selector: '...', comment: '...' })
 *   window.__domReviewAPI.addReply({ reviewId: '...', comment: '...' })
 *   window.__domReviewAPI.resolveReview('r_...')
 *   window.__domReviewAPI.unresolveReview('r_...')
 */
(function() {
  'use strict';

  var REQUEST_ATTR = 'data-dr-api-request';
  var RESPONSE_ATTR = 'data-dr-api-response';
  var EVENT_NAME = window.__WR_API_EVENT || 'dr-api-request';
  var counter = 0;

  function call(method, params) {
    var requestId = 'req_' + (++counter) + '_' + Date.now();
    var request = { requestId: requestId, method: method, params: params || {} };

    document.documentElement.setAttribute(REQUEST_ATTR, JSON.stringify(request));
    document.dispatchEvent(new CustomEvent(EVENT_NAME));

    var raw = document.documentElement.getAttribute(RESPONSE_ATTR);
    document.documentElement.removeAttribute(REQUEST_ATTR);
    document.documentElement.removeAttribute(RESPONSE_ATTR);

    if (!raw) {
      return { success: false, error: 'No response from extension. Is DOM Review loaded?' };
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      return { success: false, error: 'Invalid response: ' + e.message };
    }
  }

  window.__domReviewAPI = {
    __wrOwner: EVENT_NAME,
    version: '1.0',

    /** Get all reviews for current page */
    getReviews: function() {
      return call('getReviews');
    },

    /** Get a single review by ID */
    getReview: function(reviewId) {
      return call('getReview', { reviewId: reviewId });
    },

    /**
     * Add a new review comment on a DOM element.
     * @param {Object} params
     * @param {string} params.selector  - CSS selector for target element (required)
     * @param {string} params.comment   - Review comment text (required)
     * @param {string} [params.priority] - 'high' | 'medium' | 'low' (default: 'medium')
     * @param {string} [params.category] - 'style' | 'logic' | 'a11y' | 'text' | 'layout' | 'remove' | 'add' (default: 'style')
     */
    addComment: function(params) {
      return call('addComment', params);
    },

    /**
     * Add a reply to an existing review.
     * @param {Object} params
     * @param {string} params.reviewId - ID of parent review (required)
     * @param {string} params.comment  - Reply text (required)
     * @param {string} [params.author] - Author identifier (default: 'agent')
     */
    addReply: function(params) {
      return call('addReply', params);
    },

    /** Mark a review as resolved */
    resolveReview: function(reviewId) {
      return call('resolveReview', { reviewId: reviewId });
    },

    /** Mark a review as unresolved (reopen) */
    unresolveReview: function(reviewId) {
      return call('unresolveReview', { reviewId: reviewId });
    },

    /**
     * Update an existing review's comment, priority, or category.
     * @param {Object} params
     * @param {string} params.reviewId  - ID of review to update (required)
     * @param {string} [params.comment]  - New comment text
     * @param {string} [params.priority] - New priority
     * @param {string} [params.category] - New category
     */
    updateComment: function(params) {
      return call('updateComment', params);
    },

    /** Delete a review by ID */
    deleteReview: function(reviewId) {
      return call('deleteReview', { reviewId: reviewId });
    }
  };

  // Signal that the API is ready
  document.documentElement.setAttribute('data-dr-api-ready', 'true');
})();

;
/**
 * DOM Review — Review Store Module (Track 1)
 *
 * Central CRUD store for review comments.
 * Persists to DOM (JSON block) and localStorage.
 *
 * Registers: window.__domReview.store
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  const STORAGE_KEY = `dom-review:${location.origin}${location.pathname}`;
  let data = { version: '1.0', page: location.href, reviews: [] };
  let listeners = [];
  let domSaveTimer = null;

  // --- Private helpers ---

  function _notify() {
    const copy = data.reviews.slice();
    listeners.forEach(fn => { try { fn(copy); } catch (e) { console.warn('[DOM Review] listener error:', e); } });
  }

  function _persist() {
    saveToDOM();
    saveToStorage();
    _notify();
  }

  function _applyDOMMarker(review) {
    try {
      const el = document.querySelector(review.selector);
      if (el) el.setAttribute('data-review-id', review.id);
    } catch { /* invalid selector */ }
  }

  function _removeDOMMarker(review) {
    try {
      const el = document.querySelector(review.selector);
      if (el) el.removeAttribute('data-review-id');
    } catch { /* invalid selector */ }
  }

  // --- Agent API descriptor (included in DOM JSON for LLM discoverability) ---

  const API_DESCRIPTOR = {
    hint: 'Use window.__domReviewAPI in evaluate_script to interact with reviews programmatically. All methods are synchronous and return { success, data?, error? }.',
    methods: {
      getReviews: { args: '', description: 'Get all reviews for current page' },
      getReview: { args: 'reviewId', description: 'Get a single review by ID' },
      addComment: { args: '{ selector, comment, priority?, category? }', description: 'Add a new review on a DOM element' },
      addReply: { args: '{ reviewId, comment, author? }', description: 'Add a reply to an existing review' },
      resolveReview: { args: 'reviewId', description: 'Mark review as resolved' },
      unresolveReview: { args: 'reviewId', description: 'Reopen a resolved review' },
      updateComment: { args: '{ reviewId, comment?, priority?, category? }', description: 'Update review text or metadata' },
      deleteReview: { args: 'reviewId', description: 'Delete a review' },
    }
  };

  // --- Persistence ---

  function _domPayload() {
    return { ...data, api: API_DESCRIPTOR };
  }

  function saveToDOM() {
    clearTimeout(domSaveTimer);
    domSaveTimer = setTimeout(() => {
      let el = document.getElementById('dom-review-data');
      if (!el) {
        el = document.createElement('script');
        el.type = 'application/json';
        el.id = 'dom-review-data';
        document.body.appendChild(el);
      }
      el.textContent = JSON.stringify(_domPayload(), null, 2);
    }, 300);
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[DOM Review] localStorage save failed:', e);
    }
  }

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!parsed || !Array.isArray(parsed.reviews)) return;
      data = { ...parsed, page: location.href };
      data.reviews.forEach(_applyDOMMarker);
      // Immediate DOM save (no debounce) on load
      let el = document.getElementById('dom-review-data');
      if (!el) {
        el = document.createElement('script');
        el.type = 'application/json';
        el.id = 'dom-review-data';
        document.body.appendChild(el);
      }
      el.textContent = JSON.stringify(_domPayload(), null, 2);
    } catch (e) {
      console.warn('[DOM Review] Failed to load from storage:', e);
    }
  }

  // --- CRUD ---

  function add(review) {
    data.reviews.push(review);
    _applyDOMMarker(review);
    _persist();
  }

  function get(id) {
    return data.reviews.find(r => r.id === id) || null;
  }

  function getAll() {
    return data.reviews.slice();
  }

  function update(id, changes) {
    const idx = data.reviews.findIndex(r => r.id === id);
    if (idx === -1) return false;
    data.reviews[idx] = { ...data.reviews[idx], ...changes, updated: new Date().toISOString() };
    _persist();
    return true;
  }

  function remove(id) {
    const review = data.reviews.find(r => r.id === id);
    if (review) _removeDOMMarker(review);
    data.reviews = data.reviews.filter(r => r.id !== id);
    _persist();
  }

  function resolve(id) { return update(id, { resolved: true }); }
  function unresolve(id) { return update(id, { resolved: false }); }

  // --- Events ---

  function onChange(callback) {
    listeners.push(callback);
    return () => { listeners = listeners.filter(fn => fn !== callback); };
  }

  // --- Export / Import ---

  function toJSON() {
    return JSON.parse(JSON.stringify(data));
  }

  function fromJSON(imported) {
    if (!imported || !Array.isArray(imported.reviews)) {
      throw new Error('Invalid review data');
    }
    // Remove old markers
    data.reviews.forEach(_removeDOMMarker);
    data = { version: imported.version || '1.0', page: location.href, reviews: imported.reviews };
    data.reviews.forEach(_applyDOMMarker);
    _persist();
  }

  function clear() {
    data.reviews.forEach(_removeDOMMarker);
    data.reviews = [];
    _persist();
  }

  // --- Public API ---

  window.__domReview.store = {
    add, get, getAll, update, remove,
    resolve, unresolve,
    onChange,
    toJSON, fromJSON, clear,
    loadFromStorage, saveToDOM, saveToStorage
  };
})();

;
/**
 * DOM Review — Selector Generator Module (Track 2)
 *
 * Pure utility module. Generates unique CSS selectors and XPath
 * for DOM elements.
 *
 * Registers: window.__domReview.selectorGen
 * Public API: generate(element) -> { css, xpath }
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  const MAX_DEPTH = 10;

  // Matches Tailwind / Bootstrap / common utility class prefixes
  const UTILITY_REGEX = /^(mt-|mb-|ml-|mr-|mx-|my-|pt-|pb-|pl-|pr-|px-|py-|p-\d|m-\d|w-|h-|min-w-|min-h-|max-w-|max-h-|flex|grid|text-|bg-|border-|rounded|shadow|opacity-|overflow-|z-|gap-|space-|col-|row-|hidden|block|inline|absolute|relative|fixed|sticky|sr-only|dark:|hover:|focus:|lg:|md:|sm:|xl:|2xl:|xs:)/;

  function isUtilityClass(className) {
    return UTILITY_REGEX.test(className);
  }

  /**
   * Generate a unique CSS selector for the given element.
   */
  function generateCSS(el) {
    if (!el || el === document.documentElement) return 'html';
    if (el === document.body) return 'body';

    // Fast path: element has a meaningful id
    if (el.id && !el.id.startsWith('dom-review')) {
      try {
        const sel = `#${CSS.escape(el.id)}`;
        if (document.querySelector(sel) === el) return sel;
      } catch { /* invalid id for CSS */ }
    }

    const parts = [];
    let current = el;
    let depth = 0;

    while (current && current !== document.body && depth < MAX_DEPTH) {
      let part = current.tagName.toLowerCase();

      // Stop at an element with id
      if (current.id && !current.id.startsWith('dom-review')) {
        try {
          parts.unshift(`#${CSS.escape(current.id)}`);
          break;
        } catch { /* fall through */ }
      }

      // Add meaningful (non-utility) classes, max 2
      const meaningful = Array.from(current.classList || [])
        .filter(c => c && !isUtilityClass(c))
        .slice(0, 2);

      if (meaningful.length) {
        part += '.' + meaningful.map(c => CSS.escape(c)).join('.');
      }

      // Add nth-of-type if there are same-tag siblings
      const parent = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        if (sameTag.length > 1) {
          const idx = sameTag.indexOf(current) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }

      parts.unshift(part);
      current = current.parentElement;
      depth++;
    }

    const selector = parts.join(' > ');

    // Verify uniqueness
    try {
      if (document.querySelector(selector) === el) return selector;
    } catch { /* invalid selector */ }

    // Fallback: build full path with nth-of-type on every level
    return generateFallback(el);
  }

  /**
   * Fallback: full path selector with nth-of-type at every level.
   */
  function generateFallback(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        const idx = sameTag.indexOf(current) + 1;
        part += `:nth-of-type(${idx})`;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  }

  /**
   * Generate an XPath for the given element.
   */
  function generateXPath(el) {
    if (!el) return '';
    const parts = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let idx = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) idx++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${current.tagName.toLowerCase()}[${idx}]`);
      current = current.parentElement;
    }
    return '/' + parts.join('/');
  }

  /**
   * Public API: generate both CSS selector and XPath.
   */
  function generate(element) {
    return {
      css: generateCSS(element),
      xpath: generateXPath(element)
    };
  }

  window.__domReview.selectorGen = { generate };
})();

;
/**
 * DOM Review — Framework Detector Module (Isolated World)
 *
 * Communicates with framework-bridge.js (MAIN world) via
 * custom DOM events and attributes to detect framework components.
 *
 * dispatchEvent is synchronous — the MAIN world listener fires
 * before dispatchEvent returns, so we can read results immediately.
 *
 * Registers: window.__domReview.frameworkDetector
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  let pageFrameworksCache = null;

  function getPageFrameworks() {
    if (pageFrameworksCache) return pageFrameworksCache;
    // Ask MAIN world bridge
    document.dispatchEvent(new CustomEvent('dr-detect-page'));
    const raw = document.documentElement.getAttribute('data-dr-frameworks');
    document.documentElement.removeAttribute('data-dr-frameworks');
    pageFrameworksCache = raw ? JSON.parse(raw) : [];
    return pageFrameworksCache;
  }

  function detect(element) {
    if (!element) return null;
    const active = getPageFrameworks();
    if (active.length === 0) return null;

    // Mark target element and ask MAIN world bridge
    element.setAttribute('data-dr-detect-target', '');
    document.dispatchEvent(new CustomEvent('dr-detect-element'));
    const raw = element.getAttribute('data-dr-result');
    element.removeAttribute('data-dr-detect-target');
    element.removeAttribute('data-dr-result');

    if (!raw || raw === 'null') return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function registerAdapter() {
    console.info('[DOM Review] Custom adapters: add detection logic to framework-bridge.js (MAIN world).');
  }

  window.__domReview.frameworkDetector = {
    detect,
    getPageFrameworks,
    registerAdapter,
  };
})();

;
/**
 * DOM Review — Context Capture Module (Track 3)
 *
 * Pure utility module. Captures computed styles, bounding box,
 * and accessibility attributes from a DOM element.
 *
 * Registers: window.__domReview.contextCapture
 * Public API: capture(element) -> ContextObject
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  function fallback() {
    return {
      tagName: 'unknown',
      text: '',
      boundingBox: { x: 0, y: 0, w: 0, h: 0 },
      styles: {},
      a11y: { role: 'unknown', label: '' },
      framework: null
    };
  }

  function capture(element) {
    if (!element) return fallback();

    try {
      const computed = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return {
        tagName: element.tagName.toLowerCase(),
        text: (element.textContent || '').trim().substring(0, 100),
        boundingBox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        },
        styles: {
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          padding: computed.padding,
          margin: computed.margin,
          display: computed.display,
          position: computed.position,
          border: computed.border,
          borderRadius: computed.borderRadius,
          opacity: computed.opacity
        },
        a11y: {
          role: element.getAttribute('role') || element.tagName.toLowerCase(),
          label: element.getAttribute('aria-label')
                 || element.getAttribute('alt')
                 || (element.textContent || '').trim().substring(0, 50),
          ariaDescribedby: element.getAttribute('aria-describedby'),
          ariaExpanded: element.getAttribute('aria-expanded'),
          tabIndex: element.getAttribute('tabindex')
        },
        framework: window.__domReview.frameworkDetector
          ? window.__domReview.frameworkDetector.detect(element)
          : null
      };
    } catch (_err) {
      return fallback();
    }
  }

  window.__domReview.contextCapture = { capture };
})();

;
/**
 * Widget Review — Shadow UI Module
 *
 * Hosts all extension UI inside a CLOSED shadow root: the draggable toolbar
 * pill, plus the containers the comment card and reviews panel render into.
 * Owns the design tokens (ported from widget_review's review_theme.dart —
 * always dark, never inherits the host app), inline SVG icons, popup menus,
 * keyboard containment, and the shared component stylesheet.
 *
 * Registers: window.__domReview.ui, window.__domReview.icon
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  // --- Shadow DOM host ---
  const host = document.createElement('div');
  host.id = 'dom-review-host';
  host.style.cssText = 'position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  // --- Inline SVG icons (lucide-style, thin even strokes) ---
  const ICON_PATHS = {
    select: '<path d="M5.5 3.5h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" stroke-dasharray="3.5 3"/><path d="m10.5 10.5 4.2 10 1.7-5 5-1.7z" fill="currentColor" stroke="none"/>',
    reviews: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="m10 9.5-2 2.5 2 2.5"/><path d="m14 9.5 2 2.5-2 2.5"/>',
    more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    export: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    import: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m12 14 4-4"/><path d="M12 10v4h4" transform="translate(2 0) scale(-1 1) translate(-24 -14)"/>',
    clear: '<path d="M20 20H8.5a2 2 0 0 1-1.9-1.4L2.4 8.6A1 1 0 0 1 3.3 7.3H9l2-4h8a2 2 0 0 1 2 2v2"/><path d="m14.5 12.5-4 4"/><path d="m10.5 12.5 4 4"/>',
    locate: '<circle cx="12" cy="12" r="8"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/>',
    resolve: '<path d="M20 6 9 17l-5-5"/>',
    reopen: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    edit: '<path d="M21.17 6.83a2.12 2.12 0 0 0-3-3L3.84 17.16a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.49z"/><path d="m15 5 4 4"/>',
    delete: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    agent: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    person: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    start: '<path d="M9 9l5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="m5.1 8-2.9-.8"/><path d="M14 4.1 12 6"/><path d="m6 12-1.9 2"/>',
    allDone: '<path d="M21.8 10A10 10 0 1 1 17 3.34"/><path d="m9 11 3 3L22 4"/>',
    empty: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    grip: '<circle cx="5" cy="9" r="1"/><circle cx="12" cy="9" r="1"/><circle cx="19" cy="9" r="1"/><circle cx="5" cy="15" r="1"/><circle cx="12" cy="15" r="1"/><circle cx="19" cy="15" r="1"/>',
  };

  function icon(name, size = 18) {
    const path = ICON_PATHS[name] || '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }
  window.__domReview.icon = icon;

  // --- Shared stylesheet (tokens + components used by all UI modules) ---
  const style = document.createElement('style');
  style.textContent = `
    /* === Design tokens (widget_review review_theme.dart — always dark) === */
    :host {
      --wr-accent: #4F8CFF;
      --wr-accent-hover: #6B9FFF;
      --wr-accent-soft: #1C2A45;
      --wr-on-accent-soft: #BFD4FF;
      --wr-surface: #18181B;
      --wr-raised: #232327;
      --wr-field: #2A2A2F;
      --wr-border: #34343B;
      --wr-text: #F4F4F5;
      --wr-muted: #D4D4D8;
      --wr-faint: #A1A1AA;
      --wr-high: #E5484D;
      --wr-medium: #E58A17;
      --wr-low: #64748B;
      --wr-resolved: #30A46C;
      --wr-warning: #F5B94A;
      --wr-r-sm: 6px;
      --wr-r-md: 10px;
      --wr-r-lg: 14px;
      --wr-shadow: 0 6px 18px rgba(0, 0, 0, 0.45), 0 1px 2px rgba(0, 0, 0, 0.2);
      --wr-font: system-ui, -apple-system, 'Segoe UI', sans-serif;
      --wr-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; }
    /* 'all: initial' above nukes inherited host-page styles (req 1: never
       blend with the app theme); re-declare what the chrome needs. */
    :host {
      display: block;
      font-family: var(--wr-font);
      font-size: 14px;
      line-height: 1.4;
      color: var(--wr-text);
    }
    button { font-family: var(--wr-font); cursor: pointer; }
    textarea { font-family: var(--wr-font); }
    svg { display: block; flex: none; }

    .wr-hidden { display: none !important; }

    /* === Floating cards (comment card, reviews panel) === */
    .wr-card {
      position: fixed;
      z-index: 2147483647;
      width: 380px;
      background: var(--wr-surface);
      border: 1px solid var(--wr-border);
      border-radius: var(--wr-r-lg);
      box-shadow: var(--wr-shadow);
      color: var(--wr-text);
      pointer-events: auto;
      display: flex;
      flex-direction: column;
    }
    .wr-panel { width: 360px; max-height: 80vh; }

    /* Grab handle row: drag the card from here */
    .wr-grab {
      flex: none;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      touch-action: none;
      border-radius: var(--wr-r-lg) var(--wr-r-lg) 0 0;
    }
    .wr-grab:active { cursor: grabbing; }
    .wr-grab::before {
      content: '';
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: var(--wr-border);
    }

    /* === Toolbar pill === */
    .wr-toolbar {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px 6px 4px 4px;
      background: var(--wr-surface);
      border: 1px solid var(--wr-border);
      border-radius: var(--wr-r-lg);
      box-shadow: var(--wr-shadow);
      color: var(--wr-text);
      pointer-events: auto;
      user-select: none;
    }
    .wr-grip {
      display: grid;
      place-items: center;
      width: 20px;
      height: 30px;
      color: var(--wr-faint);
      cursor: grab;
      touch-action: none;
      border-radius: var(--wr-r-md);
    }
    .wr-grip:hover { color: var(--wr-muted); background: var(--wr-raised); }
    .wr-grip:active { cursor: grabbing; }
    .wr-tbtn {
      height: 28px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 10px;
      border: none;
      border-radius: var(--wr-r-md);
      background: transparent;
      color: var(--wr-muted);
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      transition: background 0.12s, color 0.12s;
    }
    .wr-tbtn:hover { background: var(--wr-raised); color: var(--wr-text); }
    .wr-tbtn.is-active { background: var(--wr-accent); color: #fff; }
    .wr-count {
      min-width: 17px;
      height: 17px;
      padding: 0 5px;
      border-radius: 9px;
      background: var(--wr-accent-soft);
      color: var(--wr-on-accent-soft);
      font-size: 11px;
      font-weight: 700;
      display: inline-grid;
      place-items: center;
      transition: background 0.12s, color 0.12s;
    }
    .wr-tbtn.is-active .wr-count { background: rgba(255, 255, 255, 0.22); color: #fff; }

    /* === Buttons === */
    .wr-btn {
      height: 30px;
      padding: 0 12px;
      border: 1px solid transparent;
      border-radius: var(--wr-r-md);
      background: var(--wr-field);
      color: var(--wr-text);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      transition: background 0.12s, opacity 0.15s;
    }
    .wr-btn:hover { background: #33333A; }
    .wr-btn--ghost { background: transparent; color: var(--wr-muted); }
    .wr-btn--ghost:hover { background: var(--wr-field); color: var(--wr-text); }
    .wr-btn--accent { background: var(--wr-accent); color: #fff; min-width: 72px; }
    .wr-btn--accent:hover { background: var(--wr-accent-hover); }
    .wr-btn.is-disabled { opacity: 0.4; pointer-events: none; }
    .wr-icon-btn {
      width: 28px;
      height: 28px;
      display: inline-grid;
      place-items: center;
      border: none;
      border-radius: var(--wr-r-sm);
      background: transparent;
      color: var(--wr-muted);
      transition: background 0.12s, color 0.12s;
    }
    .wr-icon-btn:hover { background: var(--wr-field); color: var(--wr-text); }

    /* === Popup menus === */
    .wr-menu {
      position: fixed;
      z-index: 2147483647;
      min-width: 190px;
      padding: 4px;
      background: var(--wr-raised);
      border: 1px solid var(--wr-border);
      border-radius: var(--wr-r-md);
      box-shadow: var(--wr-shadow);
      pointer-events: auto;
    }
    .wr-menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      height: 34px;
      padding: 0 8px;
      border: none;
      border-radius: var(--wr-r-sm);
      background: transparent;
      color: var(--wr-text);
      font-size: 13px;
      text-align: left;
      white-space: nowrap;
    }
    .wr-menu-item:hover { background: var(--wr-field); }
    .wr-menu-item .wr-mi-icon {
      width: 18px;
      display: inline-flex;
      justify-content: center;
      color: var(--wr-muted);
    }
    .wr-menu-item .wr-mi-check { margin-left: auto; color: var(--wr-accent); width: 15px; }
    .wr-menu-item.is-danger { color: var(--wr-high); }
    .wr-menu-item.is-danger .wr-mi-icon { color: var(--wr-high); }
    .wr-menu-item.is-armed { background: var(--wr-high); color: #fff; }
    .wr-menu-item.is-armed .wr-mi-icon { color: #fff; }

    /* === Path bar (tap-to-widen ancestors) === */
    .wr-comment-top {
      flex: none;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 0 6px 0 8px;
    }
    .wr-path {
      flex: 1;
      min-width: 0;
      height: 28px;
      display: flex;
      align-items: center;
      gap: 1px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .wr-path::-webkit-scrollbar { display: none; }
    .wr-crumb {
      flex: none;
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 6px;
      border: none;
      border-radius: var(--wr-r-sm);
      background: transparent;
      color: var(--wr-muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .wr-crumb:hover { background: var(--wr-raised); color: var(--wr-text); }
    .wr-crumb.is-target {
      background: var(--wr-field);
      color: var(--wr-accent);
      font-weight: 600;
    }
    .wr-crumb-sep { color: var(--wr-faint); flex: none; }

    /* === Comment card body === */
    .wr-comment-body { padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
    .wr-textarea {
      width: 100%;
      min-height: 62px;
      padding: 8px 10px;
      background: var(--wr-field);
      border: 1px solid transparent;
      border-radius: var(--wr-r-md);
      color: var(--wr-text);
      font-size: 14px;
      line-height: 1.35;
      resize: vertical;
      outline: none;
    }
    .wr-textarea:focus { border-color: var(--wr-muted); }
    .wr-textarea::placeholder { color: var(--wr-faint); }

    .wr-chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
    .wr-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 24px;
      padding: 0 9px;
      border: 1px solid var(--wr-border);
      border-radius: var(--wr-r-md);
      background: transparent;
      color: var(--wr-muted);
      font-size: 12px;
      font-weight: 500;
      transition: all 0.12s;
    }
    .wr-chip:hover { color: var(--wr-text); border-color: #45454D; }
    .wr-chip.is-active {
      background: var(--wr-accent-soft);
      border-color: transparent;
      color: var(--wr-on-accent-soft);
      font-weight: 600;
    }
    .wr-chip--high.is-active { background: var(--wr-high); color: #fff; }
    .wr-chip--medium.is-active { background: var(--wr-medium); color: #fff; }
    .wr-chip--low.is-active { background: var(--wr-low); color: #fff; }
    .wr-chip-dot { width: 8px; height: 8px; border-radius: 50%; }

    .wr-context-line {
      font-family: var(--wr-mono);
      font-size: 12px;
      color: var(--wr-faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .wr-card-actions {
      flex: none;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
    }

    /* === Reviews panel === */
    .wr-panel-head {
      flex: none;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 8px 8px 16px;
    }
    .wr-panel-title { font-size: 16px; font-weight: 600; }
    .wr-panel-count { font-size: 13px; color: var(--wr-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wr-panel-controls {
      flex: none;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 16px 12px;
    }
    .wr-tabs {
      flex: 1;
      min-width: 0;
      height: 32px;
      display: flex;
      padding: 3px;
      background: var(--wr-raised);
      border: 1px solid var(--wr-border);
      border-radius: var(--wr-r-md);
    }
    .wr-tab {
      flex: 1;
      min-width: 0;
      border: none;
      background: transparent;
      border-radius: 7px;
      color: var(--wr-muted);
      font-size: 13px;
      font-weight: 500;
      padding: 0 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: background 0.12s, color 0.12s;
    }
    .wr-tab.is-active { background: var(--wr-field); color: var(--wr-text); font-weight: 600; }
    .wr-tab .wr-tab-n { color: var(--wr-faint); font-weight: 500; margin-left: 3px; }
    .wr-divider { flex: none; border-top: 1px solid var(--wr-border); }

    .wr-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0; }
    .wr-tile {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 4px 12px 16px;
      cursor: pointer;
    }
    .wr-tile:hover { background: #1D1D21; }
    .wr-tile.is-focused { background: rgba(28, 42, 69, 0.6); }
    .wr-tile + .wr-tile { border-top: 1px solid var(--wr-border); }
    .wr-tile-badge {
      flex: none;
      margin-top: 1px;
      min-width: 22px;
      height: 22px;
      padding: 0 5px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1.5px solid #fff;
      border-radius: 11px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
      font-size: 11px;
      font-weight: 700;
      color: #fff;
      line-height: 1;
    }
    .wr-tile-badge svg { width: 12px; height: 12px; stroke-width: 2.5; }
    .wr-tile-body { flex: 1; min-width: 0; }
    .wr-tile-comment { font-size: 14px; line-height: 1.35; font-weight: 500; color: var(--wr-text); word-break: break-word; white-space: pre-wrap; }
    .wr-tile.is-resolved .wr-tile-comment { color: var(--wr-muted); }
    .wr-tile-meta {
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.35;
      color: var(--wr-faint);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .wr-replies {
      margin-top: 8px;
      padding-left: 10px;
      border-left: 2px solid var(--wr-accent);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .wr-reply-author { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: var(--wr-muted); }
    .wr-reply-author svg { width: 13px; height: 13px; }
    .wr-reply-time { font-size: 12px; font-weight: 400; color: var(--wr-faint); }
    .wr-reply-text { font-size: 13px; line-height: 1.4; color: var(--wr-muted); white-space: pre-wrap; word-break: break-word; }
    .wr-tile.is-resolved .wr-reply-text { color: var(--wr-faint); }
    .wr-reply-text.is-clamped { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; }
    .wr-link {
      display: inline-block;
      padding: 3px 0;
      border: none;
      background: none;
      color: var(--wr-accent);
      font-size: 12px;
      font-weight: 600;
      text-align: left;
    }
    .wr-link:hover { text-decoration: underline; }
    .wr-tile-actions { flex: none; display: flex; align-items: flex-start; gap: 2px; margin: -3px -2px 0 0; }

    .wr-empty { padding: 40px 32px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
    .wr-empty-icon { width: 52px; height: 52px; border-radius: 50%; background: var(--wr-raised); display: grid; place-items: center; color: var(--wr-muted); }
    .wr-empty-title { font-size: 14px; font-weight: 600; color: var(--wr-text); }
    .wr-empty-detail { font-size: 13px; color: var(--wr-muted); }

    /* === Scrollbars === */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #3F3F46; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #52525B; }
  `;
  shadow.appendChild(style);

  // --- Render containers (modules fill these with their own cards) ---
  const containers = document.createElement('div');
  containers.innerHTML = `
    <div id="wr-comment-container" class="wr-hidden"></div>
    <div id="wr-sidebar-container" class="wr-hidden"></div>
  `;
  while (containers.firstChild) shadow.appendChild(containers.firstChild);

  // --- Keyboard containment (req 3) ---
  // Nothing typed in the extension UI may reach the host page: host apps
  // listen on document for shortcuts (e.g. theme toggles) and a plain div
  // host defeats their "is it an input?" guards. Capture-phase listeners on
  // the shadow ROOT stop every key event at the boundary. Default actions
  // (typing, copy/paste) still work — only propagation is stopped.
  // Consequence: Escape is handled here too (see escapeHandlers below).
  const escapeHandlers = []; // LIFO; each returns true if it consumed the Escape

  ['keydown', 'keyup', 'keypress'].forEach(type => {
    shadow.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'keydown' && e.key === 'Escape') {
        for (let i = escapeHandlers.length - 1; i >= 0; i--) {
          if (escapeHandlers[i]()) break;
        }
      }
    }, true);
  });

  // --- Toolbar ---
  const POS_KEY = 'wr_toolbar_pos';
  let toolbar = null;

  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

  function applyToolbarInsets(right, bottom) {
    toolbar.style.right = `${clamp(right, 0, Math.max(0, window.innerWidth - toolbar.offsetWidth))}px`;
    toolbar.style.bottom = `${clamp(bottom, 0, Math.max(0, window.innerHeight - toolbar.offsetHeight))}px`;
  }

  function makeDraggable(el, target, persist) {
    let dragging = false;
    const endDrag = () => { dragging = false; };
    window.addEventListener('blur', endDrag);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      closeMenu();
      dragging = true;
      const rect = target.getBoundingClientRect();
      const startRight = window.innerWidth - rect.right;
      const startBottom = window.innerHeight - rect.bottom;
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic/lost pointer */ }
      const onMove = (ev) => {
        if (!dragging) return;
        moved = true;
        applyToolbarInsets(startRight - (ev.clientX - startX), startBottom - (ev.clientY - startY));
      };
      const onUp = () => {
        dragging = false;
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        window.removeEventListener('pointermove', onMove);
        if (moved && persist) persist();
      };
      // Listen on window: with pointer capture the events bubble here from
      // the handle; if capture is lost mid-drag they still arrive from
      // wherever the cursor is, so the drag never freezes.
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
      window.addEventListener('pointermove', onMove);
    });
  }

  function buildToolbar() {
    toolbar = document.createElement('div');
    toolbar.className = 'wr-toolbar';
    toolbar.id = 'wr-toolbar';
    toolbar.style.right = '16px';
    toolbar.style.bottom = '16px';
    toolbar.innerHTML = `
      <span class="wr-grip" id="wr-grip" title="Drag to move">${icon('grip', 16)}</span>
      <button class="wr-tbtn" id="wr-btn-select" title="Select an element to review">${icon('select', 15)}Select</button>
      <button class="wr-tbtn" id="wr-btn-reviews" title="Reviews">${icon('reviews', 15)}Reviews<span class="wr-count" id="wr-count">0</span></button>
      <button class="wr-tbtn" id="wr-btn-more" title="More" style="padding: 0 7px;">${icon('more', 16)}</button>
    `;
    shadow.appendChild(toolbar);

    makeDraggable(toolbar.querySelector('#wr-grip'), toolbar, saveToolbarPos);

    // Restore persisted position (async, non-blocking).
    try {
      chrome.storage.sync.get(POS_KEY, (res) => {
        const p = res && res[POS_KEY];
        if (p && typeof p.right === 'number' && typeof p.bottom === 'number') {
          applyToolbarInsets(p.right, p.bottom);
        }
      });
    } catch { /* storage unavailable — default position stands */ }

    // Buttons dispatch via the callbacks registered on `ui` — resolved at
    // click time so registration order doesn't matter.
    toolbar.querySelector('#wr-btn-select').addEventListener('click', () => { if (ui._onSelect) ui._onSelect(); });
    toolbar.querySelector('#wr-btn-reviews').addEventListener('click', () => { if (ui._onReviews) ui._onReviews(); });
    toolbar.querySelector('#wr-btn-more').addEventListener('click', (e) => {
      toggleMenu(e.currentTarget, [
        { icon: 'export', label: 'Export JSON', onClick: () => { if (ui._onExport) ui._onExport(); } },
        { icon: 'import', label: 'Import JSON', onClick: () => { if (ui._onImport) ui._onImport(); } },
      ]);
    });
  }

  function saveToolbarPos() {
    if (!toolbar) return;
    const right = parseFloat(toolbar.style.right) || 0;
    const bottom = parseFloat(toolbar.style.bottom) || 0;
    try {
      chrome.storage.sync.set({ [POS_KEY]: { right, bottom } });
    } catch { /* non-critical */ }
  }

  // --- Popup menu helper ---
  let openMenuEl = null;
  let menuAnchor = null;
  let menuOutside = null;
  let menuOutsideInside = null;
  let menuEscapeOff = null;

  function closeMenu() {
    if (openMenuEl) {
      openMenuEl.remove();
      openMenuEl = null;
      menuAnchor = null;
    }
    if (menuOutside) {
      document.removeEventListener('pointerdown', menuOutside, true);
      menuOutside = null;
    }
    if (menuOutsideInside) {
      shadow.removeEventListener('pointerdown', menuOutsideInside, true);
      menuOutsideInside = null;
    }
    if (menuEscapeOff) { menuEscapeOff(); menuEscapeOff = null; }
  }

  /** Re-clicking the same anchor closes the menu; otherwise opens. */
  function toggleMenu(anchor, items) {
    if (openMenuEl && menuAnchor === anchor) { closeMenu(); return; }
    openMenu(anchor, items);
  }

  /**
   * openMenu(anchorEl, items) — items: { icon?, label, danger?, checked?, onClick }
   * Positioned at the anchor, clamped to the viewport. Closed by outside
   * pointer or Escape.
   */
  function openMenu(anchor, items) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'wr-menu';
    items.forEach((it) => {
      const btn = document.createElement('button');
      btn.className = 'wr-menu-item' + (it.danger ? ' is-danger' : '');
      btn.innerHTML = `
        <span class="wr-mi-icon">${it.icon ? icon(it.icon, 16) : ''}</span>
        <span>${it.label}</span>
        ${it.checked ? `<span class="wr-mi-check">${icon('resolve', 15)}</span>` : ''}
      `;
      btn.addEventListener('click', () => {
        if (!it.keepOpen) closeMenu();
        try { it.onClick(btn); } catch (e) { console.warn('[Widget Review] menu action error:', e); }
      });
      menu.appendChild(btn);
    });
    shadow.appendChild(menu);
    openMenuEl = menu;
    menuAnchor = anchor;

    // Position near the anchor (below if it fits, else above), clamped.
    const r = anchor.getBoundingClientRect();
    menu.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      let left = clamp(r.right - mw, 8, Math.max(8, window.innerWidth - mw - 8));
      let top = r.bottom + 4;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.visibility = '';
    });

    // Outside-pointer handling, two realms (closed shadows FILTER
    // composedPath at document level — everything inside retargets to the
    // host — so a single document listener can't tell menu clicks from
    // panel clicks):
    //   1. document: a real pointerdown outside our UI closes the menu.
    //   2. shadow root: sees the UNFILTERED path, so clicks inside our UI
    //      close the menu unless they hit the menu itself or its anchor
    //      (the anchor is excluded so the button's click can toggle).
    menuOutside = (e) => {
      if (e.composedPath().includes(host)) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', menuOutside, true);
    menuOutsideInside = (e) => {
      const path = e.composedPath();
      if (path.includes(openMenuEl) || path.includes(menuAnchor)) return;
      closeMenu();
    };
    shadow.addEventListener('pointerdown', menuOutsideInside, true);

    menuEscapeOff = ui.onEscape(function menuEscape() {
      if (!openMenuEl) return false;
      closeMenu();
      return true;
    });
  }

  /**
   * Drag a floating card (left/top positioning) by its grab handle,
   * clamped fully to the viewport (like widget_review's _dragSheet).
   */
  function makeCardDraggable(handle, card) {
    let dragging = false;
    const endDrag = () => { dragging = false; };
    window.addEventListener('blur', endDrag);
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      closeMenu();
      dragging = true;
      const rect = card.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic/lost pointer */ }
      const onMove = (ev) => {
        if (!dragging) return;
        const w = card.offsetWidth;
        const h = card.offsetHeight;
        card.style.left = `${clamp(rect.left + (ev.clientX - startX), 0, Math.max(0, window.innerWidth - w))}px`;
        card.style.top = `${clamp(rect.top + (ev.clientY - startY), 0, Math.max(0, window.innerHeight - h))}px`;
      };
      const onUp = () => {
        dragging = false;
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        window.removeEventListener('pointermove', onMove);
      };
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
      window.addEventListener('pointermove', onMove);
    });
  }

  // --- Public API ---

  const ui = {
    _onSelect: null,
    _onReviews: null,
    _onExport: null,
    _onImport: null,

    init() {
      if (!host.parentNode) document.body.appendChild(host);
      if (!toolbar) buildToolbar();
    },

    getToolbar() {
      return toolbar;
    },

    getShadowRoot() {
      return shadow;
    },

    /** Reflect select-mode state on the toolbar toggle. */
    setSelectActive(active) {
      const btn = toolbar && toolbar.querySelector('#wr-btn-select');
      if (!btn) return;
      btn.classList.toggle('is-active', active);
      btn.lastChild.textContent = active ? 'Cancel' : 'Select';
    },

    updateBadgeCount(n) {
      const el = shadow.getElementById('wr-count');
      if (el) el.textContent = n;
    },

    onSelectClick(cb) { ui._onSelect = cb; },
    onReviewsClick(cb) { ui._onReviews = cb; },
    onExportClick(cb) { ui._onExport = cb; },
    onImportClick(cb) { ui._onImport = cb; },

    /** Register an Escape consumer (LIFO). Returns an unregister fn. */
    onEscape(fn) {
      escapeHandlers.push(fn);
      return () => {
        const i = escapeHandlers.indexOf(fn);
        if (i >= 0) escapeHandlers.splice(i, 1);
      };
    },

    openMenu,
    closeMenu,
    toggleMenu,
    makeCardDraggable,
  };

  window.__domReview.ui = ui;
})();

;
/**
 * Widget Review — Comment Card Module
 *
 * The "write a review" card, ported from widget_review's comment_sheet.dart:
 * grab handle (draggable), PATH BAR with tap-to-widen ancestor chips,
 * comment textarea, category/priority chips, one collapsed context line,
 * Cancel/Save. Supports edit mode.
 *
 * Depends on: ui, selectorGen, contextCapture
 * Registers: window.__domReview.commentPanel
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  const CATEGORIES = ['style', 'layout', 'text', 'a11y', 'logic', 'add', 'remove'];
  const PRIORITIES = ['high', 'medium', 'low'];
  const PATH_WINDOW = 3;   // nearest ancestors shown before collapsing into `…`
  const CHAIN_MAX = 12;    // safety cap on how deep the path bar gets

  let saveCallbacks = [];
  let cancelCallbacks = [];

  // Card state — lives here (not in the DOM) so tap-to-widen can re-render
  // without losing typed text or chip selections.
  let card = null;
  let escapeOff = null;
  let targetEl = null;
  let chain = [];          // nearest-first, chain[0] === targetEl
  let selectorData = null;
  let context = null;
  let isEdit = false;
  let editId = null;
  let fullPath = false;    // `…` chip expanded?
  let draft = { comment: '', category: 'style', priority: 'medium' };
  let saveShortcutWired = false;

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function getContainer() {
    return window.__domReview.ui.getShadowRoot().getElementById('wr-comment-container');
  }

  function setSelected(el, on) {
    if (!el) return;
    if (on) el.setAttribute('data-dom-review-selected', '');
    else el.removeAttribute('data-dom-review-selected');
  }

  // --- Path bar ---

  function buildChain(el) {
    const out = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement && out.length < CHAIN_MAX) {
      out.push(cur);
      cur = cur.parentElement;
    }
    return out;
  }

  function labelFor(el) {
    return el.tagName ? el.tagName.toLowerCase() : 'unknown';
  }

  function chipTooltip(el, isTarget) {
    try {
      return window.__domReview.selectorGen.generate(el).css;
    } catch { return isTarget ? '' : labelFor(el); }
  }

  function renderPath() {
    if (chain.length === 0) {
      // Edit mode with a gone element: show the stored selector as target.
      const label = (context && context.tagName) || selectorData?.css || 'element';
      return `<span class="wr-crumb is-target" title="${escapeHtml(selectorData?.css || '')}">[${escapeHtml(label)}]</span>`;
    }
    const showAll = fullPath || chain.length <= PATH_WINDOW;
    const visible = showAll ? chain.length : PATH_WINDOW;
    const parts = [];
    if (!showAll) {
      parts.push(`<button class="wr-crumb" data-crumb="more" title="Show all ${chain.length} levels">…</button>`);
    }
    // Outermost first, the selected element last (in [brackets], accent).
    for (let i = visible - 1; i >= 0; i--) {
      const el = chain[i];
      const isTarget = i === 0;
      const label = isTarget && context && context.framework && context.framework.componentName
        ? context.framework.componentName
        : labelFor(el);
      parts.push(
        `<button class="wr-crumb${isTarget ? ' is-target' : ''}" data-crumb="${i}" ` +
        `title="${escapeHtml(chipTooltip(el, isTarget))}">${isTarget ? '[' : ''}${escapeHtml(label)}${isTarget ? ']' : ''}</button>`
      );
      if (i > 0) parts.push(`<span class="wr-crumb-sep">${window.__domReview.icon('chevronRight', 13)}</span>`);
    }
    return parts.join('');
  }

  // --- Widen the selection to an ancestor (req 2) ---

  function widen(el) {
    if (!el || el === targetEl) return;
    setSelected(targetEl, false);
    targetEl = el;
    selectorData = window.__domReview.selectorGen.generate(el);
    context = window.__domReview.contextCapture.capture(el);
    chain = buildChain(el);
    setSelected(el, true);
    render(); // re-renders from state — comment text and chips survive
    const ta = card && card.querySelector('#wr-comment-text');
    if (ta) ta.focus();
  }

  // --- Context line ---

  function contextLine() {
    if (!context) return '';
    const parts = [];
    const fw = context.framework;
    if (fw && fw.componentName) parts.push(fw.componentName);
    if (fw && fw.filePath) parts.push(fw.filePath.split('/').pop());
    if (context.tagName) parts.push(context.tagName);
    return parts.join(' · ');
  }

  function contextTooltip() {
    if (!context) return '';
    const bits = [];
    const fw = context.framework;
    if (fw && fw.framework) bits.push(`framework: ${fw.framework}`);
    if (fw && fw.componentName) bits.push(`component: ${fw.componentName}`);
    if (fw && fw.filePath) bits.push(`file: ${fw.filePath}`);
    if (context.tagName) bits.push(`tag: ${context.tagName}`);
    if (context.a11y && context.a11y.role) bits.push(`role: ${context.a11y.role}`);
    return bits.join('\n');
  }

  // --- Rendering ---

  function chipRow(options, active, kind) {
    return options.map(opt => {
      const isActive = opt === active;
      const dot = kind === 'priority'
        ? `<span class="wr-chip-dot" style="background:var(--wr-${opt})"></span>`
        : '';
      return `<button class="wr-chip wr-chip--${opt}${isActive ? ' is-active' : ''}" data-${kind}="${opt}">${dot}${opt}</button>`;
    }).join('');
  }

  function render() {
    const container = getContainer();
    if (!container) return;
    const { icon } = window.__domReview;

    const hadCard = !!card;
    if (!card) {
      card = document.createElement('div');
      card.className = 'wr-card';
      card.id = 'wr-comment-card';
      container.appendChild(card);
    }

    const commentHtml = escapeHtml(draft.comment);
    card.innerHTML = `
      <div class="wr-grab" data-drag title="Drag to move"></div>
      <div class="wr-comment-top">
        <div class="wr-path" id="wr-path">${renderPath()}</div>
        <button class="wr-icon-btn" id="wr-comment-close" title="Cancel (Esc)">${icon('close', 16)}</button>
      </div>
      <div class="wr-comment-body">
        <textarea class="wr-textarea" id="wr-comment-text" placeholder="${isEdit ? 'Edit the review…' : 'Describe the change…'}">${commentHtml}</textarea>
        <div class="wr-chip-row" id="wr-category-row">${chipRow(CATEGORIES, draft.category, 'category')}</div>
        <div class="wr-chip-row" id="wr-priority-row">${chipRow(PRIORITIES, draft.priority, 'priority')}</div>
        ${contextLine() ? `<div class="wr-context-line" title="${escapeHtml(contextTooltip())}">${escapeHtml(contextLine())}</div>` : ''}
        <div class="wr-card-actions">
          <button class="wr-btn wr-btn--ghost" id="wr-comment-cancel">Cancel</button>
          <button class="wr-btn wr-btn--accent${draft.comment.trim() ? '' : ' is-disabled'}" id="wr-comment-save">${isEdit ? 'Update' : 'Save'}</button>
        </div>
      </div>
    `;

    wireEvents();
    window.__domReview.ui.makeCardDraggable(card.querySelector('[data-drag]'), card);

    if (!hadCard) {
      container.classList.remove('wr-hidden');
      escapeOff = window.__domReview.ui.onEscape(escapeClose);
    }
  }

  function wireEvents() {
    const path = card.querySelector('#wr-path');
    path.addEventListener('click', (e) => {
      const crumb = e.target.closest('.wr-crumb');
      if (!crumb) return;
      if (crumb.dataset.crumb === 'more') {
        fullPath = true;
        render();
        return;
      }
      const el = chain[Number(crumb.dataset.crumb)];
      if (el) widen(el);
    });

    const textarea = card.querySelector('#wr-comment-text');
    textarea.addEventListener('input', () => {
      draft.comment = textarea.value;
      card.querySelector('#wr-comment-save').classList.toggle('is-disabled', !draft.comment.trim());
    });

    // Ctrl/Cmd+Enter saves. The shadow-root key containment stops keydown
    // before it descends to the textarea, so this must live on the shadow
    // root itself (same-node listeners survive stopPropagation). Wire once.
    if (!saveShortcutWired) {
      saveShortcutWired = true;
      window.__domReview.ui.getShadowRoot().addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
        const c = getContainer();
        if (!c || c.classList.contains('wr-hidden')) return;
        e.preventDefault();
        trySave();
      }, true);
    }

    card.querySelector('#wr-category-row').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-category]');
      if (!chip) return;
      draft.category = chip.dataset.category;
      card.querySelectorAll('#wr-category-row .wr-chip').forEach(p => p.classList.toggle('is-active', p === chip));
    });

    card.querySelector('#wr-priority-row').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-priority]');
      if (!chip) return;
      draft.priority = chip.dataset.priority;
      card.querySelectorAll('#wr-priority-row .wr-chip').forEach(p => p.classList.toggle('is-active', p === chip));
    });

    card.querySelector('#wr-comment-close').addEventListener('click', cancel);
    card.querySelector('#wr-comment-cancel').addEventListener('click', cancel);
    card.querySelector('#wr-comment-save').addEventListener('click', trySave);
  }

  function positionNear(el) {
    if (!el) {
      card.style.left = `${Math.max(8, window.innerWidth - 380 - 16)}px`;
      card.style.top = `${Math.max(8, window.innerHeight - card.offsetHeight - 80)}px`;
      return;
    }
    const r = el.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    let y = r.bottom + 8;
    if (y + h > window.innerHeight - 8) y = r.top - h - 8;
    x = Math.min(Math.max(x, 8), Math.max(8, window.innerWidth - w - 8));
    y = Math.min(Math.max(y, 8), Math.max(8, window.innerHeight - h - 8));
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }

  // --- Public API ---

  function show(element, selData, ctx) {
    if (card) hide();
    reset();
    targetEl = element;
    selectorData = selData;
    context = ctx;
    chain = element ? buildChain(element) : [];
    setSelected(element, true);
    render();
    positionNear(element);
    const ta = card.querySelector('#wr-comment-text');
    if (ta) ta.focus();
  }

  function showEdit(review) {
    if (card) hide();
    reset();
    isEdit = true;
    editId = review.id;
    draft = {
      comment: review.comment || '',
      category: review.category || 'style',
      priority: review.priority || 'medium',
    };
    context = review.context || null;
    let el = null;
    try { el = document.querySelector(review.selector); } catch { /* invalid selector */ }
    targetEl = el;
    chain = el ? buildChain(el) : [];
    selectorData = el
      ? window.__domReview.selectorGen.generate(el)
      : { css: review.selector, xpath: review.xpath || '' };
    if (el) setSelected(el, true);
    render();
    positionNear(el);
    const ta = card.querySelector('#wr-comment-text');
    if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
  }

  function reset() {
    if (card) card.remove();
    card = null;
    if (escapeOff) { escapeOff(); escapeOff = null; }
    targetEl = null;
    chain = [];
    selectorData = null;
    context = null;
    isEdit = false;
    editId = null;
    fullPath = false;
    draft = { comment: '', category: 'style', priority: 'medium' };
  }

  function hide() {
    setSelected(targetEl, false);
    reset();
    const container = getContainer();
    if (container) container.classList.add('wr-hidden');
  }

  function cancel() {
    hide();
    cancelCallbacks.forEach(fn => { try { fn(); } catch { /* ignore */ } });
  }

  function escapeClose() {
    if (!card) return false;
    cancel();
    return true;
  }

  function trySave() {
    const comment = draft.comment.trim();
    if (!comment) return;
    const formData = {
      comment,
      category: draft.category,
      priority: draft.priority,
      selector: selectorData ? selectorData.css : '',
      xpath: selectorData ? selectorData.xpath : '',
      context,
      isEdit,
      editId,
    };
    saveCallbacks.forEach(fn => { try { fn(formData); } catch (e) { console.warn('[Widget Review] save callback error:', e); } });
    hide();
  }

  function onSave(callback) {
    saveCallbacks.push(callback);
    return () => { saveCallbacks = saveCallbacks.filter(fn => fn !== callback); };
  }

  function onCancel(callback) {
    cancelCallbacks.push(callback);
    return () => { cancelCallbacks = cancelCallbacks.filter(fn => fn !== callback); };
  }

  window.__domReview.commentPanel = { show, showEdit, hide, onSave, onCancel };
})();

;
/**
 * DOM Review — Badges Module (Track 7, Layer 1)
 *
 * Creates visual markers (badges) on DOM elements that have reviews.
 * Badges are positioned absolutely based on element bounding rects
 * and update on scroll/resize.
 *
 * Depends on: store (Track 1) — getAll() to read reviews
 * Registers: window.__domReview.badges
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  const BADGE_Z = 2147483646;
  // ReviewNumberBadge palette (review_theme.dart): priority-colored, resolved
  // = green. White 1.5px border, soft drop shadow.
  const BADGE_SIZE = 22;
  const PRIORITY_COLORS = {
    high: '#E5484D',
    medium: '#E58A17',
    low: '#64748B',
  };
  const RESOLVED_COLOR = '#30A46C';
  const CHECK_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  let container = null;
  let badges = new Map(); // reviewId -> badgeElement
  let rafPending = false;
  let listening = false;

  function ensureContainer() {
    if (container && container.parentNode) return;
    container = document.createElement('div');
    container.id = 'dom-review-badges';
    container.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: ${BADGE_Z}; overflow: hidden;
    `;
    document.body.appendChild(container);
  }

  function createBadgeElement(review, index) {
    const el = document.createElement('div');
    const color = review.resolved ? RESOLVED_COLOR : (PRIORITY_COLORS[review.priority] || PRIORITY_COLORS.low);
    el.style.cssText = `
      position: absolute; pointer-events: auto; cursor: pointer;
      min-width: ${BADGE_SIZE}px; height: ${BADGE_SIZE}px; border-radius: ${BADGE_SIZE / 2}px;
      background: ${color}; color: white;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px; font-weight: 700; line-height: 1;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0 5px; box-sizing: border-box;
      border: 1.5px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      transition: transform 0.15s;
      user-select: none;
    `;
    el.innerHTML = review.resolved ? CHECK_SVG : `#${index + 1}`;
    el.title = `[${review.priority}] ${review.category}: ${review.comment.substring(0, 60)}${review.comment.length > 60 ? '...' : ''}`;
    el.dataset.reviewId = review.id;

    el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.2)'; });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; });
    el.addEventListener('click', () => {
      // Highlight element + open sidebar scrolled to this review
      try {
        const target = document.querySelector(review.selector);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.setAttribute('data-dom-review-hover', '');
          setTimeout(() => target.removeAttribute('data-dom-review-hover'), 1500);
        }
      } catch { /* invalid selector */ }
      const { sidebar } = window.__domReview;
      if (sidebar) {
        sidebar.show();
        setTimeout(() => sidebar.scrollToReview(review.id), 100);
      }
    });

    return el;
  }

  function positionBadge(badgeEl, review) {
    try {
      const target = document.querySelector(review.selector);
      if (!target) {
        badgeEl.style.visibility = 'hidden';
        return;
      }
      const rect = target.getBoundingClientRect();
      // Position at top-right corner of element. (visibility, NOT display —
      // display='' would wipe the badge's inline `display: inline-flex` and
      // leave it as an uncentered block.)
      badgeEl.style.visibility = 'visible';
      badgeEl.style.left = `${rect.right - 11}px`;
      badgeEl.style.top = `${rect.top - 11}px`;
    } catch {
      badgeEl.style.visibility = 'hidden';
    }
  }

  function startListening() {
    if (listening) return;
    listening = true;
    window.addEventListener('scroll', throttledUpdateAll, true);
    window.addEventListener('resize', throttledUpdateAll);
  }

  function stopListening() {
    if (!listening) return;
    listening = false;
    window.removeEventListener('scroll', throttledUpdateAll, true);
    window.removeEventListener('resize', throttledUpdateAll);
  }

  function throttledUpdateAll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      updatePositions();
    });
  }

  function updatePositions() {
    const { store } = window.__domReview;
    const reviews = store.getAll();
    const reviewMap = new Map(reviews.map(r => [r.id, r]));

    badges.forEach((badgeEl, id) => {
      const review = reviewMap.get(id);
      if (review) positionBadge(badgeEl, review);
      else badgeEl.style.display = 'none';
    });
  }

  // --- Public API ---

  function render() {
    ensureContainer();
    const { store } = window.__domReview;
    const reviews = store.getAll();

    // Clear existing badges
    badges.forEach(el => el.remove());
    badges.clear();

    reviews.forEach((review, idx) => {
      const badgeEl = createBadgeElement(review, idx);
      positionBadge(badgeEl, review);
      container.appendChild(badgeEl);
      badges.set(review.id, badgeEl);
    });

    if (reviews.length > 0) startListening();
    else stopListening();
  }

  function add(review) {
    ensureContainer();
    const idx = badges.size;
    const badgeEl = createBadgeElement(review, idx);
    positionBadge(badgeEl, review);
    container.appendChild(badgeEl);
    badges.set(review.id, badgeEl);
    startListening();
  }

  function remove(id) {
    const el = badges.get(id);
    if (el) {
      el.remove();
      badges.delete(id);
    }
    if (badges.size === 0) stopListening();
  }

  function updateAll() {
    updatePositions();
  }

  function cleanup() {
    badges.forEach(el => el.remove());
    badges.clear();
    stopListening();
    if (container && container.parentNode) {
      container.remove();
      container = null;
    }
  }

  window.__domReview.badges = { render, add, remove, updateAll, cleanup };
})();

;
/**
 * Widget Review — Reviews Panel Module
 *
 * The review list, ported from widget_review's review_panel.dart: draggable
 * card, segmented filter tabs (Open/Resolved/All with counts), sort menu,
 ⋯ menu (Export/Import/Clear resolved), numbered priority-colored badges,
 * comment-first tiles with reply threads, locate-on-click, empty states.
 *
 * Depends on: ui, store, commentPanel
 * Registers: window.__domReview.sidebar
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

  let visible = false;
  let escapeOff = null;
  let currentFilter = 'open';      // 'open' | 'resolved' | 'all'
  let currentSort = 'newest';      // 'newest' | 'oldest' | 'priority' | 'category'
  let allRepliesShown = new Set(); // tile ids with "show earlier replies" expanded
  let expandedReplies = new Set(); // reply ids with "show more" expanded
  let focusedId = null;            // review scrolled to via badge click

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function getContainer() {
    return window.__domReview.ui.getShadowRoot().getElementById('wr-sidebar-container');
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const d = Date.now() - new Date(iso).getTime();
    if (isNaN(d)) return '';
    if (d < 45 * 1000) return 'just now';
    if (d < 60 * 60 * 1000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 24 * 60 * 60 * 1000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  }

  function categoryLabel(c) {
    return c === 'a11y' ? 'a11y' : (c ? c[0].toUpperCase() + c.slice(1) : '');
  }

  // --- Filtering / sorting ---

  function visibleReviews(reviews) {
    let list = reviews.slice();
    if (currentFilter === 'open') list = list.filter(r => !r.resolved);
    if (currentFilter === 'resolved') list = list.filter(r => r.resolved);
    const byNewest = (a, b) => new Date(b.created) - new Date(a.created);
    if (currentSort === 'newest') list.sort(byNewest);
    else if (currentSort === 'oldest') list.sort((a, b) => new Date(a.created) - new Date(b.created));
    else if (currentSort === 'priority') list.sort((a, b) =>
      ((PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3)) || byNewest(a, b));
    else if (currentSort === 'category') list.sort((a, b) =>
      (a.category || '').localeCompare(b.category || '') || byNewest(a, b));
    return list;
  }

  // --- Rendering ---

  function badgeHtml(review, number) {
    // Whitelist: priority comes from stored/imported JSON — never trust it in markup.
    const pri = ['high', 'medium', 'low'].includes(review.priority) ? review.priority : 'low';
    const color = review.resolved ? 'var(--wr-resolved)' : `var(--wr-${pri})`;
    const content = review.resolved
      ? window.__domReview.icon('resolve', 12)
      : `#${number}`;
    const tip = review.resolved ? 'Resolved' : `${pri} priority`;
    return `<span class="wr-tile-badge" style="background:${color}" title="${escapeHtml(tip)}">${content}</span>`;
  }

  function replyHtml(reply, dim) {
    const isAgent = reply.author === 'agent';
    const author = reply.author === 'user' || reply.author === 'developer' ? 'You' : (reply.author || 'unknown');
    const long = (reply.comment || '').length > 140 || ((reply.comment || '').match(/\n/g) || []).length > 2;
    const expanded = expandedReplies.has(reply.id);
    return `
      <div class="wr-reply" data-reply="${escapeHtml(reply.id)}">
        <div class="wr-reply-author">${window.__domReview.icon(isAgent ? 'agent' : 'person', 13)}${escapeHtml(author)}<span class="wr-reply-time">· ${relativeTime(reply.created)}</span></div>
        <div class="wr-reply-text${long && !expanded ? ' is-clamped' : ''}">${escapeHtml(reply.comment)}</div>
        ${long ? `<button class="wr-link" data-action="toggle-reply" data-id="${escapeHtml(reply.id)}">${expanded ? 'Show less' : 'Show more'}</button>` : ''}
      </div>
    `;
  }

  function repliesHtml(review) {
    const replies = review.replies || [];
    if (replies.length === 0) return '';
    const showAll = allRepliesShown.has(review.id) || replies.length <= 1;
    const shown = showAll ? replies : replies.slice(-1);
    const hidden = replies.length - shown.length;
    return `
      <div class="wr-replies">
        ${hidden > 0 ? `<button class="wr-link" data-action="show-earlier" data-id="${escapeHtml(review.id)}">Show ${hidden} earlier ${hidden === 1 ? 'reply' : 'replies'}</button>` : ''}
        ${shown.map(r => replyHtml(r, review.resolved)).join('')}
      </div>
    `;
  }

  function tileHtml(review, number) {
    return `
      <div class="wr-tile${review.resolved ? ' is-resolved' : ''}${review.id === focusedId ? ' is-focused' : ''}" data-review-id="${escapeHtml(review.id)}">
        ${badgeHtml(review, number)}
        <div class="wr-tile-body">
          <div class="wr-tile-comment">${escapeHtml(review.comment)}</div>
          <div class="wr-tile-meta" title="${escapeHtml(review.selector || '')}">${escapeHtml(metaLine(review))}</div>
          ${repliesHtml(review)}
        </div>
        <div class="wr-tile-actions">
          <button class="wr-icon-btn" data-action="toggle-resolved" data-id="${escapeHtml(review.id)}" title="${review.resolved ? 'Reopen' : 'Resolve'}">${window.__domReview.icon(review.resolved ? 'reopen' : 'resolve', 16)}</button>
          <button class="wr-icon-btn" data-action="more" data-id="${escapeHtml(review.id)}" title="More">${window.__domReview.icon('more', 16)}</button>
        </div>
      </div>
    `;
  }

  function metaLine(review) {
    const parts = [];
    const fw = review.context && review.context.framework;
    if (fw && fw.componentName) parts.push(fw.componentName);
    else if (review.context && review.context.tagName) parts.push(review.context.tagName);
    parts.push(categoryLabel(review.category));
    parts.push(relativeTime(review.created));
    return parts.join(' · ');
  }

  function emptyHtml(reviews, resolvedCount) {
    const { icon } = window.__domReview;
    let icon_, title, detail = null;
    if (reviews.length === 0) {
      icon_ = 'start';
      title = 'No reviews yet';
      detail = 'Tap Select, then click any element to leave a comment.';
    } else if (currentFilter === 'open') {
      icon_ = 'allDone';
      title = 'Nothing open. Nice.';
    } else if (currentFilter === 'resolved') {
      icon_ = 'empty';
      title = 'No resolved reviews';
    } else {
      icon_ = 'empty';
      title = 'No reviews';
    }
    return `
      <div class="wr-empty">
        <div class="wr-empty-icon">${icon(icon_, 26)}</div>
        <div class="wr-empty-title">${title}</div>
        ${detail ? `<div class="wr-empty-detail">${detail}</div>` : ''}
        ${currentFilter === 'open' && resolvedCount > 0 ? `<button class="wr-link" data-action="show-resolved">${icon('arrowRight', 14)} ${resolvedCount} resolved</button>` : ''}
      </div>
    `;
  }

  function tabHtml(value, label, count) {
    return `<button class="wr-tab${currentFilter === value ? ' is-active' : ''}" data-filter="${value}">${label}<span class="wr-tab-n">${count}</span></button>`;
  }

  function render() {
    if (!visible) return;
    const container = getContainer();
    if (!container) return;
    const { store, icon } = window.__domReview;

    const all = store.getAll();
    const reviews = visibleReviews(all);
    const openCount = all.filter(r => !r.resolved).length;
    const resolvedCount = all.length - openCount;

    // Preserve scroll position across re-renders.
    const listEl = container.querySelector('.wr-list');
    const scrollTop = listEl ? listEl.scrollTop : 0;
    // Preserve panel position across re-renders (the card element is rebuilt).
    const prevCard = container.querySelector('#wr-sidebar');
    const prevLeft = prevCard ? prevCard.style.left : '';
    const prevTop = prevCard ? prevCard.style.top : '';

    container.innerHTML = `
      <div class="wr-card wr-panel" id="wr-sidebar">
        <div class="wr-grab" data-drag title="Drag to move"></div>
        <div class="wr-panel-head">
          <span class="wr-panel-title">Reviews</span>
          <span class="wr-panel-count">${openCount} open</span>
          <button class="wr-icon-btn" id="wr-sidebar-more" title="More">${icon('more', 17)}</button>
          <button class="wr-icon-btn" id="wr-sidebar-close" title="Close (Esc)">${icon('close', 17)}</button>
        </div>
        <div class="wr-panel-controls">
          <div class="wr-tabs">
            ${tabHtml('open', 'Open', openCount)}
            ${tabHtml('resolved', 'Resolved', resolvedCount)}
            ${tabHtml('all', 'All', all.length)}
          </div>
          <button class="wr-icon-btn" id="wr-sidebar-sort" title="Sort">${icon('sort', 16)}</button>
        </div>
        <div class="wr-divider"></div>
        <div class="wr-list">
          ${reviews.length ? reviews.map(r => tileHtml(r, all.indexOf(r) + 1)).join('') : emptyHtml(all, resolvedCount)}
        </div>
      </div>
    `;

    const list = container.querySelector('.wr-list');
    list.scrollTop = scrollTop;

    // Place the panel: keep a dragged position, else anchor to the
    // toolbar's CURRENT position (right edges aligned, just above it;
    // flips below when there's no headroom). (Fixed-position card with
    // no left/top would land at 0,0.)
    const card = container.querySelector('#wr-sidebar');
    let left = parseFloat(prevLeft);
    let top = parseFloat(prevTop);
    if (Number.isNaN(left) || Number.isNaN(top)) {
      const tb = window.__domReview.ui.getToolbar();
      const tr = tb ? tb.getBoundingClientRect() : null;
      if (tr) {
        left = tr.right - card.offsetWidth;
        top = tr.top - card.offsetHeight - 8;
        if (top < 8) top = tr.bottom + 8;
      } else {
        left = window.innerWidth - card.offsetWidth - 16;
        top = window.innerHeight - card.offsetHeight - 80;
      }
    }
    left = Math.min(Math.max(left, 8), Math.max(8, window.innerWidth - card.offsetWidth - 8));
    top = Math.min(Math.max(top, 8), Math.max(8, window.innerHeight - card.offsetHeight - 8));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    wireEvents();
    window.__domReview.ui.makeCardDraggable(container.querySelector('[data-drag]'), container.querySelector('#wr-sidebar'));
  }

  function wireEvents() {
    const container = getContainer();
    const { store, commentPanel, exportImport } = window.__domReview;

    container.querySelector('#wr-sidebar-close').addEventListener('click', () => hide());

    container.querySelector('#wr-sidebar-more').addEventListener('click', (e) => {
      const resolvedCount = store.getAll().filter(r => r.resolved).length;
      window.__domReview.ui.toggleMenu(e.currentTarget, [
        { icon: 'export', label: 'Export JSON', onClick: () => exportImport.exportJSON() },
        { icon: 'import', label: 'Import JSON…', onClick: () => exportImport.importJSON() },
        {
          icon: 'clear', label: 'Clear resolved', danger: resolvedCount > 0, keepOpen: true, onClick: (btn) => {
            if (resolvedCount === 0) return;
            // Two-step confirm in-menu: window.confirm would freeze the page
            // behind an easy-to-miss native dialog.
            if (btn.dataset.armed) {
              store.getAll().filter(r => r.resolved).forEach(r => store.remove(r.id));
              window.__domReview.ui.closeMenu();
              return;
            }
            btn.dataset.armed = '1';
            btn.classList.add('is-armed');
            btn.children[1].textContent = `Delete ${resolvedCount} resolved?`;
          },
        },
      ]);
    });

    container.querySelector('#wr-sidebar-sort').addEventListener('click', (e) => {
      window.__domReview.ui.toggleMenu(e.currentTarget, [
        { label: 'Sort by newest', checked: currentSort === 'newest', onClick: () => { currentSort = 'newest'; render(); } },
        { label: 'Sort by oldest', checked: currentSort === 'oldest', onClick: () => { currentSort = 'oldest'; render(); } },
        { label: 'Sort by priority', checked: currentSort === 'priority', onClick: () => { currentSort = 'priority'; render(); } },
        { label: 'Sort by category', checked: currentSort === 'category', onClick: () => { currentSort = 'category'; render(); } },
      ]);
    });

    container.querySelector('.wr-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-filter]');
      if (!tab) return;
      currentFilter = tab.dataset.filter;
      render();
    });

    // One delegated handler for the whole list.
    container.querySelector('.wr-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'toggle-resolved') {
          const review = store.get(id);
          if (review) review.resolved ? store.unresolve(id) : store.resolve(id);
        } else if (action === 'more') {
          openTileMenu(btn, id);
        } else if (action === 'show-earlier') {
          allRepliesShown.add(id);
          render();
        } else if (action === 'toggle-reply') {
          expandedReplies.has(id) ? expandedReplies.delete(id) : expandedReplies.add(id);
          render();
        } else if (action === 'show-resolved') {
          currentFilter = 'resolved';
          render();
        }
        return;
      }
      const replyText = e.target.closest('.wr-reply-text');
      if (replyText) return; // selecting reply text shouldn't locate

      // Tile click locates the element on the page.
      const tile = e.target.closest('.wr-tile');
      if (tile) locate(tile.dataset.reviewId);
    });
  }

  function openTileMenu(anchor, id) {
    const { store, commentPanel } = window.__domReview;
    window.__domReview.ui.toggleMenu(anchor, [
      { icon: 'locate', label: 'Show on screen', onClick: () => locate(id) },
      {
        icon: 'edit', label: 'Edit', onClick: () => {
          const review = store.get(id);
          if (review && commentPanel) { focusedId = id; commentPanel.showEdit(review); }
        },
      },
      {
        icon: 'delete', label: 'Delete', danger: true, keepOpen: true, onClick: (btn) => {
          // Two-step confirm: first click arms (red, "Confirm delete?"),
          // second click deletes. Click elsewhere / Esc disarms.
          if (btn.dataset.armed) {
            store.remove(id);
            window.__domReview.ui.closeMenu();
            return;
          }
          btn.dataset.armed = '1';
          btn.classList.add('is-armed');
          btn.children[1].textContent = 'Confirm delete?';
        },
      },
    ]);
  }

  // --- Actions ---

  function locate(id) {
    const { store } = window.__domReview;
    const review = store.get(id);
    if (!review) return;
    try {
      const el = document.querySelector(review.selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.setAttribute('data-dom-review-hover', '');
        setTimeout(() => el.removeAttribute('data-dom-review-hover'), 1500);
      }
    } catch { /* invalid selector */ }
  }

  // --- Public API ---

  function show() {
    const container = getContainer();
    if (!container) return;
    visible = true;
    container.classList.remove('wr-hidden');
    if (!escapeOff) escapeOff = window.__domReview.ui.onEscape(escapeHide);
    render();
  }

  function escapeHide() {
    if (!visible) return false;
    hide();
    return true;
  }

  function hide() {
    const container = getContainer();
    if (!container) return;
    visible = false;
    window.__domReview.ui.closeMenu();
    container.classList.add('wr-hidden');
    focusedId = null;
    if (escapeOff) { escapeOff(); escapeOff = null; }
  }

  function toggle() {
    if (visible) hide(); else show();
  }

  function scrollToReview(id) {
    focusedId = id;
    if (!visible) { show(); }
    render();
    const container = getContainer();
    const card = container && container.querySelector(`[data-review-id="${CSS.escape(id)}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Clear the highlight after the locate flash.
    setTimeout(() => {
      if (focusedId === id) {
        focusedId = null;
        if (visible) render();
      }
    }, 2000);
  }

  window.__domReview.sidebar = { show, hide, toggle, render, scrollToReview };
})();

;
/**
 * DOM Review — Selector Mode Module (Track 5, Layer 1)
 *
 * Click-to-select mode: hover highlights DOM elements and captures
 * the clicked element for review. Uses data-dom-review-hover attribute
 * (styled by content-style.css) and avoids extension's own Shadow DOM.
 *
 * Depends on: ui (Track 4) — getShadowRoot() to identify own elements
 * Registers: window.__domReview.selector
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  let active = false;
  let hoveredElement = null;
  let selectCallbacks = [];
  let rafPending = false;

  const IGNORE_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'HTML', 'NOSCRIPT']);

  function isOwnElement(el) {
    // Walk up to check if element is inside the extension's Shadow DOM host
    let node = el;
    while (node) {
      if (node.id === 'dom-review-host') return true;
      node = node.parentElement || (node.getRootNode && node.getRootNode() !== document ? node.getRootNode().host : null);
    }
    return false;
  }

  function clearHighlight() {
    if (hoveredElement) {
      hoveredElement.removeAttribute('data-dom-review-hover');
      hoveredElement = null;
    }
  }

  // --- Event handlers ---

  function handleMouseover(e) {
    if (!active) return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!active) return;
      const target = e.target;
      if (!target || target === hoveredElement) return;
      if (IGNORE_TAGS.has(target.tagName)) return;
      if (isOwnElement(target)) return;

      clearHighlight();
      hoveredElement = target;
      hoveredElement.setAttribute('data-dom-review-hover', '');
    });
  }

  function handleClick(e) {
    if (!active) return;

    // Let clicks on extension's own UI pass through
    if (isOwnElement(e.target)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const target = hoveredElement || e.target;
    if (!target || IGNORE_TAGS.has(target.tagName)) {
      return;
    }

    clearHighlight();
    disable();

    const el = target;
    selectCallbacks.forEach(fn => {
      try { fn(el); } catch (err) { console.warn('[DOM Review] selector callback error:', err); }
    });
  }

  function handleKeydown(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      clearHighlight();
      disable();
    }
  }

  // --- Public API ---

  function enable() {
    if (active) return;
    active = true;
    document.documentElement.style.cursor = 'crosshair';
    document.addEventListener('mouseover', handleMouseover, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeydown, true);
  }

  function disable() {
    if (!active) return;
    active = false;
    document.documentElement.style.cursor = '';
    clearHighlight();
    document.removeEventListener('mouseover', handleMouseover, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeydown, true);
  }

  function isActive() {
    return active;
  }

  function toggle() {
    if (active) disable(); else enable();
  }

  function onSelect(callback) {
    selectCallbacks.push(callback);
    return () => { selectCallbacks = selectCallbacks.filter(fn => fn !== callback); };
  }

  /**
   * Programmatic selection: highlight the element and fire the same
   * onSelect callbacks as a click in select mode. Used by callers that want
   * to (re)select an element without entering select mode. Returns true if
   * the element was accepted.
   */
  function selectElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (IGNORE_TAGS.has(el.tagName)) return false;
    clearHighlight();
    hoveredElement = null;
    el.setAttribute('data-dom-review-selected', '');
    selectCallbacks.forEach(fn => {
      try { fn(el); } catch (err) { console.warn('[Widget Review] selector callback error:', err); }
    });
    return true;
  }

  window.__domReview.selector = { enable, disable, isActive, toggle, onSelect, selectElement };
})();

;
/**
 * DOM Review — Export/Import Module (Track 9, Layer 2)
 *
 * Handles exporting reviews as JSON file download and importing
 * from JSON file or raw data.
 *
 * Depends on: store (Track 1) — toJSON(), fromJSON()
 * Registers: window.__domReview.exportImport
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  function getFilename() {
    const host = location.hostname.replace(/[^a-z0-9]/gi, '-');
    const date = new Date().toISOString().slice(0, 10);
    return `dom-review-${host}-${date}.json`;
  }

  function validate(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.reviews)) return false;
    return data.reviews.every(r =>
      r && typeof r.id === 'string' &&
      typeof r.selector === 'string' &&
      typeof r.comment === 'string'
    );
  }

  function exportJSON() {
    const { store } = window.__domReview;
    const data = store.toJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getFilename();
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          importFromData(data);
        } catch (e) {
          alert('Failed to parse JSON file: ' + e.message);
        }
      };
      reader.onerror = () => alert('Failed to read file.');
      reader.readAsText(file);
      // Cleanup
      document.body.removeChild(input);
    });

    document.body.appendChild(input);
    input.click();
  }

  function importFromData(data) {
    if (!validate(data)) {
      alert('Invalid review data format. Expected { version, reviews: [...] }');
      return;
    }
    const { store } = window.__domReview;
    store.fromJSON(data);
  }

  window.__domReview.exportImport = { exportJSON, importJSON, importFromData };
})();

;
/**
 * DOM Review — Agent API Handler (ISOLATED world)
 *
 * Listens for dr-api-request events from the MAIN world bridge,
 * executes operations on window.__domReview.store, and writes
 * responses back via DOM attributes.
 *
 * Depends on: store (Track 1), selectorGen (Track 2), contextCapture (Track 5)
 * Registers: window.__domReview.agentAPI
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  const REQUEST_ATTR = 'data-dr-api-request';
  const RESPONSE_ATTR = 'data-dr-api-response';
  const EVENT_NAME = window.__WR_API_EVENT || 'dr-api-request';

  const VALID_PRIORITIES = ['high', 'medium', 'low'];
  const VALID_CATEGORIES = ['style', 'logic', 'a11y', 'text', 'layout', 'remove', 'add'];

  function respond(requestId, success, data, error) {
    const response = { requestId, success };
    if (data !== undefined) response.data = data;
    if (error !== undefined) response.error = error;
    document.documentElement.setAttribute(RESPONSE_ATTR, JSON.stringify(response));
  }

  function handleRequest() {
    const raw = document.documentElement.getAttribute(REQUEST_ATTR);
    if (!raw) return;

    let request;
    try {
      request = JSON.parse(raw);
    } catch (e) {
      respond(null, false, undefined, 'Invalid request JSON');
      return;
    }

    const { requestId, method, params } = request;
    const { store } = window.__domReview;

    if (!store) {
      respond(requestId, false, undefined, 'Store not initialized');
      return;
    }

    try {
      switch (method) {
        case 'getReviews': {
          respond(requestId, true, store.toJSON());
          break;
        }

        case 'getReview': {
          if (!params.reviewId) {
            respond(requestId, false, undefined, 'reviewId is required');
            break;
          }
          const review = store.get(params.reviewId);
          if (!review) {
            respond(requestId, false, undefined, `Review ${params.reviewId} not found`);
          } else {
            respond(requestId, true, review);
          }
          break;
        }

        case 'addComment': {
          if (!params.selector || !params.comment) {
            respond(requestId, false, undefined, 'selector and comment are required');
            break;
          }
          const priority = VALID_PRIORITIES.includes(params.priority) ? params.priority : 'medium';
          const category = VALID_CATEGORIES.includes(params.category) ? params.category : 'style';
          const id = `r_${Date.now()}`;

          // Attempt to capture context if element exists
          let context = null;
          let xpath = '';
          try {
            const el = document.querySelector(params.selector);
            if (el) {
              if (window.__domReview.contextCapture) {
                context = window.__domReview.contextCapture.capture(el);
              }
              if (window.__domReview.selectorGen) {
                xpath = window.__domReview.selectorGen.generate(el).xpath;
              }
            }
          } catch { /* invalid selector or element not found */ }

          store.add({
            id,
            selector: params.selector,
            xpath,
            comment: params.comment,
            priority,
            category,
            resolved: false,
            created: new Date().toISOString(),
            updated: null,
            context,
            replies: [],
          });
          respond(requestId, true, { id });
          break;
        }

        case 'addReply': {
          if (!params.reviewId || !params.comment) {
            respond(requestId, false, undefined, 'reviewId and comment are required');
            break;
          }
          const review = store.get(params.reviewId);
          if (!review) {
            respond(requestId, false, undefined, `Review ${params.reviewId} not found`);
            break;
          }
          const replyId = `rp_${Date.now()}`;
          const replies = (review.replies || []).slice();
          replies.push({
            id: replyId,
            comment: params.comment,
            author: params.author || 'agent',
            created: new Date().toISOString(),
          });
          store.update(params.reviewId, { replies });
          respond(requestId, true, { reviewId: params.reviewId, replyId });
          break;
        }

        case 'resolveReview': {
          if (!params.reviewId) {
            respond(requestId, false, undefined, 'reviewId is required');
            break;
          }
          const result = store.resolve(params.reviewId);
          if (!result) {
            respond(requestId, false, undefined, `Review ${params.reviewId} not found`);
          } else {
            respond(requestId, true);
          }
          break;
        }

        case 'unresolveReview': {
          if (!params.reviewId) {
            respond(requestId, false, undefined, 'reviewId is required');
            break;
          }
          const result = store.unresolve(params.reviewId);
          if (!result) {
            respond(requestId, false, undefined, `Review ${params.reviewId} not found`);
          } else {
            respond(requestId, true);
          }
          break;
        }

        case 'updateComment': {
          if (!params.reviewId) {
            respond(requestId, false, undefined, 'reviewId is required');
            break;
          }
          const changes = {};
          if (params.comment !== undefined) changes.comment = params.comment;
          if (params.priority !== undefined && VALID_PRIORITIES.includes(params.priority)) {
            changes.priority = params.priority;
          }
          if (params.category !== undefined && VALID_CATEGORIES.includes(params.category)) {
            changes.category = params.category;
          }
          const updated = store.update(params.reviewId, changes);
          if (!updated) {
            respond(requestId, false, undefined, `Review ${params.reviewId} not found`);
          } else {
            respond(requestId, true);
          }
          break;
        }

        case 'deleteReview': {
          if (!params.reviewId) {
            respond(requestId, false, undefined, 'reviewId is required');
            break;
          }
          store.remove(params.reviewId);
          respond(requestId, true);
          break;
        }

        default:
          respond(requestId, false, undefined, `Unknown method: ${method}`);
      }
    } catch (e) {
      respond(requestId, false, undefined, `Internal error: ${e.message}`);
    }
  }

  document.addEventListener(EVENT_NAME, handleRequest);

  window.__domReview.agentAPI = { version: '1.0' };
  console.log('[DOM Review] Agent API handler registered');
})();

;
/**
 * Widget Review — Orchestrator
 *
 * Final assembly: wires all modules together.
 * Runs last in content_scripts injection order.
 */
(() => {
  'use strict';
  const { store, ui, selector, selectorGen, contextCapture,
          commentPanel, badges, sidebar, exportImport } = window.__domReview;

  // 0. Check if extension is enabled before initializing
  chrome.storage.sync.get('dr_enabled', (result) => {
    if (result.dr_enabled === false) {
      console.log('[Widget Review] Extension is disabled.');
      return;
    }
    bootstrap();
  });

  function bootstrap() {

  // 1. Load persisted reviews
  store.loadFromStorage();

  // 2. Init Shadow DOM UI (toolbar pill, comment card + reviews panel containers)
  ui.init();

  // 3. Render badges for restored reviews (with retries for SPA)
  badges.render();
  // SPA frameworks render async — retry at increasing intervals
  [500, 1000, 2000, 4000].forEach(ms => setTimeout(() => badges.render(), ms));

  // 4. Wire toolbar Select -> selector mode
  ui.onSelectClick(() => {
    sidebar.hide();
    commentPanel.hide();
    selector.toggle();
    ui.setSelectActive(selector.isActive());
  });

  // 5. Wire toolbar Reviews -> reviews panel
  ui.onReviewsClick(() => {
    commentPanel.hide();
    if (selector.isActive()) {
      selector.toggle();
      ui.setSelectActive(false);
    }
    sidebar.toggle();
  });

  // 6. Wire toolbar ⋯ menu Export/Import
  ui.onExportClick(() => exportImport.exportJSON());
  ui.onImportClick(() => exportImport.importJSON());

  // 7. Wire element selection -> comment card
  selector.onSelect((element) => {
    sidebar.hide();
    const selectorData = selectorGen.generate(element);
    const context = contextCapture.capture(element);
    commentPanel.show(element, selectorData, context);
    ui.setSelectActive(false);
  });

  // 8. Wire comment card save -> store
  commentPanel.onSave((formData) => {
    if (formData.isEdit) {
      store.update(formData.editId, {
        selector: formData.selector,
        xpath: formData.xpath,
        comment: formData.comment,
        category: formData.category,
        priority: formData.priority,
        context: formData.context,
      });
    } else {
      store.add({
        id: `r_${Date.now()}`,
        selector: formData.selector,
        xpath: formData.xpath,
        comment: formData.comment,
        priority: formData.priority,
        category: formData.category,
        resolved: false,
        created: new Date().toISOString(),
        updated: null,
        context: formData.context,
        replies: [],
      });
    }
  });

  // 9. Wire comment card cancel -> reset select button
  commentPanel.onCancel(() => {
    ui.setSelectActive(false);
  });

  // 10. React to store changes
  store.onChange((reviews) => {
    badges.render();
    sidebar.render();
    ui.updateBadgeCount(reviews.filter(r => !r.resolved).length);
  });

  // 11. Initial badge count
  ui.updateBadgeCount(store.getAll().filter(r => !r.resolved).length);

  // 12. Handle SPA navigation
  window.addEventListener('popstate', () => {
    badges.cleanup();
    store.loadFromStorage();
    badges.render();
    sidebar.render();
    ui.updateBadgeCount(store.getAll().filter(r => !r.resolved).length);
  });

  console.log('[Widget Review] Extension loaded. Reviews:', store.getAll().length);

  } // end bootstrap
})();


(function(){
  /* Ownership guard for the agent contract: if some other tool assigns a
     foreign bridge to window.__domReviewAPI (e.g. an old DOM Review
     extension co-residing on localhost), the setter silently ignores it.
     With no competitor installed this never fires. */
  var mine = window.__domReviewAPI;
  if (!mine || mine.__wrOwner !== window.__WR_API_EVENT) return;
  try {
    Object.defineProperty(window, '__domReviewAPI', {
      configurable: true,
      get: function() { return mine; },
      set: function() { /* foreign bridges cannot take the contract */ }
    });
  } catch (e) { /* keep the plain property; worst case a competitor wins */ }
})();


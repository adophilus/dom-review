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

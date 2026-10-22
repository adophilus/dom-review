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

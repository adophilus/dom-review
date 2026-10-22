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
        badgeEl.style.display = 'none';
        return;
      }
      const rect = target.getBoundingClientRect();
      // Position at top-right corner of element
      badgeEl.style.display = '';
      badgeEl.style.left = `${rect.right - 11}px`;
      badgeEl.style.top = `${rect.top - 11}px`;
    } catch {
      badgeEl.style.display = 'none';
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

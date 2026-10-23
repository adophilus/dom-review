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

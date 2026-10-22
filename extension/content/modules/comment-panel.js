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

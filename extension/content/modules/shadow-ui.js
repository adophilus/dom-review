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

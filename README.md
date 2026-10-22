# Widget Review (web)

A Chrome extension for visual code review on live web UIs — the web port of
[widget_review](https://github.com/emjaycodes/widget_review) (the Flutter/Dart
package), forked from [DOM-Review](https://github.com/AAnkacHH/DOM-Review).

Tap any element on your dev site, leave a comment with a category and priority,
and your AI agent reads it live and fixes it — same workflow, same agent API,
compact dark chrome that stays out of your way.

## Install

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select `extension/`
3. Disable the old DOM Review extension (this replaces it)
4. Open your dev site (`http://localhost` / `http://127.0.0.1` by default — add
   other origins from the popup)

**Migrating reviews:** reviews live in per-extension storage, so old reviews
don't carry over automatically. In old DOM Review: **Export** → in Widget
Review: **Reviews → ⋯ → Import**.

## Using it

- **Select** — hover to highlight, click to capture
- **Path bar** — the comment card shows the element chain
  (`… › Card › InkWell › [Button]`); click an ancestor to widen the selection,
  your draft survives
- **Comment card** — draggable by its grab handle, category + priority chips,
  Ctrl/⌘+Enter to save
- **Reviews** — filter Open/Resolved/All, sort, resolve, locate (scrolls +
  flashes the element), edit, delete, reply threads
- Numbered pins follow reviewed elements, colored by priority

## Agent API (unchanged from DOM Review)

The agent-facing contract is byte-compatible — existing dom-review skills and
MCP setups keep working:

- `<script id="dom-review-data" type="application/json">` in the page DOM
- `window.__domReviewAPI`: `getReviews`, `getReview`, `addComment`, `addReply`,
  `resolveReview`, `unresolveReview`, `updateComment`, `deleteReview`

## Fixes over DOM-Review

1. **Navigate up** — widen selection to any ancestor via the path bar
2. **Keyboard containment** — typing in review UI no longer leaks key events to
   the host app (closed shadow roots retarget bubbled keys to the host div, so
   apps with document/window-level shortcuts — e.g. a `d`-to-toggle-theme —
   would misfire; all key events now stop at the shadow root)

## Known limits

- Elements inside a page's own shadow roots can be highlighted, but the saved
  CSS selector can't re-resolve into another root (platform limit, same as
  DOM-Review).
- Host-page `document`-level keydown listeners registered in **capture** phase
  still see keystrokes before containment can stop them (physically
  unavoidable from inside a shadow root); normal bubble-phase shortcuts are
  fully contained.

## Demo / test target

`demo/index.html` — a deliberately busy admin dashboard (deep chains, dynamic
lists, tables, forms, contenteditable, its own `d`-toggles-theme shortcut, an
open-shadow-root corner case). Serve it and point the extension at it:

```
python3 -m http.server 8123 --bind 127.0.0.1 --directory demo
```

## Layout

```
extension/
  manifest.json          MV3, "Widget Review" 2.0.0
  content/               UI + plumbing (closed shadow DOM)
  background/            service worker (custom-site permissions)
  popup/                 enable toggle + custom site patterns
```

Design tokens ported from widget_review's `review_theme.dart` — always-dark
chrome (`#18181B` surfaces, `#4F8CFF` accent), never inherits the host page.

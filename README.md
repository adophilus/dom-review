# Widget Review (web)

A Chrome extension for visual code review on live web UIs — the web port of
[widget_review](https://github.com/emjaycodes/widget_review) (the Flutter/Dart
package), forked from [DOM-Review](https://github.com/AAnkacHH/DOM-Review).

Tap any element on your dev site, leave a comment with a category and priority,
and your AI agent reads it live and fixes it — same workflow, same agent API,
compact dark chrome that stays out of your way.

## Two ways to run it

**1. Chrome extension** — `chrome://extensions` → Developer mode → **Load
unpacked** → `extension/`. Disable the old DOM Review extension (this
replaces it). Reviews persist per-extension; old ones can be migrated via
Export → Import.

**2. Vite plugin (dev-only)** — injects the same review UI into any Vite dev
server, no extension needed. The UI modules are shared: one source
(`extension/content/modules`), two delivery paths.

```js
// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import domReview from './plugin/index.js'

export default defineConfig({ plugins: [react(), domReview()] })
```

`domReview({ enabled: false })` turns it off. Dev-only (`apply:
'serve'`) — like widget_review's `kDebugMode` on the Flutter side. Agent
contract (`window.__domReviewAPI`, `#dom-review-data`) identical, so the
same AI workflow applies.

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

`demo/` — a Vite + React port of a deliberately busy admin dashboard (deep
chains, dynamic lists, tables, forms, contenteditable, its own
`d`-toggles-theme shortcut, an open-shadow-root corner case):

```
cd demo && npm install && npm run dev   # http://localhost:5175
```

The dom-review plugin is wired into its `vite.config.js`, so the review
UI auto-injects on load.

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

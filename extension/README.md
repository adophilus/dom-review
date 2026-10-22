<p align="center">
  <img src="chrome-store-assets/store-icon-128.png" alt="DOM Review logo" width="128" height="128">
</p>

<h1 align="center">DOM Review</h1>

<p align="center"><strong>Visual code review for live UI — leave comments on DOM elements for AI agents.</strong></p>

DOM Review is a Chrome extension that bridges the gap between what you *see* in the browser and what your AI coding agent needs to *fix*. Select any element on your page, leave a comment describing what's wrong, and your AI agent reads the reviews directly from the browser via the [Chrome DevTools MCP server](https://github.com/anthropics/anthropic-quickstarts/tree/main/chrome-devtools-mcp) — no copy-pasting, no file juggling, no context lost.

Built for the **vibecoding workflow**: you look at your app, point at what's off, describe the fix in plain English, and the AI reads your reviews straight from Chrome and makes the changes.

![Chrome Web Store](https://img.shields.io/badge/Manifest-V3-blue)
![Version](https://img.shields.io/badge/version-1.1.0-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

---

## The Problem

When vibecoding frontend changes, the feedback loop looks like this:

1. You see something wrong in the browser
2. You switch to your editor / AI chat
3. You try to *describe* the element: "the button in the header... no, the second one... the one with the blue border..."
4. The AI guesses which element you mean
5. It changes the wrong thing
6. Repeat

**DOM Review eliminates steps 2-6.** You click the element, write your comment, and the AI agent reads the review data directly from the browser through MCP — complete with CSS selectors, computed styles, accessibility attributes, and React/Vue/Angular component names and props.

## How It Works

```text
  You (in browser)              AI Agent (via Chrome MCP)
  ┌──────────────────┐         ┌──────────────────────────┐
  │ 1. Click element │         │                          │
  │ 2. Write comment │  MCP    │ 3. Reads reviews from    │
  │    "make this    │ ◄─────► │    the live page via     │
  │     bolder"      │         │    Chrome DevTools MCP   │
  │                  │         │ 4. Gets full context:    │
  │                  │         │    selector, styles,     │
  │                  │         │    component, props      │
  │                  │         │ 5. Edits the code        │
  └──────────────────┘         └──────────────────────────┘
```

The key: reviews live inside the page DOM. Any tool with access to Chrome DevTools MCP can read them — Claude Code, Cursor, Windsurf, or any IDE with MCP support.

## MCP Integration (Primary Workflow)

DOM Review is designed to work with the **Chrome DevTools MCP server**, which gives AI coding agents direct access to your browser. The reviews are stored in the page DOM as a hidden `<script id="dom-review-data">` element with structured JSON, so the AI agent can read them without any manual export step.

### Setup

1. **Install DOM Review** (see [Installation](#installation) below)
2. **Set up Chrome DevTools MCP** in your IDE:

   **Claude Code** (`~/.claude/settings.json`):

   ```json
   {
     "mcpServers": {
       "chrome-devtools": {
         "command": "npx",
         "args": ["@anthropic-ai/chrome-devtools-mcp@latest"]
       }
     }
   }
   ```

   **Cursor** (`.cursor/mcp.json`):

   ```json
   {
     "mcpServers": {
       "chrome-devtools": {
         "command": "npx",
         "args": ["@anthropic-ai/chrome-devtools-mcp@latest"]
       }
     }
   }
   ```

3. **Open your localhost app** in Chrome
4. **Leave reviews** using DOM Review
5. **Tell your AI agent** to read and fix the reviews:

   ```
   Look at the current page in Chrome via MCP. There are DOM Review
   comments on elements that need changes. Read the review data from
   the page, then fix each unresolved issue. Use the CSS selectors
   and component context to find the right files to edit.
   ```

### What the AI Agent Sees

Through MCP, the agent can access the page snapshot and evaluate JavaScript to read review data directly:

```javascript
// The agent can run this via Chrome MCP to get all reviews
JSON.parse(document.getElementById('dom-review-data')?.textContent || '[]')
```

Each review contains:

```json
{
  "id": "r_1708888800000",
  "selector": "#app > div.container > button.submit-btn",
  "xpath": "/html/body/div[1]/div[2]/button[1]",
  "comment": "Make the font size 16px and add more padding",
  "category": "style",
  "priority": "high",
  "resolved": false,
  "created": "2025-02-22T10:00:00.000Z",
  "context": {
    "tagName": "button",
    "text": "Submit",
    "boundingBox": { "x": 340, "y": 520, "w": 120, "h": 40 },
    "styles": {
      "color": "rgb(255, 255, 255)",
      "fontSize": "14px",
      "padding": "8px 12px",
      "display": "inline-flex"
    },
    "a11y": {
      "role": "button",
      "label": "Submit form",
      "tabIndex": 0
    },
    "framework": {
      "framework": "react",
      "componentName": "SubmitButton",
      "filePath": "src/components/SubmitButton.tsx",
      "props": { "variant": "primary", "disabled": false }
    }
  }
}
```

The AI gets everything it needs in one shot: which element, what's wrong, what the element looks like, what component it belongs to, and where the source file is.

The JSON also includes an `api` block that tells the agent how to use `window.__domReviewAPI` for adding replies, resolving reviews, and more. See [Agent API](#agent-api) for details.

## Agent API

DOM Review exposes a programmatic API on the page at `window.__domReviewAPI`. AI agents using Chrome DevTools MCP can call it via `evaluate_script` to add comments, reply to reviews, and resolve/unresolve — no DOM hacking required.

The API is self-documented: the `#dom-review-data` JSON block includes an `api` field describing all available methods, so agents discover it automatically when reading review data.

### Available Methods

All methods are **synchronous** and return `{ success: true, data? }` or `{ success: false, error }`.

| Method | Arguments | Description |
| --- | --- | --- |
| `getReviews()` | — | Get all reviews for the current page |
| `getReview(reviewId)` | `string` | Get a single review by ID |
| `addComment({...})` | `{ selector, comment, priority?, category? }` | Add a new review on a DOM element |
| `addReply({...})` | `{ reviewId, comment, author? }` | Add a reply to an existing review |
| `resolveReview(reviewId)` | `string` | Mark a review as resolved |
| `unresolveReview(reviewId)` | `string` | Reopen a resolved review |
| `updateComment({...})` | `{ reviewId, comment?, priority?, category? }` | Update review text or metadata |
| `deleteReview(reviewId)` | `string` | Delete a review |

### Example: Agent Workflow

```javascript
// Read all reviews
const reviews = window.__domReviewAPI.getReviews();

// Add a new comment on an element
window.__domReviewAPI.addComment({
  selector: 'button.submit-btn',
  comment: 'Missing aria-label for screen readers',
  priority: 'high',
  category: 'a11y'
});

// Reply to a review after fixing it
window.__domReviewAPI.addReply({
  reviewId: 'r_1708888800000',
  comment: 'Fixed. Added aria-label="Submit form" in SubmitButton.tsx',
  author: 'claude-code'
});

// Resolve the review
window.__domReviewAPI.resolveReview('r_1708888800000');
```

### How It Works Under the Hood

The API uses a **two-part bridge** to cross Chrome's world boundary:

- `agent-api-bridge.js` runs in the **MAIN world** (page context) — this is what `evaluate_script` can access
- `agent-api-handler.js` runs in the **ISOLATED world** (extension sandbox) — this has access to the real review store

Communication happens via synchronous DOM events and attributes (same pattern as the framework detection bridge), so all API calls return results immediately.

## Features

### Element Selection

Click any element on the page. DOM Review captures:

- **CSS selector** (smart generation that avoids utility classes like Tailwind/Bootstrap)
- **XPath** as fallback
- **Computed styles** — colors, fonts, display, position, dimensions
- **Accessibility attributes** — ARIA roles, labels, tab index
- **Framework component info** — name, file path, props, state

### Review Categories

Categorize each comment so AI agents can prioritize and batch fixes:

| Category | Use case                          |
| -------- | --------------------------------- |
| `style`  | CSS / visual changes              |
| `layout` | Spacing, alignment, responsive    |
| `text`   | Copy, labels, placeholder text    |
| `a11y`   | Accessibility improvements        |
| `logic`  | Behavioral bugs, interactions     |
| `add`    | Missing elements or features      |
| `remove` | Elements that shouldn't be there  |

Each review also has a **priority** level: `high`, `medium`, or `low`.

### Framework Detection

Automatically detects and extracts component-level data from:

- **React** — component name, props, memoized state (via Fiber internals)
- **Vue 3** — component name, props, setup state
- **Vue 2** — component name, props, data
- **Angular** — component class, properties

This means your AI agent gets context like *"this is the `<ProductCard>` component at `src/components/ProductCard.tsx`, with prop `variant="outlined"`"* — not just a raw CSS selector.

### Visual Badges

Numbered badges appear on reviewed elements, color-coded by priority:

- Red — high priority
- Amber — medium priority
- Gray — low priority
- Green — resolved

Badges track element position on scroll and resize.

### Sidebar Panel

Manage all reviews in a slide-out sidebar:

- Filter by status: All / Open / Resolved
- Sort by date, priority, or category
- Click "Locate" to scroll to and highlight the element
- Edit, resolve, reopen, or delete reviews
- Collapsible context details for each review

### Export / Import (Alternative Workflow)

If you're not using MCP, you can still export/import reviews as JSON files:

- **Export** reviews as a structured JSON file (`dom-review-{hostname}-{date}.json`)
- **Import** previous review sessions to continue where you left off
- Feed the JSON file directly to any AI chat as an attachment

### AI Prompt Templates

The popup includes ready-made prompts you can copy:

- **Fix All Issues** — instructs AI to address all unresolved reviews by priority
- **Style Review** — focused pass on CSS/visual issues with captured context
- **Accessibility Audit** — WCAG-compliance check using captured a11y data

## Installation

### From Source (Developer Mode)

1. Clone the repository:

   ```bash
   git clone https://github.com/AAnkacHH/web-review-extention.git
   cd web-review-extention
   ```

2. Open Chrome and go to `chrome://extensions/`

3. Enable **Developer mode** (toggle in top-right)

4. Click **Load unpacked** and select the project folder

5. The DOM Review icon appears in your toolbar. Navigate to any `localhost` page to start reviewing. To use on other dev sites, see [Custom Domains](#custom-domains).

### Permissions

| Permission                  | Why                              |
| --------------------------- | -------------------------------- |
| `activeTab`                 | Access the current tab's DOM     |
| `storage`                   | Persist reviews and settings     |
| `scripting`                 | Inject content scripts dynamically |
| `localhost` / `127.0.0.1`   | Default dev server origins       |
| `http://*/*` (optional)     | User-added custom dev sites      |

> By default the extension only runs on localhost. Custom sites require explicit user approval via Chrome's permission prompt.

## Usage

### Quick Start (with MCP)

1. Open your local dev server in Chrome (`http://localhost:...`)
2. Click the DOM Review icon or use the floating toolbar (bottom-right corner)
3. Click **Select** to enter selection mode (crosshair cursor)
4. Click any element on the page
5. A comment panel appears — write your feedback, pick a category and priority
6. Click **Save**
7. Repeat for all the changes you want
8. Switch to your IDE and tell the AI agent:

   ```text
   Check the current page in Chrome via MCP. Read the DOM Review
   data and fix all unresolved issues, starting with high priority.
   ```

The AI agent reads the reviews directly from the live page — no export needed.

### Quick Start (without MCP)

If your IDE doesn't support MCP yet, use the export workflow:

1. Follow steps 1-7 above
2. Click **Export** to download the review JSON
3. Attach the JSON to your AI chat with a prompt like:

   ```text
   Here is a DOM review export for my app. Fix all unresolved issues.
   Follow the CSS selectors to find each element. Use the captured
   context (styles, component names, props) to make accurate changes.
   ```

## Privacy Policy

DOM Review does not collect, store, or transmit any personal data. All data remains in your browser's localStorage.

## Architecture

```text
manifest.json
├── popup/                  # Browser action popup (review count, prompt templates)
├── background/             # Service worker (message relay)
├── content/                # Injected into the page
│   ├── content-script.js   # Orchestrator — wires all modules together
│   ├── content-style.css   # Host page styles (hover outlines)
│   └── modules/
│       ├── review-store.js         # Central CRUD store + persistence
│       ├── selector-generator.js   # CSS selector & XPath generation
│       ├── framework-detector.js   # Isolated↔Main world bridge
│       ├── framework-bridge.js     # MAIN world framework detection
│       ├── agent-api-bridge.js     # MAIN world agent API (window.__domReviewAPI)
│       ├── agent-api-handler.js    # ISOLATED world API request handler
│       ├── context-capture.js      # Element context extraction
│       ├── shadow-ui.js            # Shadow DOM UI host
│       ├── comment-panel.js        # Comment form
│       ├── badges.js               # Visual markers on elements
│       ├── sidebar.js              # Review list panel
│       ├── selector-mode.js        # Click-to-select mode
│       └── export-import.js        # JSON export/import
└── icons/                  # Extension icons
```

**Key design decisions:**

- **DOM-embedded review data** — reviews are stored as a hidden `<script>` tag in the page DOM, making them accessible to any MCP-connected AI agent
- **Shadow DOM isolation** — all extension UI lives inside a closed Shadow DOM so it never conflicts with the page's styles or scripts
- **Modular IIFE architecture** — each module is self-contained and communicates through a shared `window.__domReview` namespace
- **Dual-world injection** — framework detection runs in the MAIN world (access to page JS context) while everything else runs in the ISOLATED world (Chrome extension sandbox)
- **No build step** — vanilla JS, no bundler, no dependencies. Load and go
- **No external network requests** — everything stays local

## Claude Code Integration

To make Claude Code automatically understand DOM Review without any discovery step, add the workflow instructions to your setup.

### Option A: Per-Project (CLAUDE.md)

Copy the template into your project root:

```bash
cp path/to/dom-review-extension/docs/CLAUDE.md ./CLAUDE.md
# or append to existing CLAUDE.md
cat path/to/dom-review-extension/docs/CLAUDE.md >> ./CLAUDE.md
```

### Option B: Global (all projects)

Add to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__chrome-devtools__evaluate_script",
      "mcp__chrome-devtools__take_snapshot",
      "mcp__chrome-devtools__take_screenshot",
      "mcp__chrome-devtools__navigate_page",
      "mcp__chrome-devtools__click",
      "mcp__chrome-devtools__list_pages",
      "mcp__chrome-devtools__select_page"
    ]
  },
  "userInstructions": "This project uses the DOM Review Chrome extension with Chrome DevTools MCP server (chrome-devtools). To read reviews: use mcp__chrome-devtools__evaluate_script with function `() => JSON.parse(document.getElementById('dom-review-data')?.textContent || '{\"reviews\":[]}')`. To interact programmatically, use mcp__chrome-devtools__evaluate_script to call window.__domReviewAPI methods — getReviews(), getReview(id), addComment({selector, comment, priority?, category?}), addReply({reviewId, comment, author?}), resolveReview(id), unresolveReview(id), updateComment({reviewId, comment?, priority?, category?}), deleteReview(id). All methods are synchronous, return {success, data?, error?}. evaluate_script requires arrow function syntax: () => window.__domReviewAPI.methodName(...). After fixing a review, call addReply with a summary of changes, then resolveReview to mark it done."
}
```

### Usage

Once configured, just tell Claude Code:

```
Check the page in Chrome for DOM Review comments and fix them.
```

Claude Code will read the reviews, fix the code, reply with what was changed, and resolve each review — no manual steps needed.

## Custom Domains

By default DOM Review runs on `http://localhost/*` and `http://127.0.0.1/*`. You can add custom dev sites (LAN IPs, local domains, remote dev servers) from the popup.

### Adding a Site

1. Click the DOM Review icon to open the popup
2. Scroll to **Allowed Sites** at the bottom
3. Type a host in the input field and click **Add** (or press Enter)
4. Chrome will show a permission prompt — click **Allow**
5. Reload any open tabs on that site

The input accepts flexible formats:

| You type | Saved as |
| --- | --- |
| `192.168.1.50:3000` | `http://192.168.1.50:3000/*` |
| `http://myapp.local:5173/` | `http://myapp.local:5173/*` |
| `http://dev.example.com/*` | `http://dev.example.com/*` |

### Removing a Site

Click the **×** button next to the custom pattern in the Allowed Sites list. The host permission is automatically revoked.

### Enable / Disable

The toggle switch in the popup header enables or disables the extension globally. When disabled, the toolbar and all UI are hidden. Existing tabs need a reload to reflect the change.

### Notes

- Only HTTP origins are supported (this is a dev tool — HTTPS is not needed)
- Default patterns (localhost, 127.0.0.1) cannot be removed
- Each custom site triggers a separate Chrome permission prompt for transparency
- Custom patterns are synced across devices via `chrome.storage.sync`

## Vibecoding Workflow Tips

**Let the AI read the page directly.** With MCP, you don't need to describe anything — the agent can see the page, read the reviews, and see the element context all at once.

**Batch your reviews.** Do a full visual pass of the page, mark everything that needs fixing, then tell the AI to fix it all. This gives the agent a complete picture and lets it batch related changes.

**Use categories consistently.** If you tag layout issues as `layout` and style issues as `style`, you can tell the AI to "fix all layout issues first" for a more focused pass.

**Include the component context.** When working with React/Vue/Angular, the detected framework data tells the AI exactly which component file to edit — no guessing.

**Use priority to control order.** Mark critical visual bugs as `high` and polish items as `low`. Tell the AI to address high-priority items first so you can review the important fixes before moving on.

**Iterate with resolve.** After the AI makes changes, refresh the page, check the results, mark fixed items as resolved, and add new comments for anything that still needs work.

## Supported Environments

- **Browser:** Chrome (Manifest V3)
- **Pages:** `http://localhost/*` and `http://127.0.0.1/*` by default, plus any user-added custom dev sites
- **MCP Clients:** Claude Code, Cursor, Windsurf, and any IDE with MCP support
- **Frameworks:** React, Vue 2, Vue 3, Angular (auto-detected)
- **CSS Libraries:** Tailwind, Bootstrap (utility classes filtered from selectors)

## Contributing

Contributions are welcome. Some areas that could use help:

- [ ] Support for more frameworks (Svelte, SolidJS, Astro)
- [ ] Firefox / Safari ports
- [ ] Screenshot capture attached to reviews
- [ ] Multi-page review sessions
- [ ] Team collaboration (shared review files)
- [x] Custom domain support (LAN IPs, local domains)
- [x] Global enable/disable toggle
- [ ] Dark/light theme toggle

## License

MIT

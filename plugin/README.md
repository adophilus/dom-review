# vite-plugin-dom-review

Auto-injects the Widget Review dev UI into a Vite dev server — select any
element, leave a comment with category + priority, and your AI agent reads it
live via `window.__domReviewAPI` / `#dom-review-data`.

Usage — in `vite.config.js`, add it to `plugins` after your framework plugin:

```js
import domReview from '../plugin/index.js'

export default defineConfig({ plugins: [react(), domReview()] })
```

Options: `{ enabled: false }` turns injection off. It takes any expression, so
it composes with environments:

```js
domReview({ enabled: process.env.ENABLE_REVIEW === '1' })  // opt-in via env
domReview({ enabled: mode === 'development' })             // defineConfig(({ mode }) => ...)
```

Dev-only (`apply: 'serve'`) — it never ships in `vite build`, mirroring
widget_review's debug-build default. Shares its UI modules one-to-one with
`extension/content/modules`, so fixes land in both delivery paths.

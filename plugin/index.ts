/**
 * dom-review — visual code review for live web UIs, readable by AI agents.
 *
 * This entrypoint re-exports the Vite plugin. The widget it injects lets a
 * human annotate any element on a dev page (comment, category, priority),
 * while the agent reads and resolves those reviews live through
 * `window.__domReviewAPI` and the `#dom-review-data` element.
 *
 * ```ts
 * // vite.config.ts
 * import domReview from "@adophilus/dom-review/plugin/vite";
 *
 * export default defineConfig({ plugins: [domReview()] });
 * ```
 *
 * @module
 */

export { default } from "./vite.ts";

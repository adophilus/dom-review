/**
 * Vite plugin — import via `@adophilus/dom-review/plugin/vite`.
 *
 * Auto-injects the Widget Review dev UI (the visual code-review chrome from
 * extension/) into a Vite dev server. Dev-only (`apply: 'serve'`) — the
 * review tool belongs to development, mirroring widget_review's
 * kDebugMode default on the Flutter side.
 *
 * Works with SPA/MPA servers (transformIndexHtml) and SSR routers
 * (TanStack Start, Next-style) via a dev-server middleware fallback.
 *
 * The UI modules are vanilla-JS IIFEs sharing the window.__domReview
 * namespace. Bundle assembly lives in bundle.js:
 *   - monorepo dev: concat live from extension/content/modules
 *   - published:    prebuilt dist/ (written by build.mjs)
 * The bundle is prefixed with a tiny `chrome.storage`/`chrome.runtime` shim
 * backed by localStorage, since the UI was written for an extension world.
 *
 * ```ts
 * // vite.config.ts
 * import domReview from "@adophilus/dom-review/plugin/vite";
 *
 * export default defineConfig({
 *   plugins: [domReview()], // dev-only; `false` turns it off
 * });
 * ```
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { liveBundle, liveHoverCss } from "./bundle.js";

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(PLUGIN_DIR, "dist");

/** Options for {@linkcode domReview}. */
export interface DomReviewOptions {
	/** Turn injection off (default: on inside the Vite dev server). */
	enabled?: boolean;
}

/** A minimal structural view of a dev-only Vite plugin — everything this
 *  plugin returns, typed without pulling `vite` in as a dependency. */
export interface DomReviewPlugin {
	name: string;
	apply: "serve";
	/** Vite SPA/MPA path: transform served HTML files. */
	transformIndexHtml(): {
		tag: string;
		attrs?: Record<string, string>;
		children?: string;
		injectTo?: "head" | "body" | "prepend" | "append";
	}[];
	/** Dev-server hook: serves the widget bundle and injects into SSR HTML. */
	configureServer(server: {
		middlewares: {
			use: (
				route: string,
				fn: (
					req: unknown,
					res: unknown,
					next: () => void,
				) => void,
			) => void;
		};
	}): void;
}

/** One tag transformIndexHtml should inject into served HTML. */
interface HtmlTagInjection {
	tag: string;
	attrs?: Record<string, string>;
	children?: string;
	injectTo?: "head" | "body" | "prepend" | "append";
}

// Prefer the prebuilt dist/ bundle (published package is self-contained);
// fall back to live concatenation from extension/ (monorepo dev mode).
function getBundle(): string {
	const dist = path.join(DIST_DIR, "ui-bundle.js");
	if (existsSync(dist)) return readFileSync(dist, "utf8");
	return liveBundle();
}

function getHoverCss(): string {
	const dist = path.join(DIST_DIR, "hover.css");
	if (existsSync(dist)) return readFileSync(dist, "utf8");
	return liveHoverCss();
}

/** The tags transformIndexHtml would inject, as one HTML string. Shared by
 *  the SPA path (transformIndexHtml) and the SSR fallback below. */
function injectionTags(): string {
	return `<style>${getHoverCss()}</style><script src="/@dom-review/review.js" defer></script>`;
}

/** Whatever writeHead accepted for headers — object or tuple array. */
type RawHeaders = Record<string, string | number | string[]> | string[][];

function headerValue(headers: RawHeaders | undefined, name: string): unknown {
	if (!headers) return undefined;
	const key = name.toLowerCase();
	if (Array.isArray(headers)) {
		const hit = headers.find(([k]) => k.toLowerCase() === key);
		return hit && hit[1];
	}
	const hit = Object.entries(headers).find(([k]) => k.toLowerCase() === key);
	return hit && hit[1];
}

/** Headers minus content-length — the injected body changes it, and after
 *  writeHead it can no longer be legally amended (chunked encoding fills in). */
function withoutContentLength(headers: RawHeaders): RawHeaders {
	if (Array.isArray(headers))
		return headers.filter(([k]) => k.toLowerCase() !== "content-length");
	const copy = { ...headers };
	for (const k of Object.keys(copy))
		if (k.toLowerCase() === "content-length") delete copy[k];
	return copy;
}

/** Minimal structural types for the dev-server response surface the SSR
 *  fallback touches — enough to stay honest without @types/node express-isms. */
interface InjectServer {
	middlewares: {
		use(route: string, fn: (req: unknown, res: unknown, next: () => void) => void): void;
	};
}

interface InjectResponse {
	getHeader(name: string): unknown;
	setHeader(name: string, value: string): void;
	removeHeader(name: string): void;
	writeHead(status: number, headers?: RawHeaders): unknown;
	write(chunk: unknown, ...args: unknown[]): unknown;
	end(chunk?: unknown, ...args: unknown[]): unknown;
}

/** Inject the review widget into SSR-rendered HTML responses: buffer
 *  text/html bodies, drop content-length at writeHead, and splice the tags
 *  in before `</head>` at end(). */
function injectIntoSsrResponses(res: InjectResponse, tags: string): void {
	const origWrite = res.write.bind(res);
	const origEnd = res.end.bind(res);
	const chunks: Buffer[] = [];
	let buffering = false;

	const isHtml = (): boolean =>
		String(res.getHeader("content-type") || "").includes("text/html");

	// Content-type usually arrives here — the one moment content-length can
	// still be legally dropped.
	const origWriteHead = res.writeHead.bind(res);
	res.writeHead = function writeHead(
		status: number,
		headers?: RawHeaders,
		...rest: unknown[]
	) {
		const type = String(
			headerValue(headers, "content-type") ??
				res.getHeader("content-type") ??
				"",
		);
		if (type.includes("text/html")) {
			buffering = true;
			headers = withoutContentLength(headers as RawHeaders);
		}
		return origWriteHead(status, headers as RawHeaders, ...rest);
	};

	res.write = function write(chunk: unknown, ...args: unknown[]) {
		if (!buffering && isHtml()) buffering = true;
		if (!buffering) return origWrite(chunk, ...args);
		if (chunk != null)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		return true;
	};

	res.end = function end(chunk?: unknown, ...args: unknown[]) {
		if (!buffering && isHtml()) buffering = true;
		if (!buffering) return origEnd(chunk, ...args);
		if (chunk != null)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

		let html = Buffer.concat(chunks).toString("utf8");
		// transformIndexHtml already ran for this response (Vite SPA
		// fallback) — don't double-inject.
		if (html.includes("</head>") && !html.includes("/@dom-review/review.js")) {
			html = html.replace("</head>", `${tags}</head>`);
			if (!res.headersSent) {
				res.removeHeader("content-length");
				res.setHeader("Content-Length", String(Buffer.byteLength(html)));
			}
		}
		return origEnd(html, ...args);
	};
}

/**
 * Create the dom-review Vite plugin.
 *
 * Injects the review widget into every page the dev server serves, and
 * serves the widget bundle itself at `/@dom-review/review.js`. Reviews are
 * exposed to agents via `window.__domReviewAPI` and the
 * `#dom-review-data` element.
 *
 * @param options - Set {@linkcode DomReviewOptions.enabled | enabled} to
 *   `false` to turn injection off (e.g. gated on an env var).
 * @returns The Vite plugin — spread into `plugins` after your framework
 *   plugin.
 *
 * @example
 * ```ts
 * import domReview from "@adophilus/dom-review/plugin/vite";
 *
 * export default defineConfig({
 *   plugins: [domReview({ enabled: process.env.ENABLE_REVIEW === "1" })],
 * });
 * ```
 */
export default function domReview(options: DomReviewOptions = {}): DomReviewPlugin {
	const enabled = options.enabled !== false;
	return {
		name: "vite-plugin-dom-review",
		apply: "serve",
		transformIndexHtml(): HtmlTagInjection[] {
			if (!enabled) return [];
			return [
				{ tag: "style", children: getHoverCss(), injectTo: "head" },
				{
					tag: "script",
					attrs: { src: "/@dom-review/review.js" },
					injectTo: "body",
				},
			];
		},
		configureServer(server: InjectServer): void {
			if (!enabled) return;
			server.middlewares.use("/@dom-review/review.js", (req, res) => {
				const r = res as InjectResponse;
				r.setHeader("Content-Type", "text/javascript; charset=utf-8");
				r.setHeader("Cache-Control", "no-cache");
				r.end(getBundle());
			});

			// SSR dev servers render HTML through their own pipeline and never
			// hit transformIndexHtml — see injectIntoSsrResponses.
			server.middlewares.use((req, res, next) => {
				const method = (req as { method?: string }).method;
				if (method !== "GET" && method !== "HEAD") return next();
				injectIntoSsrResponses(res as InjectResponse, injectionTags());
				next();
			});
		},
	};
}

/**
 * Vite plugin — import via `@adophilus/dom-review/plugin/vite`.
 *
 * Auto-injects the Widget Review dev UI (the visual code-review chrome from
 * extension/) into a Vite dev server. Dev-only (`apply: 'serve'`) — the
 * review tool belongs to development, mirroring widget_review's
 * kDebugMode default on the Flutter side.
 *
 * The UI modules are vanilla-JS IIFEs sharing the window.__domReview
 * namespace. Bundle assembly lives in bundle.js:
 *   - monorepo dev: concat live from extension/content/modules
 *   - published:    prebuilt dist/ (written by build.mjs)
 * The bundle is prefixed with a tiny `chrome.storage`/`chrome.runtime` shim
 * backed by localStorage, since the UI was written for an extension world.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveBundle, liveHoverCss } from './bundle.js';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(PLUGIN_DIR, 'dist');

// Prefer the prebuilt dist/ bundle (published package is self-contained);
// fall back to live concatenation from extension/ (monorepo dev mode).
function getBundle() {
  const dist = path.join(DIST_DIR, 'ui-bundle.js');
  if (existsSync(dist)) return readFileSync(dist, 'utf8');
  return liveBundle();
}

function getHoverCss() {
  const dist = path.join(DIST_DIR, 'hover.css');
  if (existsSync(dist)) return readFileSync(dist, 'utf8');
  return liveHoverCss();
}

/** The tags transformIndexHtml would inject, as one HTML string. Shared by
 *  the SPA path (transformIndexHtml) and the SSR fallback below. */
function injectionTags() {
  return `<style>${getHoverCss()}</style><script src="/@dom-review/review.js" defer></script>`;
}

/** Type of a writeHead headers argument, whatever shape it came in. */
function headerValue(headers, name) {
  if (!headers) return undefined;
  if (Array.isArray(headers)) {
    const hit = headers.find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    return hit && hit[1];
  }
  const hit = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return hit && hit[1];
}

/** Headers minus content-length — the injected body changes it, and after
 *  writeHead it can no longer be amended (chunked encoding fills in). */
function withoutContentLength(headers) {
  if (!headers) return headers;
  if (Array.isArray(headers))
    return headers.filter(
      ([key]) => key.toLowerCase() !== 'content-length',
    );
  const copy = { ...headers };
  for (const key of Object.keys(copy))
    if (key.toLowerCase() === 'content-length') delete copy[key];
  return copy;
}

export default function domReview(options = {}) {
  const enabled = options.enabled !== false;
  return {
    name: 'vite-plugin-dom-review',
    apply: 'serve',
    transformIndexHtml() {
      if (!enabled) return [];
      return [
        { tag: 'style', children: getHoverCss(), injectTo: 'head' },
        { tag: 'script', attrs: { src: '/@dom-review/review.js' }, injectTo: 'body' },
      ];
    },
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use('/@dom-review/review.js', (req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(getBundle());
      });

      // SSR dev servers (TanStack Start, Next-style routers, …) render HTML
      // through their own pipeline and never hit transformIndexHtml — inject
      // into text/html responses here instead. Buffer-then-flush at end():
      // dev HTML is small and local, so holding one response is fine.
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);
        const chunks = [];
        let buffering = false;

        const isHtml = () =>
          String(res.getHeader('content-type') || '').includes('text/html');

        // Content-type usually arrives here — the one moment content-length
        // can still be legally dropped.
        const origWriteHead = res.writeHead.bind(res);
        res.writeHead = function writeHead(status, headers, ...rest) {
          const type = String(
            headerValue(headers, 'content-type') ??
              res.getHeader('content-type') ??
              '',
          );
          if (type.includes('text/html')) {
            buffering = true;
            headers = withoutContentLength(headers);
          }
          return origWriteHead(status, headers, ...rest);
        };

        res.write = function write(chunk, ...args) {
          if (!buffering && isHtml()) buffering = true;
          if (!buffering) return origWrite(chunk, ...args);
          if (chunk != null)
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return true;
        };

        res.end = function end(chunk, ...args) {
          if (!buffering && isHtml()) buffering = true;
          if (!buffering) return origEnd(chunk, ...args);
          if (chunk != null)
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

          let html = Buffer.concat(chunks).toString('utf8');
          // transformIndexHtml already ran for this response (Vite SPA
          // fallback) — don't double-inject.
          if (html.includes('</head>') && !html.includes('/@dom-review/review.js')) {
            html = html.replace('</head>', `${injectionTags()}</head>`);
            if (!res.headersSent) {
              res.removeHeader('content-length');
              res.setHeader('Content-Length', String(Buffer.byteLength(html)));
            }
          }
          return origEnd(html, ...args);
        };

        next();
      });
    },
  };
}

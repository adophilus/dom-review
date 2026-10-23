export interface DomReviewOptions {
  /** Turn injection off (default: on inside the Vite dev server). */
  enabled?: boolean;
}

export interface DomReviewPlugin {
  name: string;
  apply: 'serve';
  transformIndexHtml(): {
    tag: string;
    attrs?: Record<string, string>;
    children?: string;
    injectTo?: 'head' | 'body' | 'prepend' | 'append';
  }[];
  configureServer(server: unknown): void;
}

export default function domReview(options?: DomReviewOptions): DomReviewPlugin;

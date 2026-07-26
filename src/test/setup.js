/**
 * Vitest global setup — runs before every test file (wired via `test.setupFiles`
 * in vite.config.js).
 *
 * Two responsibilities only:
 *   1. Register the jest-dom matchers (`toBeInTheDocument`, `toHaveAttribute`, …)
 *      so screen tests can assert on the rendered DOM.
 *   2. Unmount every React tree between tests. Without this, components mounted
 *      by one test stay in `document.body` and the next `screen.getBy*` query
 *      matches a stale tree.
 *
 * Deliberately does NOT register any module mock: pure-function tests (the vast
 * majority of this suite) must keep running against real modules.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// recharts' <ResponsiveContainer> observes its parent and throws without this —
// jsdom ships no ResizeObserver. The stub never fires a callback, so a chart
// mounts at zero size and renders no SVG; that is fine, because what these
// tests prove is that the JSX and data transforms AROUND the chart don't throw.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
});

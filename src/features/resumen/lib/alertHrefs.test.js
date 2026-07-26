/**
 * Guards the alert -> route contract.
 *
 * Every alert rendered by the Resumen panel links somewhere. When a route is
 * retired, nothing in the type system or the build notices that an alert still
 * points at it — the link just dead-ends at the catch-all redirect. This test
 * reads the declared routes straight out of App.jsx so removing a route breaks
 * here instead of in front of the user.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALERT_HREFS } from './alertsPanel.js';

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(here, '../../../App.jsx'), 'utf8');

const declaredRoutes = new Set(
  Array.from(appSource.matchAll(/path="([^"]+)"/g), (match) => match[1]),
);

describe('resumen alert links', () => {
  it('exposes at least one destination', () => {
    expect(ALERT_HREFS.length).toBeGreaterThan(0);
  });

  it('points every alert at a route App.jsx actually declares', () => {
    const dangling = ALERT_HREFS.filter((href) => !declaredRoutes.has(href));
    expect(dangling).toEqual([]);
  });

  it('uses absolute paths so the link resolves from any view', () => {
    for (const href of ALERT_HREFS) {
      expect(href.startsWith('/')).toBe(true);
    }
  });
});

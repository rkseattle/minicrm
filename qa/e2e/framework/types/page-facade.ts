/**
 * PageFacade — a unified page object combining SafePage navigation methods
 * with all HealMethods element interactions. testName is baked in at fixture
 * creation so callers never thread it manually.
 *
 * The Proxy intercepts `context` to return a SafeContext rather than the raw
 * BrowserContext, blocking newPage() and newCDPSession() at runtime in addition
 * to the compile-time restriction in SafePage.
 */

import type { Page } from '@playwright/test';
import type { SafePage } from './safe-page.js';
import type { SafeContext } from './safe-context.js';
import type { HealMethods } from '../fixtures/heal-methods.js';
import { buildHealPage } from '../fixtures/heal-methods.js';

export type PageFacade = SafePage & HealMethods;

export function createPageFacade(
  page: Page,
  testName: string,
  pageObjectPathSegments: string[] = [],
): PageFacade {
  // Pass createPageFacade itself as the tabFactory so newTab() can wrap new
  // tabs. This avoids a circular import: heal-methods.ts never imports from
  // page-facade.ts, but we inject the factory here at construction time.
  const healPage = buildHealPage(page, testName, createPageFacade, pageObjectPathSegments);

  // Safe cast: the Proxy routes HealMethods property accesses to healPage and
  // all other accesses to the raw Page. Methods absent from the PageFacade type
  // remain inaccessible at compile time even though the underlying Page has them.
  return new Proxy(page as unknown as PageFacade, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'string' && prop in healPage) {
        const method = (healPage as unknown as Record<string, unknown>)[prop];
        return typeof method === 'function' ? method.bind(healPage) : method;
      }
      // Intercept context() to return SafeContext instead of raw BrowserContext.
      // This enforces the SafeContext restriction at runtime as well as at the
      // type level — callers cannot reach newPage() or newCDPSession() even via
      // dynamic property access on the context object.
      if (prop === 'context') {
        return () => (target as unknown as Page).context() as unknown as SafeContext;
      }
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

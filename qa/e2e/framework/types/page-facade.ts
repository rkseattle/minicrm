/**
 * PageFacade — a unified page object combining SafePage navigation methods
 * with all HealMethods element interactions. testName is baked in at fixture
 * creation so callers never thread it manually.
 *
 * MINCRM-209
 */

import type { Page } from '@playwright/test';
import type { SafePage } from './safe-page.js';
import type { HealMethods } from '../fixtures/heal-methods.js';
import { buildHealPage } from '../fixtures/heal-methods.js';

export type PageFacade = SafePage & HealMethods;

export function createPageFacade(page: Page, testName: string): PageFacade {
  const healPage = buildHealPage(page, testName); // testName captured in closure

  // Safe cast: the Proxy routes HealMethods property accesses to healPage and
  // all other accesses to the raw Page. ForbiddenPageMethods are absent from the
  // PageFacade type, so they remain inaccessible at compile time even though the
  // underlying Page object has them at runtime.
  return new Proxy(page as unknown as PageFacade, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'string' && prop in healPage) {
        const method = (healPage as unknown as Record<string, unknown>)[prop];
        return typeof method === 'function' ? method.bind(healPage) : method;
      }
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Barrel export for the E2E fixture layer.
 *
 * All test specs and behaviors must import `test` and `expect` from here
 * rather than directly from `@playwright/test`. This ensures the healPage
 * fixture is always available and that imports don't bypass the fixture layer.
 *
 * MINCRM-126
 */

export { test } from './heal-page.fixture.js';
export { expect } from '@playwright/test';

export type { HealPage, LocateOptions } from './heal-page.fixture.js';

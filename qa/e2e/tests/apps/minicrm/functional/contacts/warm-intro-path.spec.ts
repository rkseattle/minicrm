/**
 * F7-WI — AI warm introduction path mapping
 *
 * Functional regression tests for the "Find warm path" action on the
 * contact detail page.
 *
 * Test groups:
 *   F7-WI1 — Clicking Find warm path shows an empty-results panel when no
 *            candidate exists (deterministic — no AI call is needed for a
 *            contact with zero rep-engaged known contacts)
 *   F7-WI2 — The Find warm path button is hidden when the flag is off
 *
 * Stub note:
 *   Traversal itself is deterministic (no AI call), so the "no path found"
 *   case is fully exercisable in E2E. The suggested-introduction-message
 *   generation step runs with E2E=true and returns a fallback template
 *   rather than calling Anthropic — covered by the service-layer unit tests
 *   (warmIntroService.test.ts) and client component tests
 *   (WarmIntroPathsPanel.test.tsx), which mock the HTTP response directly.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviours imported from @behaviors/* only — never @pages/*
 *   - Feature flag UI state controlled via withFlags() route interception only
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestContact,
  createTestRep,
  navigateToContact,
  withFlags,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  expectContactNameVisible,
  clickFindWarmPath,
  expectWarmPathResultsVisible,
  expectWarmPathEmptyMessageVisible,
  isFindWarmPathButtonVisible,
} from '@behaviors/minicrm/contacts.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F7-WI1 — Empty results when no candidate exists
// ---------------------------------------------------------------------------

test(
  'F7-WI1: Find warm path shows a no-paths-found message for a contact with no candidates',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'WI1',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);
    await expectContactNameVisible({ page });

    await clickFindWarmPath(contact.id, { page });
    await expectWarmPathResultsVisible(contact.id, { page });

    // The warm-path lookup is a real async HTTP round trip (unlike the
    // deterministic E2E stub used by meeting-brief/task-suggestions) — the
    // panel shows "Finding warm paths…" until the request resolves, so the
    // empty-state assertion must retry rather than assert on the first paint.
    await expect(async () => {
      await expectWarmPathEmptyMessageVisible({ page });
    }).toPass({ timeout: 10_000 });
  },
);

// ---------------------------------------------------------------------------
// F7-WI2 — Button hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F7-WI2: the Find warm path button stays hidden when ai_warm_intro_path is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'WI2',
      last_name: `Contact ${Date.now()}`,
    });

    await withFlags(page, { ai_warm_intro_path: false });
    await navigateToContact(page, contact.id);
    await expectContactNameVisible({ page });

    expect(await isFindWarmPathButtonVisible(contact.id, { page })).toBe(false);
  },
);

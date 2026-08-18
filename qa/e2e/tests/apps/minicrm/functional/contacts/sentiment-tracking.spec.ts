/**
 * F7-ST — AI sentiment tracking
 *
 * Functional regression tests for the passive sentiment trend sparkline on
 * the contact detail page.
 *
 * Test groups:
 *   F7-ST1 — No sparkline is shown when there is insufficient scored data
 *   F7-ST2 — The sparkline stays hidden when the flag is off
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so scoreActivitySentiment bypasses the
 *   Anthropic SDK entirely and never writes a score row — every contact stays
 *   at "insufficient data", for which no sparkline renders. The sparkline-
 *   rendering path for scored data is covered by the client component test
 *   suite (ContactDetailPage.test.tsx, SentimentSparkline.test.tsx), which
 *   mock the HTTP response directly — E2E cannot exercise it without real
 *   AI output.
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
  isSentimentTrendVisible,
} from '@behaviors/minicrm/contacts.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F7-ST1 — No sparkline for insufficient scored data
// ---------------------------------------------------------------------------

test(
  'F7-ST1: no sparkline is shown for a contact with insufficient scored interactions',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'ST1',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);

    await expectContactNameVisible({ page });
    expect(await isSentimentTrendVisible(contact.id, { page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-ST2 — Sparkline hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F7-ST2: the sentiment trend sparkline stays hidden when ai_sentiment_tracking is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'ST2',
      last_name: `Contact ${Date.now()}`,
    });

    await withFlags(page, { ai_sentiment_tracking: false });
    await navigateToContact(page, contact.id);

    await expectContactNameVisible({ page });
    expect(await isSentimentTrendVisible(contact.id, { page })).toBe(false);
  },
);

/**
 * F16-FT — AI smart follow-up timing suggestions
 *
 * Functional regression tests for the passive follow-up timing card on the
 * contact detail page.
 *
 * Test groups:
 *   F16-FT1 — No card is shown for a contact with fewer than 5 interactions
 *   F16-FT2 — The card stays hidden when the flag is off
 *
 * Stub note:
 *   Timing derivation is deterministic/SQL-driven (no LLM call), but the
 *   cached suggestion is only populated via the nightly cron
 *   (computeFollowUpTimingSuggestions) or a lazy recompute triggered by a
 *   GET once 5+ interactions exist. A freshly created E2E contact has zero
 *   logged interactions, so the suggestion stays null and no card renders —
 *   matching sentiment-tracking.spec.ts's convention for cached-signal AI
 *   features. The populated-suggestion rendering and "Schedule follow-up"
 *   flow are covered by the client component test suite
 *   (ContactDetailPage.test.tsx, FollowUpTimingCard.test.tsx), which mock
 *   the HTTP response directly.
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
import { isFollowUpTimingCardVisible } from '@behaviors/minicrm/contacts.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F16-FT1 — No card for a contact with fewer than 5 interactions
// ---------------------------------------------------------------------------

test(
  'F16-FT1: no follow-up timing card is shown for a contact with insufficient interaction history',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'FT1',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);

    expect(await isFollowUpTimingCardVisible(contact.id, { page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F16-FT2 — Card hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F16-FT2: the follow-up timing card stays hidden when ai_followup_timing_suggestions is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'FT2',
      last_name: `Contact ${Date.now()}`,
    });

    await withFlags(page, { ai_followup_timing_suggestions: false });
    await navigateToContact(page, contact.id);

    expect(await isFollowUpTimingCardVisible(contact.id, { page })).toBe(false);
  },
);

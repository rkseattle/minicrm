/**
 * F7-CB — AI champion and blocker detection (MINCRM-466)
 *
 * Functional regression tests for the passive champion/blocker classification
 * badge on the contact detail page.
 *
 * Test groups:
 *   F7-CB1 — No badge is shown for the default neutral classification
 *   F7-CB2 — The classification badge is hidden when the flag is off
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so analyzeContactSignals bypasses the
 *   Anthropic SDK entirely and never writes a classification row — every
 *   contact stays at the default neutral state, for which no badge renders
 *   per the ticket's AC ("Neutral (default — no badge shown)"). The badge-
 *   rendering path for non-neutral classifications is covered by the client
 *   component test suite (ContactDetailPage.test.tsx, ChampionBlockerBadge.test.tsx),
 *   which mock the HTTP response directly — E2E cannot exercise it without
 *   real AI output. (MINCRM-466)
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
  isChampionBlockerBadgeVisible,
} from '@behaviors/minicrm/contacts.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F7-CB1 — No badge for the default neutral classification
// ---------------------------------------------------------------------------

test(
  'F7-CB1: no badge is shown for a contact with the default neutral classification',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'CB1',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);

    await expectContactNameVisible({ page });
    expect(await isChampionBlockerBadgeVisible(contact.id, { page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-CB2 — Badge hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F7-CB2: the champion/blocker badge stays hidden when ai_champion_blocker_detection is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'CB2',
      last_name: `Contact ${Date.now()}`,
    });

    await withFlags(page, { ai_champion_blocker_detection: false });
    await navigateToContact(page, contact.id);

    await expectContactNameVisible({ page });
    expect(await isChampionBlockerBadgeVisible(contact.id, { page })).toBe(false);
  },
);

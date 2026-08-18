/**
 * F-MB — AI pre-meeting brief generation
 *
 * Functional regression tests for the "Generate Brief" action on the
 * activity timeline and the resulting brief panel.
 *
 * Test groups:
 *   F-MB1 — Generating a brief for a future-dated Call activity shows the
 *           panel with the deterministic E2E stub content
 *   F-MB2 — Generate Brief is not shown for a past-dated activity
 *   F-MB3 — Generate Brief is not shown for an activity with no linked contact
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so generateMeetingBrief bypasses the
 *   Anthropic SDK and returns a deterministic E2E_STUB_BRIEF.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestContact,
  createTestAccount,
  createTestActivity,
  createTestRep,
  navigateToContact,
  navigateToAccount,
  utcDayOffset,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import { expectContactNameVisible } from '@behaviors/minicrm/contacts.behaviors.js';
import {
  isGenerateBriefButtonVisible,
  clickGenerateBrief,
  isMeetingBriefPanelVisible,
} from '@behaviors/minicrm/activities.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

function tomorrowDateString(): string {
  return utcDayOffset(1);
}

function yesterdayDateString(): string {
  return utcDayOffset(-1);
}

// ---------------------------------------------------------------------------
// F-MB1 — Generate Brief shows the panel with stub content
// ---------------------------------------------------------------------------

test(
  'F-MB1: generating a brief for a future-dated Call activity shows the brief panel',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'MB1',
      last_name: `Contact ${Date.now()}`,
    });
    const activity = await createTestActivity(testData, restClient, {
      type: 'Call',
      subject: 'Upcoming discovery call',
      contact_id: contact.id,
      due_date: tomorrowDateString(),
      direction: 'Outbound',
    });

    await navigateToContact(page, contact.id);
    await expectContactNameVisible({ page });

    await expect(async () => {
      expect(await isGenerateBriefButtonVisible(activity.id, { page })).toBe(true);
    }).toPass({ timeout: 10_000 });

    await clickGenerateBrief(activity.id, { page });

    await expect(async () => {
      expect(await isMeetingBriefPanelVisible({ page })).toBe(true);
    }).toPass({ timeout: 10_000 });
  },
);

// ---------------------------------------------------------------------------
// F-MB2 — No button for a past-dated activity
// ---------------------------------------------------------------------------

test(
  'F-MB2: Generate Brief is not shown for a past-dated Call activity',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'MB2',
      last_name: `Contact ${Date.now()}`,
    });
    const activity = await createTestActivity(testData, restClient, {
      type: 'Call',
      subject: 'Past discovery call',
      contact_id: contact.id,
      due_date: yesterdayDateString(),
      direction: 'Outbound',
    });

    await navigateToContact(page, contact.id);
    await expectContactNameVisible({ page });

    expect(await isGenerateBriefButtonVisible(activity.id, { page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F-MB3 — No button without a linked contact
// ---------------------------------------------------------------------------

test(
  'F-MB3: Generate Brief is not shown for an activity with no linked contact',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `MB3 Account ${Date.now()}`,
    });

    const activity = await createTestActivity(testData, restClient, {
      type: 'Meeting',
      subject: 'Account-only meeting',
      account_id: account.id,
      due_date: tomorrowDateString(),
    });

    await navigateToAccount(page, account.id);

    expect(await isGenerateBriefButtonVisible(activity.id, { page })).toBe(false);
  },
);

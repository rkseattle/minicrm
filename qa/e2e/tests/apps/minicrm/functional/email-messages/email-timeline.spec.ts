/**
 * Emails section on record detail pages
 *
 * Covers when the section renders and what a user with no mailbox is told, in a real
 * browser against the running stack.
 *
 * This file covers the section with no mail. The thread list, replying and privacy are
 * covered with real synced mail by the specs in functional/email-sync/. What E2E adds here
 * is the gating as assembled: the real flag row, the real capability set, and the list
 * endpoint answering for a mailbox-less rep.
 *
 * @serial because it flips the real email_sync feature_flags row. withFlags() intercepts
 * the browser's flag fetch only — the list endpoint re-reads the row per request, so the
 * section's own query would be refused unless the row itself is on.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators in this file — all through @behaviors/* imports
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestContact,
  createTestLead,
  createTestRep,
  createTestUser,
  navigateToContact,
} from '@apps/minicrm/helpers.js';
import { loginAs, loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { updateFeatureFlag } from '@behaviors/minicrm/feature-flags.behaviors.js';
import { EMAIL_SYNC_FLAG } from '@behaviors/minicrm/email-sync.behaviors.js';
import {
  isEmailComposeDisabled,
  isEmailsSectionAbsent,
  navigateToRecordAndAwaitEmailRequests,
  readEmailComposeDescription,
  waitForEmailsEmptyState,
} from '@behaviors/minicrm/email-messages.behaviors.js';
import { waitForNotesSection } from '@behaviors/minicrm/notes.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';

/** The no-mailbox reason's English text, matched loosely so copy edits do not break it. */
const NO_MAILBOX_REASON = /connect a mailbox/i;

const VIEWER_PASSWORD = 'ViewerTimeline1!';

test.use({ storageState: { cookies: [], origins: [] } });

// describe.serial for intra-file ordering: these tests write one global flag row, so
// they must not interleave with each other. Cross-file protection is the @serial tag plus
// the resource-registry entry, which is what moves the file to the serial job.
test.describe.serial('Emails section on detail pages', () => {
  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    // Seeded off, and the whole suite assumes that: a rollout flag left on changes what
    // every other spec's UI renders.
    await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: false });
    await ensureSystemDefaults(restClient);
  });

  test('F-ET1 — with email sync off, a contact page shows no Emails section @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await loginAsAdmin(restClient);
    await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: false });
    const rep = await createTestRep(testData, restClient);
    expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
    const contact = await createTestContact(testData, restClient);

    await loginViaBrowser(rep.email, rep.password, { page });
    await navigateToContact(page, contact.id);
    // Notes renders from the same flag query, so the flag state has reached the sidebar.
    await waitForNotesSection({ page });

    expect(await isEmailsSectionAbsent({ page })).toBe(true);
  });

  test('F-ET2 — a rep with no mailbox sees the empty state and an explained, disabled Compose @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await loginAsAdmin(restClient);
    await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: true });
    const rep = await createTestRep(testData, restClient);
    expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
    const contact = await createTestContact(testData, restClient);

    await loginViaBrowser(rep.email, rep.password, { page });
    const statuses = await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);

    expect(statuses).toEqual({ threadsStatus: 200, mailboxesStatus: 200 });
    await waitForEmailsEmptyState({ page });
    expect(await isEmailComposeDisabled({ page })).toBe(true);
    // Polled: the description is attached on the render after the mailbox list lands.
    await expect.poll(() => readEmailComposeDescription({ page })).toMatch(NO_MAILBOX_REASON);
  });

  test('F-ET3 — the same on a lead the rep owns @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await loginAsAdmin(restClient);
    await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: true });
    const rep = await createTestRep(testData, restClient);
    expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
    // Created as the rep, so the rep owns it: a lead's mail is readable only by its owner.
    const lead = await createTestLead(testData, restClient);

    await loginViaBrowser(rep.email, rep.password, { page });
    const statuses = await navigateToRecordAndAwaitEmailRequests({ page }, 'lead', lead.id);

    expect(statuses).toEqual({ threadsStatus: 200, mailboxesStatus: 200 });
    await waitForEmailsEmptyState({ page });
    expect(await isEmailComposeDisabled({ page })).toBe(true);
    await expect.poll(() => readEmailComposeDescription({ page })).toMatch(NO_MAILBOX_REASON);
  });

  test('F-ET4 — a viewer, who cannot manage mailboxes, sees no Emails section @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await loginAsAdmin(restClient);
    await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: true });
    const contact = await createTestContact(testData, restClient);
    const viewer = await createTestUser(testData, restClient, {
      role: 'viewer',
      password: VIEWER_PASSWORD,
    });

    await loginViaBrowser(viewer.email, VIEWER_PASSWORD, { page });
    await navigateToContact(page, contact.id);
    // Notes renders from the same flag query, so the flag state has reached the sidebar.
    await waitForNotesSection({ page });

    expect(await isEmailsSectionAbsent({ page })).toBe(true);
  });
});

/**
 * Email Sync — mail from an excluded domain is never stored, wherever the exclusion is set.
 *
 * Two lists exclude a domain: the org's, which an admin sets, and each mailbox's own. Each
 * test seeds one message from an excluded domain beside one from an allowed domain, both
 * senders being contacts, so a sync that stored nothing at all could not pass, and the
 * result is read where a user would see it: each contact's Emails section.
 *
 * @serial: writes feature_flags.email_sync and settings.email_sync_excluded_domains
 * (resource-registry.ts); ensureSystemDefaults restores both after each test.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestRep } from '@apps/minicrm/helpers.js';
import { loginAs, loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToRecordAndAwaitEmailRequests,
  waitForEmailsEmptyState,
} from '@behaviors/minicrm/email-messages.behaviors.js';
import {
  connectImapMailboxViaApi,
  deliverToImapMailbox,
  readTimelineThreadSubjects,
  setMailboxExcludedDomains,
  syncMailboxNow,
  type SyncOutcome,
  enableEmailSyncForTest,
} from '@behaviors/minicrm/email-sync.behaviors.js';
import { setOrgExcludedDomainsViaApi } from '@behaviors/minicrm/email-sync-settings.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import type { TestDataManager } from '@apps/minicrm/test-data-manager.js';

function storedCount(outcomes: SyncOutcome[]): number {
  return outcomes.reduce((sum, o) => sum + o.messages_stored, 0);
}

/** Both senders as contacts of the rep, and one message from each in a fresh mailbox. */
async function seedBothSenders(
  restClient: RestClient,
  testData: TestDataManager,
  excludedDomain: string,
  mailbox: string,
): Promise<{ allowedId: string; excludedId: string; shown: string; hidden: string }> {
  const allowedSender = `buyer-${crypto.randomUUID()}@allowed.test`;
  const excludedSender = `contact-${crypto.randomUUID()}@${excludedDomain}`;
  const allowed = await createTestContact(testData, restClient, { email: allowedSender });
  const excluded = await createTestContact(testData, restClient, { email: excludedSender });
  const shown = `Shown ${crypto.randomUUID()}`;
  const hidden = `Hidden ${crypto.randomUUID()}`;
  await deliverToImapMailbox({ from: excludedSender, to: mailbox, subject: hidden, text: 'x' });
  await deliverToImapMailbox({ from: allowedSender, to: mailbox, subject: shown, text: 'y' });
  return { allowedId: allowed.id, excludedId: excluded.id, shown, hidden };
}

/** What each contact's Emails section shows: the allowed thread, and nothing at all. */
async function expectOnlyAllowedMailShown(
  page: PageFacade,
  rep: { email: string; password: string },
  seeded: { allowedId: string; excludedId: string; shown: string },
): Promise<void> {
  await loginViaBrowser(rep.email, rep.password, { page });
  await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', seeded.allowedId);
  expect(await readTimelineThreadSubjects({ page })).toEqual([seeded.shown]);
  await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', seeded.excludedId);
  await waitForEmailsEmptyState({ page });
}

test.describe.serial('Excluded domains', () => {
  // The email_sync flag is restored by enableEmailSyncForTest's own teardown, after mailboxes go.
  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await ensureSystemDefaults(restClient);
  });

  test('F-EMS6 — mail from an org-excluded domain is never synced @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    const excluded = `excluded-${crypto.randomUUID().slice(0, 8)}.test`;
    await enableEmailSyncForTest(restClient, testData);
    expect(await setOrgExcludedDomainsViaApi(restClient, [excluded])).toEqual([excluded]);
    const rep = await createTestRep(testData, restClient);
    expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
    const mailbox = `org-excl-${crypto.randomUUID()}@example.test`;
    const seeded = await seedBothSenders(restClient, testData, excluded, mailbox);
    const account = await connectImapMailboxViaApi(restClient, testData, rep, mailbox);

    const outcomes = await syncMailboxNow(restClient, account.id);

    expect(storedCount(outcomes)).toBe(1);
    await expectOnlyAllowedMailShown(page, rep, seeded);
  });

  test('F-EMS6b — mail from a domain the mailbox excludes is never synced @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    const excluded = `mine-${crypto.randomUUID().slice(0, 8)}.test`;
    await enableEmailSyncForTest(restClient, testData);
    const rep = await createTestRep(testData, restClient);
    expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
    const mailbox = `own-excl-${crypto.randomUUID()}@example.test`;
    const seeded = await seedBothSenders(restClient, testData, excluded, mailbox);
    const account = await connectImapMailboxViaApi(restClient, testData, rep, mailbox);
    expect(
      (await setMailboxExcludedDomains(restClient, account.id, [excluded])).excluded_domains,
    ).toEqual([excluded]);

    const outcomes = await syncMailboxNow(restClient, account.id);

    expect(storedCount(outcomes)).toBe(1);
    await expectOnlyAllowedMailShown(page, rep, seeded);
  });
});

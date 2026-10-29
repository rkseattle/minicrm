/**
 * Email Sync — filing unmatched mail by hand, and unfiling it.
 *
 * Mail from an address no record carries lands in the rep's unmatched inbox. The inbox and
 * the link routes are API surfaces with no page of their own, so the link is made through
 * the API and its effect read where a user sees it: the contact's Emails section.
 *
 * @serial: the server reads feature_flags.email_sync per request (resource-registry.ts).
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestRep } from '@apps/minicrm/helpers.js';
import { loginAs, loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  listMailForRecord,
  listUnmatchedMail,
  navigateToRecordAndAwaitEmailRequests,
  waitForEmailsEmptyState,
} from '@behaviors/minicrm/email-messages.behaviors.js';
import {
  connectImapMailboxViaApi,
  deliverToImapMailbox,
  linkMessageToRecord,
  readTimelineThreadSubjects,
  syncMailboxNow,
  unlinkMessageFromRecord,
  enableEmailSyncForTest,
} from '@behaviors/minicrm/email-sync.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe.serial('Unmatched inbox: link and unlink', () => {
  // The email_sync flag is restored by enableEmailSyncForTest's own teardown, after mailboxes go.
  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await ensureSystemDefaults(restClient);
  });

  test('F-EMS3 — a rep files unmatched mail on a contact, then unfiles it @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await enableEmailSyncForTest(restClient, testData);
    const rep = await createTestRep(testData, restClient);
    expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
    const contact = await createTestContact(testData, restClient);
    const mailbox = `unmatched-${crypto.randomUUID()}@example.test`;
    const subject = `Stranger ${crypto.randomUUID()}`;
    await deliverToImapMailbox({
      from: `stranger-${crypto.randomUUID()}@nowhere.test`,
      to: mailbox,
      subject,
      text: 'No record carries this sender.',
    });
    const account = await connectImapMailboxViaApi(restClient, testData, rep, mailbox);
    await syncMailboxNow(restClient, account.id);

    const unmatched = await listUnmatchedMail(restClient);
    const thread = unmatched.data.find((t) => t.messages.some((m) => m.subject === subject));
    const message = thread?.messages.find((m) => m.subject === subject);
    expect(message).toBeDefined();
    expect((await listMailForRecord(restClient, 'contact', contact.id)).total).toBe(0);

    // Safe: asserted defined just above.
    const linkId = await linkMessageToRecord(restClient, message!.id, 'contact', contact.id);

    const linked = await listMailForRecord(restClient, 'contact', contact.id);
    // Safe: asserted defined above.
    expect(linked.data.flatMap((t) => t.messages.map((m) => m.id))).toContain(message!.id);
    await loginViaBrowser(rep.email, rep.password, { page });
    await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);
    expect(await readTimelineThreadSubjects({ page })).toContain(subject);

    // Safe: asserted defined above.
    expect(await unlinkMessageFromRecord(restClient, message!.id, linkId)).toBe(204);

    expect((await listMailForRecord(restClient, 'contact', contact.id)).total).toBe(0);
    await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);
    await waitForEmailsEmptyState({ page });
  });
});

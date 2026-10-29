/**
 * Email Sync — a thread its owner marks private shows an admin nothing of its content.
 *
 * Mail itself is owner-only on every read path, so an admin never lists another rep's
 * threads, private or not. What an admin can read is the Email activity a send files on the
 * contact, which names the thread's subject. Marking the thread private scrubs that
 * activity to "Private email", so this is where privacy is visible to an admin.
 *
 * @serial: the server reads feature_flags.email_sync per request (resource-registry.ts).
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAdmin, createTestContact, createTestRep } from '@apps/minicrm/helpers.js';
import { rfc822Message } from '@apps/minicrm/mail-fakes.js';
import { PRIVATE_EMAIL_SUBJECT } from '@minicrm/shared/schemas/emailMessageSchema.js';
import { getActivities } from '@behaviors/minicrm/activities.behaviors.js';
import { loginAs, loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  listMailForRecord,
  navigateToRecordAndAwaitEmailRequests,
  waitForEmailsEmptyState,
} from '@behaviors/minicrm/email-messages.behaviors.js';
import {
  connectEmulatedMailbox,
  replyToMessage,
  seedEmulatedMail,
  syncMailboxNow,
  toggleThreadPrivacy,
  waitForThreadMarkedPrivate,
  enableEmailSyncForTest,
} from '@behaviors/minicrm/email-sync.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe.serial('Private threads', () => {
  // The email_sync flag is restored by enableEmailSyncForTest's own teardown, after mailboxes go.
  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await ensureSystemDefaults(restClient);
  });

  test('F-EMS5 — marking a thread private scrubs what an admin can see of it @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await enableEmailSyncForTest(restClient, testData);
    const admin = await createTestAdmin(testData, restClient);
    const rep = await createTestRep(testData, restClient);
    expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
    const buyer = `buyer-${crypto.randomUUID()}@customer.test`;
    const contact = await createTestContact(testData, restClient, { email: buyer });
    const address = `private-${crypto.randomUUID()}@example.test`;
    const { account, token } = await connectEmulatedMailbox(
      restClient,
      testData,
      rep,
      'google',
      address,
    );
    const subject = `Confidential ${crypto.randomUUID()}`;
    await seedEmulatedMail(token, {
      raw: await rfc822Message({ from: buyer, to: address, subject, text: 'Between us.' }),
    });
    await syncMailboxNow(restClient, account.id);
    const [thread] = (await listMailForRecord(restClient, 'contact', contact.id)).data;
    const original = thread?.messages[0];
    expect(original).toBeDefined();

    await loginViaBrowser(rep.email, rep.password, { page });
    await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);
    // Safe: asserted defined above.
    expect(await replyToMessage({ page }, subject, original!.id, 'Terms attached.')).toBe(201);
    expect(await loginAs(restClient, admin.email, admin.password)).toBe(200);
    const before = await getActivities(restClient, { contact: contact.id });
    expect(before.some((activity) => activity.subject.includes(subject))).toBe(true);

    await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);
    const replySubject = `Re: ${subject}`;
    expect(await toggleThreadPrivacy({ page }, replySubject)).toBe(200);
    await waitForThreadMarkedPrivate({ page }, replySubject);

    const after = await getActivities(restClient, { contact: contact.id });
    expect(after.some((activity) => activity.subject.includes(subject))).toBe(false);
    expect(after.map((activity) => activity.subject)).toContain(PRIVATE_EMAIL_SUBJECT);
    // Mail is owner-only: the admin's own Emails section never lists the rep's thread.
    expect((await listMailForRecord(restClient, 'contact', contact.id)).total).toBe(0);
    await loginViaBrowser(admin.email, admin.password, { page });
    await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);
    await waitForEmailsEmptyState({ page });
  });
});

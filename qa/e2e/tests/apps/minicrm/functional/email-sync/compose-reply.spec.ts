/**
 * Email Sync — composing and replying through a connected mailbox.
 *
 * Gmail and Graph only: an IMAP mailbox cannot send. The emulator files a Gmail send only
 * by the threadId the request names, and a Graph draft only by its In-Reply-To, as the
 * providers do, so a reply landing in the same thread proves the server sent the right one,
 * and a new message landing in a thread of its own proves it named none.
 *
 * @serial: the server reads feature_flags.email_sync per request (resource-registry.ts).
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestRep } from '@apps/minicrm/helpers.js';
import { rfc822Message } from '@apps/minicrm/mail-fakes.js';
import { loginAs, loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  listMailForRecord,
  navigateToRecordAndAwaitEmailRequests,
} from '@behaviors/minicrm/email-messages.behaviors.js';
import {
  composeFromMailbox,
  connectEmulatedMailbox,
  countMessagesInThread,
  listEmulatedMail,
  replyToMessage,
  seedEmulatedMail,
  syncMailboxNow,
  enableEmailSyncForTest,
} from '@behaviors/minicrm/email-sync.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe.serial('Compose and reply through a connected mailbox', () => {
  // The email_sync flag is restored by enableEmailSyncForTest's own teardown, after mailboxes go.
  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await ensureSystemDefaults(restClient);
  });

  for (const provider of ['google', 'microsoft'] as const) {
    test(`F-EMS4 — ${provider}: a reply sent from the contact joins the thread it answers @functional @serial`, async ({
      page,
      restClient,
      testData,
    }) => {
      await enableEmailSyncForTest(restClient, testData);
      const rep = await createTestRep(testData, restClient);
      expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
      const buyer = `buyer-${crypto.randomUUID()}@customer.test`;
      const contact = await createTestContact(testData, restClient, { email: buyer });
      const address = `${provider}-${crypto.randomUUID()}@example.test`;
      const { account, token } = await connectEmulatedMailbox(
        restClient,
        testData,
        rep,
        provider,
        address,
      );
      const subject = `Quote ${crypto.randomUUID()}`;
      const inbound = await seedEmulatedMail(token, {
        raw: await rfc822Message({
          from: buyer,
          to: address,
          subject,
          text: 'Can you send a quote?',
        }),
      });
      await syncMailboxNow(restClient, account.id);
      const [thread] = (await listMailForRecord(restClient, 'contact', contact.id)).data;
      const original = thread?.messages[0];
      expect(original).toBeDefined();

      await loginViaBrowser(rep.email, rep.password, { page });
      await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);
      // Safe: asserted defined above.
      const sendStatus = await replyToMessage({ page }, subject, original!.id, 'Quote attached.');

      expect(sendStatus).toBe(201);
      const sent = (await listEmulatedMail(token)).filter(
        (m) => m.folder === 'sentitems' && !m.isDraft,
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]?.threadId).toBe(inbound.threadId);

      await syncMailboxNow(restClient, account.id);
      await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);
      expect(await countMessagesInThread({ page }, `Re: ${subject}`)).toBe(2);
    });
  }

  for (const provider of ['google', 'microsoft'] as const) {
    test(`F-EMS4b — ${provider}: a new email composed on the contact starts a thread of its own @functional @serial`, async ({
      page,
      restClient,
      testData,
    }) => {
      await enableEmailSyncForTest(restClient, testData);
      const rep = await createTestRep(testData, restClient);
      expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
      const buyer = `buyer-${crypto.randomUUID()}@customer.test`;
      const contact = await createTestContact(testData, restClient, { email: buyer });
      const address = `${provider}-${crypto.randomUUID()}@example.test`;
      const { account, token } = await connectEmulatedMailbox(
        restClient,
        testData,
        rep,
        provider,
        address,
      );
      const earlier = await seedEmulatedMail(token, {
        raw: await rfc822Message({ from: buyer, to: address, subject: 'Earlier', text: 'Hi.' }),
      });
      // Synced first, so the server knows this thread and could wrongly send into it.
      await syncMailboxNow(restClient, account.id);
      const subject = `Proposal ${crypto.randomUUID()}`;

      await loginViaBrowser(rep.email, rep.password, { page });
      await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);
      const sendStatus = await composeFromMailbox(
        { page },
        account.id,
        subject,
        'Proposal attached.',
      );

      expect(sendStatus).toBe(201);
      const sent = (await listEmulatedMail(token)).filter(
        (m) => m.folder === 'sentitems' && !m.isDraft,
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]?.threadId).not.toBe(earlier.threadId);

      await syncMailboxNow(restClient, account.id);
      await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);
      expect(await countMessagesInThread({ page }, subject)).toBe(1);
    });
  }
});

/**
 * Email Sync — mail a provider holds reaches the matched contact's Emails section.
 *
 * Once per provider: IMAP against GreenMail, Gmail and Graph against the emulator. Each
 * syncs twice, so the second round exercises the incremental cursor (Gmail historyId,
 * Graph delta link, IMAP UIDNEXT) rather than only the first backfill.
 *
 * @serial: the server reads feature_flags.email_sync per request (resource-registry.ts).
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestRep } from '@apps/minicrm/helpers.js';
import { rfc822Message } from '@apps/minicrm/mail-fakes.js';
import { loginAs, loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { navigateToRecordAndAwaitEmailRequests } from '@behaviors/minicrm/email-messages.behaviors.js';
import {
  connectEmulatedMailbox,
  connectImapMailboxViaApi,
  deliverToImapMailbox,
  readTimelineThreadSubjects,
  seedEmulatedMail,
  syncMailboxNow,
  type MailboxOwner,
  enableEmailSyncForTest,
} from '@behaviors/minicrm/email-sync.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import type { TestDataManager } from '@apps/minicrm/test-data-manager.js';

type Provider = 'imap' | 'google' | 'microsoft';

/** A connected mailbox and how to put a message into it from outside. */
interface SeededMailbox {
  accountId: string;
  deliver: (from: string, subject: string) => Promise<void>;
}

async function mailboxFor(
  provider: Provider,
  restClient: RestClient,
  testData: TestDataManager,
  owner: MailboxOwner,
): Promise<SeededMailbox> {
  const address = `${provider}-${crypto.randomUUID()}@example.test`;
  if (provider === 'imap') {
    const deliver = async (from: string, subject: string): Promise<void> => {
      await deliverToImapMailbox({ from, to: address, subject, text: `Body of ${subject}` });
    };
    // GreenMail creates the mailbox on first delivery, so it exists before it is connected.
    await deliver('setup@seed.test', `Setup ${address}`);
    const account = await connectImapMailboxViaApi(restClient, testData, owner, address);
    return { accountId: account.id, deliver };
  }
  const { account, token } = await connectEmulatedMailbox(
    restClient,
    testData,
    owner,
    provider,
    address,
  );
  return {
    accountId: account.id,
    deliver: async (from, subject) => {
      await seedEmulatedMail(token, {
        raw: await rfc822Message({ from, to: address, subject, text: `Body of ${subject}` }),
      });
    },
  };
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe.serial('Synced mail on the matched contact', () => {
  // The email_sync flag is restored by enableEmailSyncForTest's own teardown, after mailboxes go.
  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await ensureSystemDefaults(restClient);
  });

  for (const provider of ['imap', 'google', 'microsoft'] as const) {
    test(`F-EMS2 — ${provider}: synced mail appears on the contact it names, then the next round adds more @functional @serial`, async ({
      page,
      restClient,
      testData,
    }) => {
      await enableEmailSyncForTest(restClient, testData);
      const rep = await createTestRep(testData, restClient);
      expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
      const buyer = `buyer-${crypto.randomUUID()}@customer.test`;
      // Created as the rep, so the rep owns it and may read its mail.
      const contact = await createTestContact(testData, restClient, { email: buyer });
      const mailbox = await mailboxFor(provider, restClient, testData, rep);
      const first = `First ${crypto.randomUUID()}`;
      const second = `Second ${crypto.randomUUID()}`;

      await mailbox.deliver(buyer, first);
      const backfill = await syncMailboxNow(restClient, mailbox.accountId);
      await mailbox.deliver(buyer, second);
      const incremental = await syncMailboxNow(restClient, mailbox.accountId);

      expect(backfill.at(-1)?.status).toBe('synced');
      expect(incremental).toEqual([
        expect.objectContaining({ status: 'synced', messages_stored: 1, has_more: false }),
      ]);
      await loginViaBrowser(rep.email, rep.password, { page });
      const statuses = await navigateToRecordAndAwaitEmailRequests({ page }, 'contact', contact.id);
      expect(statuses.threadsStatus).toBe(200);
      const subjects = await readTimelineThreadSubjects({ page });
      expect(subjects).toEqual(expect.arrayContaining([first, second]));
    });
  }
});

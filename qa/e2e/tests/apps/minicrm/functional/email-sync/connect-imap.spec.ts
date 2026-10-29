/**
 * Email Sync — connecting an IMAP mailbox through the profile page.
 *
 * Runs against GreenMail, which the server may dial because SSRF_ALLOWED_PRIVATE_HOSTS
 * names it in the test stack. The connect form tests the credentials live before storing
 * anything, so a 201 here means a real IMAP login succeeded.
 *
 * @serial: the server reads feature_flags.email_sync per request, so turning the feature
 * on means writing that global row (resource-registry.ts).
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestRep } from '@apps/minicrm/helpers.js';
import { loginAs, loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  connectImapMailboxViaProfile,
  deliverToImapMailbox,
  listMyMailboxes,
  readMailboxStatusLabel,
  syncMailboxNow,
  enableEmailSyncForTest,
} from '@behaviors/minicrm/email-sync.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe.serial('Connect an IMAP mailbox', () => {
  // The email_sync flag is restored by enableEmailSyncForTest's own teardown, after mailboxes go.
  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await ensureSystemDefaults(restClient);
  });

  test('F-EMS1 — a rep connects an IMAP mailbox and sees it active, then synced @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await enableEmailSyncForTest(restClient, testData);
    const rep = await createTestRep(testData, restClient);
    expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
    // A fresh address per run: GreenMail creates the mailbox on its first delivery.
    const mailbox = `imap-${crypto.randomUUID()}@example.test`;
    await deliverToImapMailbox({
      from: 'prospect@customer.test',
      to: mailbox,
      subject: `Hello ${mailbox}`,
      text: 'Seeded so the mailbox exists before it is connected.',
    });

    await loginViaBrowser(rep.email, rep.password, { page });
    const connected = await connectImapMailboxViaProfile(
      { page },
      testData,
      restClient,
      rep,
      mailbox,
    );

    expect(connected.status).toBe(201);
    // Safe: a 201 always carries the stored account.
    const account = connected.account!;
    expect(account).toMatchObject({ provider: 'imap', email_address: mailbox, status: 'active' });
    expect(await readMailboxStatusLabel({ page }, account.id)).toMatch(/^Active$/);

    const outcomes = await syncMailboxNow(restClient, account.id);
    expect(outcomes.at(-1)).toMatchObject({ status: 'synced', has_more: false });
    expect(
      outcomes.reduce((sum, o) => sum + (o.status === 'synced' ? o.messages_stored : 0), 0),
    ).toBe(1);

    const [stored] = await listMyMailboxes(restClient);
    expect(stored).toMatchObject({ id: account.id, status: 'active' });
    expect(stored?.last_sync_at).not.toBeNull();
  });
});

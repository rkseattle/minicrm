/**
 * Send intents: the state each send outcome leaves, and the sync engine filing a sent
 * message whose own filing failed. Real database; the provider is faked at its seam.
 */

import 'dotenv/config';

import { vi } from 'vitest';

import pool from '../db.js';
import logger from '../logger.js';
import {
  upsertOAuthAccount,
  type ClaimedSyncAccount,
} from '../services/connectedAccountService.js';
import {
  fileReconciledIntents,
  lockReconcilableIntents,
  sweepUnsettledIntents,
} from '../services/emailSendIntentService.js';
import { setRlsUserIdTo } from '../services/rlsContextService.js';
import { sendEmail, SENT_NOT_RECORDED } from '../services/emailSendService.js';
import { syncDueAccounts, syncOneAccount } from '../services/emailSyncService.js';
import type * as FeatureFlagModule from '../services/featureFlagService.js';
import type {
  MailProvider,
  NormalizedMessage,
  ProviderPage,
  SentMessage,
} from '../services/mail/mailProvider.js';
import { normalizeFromSource } from '../services/mail/messageBody.js';
import {
  SEND_AUTH_EXPIRED,
  SEND_NOT_SENT,
  SEND_OUTCOME_UNKNOWN,
  SEND_RATE_LIMITED,
  SEND_SCOPE_MISSING,
  sendFailure,
  type SendFailureCode,
} from '../services/mail/sendOutcome.js';
import { createUser } from '../services/userService.js';
import type { SendEmailInput } from '@minicrm/shared/schemas/emailMessageSchema.js';

import { clearAuditLogFor, failClientQueriesContaining, failMessageInsert } from './testUtils.js';

// The email feature is off for the whole file: a sweep must run without it, and with it off
// syncDueAccounts claims no other suite's mailbox.
vi.mock('../services/featureFlagService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof FeatureFlagModule>()),
  isFeatureEnabled: async () => false,
}));

const FILE_PREFIX = 'emailintent';
const MAILBOX = `${FILE_PREFIX}-mailbox@example.com`;

let userId: string;
let accountId: string;
let actor: { id: string; name: string };

type SendBehavior = (
  mime: Buffer,
  onPrepared?: (providerMessageId: string) => Promise<void>,
) => Promise<SentMessage>;

/** A provider whose send does whatever the test says, and which records each document. */
function sender(behavior: SendBehavior): { provider: MailProvider; sent: Buffer[] } {
  const sent: Buffer[] = [];
  return {
    sent,
    provider: {
      async fetchSince() {
        throw new Error('not under test');
      },
      async send(_auth, mime, _threadHint, onPrepared) {
        sent.push(mime);
        return behavior(mime, onPrepared);
      },
    },
  };
}

/** The one document a fake sent; a test that sent none fails here rather than later. */
function onlyDocument(sent: readonly Buffer[]): Buffer {
  const [document] = sent;
  if (!document) throw new Error('nothing was sent');
  return document;
}

/** The Sent copy of a document, as the sync engine would normalize it. */
async function sentCopy(
  mime: Buffer,
  providerMessageId: string,
  overrides: Partial<NormalizedMessage> = {},
): Promise<NormalizedMessage> {
  const normalized = await normalizeFromSource(mime, {
    providerMessageId,
    nativeThreadId: null,
    fallbackThreadId: `thread-${providerMessageId}`,
    accountAddress: MAILBOX,
    driver: 'test',
  });
  // Safe: every document the send path builds has a From address.
  return { ...normalized!, ...overrides };
}

/** Runs one sync of this mailbox whose only page is the given messages. */
async function syncPage(messages: NormalizedMessage[]): Promise<void> {
  const page: ProviderPage = {
    messages,
    cursor: `cursor-${Date.now()}`,
    cursorInvalid: false,
    hasMore: false,
  };
  // Safe: a read-only provider; sync never calls send.
  const provider = {
    async fetchSince(): Promise<ProviderPage> {
      return page;
    },
  } as MailProvider;
  const account: ClaimedSyncAccount = {
    id: accountId,
    userId,
    userRole: 'rep',
    provider: 'google',
    emailAddress: MAILBOX,
    syncCursor: 'already-backfilled',
    syncFailureCount: 0,
    grantedScopes: [],
  };
  await syncOneAccount(account, provider);
}

function typed(overrides: Partial<SendEmailInput> = {}): SendEmailInput {
  return {
    connected_account_id: accountId,
    to: ['someone@example.net'],
    cc: [],
    subject: 'Hello',
    body_html: '<p>A typed body.</p>',
    ...overrides,
  };
}

async function createContact(local: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Ada', 'Lovelace', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-${local}@example.com`, userId],
  );
  return result.rows[0]!.id; // Safe: an INSERT … RETURNING returns its one row.
}

async function intent(): Promise<{
  status: string;
  provider_message_id: string | null;
  email_message_id: string | null;
  activity_notes: string | null;
  to_addresses: string[];
}> {
  const result = await pool.query(
    `SELECT status, provider_message_id, email_message_id, activity_notes, to_addresses
       FROM email_send_intents WHERE connected_account_id = $1`,
    [accountId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

async function countRows(sql: string, values: unknown[]): Promise<number> {
  return (await pool.query(sql, values)).rowCount ?? 0;
}

const activitiesFor = (contactId: string): Promise<number> =>
  countRows('SELECT 1 FROM activities WHERE contact_id = $1', [contactId]);
const manualLinksTo = (contactId: string): Promise<number> =>
  countRows(`SELECT 1 FROM email_message_links WHERE record_id = $1 AND match_type = 'manual'`, [
    contactId,
  ]);
const auditsOf = (eventType: string): Promise<number> =>
  countRows('SELECT 1 FROM audit_log WHERE event_type = $1 AND record_id = $2', [
    eventType,
    accountId,
  ]);

async function deleteFixtures(): Promise<void> {
  await pool.query(
    `DELETE FROM activities WHERE owner_id IN
       (SELECT id FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com')`,
  );
  await pool.query(`DELETE FROM contacts WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
}

beforeAll(async () => {
  await deleteFixtures();
  const user = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Intent Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  userId = user.id;
  actor = { id: user.id, name: user.name };
  const account = await upsertOAuthAccount(
    {
      userId,
      provider: 'google',
      emailAddress: MAILBOX,
      grantedScopes: [],
      auth: {
        kind: 'oauth',
        access_token: 'still-valid',
        refresh_token: 'refresh',
        expires_at: Date.now() + 24 * 60 * 60 * 1000,
      },
    },
    actor,
  );
  accountId = account.id;
  // Out of the scheduler's reach: another suite's tick must not sync this mailbox.
  await pool.query(
    `UPDATE connected_accounts SET sync_next_attempt_at = NOW() + interval '1 day',
            sync_cursor = 'already-backfilled'
      WHERE id = $1`,
    [accountId],
  );
});

beforeEach(async () => {
  await pool.query('DELETE FROM email_send_intents WHERE connected_account_id = $1', [accountId]);
  await pool.query('DELETE FROM email_messages WHERE connected_account_id = $1', [accountId]);
  await pool.query('DELETE FROM activities WHERE owner_id = $1', [userId]);
  await pool.query(`DELETE FROM contacts WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await clearAuditLogFor(userId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await clearAuditLogFor(userId);
  await pool.query('DELETE FROM connected_accounts WHERE id = $1', [accountId]);
  await deleteFixtures();
  await pool.end();
});

describe('the intent each outcome leaves', () => {
  it('is committed before the provider is called', async () => {
    let statusDuringSend: string | null = null;
    const { provider } = sender(async () => {
      statusDuringSend = (await intent()).status;
      return { providerMessageId: 'gm-before', threadId: null };
    });

    await sendEmail(typed(), userId, actor, { provider });

    expect(statusDuringSend).toBe('pending');
  });

  it('is filed by a send that stored, and keeps no copy of the text', async () => {
    const { provider } = sender(async () => ({ providerMessageId: 'gm-filed', threadId: null }));

    const response = await sendEmail(typed(), userId, actor, { provider });

    expect(await intent()).toMatchObject({
      status: 'filed',
      provider_message_id: 'gm-filed',
      email_message_id: response.message.id,
      activity_notes: null,
    });
  });

  it.each<SendFailureCode>([
    SEND_NOT_SENT,
    SEND_AUTH_EXPIRED,
    SEND_SCOPE_MISSING,
    SEND_RATE_LIMITED,
  ])('is not_sent when the provider refuses with %s', async (code) => {
    const { provider } = sender(async () => {
      throw sendFailure(code, 'test');
    });

    await expect(sendEmail(typed(), userId, actor, { provider })).rejects.toBeDefined();

    expect(await intent()).toMatchObject({
      status: 'not_sent',
      to_addresses: [],
      activity_notes: null,
    });
    expect(await auditsOf('email_send_unconfirmed')).toBe(0);
  });

  it('is unconfirmed, and audited, when the provider does not say whether it went', async () => {
    const { provider } = sender(async () => {
      throw sendFailure(SEND_OUTCOME_UNKNOWN, 'test');
    });

    await expect(sendEmail(typed(), userId, actor, { provider })).rejects.toBeDefined();

    expect(await intent()).toMatchObject({ status: 'unconfirmed', to_addresses: [] });
    const audit = await pool.query<{ new_value: string }>(
      `SELECT new_value FROM audit_log
        WHERE event_type = 'email_send_unconfirmed' AND record_id = $1`,
      [accountId],
    );
    expect(audit.rows).toHaveLength(1);
    // Safe: the length was asserted on the line above.
    expect(JSON.parse(audit.rows[0]!.new_value)).toMatchObject({
      provider_confirmed: false,
      to: ['someone@example.net'],
    });
  });

  it('keeps no copy of a typed body while pending', async () => {
    let notesDuringSend: string | null = 'unset';
    const { provider } = sender(async () => {
      notesDuringSend = (await intent()).activity_notes;
      return { providerMessageId: 'gm-notes', threadId: null };
    });

    await sendEmail(typed(), userId, actor, { provider });

    expect(notesDuringSend).toBeNull();
  });

  it('still files when recording the provider id fails, and takes the id from the message', async () => {
    failQueriesContaining("SET status = 'sent'");
    const { provider } = sender(async () => ({ providerMessageId: 'gm-unmarked', threadId: null }));

    await sendEmail(typed(), userId, actor, { provider });

    expect(await intent()).toMatchObject({ status: 'filed', provider_message_id: 'gm-unmarked' });
  });

  it('answers with the refusal even when the intent cannot be settled', async () => {
    failQueriesContaining("SET status = 'not_sent'");
    const { provider } = sender(async () => {
      throw sendFailure(SEND_NOT_SENT, 'test');
    });

    await expect(sendEmail(typed(), userId, actor, { provider })).rejects.toMatchObject({
      code: 'SEND_FAILED',
    });
    // Left for the sweep, which reports it unconfirmed rather than guessing.
    expect((await intent()).status).toBe('pending');
  });

  it('reports a send whose intent vanished mid-send as sent but not recorded', async () => {
    const { provider } = sender(async () => {
      await pool.query('DELETE FROM email_send_intents WHERE connected_account_id = $1', [
        accountId,
      ]);
      return { providerMessageId: 'gm-vanished', threadId: null };
    });

    await expect(sendEmail(typed(), userId, actor, { provider })).rejects.toMatchObject({
      code: SENT_NOT_RECORDED,
    });
  });

  it('stays sent, with the provider id, when storing fails after the provider accepted', async () => {
    const { provider } = sender(async () => ({ providerMessageId: 'gm-stored', threadId: null }));
    failMessageInsert();

    await expect(sendEmail(typed(), userId, actor, { provider })).rejects.toMatchObject({
      code: SENT_NOT_RECORDED,
    });

    expect(await intent()).toMatchObject({ status: 'sent', provider_message_id: 'gm-stored' });
  });
});

describe('the sync engine filing a send', () => {
  it('files a send whose own filing failed: its record, one activity, one audit', async () => {
    const contactId = await createContact('failed-filing');
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-recover',
      threadId: null,
    }));
    failMessageInsert();
    await expect(
      sendEmail(typed({ record_type: 'contact', record_id: contactId }), userId, actor, {
        provider,
      }),
    ).rejects.toMatchObject({ code: SENT_NOT_RECORDED });
    vi.restoreAllMocks();

    await syncPage([await sentCopy(onlyDocument(sent), 'gm-recover')]);

    expect((await intent()).status).toBe('filed');
    expect(await manualLinksTo(contactId)).toBe(1);
    expect(await activitiesFor(contactId)).toBe(1);
    expect(await auditsOf('email_sent')).toBe(1);
  });

  it('files an unconfirmed Graph send by the draft id it recorded before submitting', async () => {
    const contactId = await createContact('graph-unknown');
    const { provider, sent } = sender(async (_mime, onPrepared) => {
      await onPrepared?.('graph-draft-1');
      throw sendFailure(SEND_OUTCOME_UNKNOWN, 'test');
    });
    await expect(
      sendEmail(typed({ record_type: 'contact', record_id: contactId }), userId, actor, {
        provider,
      }),
    ).rejects.toBeDefined();

    // A Message-ID the provider rewrote matches nothing; the draft id still does.
    await syncPage([
      await sentCopy(onlyDocument(sent), 'graph-draft-1', { rfcMessageId: 'rewritten@x' }),
    ]);

    expect((await intent()).status).toBe('filed');
    expect(await activitiesFor(contactId)).toBe(1);
  });

  it('files an unconfirmed Gmail send by the Message-ID it generated', async () => {
    const contactId = await createContact('gmail-unknown');
    const { provider, sent } = sender(async () => {
      throw sendFailure(SEND_OUTCOME_UNKNOWN, 'test');
    });
    await expect(
      sendEmail(typed({ record_type: 'contact', record_id: contactId }), userId, actor, {
        provider,
      }),
    ).rejects.toBeDefined();

    await syncPage([await sentCopy(onlyDocument(sent), 'gm-unknown')]);

    expect((await intent()).status).toBe('filed');
    expect(await activitiesFor(contactId)).toBe(1);
  });

  it('files once when sync stores the Sent copy before the send path records it', async () => {
    const contactId = await createContact('sync-first');
    const { provider } = sender(async (mime) => {
      await syncPage([await sentCopy(mime, 'gm-race')]);
      return { providerMessageId: 'gm-race', threadId: null };
    });

    await sendEmail(typed({ record_type: 'contact', record_id: contactId }), userId, actor, {
      provider,
    });

    expect((await intent()).status).toBe('filed');
    expect(await activitiesFor(contactId)).toBe(1);
    expect(await auditsOf('email_sent')).toBe(1);
  });

  it('does not file again when sync reads a Sent copy the send path already filed', async () => {
    const contactId = await createContact('send-first');
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-done',
      threadId: null,
    }));
    await sendEmail(typed({ record_type: 'contact', record_id: contactId }), userId, actor, {
      provider,
    });

    await syncPage([await sentCopy(onlyDocument(sent), 'gm-done')]);

    expect(await activitiesFor(contactId)).toBe(1);
    expect(await auditsOf('email_sent')).toBe(1);
  });
});

describe('the sync engine filing a send, by what it was sent from', () => {
  /** A send whose own filing failed, leaving its intent `sent`. @returns the document. */
  async function sendThatFailedToFile(
    providerMessageId: string,
    overrides: Partial<SendEmailInput> = {},
  ): Promise<Buffer> {
    const { provider, sent } = sender(async () => ({ providerMessageId, threadId: null }));
    failMessageInsert();
    await expect(sendEmail(typed(overrides), userId, actor, { provider })).rejects.toMatchObject({
      code: SENT_NOT_RECORDED,
    });
    vi.restoreAllMocks();
    return onlyDocument(sent);
  }

  it('skips a record deleted since the send, and still audits it', async () => {
    const contactId = await createContact('deleted-later');
    const mime = await sendThatFailedToFile('gm-deleted', {
      record_type: 'contact',
      record_id: contactId,
    });
    await pool.query('DELETE FROM contacts WHERE id = $1', [contactId]);

    await syncPage([await sentCopy(mime, 'gm-deleted')]);

    expect((await intent()).status).toBe('filed');
    expect(await manualLinksTo(contactId)).toBe(0);
    expect(await activitiesFor(contactId)).toBe(0);
    expect(await auditsOf('email_sent')).toBe(1);
  });

  it('links a lead but writes no activity, which cannot name one', async () => {
    const lead = await pool.query<{ id: string }>(
      `INSERT INTO leads (first_name, last_name, email, owner_id, status)
       VALUES ('Lea', 'Lead', $1, $2, 'New') RETURNING id`,
      [`${FILE_PREFIX}-lead@example.com`, userId],
    );
    const leadId = lead.rows[0]!.id; // Safe: an INSERT … RETURNING returns its one row.
    const mime = await sendThatFailedToFile('gm-lead', { record_type: 'lead', record_id: leadId });

    await syncPage([await sentCopy(mime, 'gm-lead')]);

    expect(await manualLinksTo(leadId)).toBe(1);
    expect(await countRows('SELECT 1 FROM activities WHERE owner_id = $1', [userId])).toBe(0);
    await pool.query('DELETE FROM leads WHERE id = $1', [leadId]);
  });

  it('files a send from no record with its audit alone', async () => {
    const mime = await sendThatFailedToFile('gm-norecord');

    await syncPage([await sentCopy(mime, 'gm-norecord')]);

    expect((await intent()).status).toBe('filed');
    expect(await auditsOf('email_sent')).toBe(1);
  });

  it("files a forward with only the sender's own text, which its intent kept", async () => {
    const contactId = await createContact('forward');
    const original = await pool.query<{ id: string }>(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address,
          to_addresses, subject, message_body_html, message_body_text)
       VALUES ($1, 'original-1', 'thread-original', 'inbound', 'someone@example.net', $2,
               'Original', '<p>The private original.</p>', 'The private original.')
       RETURNING id`,
      [accountId, [MAILBOX]],
    );
    const mime = await sendThatFailedToFile('gm-forward', {
      body_html: '<p>FYI, see below.</p>',
      // Safe: an INSERT … RETURNING returns its one row.
      forward_of_message_id: original.rows[0]!.id,
      record_type: 'contact',
      record_id: contactId,
    });

    await syncPage([await sentCopy(mime, 'gm-forward')]);

    const notes = await pool.query<{ notes: string }>(
      'SELECT notes FROM activities WHERE contact_id = $1',
      [contactId],
    );
    expect(notes.rows.map((row) => row.notes)).toEqual(['FYI, see below.']);
  });

  it('files nothing, and says so, when a matched copy was not stored', async () => {
    await sendThatFailedToFile('gm-unstored');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const intents = await lockReconcilableIntents(client, accountId, ['gm-unstored'], []);
      const copy = await sentCopy(Buffer.from('From: a@example.com\r\n\r\nx'), 'gm-unstored');
      const logged = vi.spyOn(logger, 'error');

      expect(await fileReconciledIntents(client, accountId, intents, [copy])).toEqual([]);
      expect(logged).toHaveBeenCalledWith(
        { intentId: intents[0]?.id },
        'emailSendIntentService: matched copy not stored',
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect((await intent()).status).toBe('sent');
  });

  it('stores the page and leaves the intent for the sweep when filing it fails', async () => {
    const contactId = await createContact('filing-fails');
    const mime = await sendThatFailedToFile('gm-filing-fails', {
      record_type: 'contact',
      record_id: contactId,
    });
    failClientQueriesContaining("VALUES ($1, $2, $3, 'manual')");

    await syncPage([await sentCopy(mime, 'gm-filing-fails')]);

    const stored = await pool.query(
      `SELECT 1 FROM email_messages
        WHERE connected_account_id = $1 AND provider_message_id = 'gm-filing-fails'`,
      [accountId],
    );
    expect(stored.rowCount).toBe(1);
    expect((await intent()).status).toBe('sent');
  });

  it('the send path also locks the intent before writing the message', async () => {
    const holder = await pool.connect();
    const realConnect = pool.connect.bind(pool);
    let holding = false;
    // Takes the intent's lock on another session at the send path's first checkout after the
    // intent exists, which is recordSent's, so recordSent meets it.
    // Safe: both overloads of connect are honored; the cast only satisfies the spy's type.
    vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
      // Safe: pg's connect has a callback overload, which this calls with one.
      if (callback) return (realConnect as unknown as (cb: unknown) => void)(callback);
      return (async () => {
        if (!holding) {
          await holder.query('BEGIN');
          const locked = await holder.query(
            'SELECT 1 FROM email_send_intents WHERE connected_account_id = $1 FOR UPDATE',
            [accountId],
          );
          if ((locked.rowCount ?? 0) > 0) holding = true;
          else await holder.query('ROLLBACK');
        }
        return realConnect();
      })();
    }) as typeof pool.connect);
    const { provider } = sender(async () => ({
      providerMessageId: 'gm-send-order',
      threadId: null,
    }));

    const sending = sendEmail(typed(), userId, actor, { provider });
    try {
      await waitForLockWaiter();
      // Had recordSent written the message before waiting, this would block on its row while
      // it blocks on the intent, and Postgres would abort one of them as a deadlock.
      await holder.query(
        `INSERT INTO email_messages
           (connected_account_id, provider_message_id, thread_id, direction, from_address)
         VALUES ($1, 'gm-send-order', 'thread-gm-send-order', 'outbound', $2)`,
        [accountId, MAILBOX],
      );
      await holder.query('COMMIT');
      await sending;
    } finally {
      holder.release();
    }

    expect(holding).toBe(true);
    expect((await intent()).status).toBe('filed');
  });

  it('locks the intent before writing the message, so it cannot deadlock the send path', async () => {
    const mime = await sendThatFailedToFile('gm-order');
    const copy = await sentCopy(mime, 'gm-order');
    const holder = await pool.connect();
    try {
      // The send path's order: the intent first.
      await holder.query('BEGIN');
      await holder.query(
        'SELECT 1 FROM email_send_intents WHERE connected_account_id = $1 FOR UPDATE',
        [accountId],
      );
      const syncing = syncPage([copy]);
      await waitForLockWaiter();
      // Then the message. Had sync written it before waiting, this would block on sync's row
      // while sync blocks on the intent, and Postgres would abort one of them as a deadlock.
      await holder.query(
        `INSERT INTO email_messages
           (connected_account_id, provider_message_id, thread_id, direction, from_address)
         VALUES ($1, 'gm-order', 'thread-gm-order', 'outbound', $2)`,
        [accountId, MAILBOX],
      );
      await holder.query('COMMIT');
      await syncing;
    } finally {
      holder.release();
    }

    expect((await intent()).status).toBe('filed');
  });
});

/** Waits until another session is blocked on a lock on the intents table. */
async function waitForLockWaiter(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query(
      `SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%email_send_intents%' AND pid <> pg_backend_pid()`,
    );
    if ((waiting.rowCount ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('no session ever waited on the intent lock');
}

/** Fails every `pool.query` whose text contains `fragment`; undo with `vi.restoreAllMocks()`. */
function failQueriesContaining(fragment: string): void {
  // Safe: called below with exactly the arguments the caller passed.
  const realQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  // Safe: delegates every overload unchanged; the cast only satisfies the spy's type.
  vi.spyOn(pool, 'query').mockImplementation(((text: unknown, ...rest: unknown[]) =>
    typeof text === 'string' && text.includes(fragment)
      ? Promise.reject(new Error('storage down'))
      : realQuery(text, ...rest)) as typeof pool.query);
}

describe('syncDueAccounts', () => {
  it('keeps syncing when the sweep fails', async () => {
    failClientQueriesContaining("SET status = 'unconfirmed'");

    await expect(syncDueAccounts()).resolves.toEqual([]);
  });

  it('sweeps unsettled sends even with the email feature turned off', async () => {
    await pool.query(
      `INSERT INTO email_send_intents
         (user_id, actor_name, connected_account_id, rfc_message_id, status, updated_at)
       VALUES ($1, 'Intent Rep', $2, 'flag-off@example.com', 'sent', now() - interval '2 hours')`,
      [userId, accountId],
    );

    expect(await syncDueAccounts()).toEqual([]);

    expect((await intent()).status).toBe('unconfirmed');
    expect(await auditsOf('email_send_unconfirmed')).toBe(1);
  });
});

describe('sweepUnsettledIntents', () => {
  async function insertIntent(status: string, ageMinutes: number): Promise<void> {
    await pool.query(
      `INSERT INTO email_send_intents
         (user_id, actor_name, connected_account_id, rfc_message_id, status, to_addresses,
          updated_at)
       VALUES ($1, 'Intent Rep', $2, $3, $4, '{someone@example.net}',
               now() - ($5 || ' minutes')::interval)`,
      [userId, accountId, `${status}-${ageMinutes}@example.com`, status, ageMinutes],
    );
  }

  async function auditedConfirmations(): Promise<boolean[]> {
    const result = await pool.query<{ new_value: string }>(
      `SELECT new_value FROM audit_log
        WHERE event_type = 'email_send_unconfirmed' AND record_id = $1 ORDER BY new_value`,
      [accountId],
    );
    return result.rows.map(
      // Safe: the sweep writes this shape, and the assertion fails on any other.
      (row) => (JSON.parse(row.new_value) as { provider_confirmed: boolean }).provider_confirmed,
    );
  }

  it('reports a send left unanswered or unfiled for an hour, saying which', async () => {
    await insertIntent('pending', 90);
    await insertIntent('sent', 90);

    await sweepUnsettledIntents();

    const statuses = await pool.query<{ status: string }>(
      'SELECT status FROM email_send_intents WHERE connected_account_id = $1',
      [accountId],
    );
    expect(statuses.rows.map((row) => row.status)).toEqual(['unconfirmed', 'unconfirmed']);
    expect((await auditedConfirmations()).sort()).toEqual([false, true]);
  });

  it('leaves a recent send and a settled one alone', async () => {
    await insertIntent('pending', 5);
    await insertIntent('not_sent', 90);
    await insertIntent('filed', 90);

    await sweepUnsettledIntents();

    expect(await auditedConfirmations()).toEqual([]);
  });
});

describe('setRlsUserIdTo', () => {
  async function inTransaction(userId: string | null): Promise<string | null> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setRlsUserIdTo(client, userId);
      const setting = await client.query<{ value: string | null }>(
        `SELECT current_setting('app.current_user_id', true) AS value`,
      );
      await client.query('ROLLBACK');
      return setting.rows[0]?.value ?? null;
    } finally {
      client.release();
    }
  }

  it('sets the named user for the transaction', async () => {
    expect(await inTransaction(userId)).toBe(userId);
  });

  it('sets the unauthenticated value for null', async () => {
    expect(await inTransaction(null)).toBe('');
  });
});

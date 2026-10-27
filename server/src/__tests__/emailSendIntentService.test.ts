/**
 * Send intents: the state each send outcome leaves, and the sync engine filing a sent
 * message whose own filing failed. Real database; the provider is faked at its seam.
 */

import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { vi } from 'vitest';

import pool from '../db.js';
import { erasedAddressDigest, lockForErasure } from '../services/mail/gdprRedaction.js';
import { updateActivity } from '../services/activityService.js';
import logger from '../logger.js';
import {
  upsertOAuthAccount,
  type ClaimedSyncAccount,
} from '../services/connectedAccountService.js';
import {
  claimSendIntent,
  DEFAULT_EMAIL_SEND_MAX_PER_HOUR,
  emailSendMaxPerHour,
  fileReconciledIntents,
  lockReconcilableIntents,
  markIntentNotSent,
  SEND_LIMIT_LOCK_NAMESPACE,
  sweepUnsettledIntents,
  type NewSendIntent,
} from '../services/emailSendIntentService.js';
import { setRlsUserIdTo } from '../services/rlsContextService.js';
import { PRIVATE_EMAIL_SUBJECT, setThreadPrivacy } from '../services/emailMessageService.js';
import {
  getRecordAuditLog,
  maskAuditEvent,
  PRIVATE_REDACTED_TEXT,
} from '../services/auditService.js';
import {
  IDEMPOTENCY_KEY_REUSED,
  replaySend,
  SEND_ALREADY_SENT,
  SEND_IN_PROGRESS,
  SEND_UNCONFIRMED,
  sendEmail,
  SENT_NOT_RECORDED,
  type SendIdempotency,
} from '../services/emailSendService.js';
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

import {
  clearAuditLogFor,
  failClientQueriesContaining,
  failMessageInsert,
  insertParkedMailbox,
  stubClientQueries,
  purgeFixtureUsers,
} from './testUtils.js';

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
    excludedDomains: [],
  };
  await syncOneAccount(account, provider);
}

/** A key for one send, as the client generates per compose. */
function freshKey(): SendIdempotency {
  return { key: randomUUID(), requestHash: 'test-request' };
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
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
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
  await pool.query('DELETE FROM email_send_ledger WHERE user_id = $1', [userId]);
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

    await sendEmail(typed(), userId, actor, freshKey(), { provider });

    expect(statusDuringSend).toBe('pending');
  });

  it('is filed by a send that stored, and keeps no copy of the text', async () => {
    const { provider } = sender(async () => ({ providerMessageId: 'gm-filed', threadId: null }));

    const response = await sendEmail(typed(), userId, actor, freshKey(), { provider });

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

    await expect(sendEmail(typed(), userId, actor, freshKey(), { provider })).rejects.toBeDefined();

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

    await expect(sendEmail(typed(), userId, actor, freshKey(), { provider })).rejects.toBeDefined();

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

    await sendEmail(typed(), userId, actor, freshKey(), { provider });

    expect(notesDuringSend).toBeNull();
  });

  it('still files when recording the provider id fails, and takes the id from the message', async () => {
    failQueriesContaining("SET status = 'sent'");
    const { provider } = sender(async () => ({ providerMessageId: 'gm-unmarked', threadId: null }));

    await sendEmail(typed(), userId, actor, freshKey(), { provider });

    expect(await intent()).toMatchObject({ status: 'filed', provider_message_id: 'gm-unmarked' });
  });

  it('answers with the refusal even when the intent cannot be settled', async () => {
    failQueriesContaining("SET status = 'not_sent'");
    const { provider } = sender(async () => {
      throw sendFailure(SEND_NOT_SENT, 'test');
    });

    await expect(sendEmail(typed(), userId, actor, freshKey(), { provider })).rejects.toMatchObject(
      {
        code: 'SEND_FAILED',
      },
    );
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

    await expect(sendEmail(typed(), userId, actor, freshKey(), { provider })).rejects.toMatchObject(
      {
        code: SENT_NOT_RECORDED,
      },
    );
  });

  it('stays sent, with the provider id, when storing fails after the provider accepted', async () => {
    const { provider } = sender(async () => ({ providerMessageId: 'gm-stored', threadId: null }));
    failMessageInsert();

    await expect(sendEmail(typed(), userId, actor, freshKey(), { provider })).rejects.toMatchObject(
      {
        code: SENT_NOT_RECORDED,
      },
    );

    expect(await intent()).toMatchObject({ status: 'sent', provider_message_id: 'gm-stored' });
  });
});

/** Stores a private message in this mailbox to answer, in a thread of its own. */
async function privateParent(threadId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO email_messages
       (connected_account_id, provider_message_id, thread_id, direction, from_address,
        rfc_message_id, is_private)
     VALUES ($1, $2, $3, 'inbound', 'someone@example.net', $4, true)
     RETURNING id`,
    [accountId, `INBOX:${threadId}`, threadId, `${threadId}@x.test`],
  );
  return result.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
}

async function filedRow(
  contactId: string,
): Promise<{ notes: string | null; isPrivate: boolean; threadId: string }> {
  const result = await pool.query<{ notes: string | null; is_private: boolean; thread_id: string }>(
    `SELECT a.notes, m.is_private, m.thread_id
       FROM activities a
       JOIN email_message_links l ON l.record_type = 'contact' AND l.record_id = a.contact_id
       JOIN email_messages m ON m.id = l.email_message_id AND m.direction = 'outbound'
      WHERE a.contact_id = $1`,
    [contactId],
  );
  const row = result.rows[0]!; // Safe: each caller files exactly one send from this contact.
  return { notes: row.notes, isPrivate: row.is_private, threadId: row.thread_id };
}

describe('the sync engine filing a send', () => {
  it('files a send whose own filing failed: its record, one activity, one audit', async () => {
    const contactId = await createContact('failed-filing');
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-recover',
      threadId: null,
    }));
    failMessageInsert();
    await expect(
      sendEmail(
        typed({ record_type: 'contact', record_id: contactId }),
        userId,
        actor,
        freshKey(),
        {
          provider,
        },
      ),
    ).rejects.toMatchObject({ code: SENT_NOT_RECORDED });
    vi.restoreAllMocks();

    await syncPage([await sentCopy(onlyDocument(sent), 'gm-recover')]);

    expect((await intent()).status).toBe('filed');
    expect(await manualLinksTo(contactId)).toBe(1);
    expect(await activitiesFor(contactId)).toBe(1);
    expect(await auditsOf('email_sent')).toBe(1);
  });

  it('files a recovered send into a private thread without its body', async () => {
    const contactId = await createContact('private-recover');
    // A thread that already holds private mail; the Sent copy is filed into it below.
    await pool.query(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address,
          is_private)
       VALUES ($1, 'INBOX:private-root', 'thread-gm-private', 'inbound', 'x@example.net', true)`,
      [accountId],
    );
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-private',
      threadId: null,
    }));
    failMessageInsert();
    await expect(
      sendEmail(
        typed({ record_type: 'contact', record_id: contactId }),
        userId,
        actor,
        freshKey(),
        {
          provider,
        },
      ),
    ).rejects.toMatchObject({ code: SENT_NOT_RECORDED });
    vi.restoreAllMocks();

    await syncPage([
      await sentCopy(onlyDocument(sent), 'gm-private', { threadId: 'thread-gm-private' }),
    ]);

    const activity = await pool.query<{ subject: string; notes: string | null; linked: boolean }>(
      `SELECT subject, notes, metadata->>'email_message_id' IS NOT NULL AS linked
         FROM activities WHERE contact_id = $1`,
      [contactId],
    );
    expect((await intent()).status).toBe('filed');
    expect(activity.rows).toEqual([{ subject: PRIVATE_EMAIL_SUBJECT, notes: null, linked: true }]);
  });

  it('keeps a recovered reply private when sync files its copy under a thread of its own', async () => {
    const parent = await privateParent('private-convo');
    const contactId = await createContact('recover-elsewhere');
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-elsewhere',
      threadId: null,
    }));
    failMessageInsert();
    await expect(
      sendEmail(
        typed({ in_reply_to_message_id: parent, record_type: 'contact', record_id: contactId }),
        userId,
        actor,
        freshKey(),
        { provider },
      ),
    ).rejects.toMatchObject({ code: SENT_NOT_RECORDED });
    vi.restoreAllMocks();

    // Sync derives a thread of its own, which holds nothing private.
    await syncPage([
      await sentCopy(onlyDocument(sent), 'gm-elsewhere', { threadId: 'synced-elsewhere' }),
    ]);

    expect(await filedRow(contactId)).toEqual({
      notes: null,
      isPrivate: true,
      threadId: 'synced-elsewhere',
    });
  });

  it('keeps a reply private when sync files it before the send path records it', async () => {
    const parent = await privateParent('private-early');
    const contactId = await createContact('sync-first');
    const { provider } = sender(async (mime) => {
      // The Sent copy reaches sync while the provider call is still returning.
      await syncPage([await sentCopy(mime, 'gm-early', { threadId: 'synced-first' })]);
      return { providerMessageId: 'gm-early', threadId: null };
    });

    await sendEmail(
      typed({ in_reply_to_message_id: parent, record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const filed = await filedRow(contactId);
    expect(filed.notes).toBeNull();
    expect(filed.isPrivate).toBe(true);
  });

  it('files a recovered send to an erased address without its subject or body', async () => {
    const erased = 'erased-recovered@example.net';
    const erasureRecord = randomUUID();
    await pool.query(
      `INSERT INTO gdpr_deletion_log
         (record_type, record_id, requested_by, erasure_scope, completed_at, erased_address_hmac)
       VALUES ('contact', $1, $2, '{}', now(), $3)`,
      [erasureRecord, userId, erasedAddressDigest(erased)],
    );
    const contactId = await createContact('erased-recover');
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-erased',
      threadId: null,
    }));
    failMessageInsert();
    try {
      await expect(
        sendEmail(
          typed({ to: [erased], record_type: 'contact', record_id: contactId }),
          userId,
          actor,
          freshKey(),
          { provider },
        ),
      ).rejects.toMatchObject({ code: SENT_NOT_RECORDED });
      vi.restoreAllMocks();

      await syncPage([await sentCopy(onlyDocument(sent), 'gm-erased')]);

      const activity = await pool.query<{ subject: string; notes: string | null }>(
        'SELECT subject, notes FROM activities WHERE contact_id = $1',
        [contactId],
      );
      expect(activity.rows).toEqual([{ subject: '[GDPR deleted]', notes: null }]);
    } finally {
      await pool.query('DELETE FROM gdpr_deletion_log WHERE record_id = $1', [erasureRecord]);
    }
  });

  it('files an unconfirmed Graph send by the draft id it recorded before submitting', async () => {
    const contactId = await createContact('graph-unknown');
    const { provider, sent } = sender(async (_mime, onPrepared) => {
      await onPrepared?.('graph-draft-1');
      throw sendFailure(SEND_OUTCOME_UNKNOWN, 'test');
    });
    await expect(
      sendEmail(
        typed({ record_type: 'contact', record_id: contactId }),
        userId,
        actor,
        freshKey(),
        {
          provider,
        },
      ),
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
      sendEmail(
        typed({ record_type: 'contact', record_id: contactId }),
        userId,
        actor,
        freshKey(),
        {
          provider,
        },
      ),
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

    await sendEmail(
      typed({ record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

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
    await sendEmail(
      typed({ record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

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
    await expect(
      sendEmail(typed(overrides), userId, actor, freshKey(), { provider }),
    ).rejects.toMatchObject({
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

    const sending = sendEmail(typed(), userId, actor, freshKey(), { provider });
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

/**
 * Waits until some session is blocked on one advisory lock, named by a `pg_locks` predicate
 * over `classid`, `objid` and `objsubid`.
 */
async function waitForAdvisoryLockWaiter(
  lockPredicate: string,
  params: unknown[],
  label: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND ${lockPredicate}`,
      params,
    );
    if ((waiting.rowCount ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no session ever waited on the ${label}`);
}

/** Waits until another session is blocked on a user's send-limit lock, and no other lock. */
function waitForSendLimitLockWaiter(): Promise<void> {
  return waitForAdvisoryLockWaiter('classid = $1', [SEND_LIMIT_LOCK_NAMESPACE], 'send-limit lock');
}

/**
 * Waits until a session is blocked on the GDPR ingest lock: a two-key advisory lock shows its
 * keys as classid (the first, as an unsigned 32-bit value) and objid, with objsubid 2.
 */
function waitForIngestLockWaiter(): Promise<void> {
  return waitForAdvisoryLockWaiter(
    `classid::bigint = (hashtext('gdpr-email-ingest')::bigint + 4294967296) % 4294967296
       AND objid = 0 AND objsubid = 2`,
    [],
    'GDPR ingest lock',
  );
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
         (idempotency_key, request_hash, user_id, actor_name, connected_account_id, rfc_message_id, status, updated_at)
       VALUES (gen_random_uuid(), '', $1, 'Intent Rep', $2, 'flag-off@example.com', 'sent', now() - interval '2 hours')`,
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
         (idempotency_key, request_hash, user_id, actor_name, connected_account_id, rfc_message_id, status, to_addresses,
          updated_at)
       VALUES (gen_random_uuid(), '', $1, 'Intent Rep', $2, $3, $4, '{someone@example.net}',
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

describe('idempotent send', () => {
  const keyed = (key: string = randomUUID(), requestHash = 'same-request'): SendIdempotency => ({
    key,
    requestHash,
  });

  /** A provider that answers after the test releases it, counting submissions. */
  function heldSender(): { provider: MailProvider; release: () => void; calls: () => number } {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { provider, sent } = sender(async () => {
      await gate;
      return { providerMessageId: `gm-held-${sent.length}`, threadId: null };
    });
    return { provider, release: () => release(), calls: () => sent.length };
  }

  /**
   * Runs two sends with one key at once. Either may win, so the loser is awaited first —
   * the winner cannot finish until the provider is released.
   */
  async function twoAtOnce(key: SendIdempotency, held: ReturnType<typeof heldSender>) {
    const sends = [0, 1].map(() =>
      sendEmail(typed(), userId, actor, key, { provider: held.provider }),
    );
    await Promise.race(sends.map((send) => send.catch(() => undefined)));
    held.release();
    return Promise.allSettled(sends);
  }

  it('sends once when the same key is submitted twice', async () => {
    const key = keyed();
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-once',
      threadId: null,
    }));

    const first = await sendEmail(typed(), userId, actor, key, { provider });
    const second = await sendEmail(typed(), userId, actor, key, { provider });

    expect(sent).toHaveLength(1);
    expect(second.message.id).toBe(first.message.id);
  });

  it('sends once when the same key is submitted twice at the same moment', async () => {
    const key = keyed();
    const held = heldSender();

    const settled = await twoAtOnce(key, held);

    expect(settled.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(settled.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: SEND_IN_PROGRESS },
    });
    expect(held.calls()).toBe(1);
  });

  it('never resends a send whose outcome is unknown', async () => {
    const key = keyed();
    const { provider, sent } = sender(async () => {
      throw sendFailure(SEND_OUTCOME_UNKNOWN, 'test');
    });
    await expect(sendEmail(typed(), userId, actor, key, { provider })).rejects.toBeDefined();

    await expect(sendEmail(typed(), userId, actor, key, { provider })).rejects.toMatchObject({
      code: SEND_UNCONFIRMED,
    });
    expect(sent).toHaveLength(1);
  });

  it('answers a repeat of a send that went out but was not filed without sending again', async () => {
    const key = keyed();
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-unfiled',
      threadId: null,
    }));
    failMessageInsert();
    await expect(sendEmail(typed(), userId, actor, key, { provider })).rejects.toMatchObject({
      code: SENT_NOT_RECORDED,
    });
    vi.restoreAllMocks();

    await expect(sendEmail(typed(), userId, actor, key, { provider })).rejects.toMatchObject({
      code: SEND_ALREADY_SENT,
    });
    expect(sent).toHaveLength(1);
  });

  it('sends again under the same key after a refusal that sent nothing', async () => {
    const key = keyed();
    let refuse = true;
    const { provider, sent } = sender(async () => {
      if (refuse) throw sendFailure(SEND_NOT_SENT, 'test');
      return { providerMessageId: 'gm-retried', threadId: null };
    });
    await expect(sendEmail(typed(), userId, actor, key, { provider })).rejects.toBeDefined();
    refuse = false;

    await sendEmail(typed(), userId, actor, key, { provider });

    expect(sent).toHaveLength(2);
    expect((await intent()).status).toBe('filed');
  });

  it('lets only one of two simultaneous retries of a refused send through', async () => {
    const key = keyed();
    const { provider: refusing } = sender(async () => {
      throw sendFailure(SEND_NOT_SENT, 'test');
    });
    await expect(
      sendEmail(typed(), userId, actor, key, { provider: refusing }),
    ).rejects.toBeDefined();
    const held = heldSender();

    const settled = await twoAtOnce(key, held);

    expect(settled.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(settled.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: SEND_IN_PROGRESS },
    });
    expect(held.calls()).toBe(1);
  });

  it('refuses a key reused for a different message', async () => {
    const key = randomUUID();
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-reused',
      threadId: null,
    }));
    await sendEmail(typed(), userId, actor, keyed(key, 'first-request'), { provider });

    await expect(
      sendEmail(typed({ subject: 'Different' }), userId, actor, keyed(key, 'other-request'), {
        provider,
      }),
    ).rejects.toMatchObject({ code: IDEMPOTENCY_KEY_REUSED });
    expect(sent).toHaveLength(1);
  });

  /** Writes an intent under a key directly, in a state no send path can be paused in. */
  async function intentUnderKey(
    key: SendIdempotency,
    status: string,
    emailMessageId: string | null = null,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO email_send_intents
         (idempotency_key, request_hash, user_id, actor_name, connected_account_id,
          rfc_message_id, status, email_message_id)
       VALUES ($1, $2, $3, 'Intent Rep', $4, $5, $6, $7)`,
      [
        key.key,
        key.requestHash,
        userId,
        accountId,
        `${key.key}@example.com`,
        status,
        emailMessageId,
      ],
    );
  }

  /** Answers the given statements with no rows, as losing a race to another request would. */
  function noRowsFor(...fragments: string[]): void {
    // Safe: called below with exactly the arguments the caller passed.
    const realQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
    // Safe: delegates every overload unchanged; the cast only satisfies the spy's type.
    vi.spyOn(pool, 'query').mockImplementation(((text: unknown, ...rest: unknown[]) =>
      typeof text === 'string' && fragments.some((fragment) => text.includes(fragment))
        ? Promise.resolve({ rows: [], rowCount: 0 })
        : realQuery(text, ...rest)) as typeof pool.query);
  }

  it('answers a repeat of a filed send whose message was since deleted as already sent', async () => {
    const key = keyed();
    const { provider } = sender(async () => ({ providerMessageId: 'gm-gone', threadId: null }));
    await sendEmail(typed(), userId, actor, key, { provider });
    await pool.query('DELETE FROM email_messages WHERE connected_account_id = $1', [accountId]);

    await expect(replaySend(userId, key)).rejects.toMatchObject({ code: SEND_ALREADY_SENT });
  });

  it('answers a repeat while the first send is in flight as in progress', async () => {
    const key = keyed();
    await intentUnderKey(key, 'pending');

    await expect(replaySend(userId, key)).rejects.toMatchObject({ code: SEND_IN_PROGRESS });
  });

  it('refuses a refused send retried under its key with a different message', async () => {
    const key = keyed();
    await intentUnderKey(key, 'not_sent');

    await expect(replaySend(userId, keyed(key.key, 'other-request'))).rejects.toMatchObject({
      code: IDEMPOTENCY_KEY_REUSED,
    });
  });

  it('says not sent, not in progress, when a concurrent retry was refused first', async () => {
    const key = keyed();
    await intentUnderKey(key, 'not_sent');
    stubClientQueries(["SET status = 'pending', actor_name"], 'empty');
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-never',
      threadId: null,
    }));

    await expect(sendEmail(typed(), userId, actor, key, { provider })).rejects.toMatchObject({
      code: 'SEND_FAILED',
    });
    expect(sent).toHaveLength(0);
  });

  it('fails loudly when a key it could not claim has no intent', async () => {
    stubClientQueries(
      ['ON CONFLICT (user_id, idempotency_key)', "SET status = 'pending', actor_name"],
      'empty',
    );
    noRowsFor('FROM email_send_intents i');
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-orphan',
      threadId: null,
    }));

    await expect(sendEmail(typed(), userId, actor, keyed(), { provider })).rejects.toThrow(
      'a claimed key has no intent',
    );
    expect(sent).toHaveLength(0);
  });

  describe('replaySend', () => {
    it('has nothing to replay for a new key, or for a refused send to retry', async () => {
      expect(await replaySend(userId, keyed())).toBeNull();

      const key = keyed();
      const { provider } = sender(async () => {
        throw sendFailure(SEND_NOT_SENT, 'test');
      });
      await expect(sendEmail(typed(), userId, actor, key, { provider })).rejects.toBeDefined();
      expect(await replaySend(userId, key)).toBeNull();
    });

    it('replays a filed send as its first response', async () => {
      const key = keyed();
      const { provider } = sender(async () => ({ providerMessageId: 'gm-replay', threadId: null }));
      const first = await sendEmail(typed(), userId, actor, key, { provider });

      expect(await replaySend(userId, key)).toEqual(first);
    });
  });
});

describe('the hourly send limit', () => {
  afterEach(() => {
    delete process.env.EMAIL_SEND_MAX_PER_HOUR;
    delete process.env.TEST_RATE_LIMIT;
  });

  function newIntent(idempotencyKey: string = randomUUID()): NewSendIntent {
    return {
      userId,
      actorName: 'Intent Rep',
      connectedAccountId: accountId,
      rfcMessageId: `${randomUUID()}@example.com`,
      recordType: null,
      recordId: null,
      activityNotes: null,
      threadPrivate: false,
      toAddresses: ['someone@example.net'],
      ccAddresses: [],
      idempotencyKey,
      requestHash: 'limit-request',
      unresolvedMergeTags: [],
    };
  }

  /** An earlier send, with the ledger entry its claim would have written unless refused. */
  async function existingIntent(
    status: string,
    ageMinutes = 0,
    mailbox: string = accountId,
  ): Promise<void> {
    const intent = await pool.query<{ id: string }>(
      `INSERT INTO email_send_intents
         (idempotency_key, request_hash, user_id, actor_name, connected_account_id,
          rfc_message_id, status, created_at)
       VALUES (gen_random_uuid(), '', $1, 'Intent Rep', $2, $3, $4,
               now() - ($5 || ' minutes')::interval)
       RETURNING id`,
      [userId, mailbox, `${randomUUID()}@example.com`, status, ageMinutes],
    );
    if (status === 'not_sent') return;
    await pool.query(
      `INSERT INTO email_send_ledger (user_id, intent_id, created_at)
       VALUES ($1, $2, now() - ($3 || ' minutes')::interval)`,
      // Safe: an INSERT … RETURNING returns its one row.
      [userId, intent.rows[0]!.id, ageMinutes],
    );
  }

  async function intentCount(): Promise<number> {
    return countRows('SELECT 1 FROM email_send_intents WHERE user_id = $1', [userId]);
  }

  it('refuses the claim past the ceiling, keeps nothing, and says when to retry', async () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '2';
    await claimSendIntent(newIntent(), true);
    await claimSendIntent(newIntent(), true);

    const third = await claimSendIntent(newIntent(), true);

    expect(third.kind).toBe('limited');
    // Safe: narrowed by the assertion above.
    const { retryAfterSeconds } = third as { retryAfterSeconds: number };
    expect(retryAfterSeconds).toBeGreaterThan(60 * 59);
    expect(retryAfterSeconds).toBeLessThanOrEqual(60 * 60);
    expect(await intentCount()).toBe(2);
  });

  it('counts ledger entries, not intents, whatever their status', async () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '3';
    for (const status of ['not_sent', 'not_sent', 'not_sent']) await existingIntent(status);
    expect((await claimSendIntent(newIntent(), true)).kind).toBe('claimed');

    for (const status of ['sent', 'unconfirmed']) await existingIntent(status);
    expect((await claimSendIntent(newIntent(), true)).kind).toBe('limited');
  });

  it('ignores sends older than the hour', async () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    await existingIntent('filed', 61);

    expect((await claimSendIntent(newIntent(), true)).kind).toBe('claimed');
  });

  it('counts a refused send retried under its key, and leaves it refused when over', async () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    const key = randomUUID();
    const first = await claimSendIntent(newIntent(key), true);
    // Safe: the first claim of a fresh key under the ceiling is always claimed.
    await markIntentNotSent((first as { intentId: string }).intentId);
    await existingIntent('filed');

    expect((await claimSendIntent(newIntent(key), true)).kind).toBe('limited');
    const status = await pool.query<{ status: string }>(
      'SELECT status FROM email_send_intents WHERE idempotency_key = $1',
      [key],
    );
    expect(status.rows[0]?.status).toBe('not_sent');
  });

  it('waits for a concurrent claim by the same user, then counts it', async () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    const holder = await pool.connect();
    try {
      // Another claim for this user, mid-transaction: holding the lock, its send not committed.
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        SEND_LIMIT_LOCK_NAMESPACE,
        userId,
      ]);
      await holder.query(
        `WITH claimed AS (
           INSERT INTO email_send_intents
             (idempotency_key, request_hash, user_id, actor_name, connected_account_id,
              rfc_message_id)
           VALUES (gen_random_uuid(), '', $1, 'Intent Rep', $2, $3)
           RETURNING id
         )
         INSERT INTO email_send_ledger (user_id, intent_id) SELECT $1, id FROM claimed`,
        [userId, accountId, `${randomUUID()}@example.com`],
      );
      const claiming = claimSendIntent(newIntent(), true);
      // Without the lock this claim would finish now, counting only itself.
      await waitForSendLimitLockWaiter();
      await holder.query('COMMIT');

      expect((await claiming).kind).toBe('limited');
    } finally {
      holder.release();
    }
  });

  it('never limits a key already taken, which sends nothing', async () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    const key = randomUUID();
    await claimSendIntent(newIntent(key), true);
    // Over the ceiling now, so a count taken before the key check would refuse the repeat.
    await existingIntent('filed');

    expect((await claimSendIntent(newIntent(key), true)).kind).toBe('taken');
  });

  it('says to retry when every send over the ceiling has left the window', async () => {
    // A ceiling lowered since: two sends are over it, so the newer must leave, not the oldest.
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    await existingIntent('filed', 50);
    await existingIntent('filed', 10);

    const claim = await claimSendIntent(newIntent(), true);

    expect(claim.kind).toBe('limited');
    // Safe: narrowed by the assertion above.
    const { retryAfterSeconds } = claim as { retryAfterSeconds: number };
    expect(retryAfterSeconds).toBeGreaterThan(50 * 60 - 10);
    expect(retryAfterSeconds).toBeLessThanOrEqual(50 * 60);
  });

  it('refuses before any other work when the user is already at the ceiling', async () => {
    process.env.TEST_RATE_LIMIT = 'true';
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    await existingIntent('filed');
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-over',
      threadId: null,
    }));

    // A parent that does not exist: without the early refusal this would answer 404.
    await expect(
      sendEmail(
        typed({ in_reply_to_message_id: '00000000-0000-4000-8000-0000000000c1' }),
        userId,
        actor,
        { key: randomUUID(), requestHash: 'over' },
        { provider },
      ),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(sent).toHaveLength(0);
  });

  it('answers a duplicate at the ceiling from its first send, never refusing it', async () => {
    const key: SendIdempotency = { key: randomUUID(), requestHash: 'duplicate' };
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-dup',
      threadId: null,
    }));
    const first = await sendEmail(typed(), userId, actor, key, { provider });
    process.env.TEST_RATE_LIMIT = 'true';
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';

    const duplicate = await sendEmail(typed(), userId, actor, key, { provider });

    expect(duplicate.message.id).toBe(first.message.id);
    expect(sent).toHaveLength(1);
  });

  it('keeps counting after the mailbox the sends went through is disconnected', async () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    const other = await insertParkedMailbox(userId, `${FILE_PREFIX}-reconnected@example.com`);
    await existingIntent('filed', 0, other);
    await pool.query('DELETE FROM connected_accounts WHERE id = $1', [other]);

    expect((await claimSendIntent(newIntent(), true)).kind).toBe('limited');
  });

  it('uncounts a refusal that sent nothing', async () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    const first = await claimSendIntent(newIntent(), true);
    // Safe: the first claim of a fresh key under the ceiling is always claimed.
    await markIntentNotSent((first as { intentId: string }).intentId);

    expect(await countRows('SELECT 1 FROM email_send_ledger WHERE user_id = $1', [userId])).toBe(0);
    expect((await claimSendIntent(newIntent(), true)).kind).toBe('claimed');
  });

  it('refuses a retry of a refused send early too, since it would send', async () => {
    process.env.TEST_RATE_LIMIT = 'true';
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    const key: SendIdempotency = { key: randomUUID(), requestHash: 'retry-over' };
    const { provider: refusing } = sender(async () => {
      throw sendFailure(SEND_NOT_SENT, 'test');
    });
    await expect(
      sendEmail(typed(), userId, actor, key, { provider: refusing }),
    ).rejects.toBeDefined();
    await existingIntent('filed');
    const { provider, sent } = sender(async () => ({
      providerMessageId: 'gm-retry',
      threadId: null,
    }));

    // A parent that does not exist: without the early refusal this would answer 404.
    await expect(
      sendEmail(
        typed({ in_reply_to_message_id: '00000000-0000-4000-8000-0000000000c2' }),
        userId,
        actor,
        key,
        { provider },
      ),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(sent).toHaveLength(0);
  });

  it('is not enforced where every limiter is bypassed', async () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    await existingIntent('filed');

    expect((await claimSendIntent(newIntent(), false)).kind).toBe('claimed');
  });
});

describe('emailSendMaxPerHour', () => {
  afterEach(() => {
    delete process.env.EMAIL_SEND_MAX_PER_HOUR;
  });

  it('reads a positive integer override', () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '25';

    expect(emailSendMaxPerHour()).toBe(25);
  });

  it.each(['', '0', '-5', '2.5', 'many'])('falls back to the default for %j', (value) => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = value;

    expect(emailSendMaxPerHour()).toBe(DEFAULT_EMAIL_SEND_MAX_PER_HOUR);
  });

  it('uses the default when unset', () => {
    expect(emailSendMaxPerHour()).toBe(DEFAULT_EMAIL_SEND_MAX_PER_HOUR);
  });
});

describe('marking a thread private after its sends were filed', () => {
  async function filedActivity(contactId: string): Promise<{
    id: string;
    subject: string;
    notes: string | null;
    scrubbed: boolean;
  }> {
    const result = await pool.query<{
      id: string;
      subject: string;
      notes: string | null;
      scrubbed: boolean;
    }>(
      `SELECT id, subject, notes, EXISTS (SELECT 1 FROM redacted_records r WHERE r.record_type = 'activity' AND r.record_id = activities.id) AS scrubbed
         FROM activities WHERE contact_id = $1`,
      [contactId],
    );
    return result.rows[0]!; // Safe: each test files exactly one send to its contact.
  }

  async function sendTo(contactId: string, providerMessageId: string): Promise<string> {
    const { provider } = sender(async () => ({ providerMessageId, threadId: null }));
    const response = await sendEmail(
      typed({ record_type: 'contact', record_id: contactId, subject: 'Quarterly numbers' }),
      userId,
      actor,
      freshKey(),
      { provider },
    );
    return response.message.id;
  }

  it('scrubs the activity already filed, and making it visible does not restore it', async () => {
    const contactId = await createContact('retro-scrub');
    const messageId = await sendTo(contactId, 'gm-retro');
    expect(await filedActivity(contactId)).toMatchObject({
      subject: 'Quarterly numbers',
      scrubbed: false,
    });

    await pool.query(
      `INSERT INTO contact_champion_blocker_signals (contact_id, status, contributing_signals)
       VALUES ($1, 'champion', '[{"description": "Quarterly numbers look great", "detected_at": "2026-01-01"}]')`,
      [contactId],
    );
    const { version } = await pool
      .query<{ version: number }>('SELECT version FROM activities WHERE contact_id = $1', [
        contactId,
      ])
      .then((result) => result.rows[0]!); // Safe: one send was filed to this contact.

    await setThreadPrivacy(messageId, userId, true, actor);
    expect(await filedActivity(contactId)).toMatchObject({
      subject: PRIVATE_EMAIL_SUBJECT,
      notes: null,
      scrubbed: true,
    });
    const after = await pool.query<{ version: number; quotes: unknown; status: string }>(
      `SELECT a.version, s.contributing_signals AS quotes, s.status
         FROM activities a JOIN contact_champion_blocker_signals s ON s.contact_id = a.contact_id
        WHERE a.contact_id = $1`,
      [contactId],
    );
    // A stale edit form fails on the bumped version; the label stays, its quotes go.
    expect(after.rows).toEqual([{ version: version + 1, quotes: [], status: 'champion' }]);
    expect(
      await countRows(
        `SELECT 1 FROM audit_log a JOIN activities t ON t.id = a.record_id
          WHERE t.contact_id = $1 AND a.event_type = 'updated' AND a.field_name = 'subject'`,
        [contactId],
      ),
    ).toBe(1);

    await setThreadPrivacy(messageId, userId, false, actor);
    expect(await filedActivity(contactId)).toMatchObject({ subject: PRIVATE_EMAIL_SUBJECT });
  });

  it('masks the scrubbed activity in its audit history and in live events', async () => {
    const contactId = await createContact('retro-audit');
    const messageId = await sendTo(contactId, 'gm-retro-audit');
    const { id } = await filedActivity(contactId);
    const [created] = await getRecordAuditLog({ recordType: 'activity', recordId: id, all: true });
    // The creation entry names the activity by its subject.
    expect(created?.record_name).toBe('Quarterly numbers');

    await setThreadPrivacy(messageId, userId, true, actor);

    const history = await getRecordAuditLog({ recordType: 'activity', recordId: id, all: true });
    const creation = history.find((row) => row.event_type === 'created');
    expect(creation?.record_name).toBe(PRIVATE_REDACTED_TEXT);
    // The scrub's own entry, written with it, stays readable.
    expect(history.find((row) => row.event_type === 'updated')?.new_value).toBe(
      PRIVATE_EMAIL_SUBJECT,
    );
    const live = await maskAuditEvent({
      ...created!, // Safe: the creation entry was asserted above, before the scrub.
      source: null,
      created_at: new Date(created!.created_at).toISOString(), // Safe: as above.
    });
    expect(live.record_name).toBe(PRIVATE_REDACTED_TEXT);
  });

  it('scrubs again text written back while the thread was visible', async () => {
    const contactId = await createContact('retro-rewritten');
    const messageId = await sendTo(contactId, 'gm-retro-rewritten');
    await setThreadPrivacy(messageId, userId, true, actor);
    await setThreadPrivacy(messageId, userId, false, actor);
    await pool.query(`UPDATE activities SET notes = 'pasted back' WHERE contact_id = $1`, [
      contactId,
    ]);

    await setThreadPrivacy(messageId, userId, true, actor);

    expect(await filedActivity(contactId)).toMatchObject({ notes: null });
  });

  it('masks text written back while visible once the thread is private again', async () => {
    const contactId = await createContact('retro-reaudit');
    const messageId = await sendTo(contactId, 'gm-retro-reaudit');
    await setThreadPrivacy(messageId, userId, true, actor);
    await setThreadPrivacy(messageId, userId, false, actor);
    const { id } = await filedActivity(contactId);
    const { version } = (
      await pool.query<{ version: number }>('SELECT version FROM activities WHERE id = $1', [id])
    ).rows[0]!; // Safe: the activity was just read.
    await updateActivity(id, { notes: 'pasted back: the numbers', version }, actor);

    await setThreadPrivacy(messageId, userId, true, actor);

    const history = await getRecordAuditLog({ recordType: 'activity', recordId: id, all: true });
    const edit = history.find((row) => row.field_name === 'notes');
    expect(edit?.new_value).toBe(PRIVATE_REDACTED_TEXT);
  });

  it('masks text written and removed while visible, once the thread is private again', async () => {
    const contactId = await createContact('retro-removed');
    const messageId = await sendTo(contactId, 'gm-retro-removed');
    await setThreadPrivacy(messageId, userId, true, actor);
    await setThreadPrivacy(messageId, userId, false, actor);
    const { id } = await filedActivity(contactId);
    const versionOf = async (): Promise<number> =>
      (await pool.query<{ version: number }>('SELECT version FROM activities WHERE id = $1', [id]))
        .rows[0]!.version; // Safe: the activity was just read.
    await updateActivity(
      id,
      { notes: 'pasted back: the numbers', version: await versionOf() },
      actor,
    );
    await updateActivity(id, { notes: null, version: await versionOf() }, actor);

    // Nothing left to scrub, but the setting changes: the cutoff still moves.
    await setThreadPrivacy(messageId, userId, true, actor);

    const history = await getRecordAuditLog({ recordType: 'activity', recordId: id, all: true });
    const notes = history.filter((row) => row.field_name === 'notes');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((row) => row.new_value !== 'pasted back: the numbers')).toBe(true);
    expect(notes.every((row) => row.old_value !== 'pasted back: the numbers')).toBe(true);
  });

  it('keeps later history readable when the thread is marked private again with no change', async () => {
    const contactId = await createContact('retro-noop');
    const messageId = await sendTo(contactId, 'gm-retro-noop');
    await setThreadPrivacy(messageId, userId, true, actor);
    const { id } = await filedActivity(contactId);
    const { version } = (
      await pool.query<{ version: number }>('SELECT version FROM activities WHERE id = $1', [id])
    ).rows[0]!; // Safe: the activity was just read.
    await updateActivity(id, { due_date: '2030-01-01', version }, actor);

    // A double-click, or a second tab: nothing is left to scrub.
    await setThreadPrivacy(messageId, userId, true, actor);

    const history = await getRecordAuditLog({ recordType: 'activity', recordId: id, all: true });
    expect(history.find((row) => row.field_name === 'due_date')?.new_value).toContain('2030');
  });

  it("waits for an erasure in progress before changing a thread's privacy", async () => {
    const contactId = await createContact('retro-locked');
    const messageId = await sendTo(contactId, 'gm-retro-locked');
    const erasure = await pool.connect();
    try {
      await erasure.query('BEGIN');
      await lockForErasure(erasure);
      let settled = false;
      const pending = setThreadPrivacy(messageId, userId, true, actor).finally(() => {
        settled = true;
      });
      await waitForIngestLockWaiter();
      // The decisive check: blocked while the erasure holds the lock, whoever else waits on it.
      expect(settled).toBe(false);
      await erasure.query('COMMIT');
      await expect(pending).resolves.toMatchObject({ isPrivate: true });
    } finally {
      erasure.release();
    }
  });

  it('leaves an activity already clean untouched, so open edit forms stay valid', async () => {
    const contactId = await createContact('retro-idempotent');
    const messageId = await sendTo(contactId, 'gm-retro-idempotent');
    await setThreadPrivacy(messageId, userId, true, actor);
    const versionOf = async (): Promise<number> =>
      (
        await pool.query<{ version: number }>(
          'SELECT version FROM activities WHERE contact_id = $1',
          [contactId],
        )
      ).rows[0]!.version; // Safe: one send was filed to this contact.
    const before = await versionOf();
    await setThreadPrivacy(messageId, userId, false, actor);

    await setThreadPrivacy(messageId, userId, true, actor);

    expect(await versionOf()).toBe(before);
  });

  it("leaves another thread's activity alone", async () => {
    const privateContact = await createContact('retro-private');
    const otherContact = await createContact('retro-other');
    const messageId = await sendTo(privateContact, 'gm-retro-a');
    await sendTo(otherContact, 'gm-retro-b');

    await setThreadPrivacy(messageId, userId, true, actor);

    expect(await filedActivity(otherContact)).toMatchObject({
      subject: 'Quarterly numbers',
      scrubbed: false,
    });
  });

  it("scrubs an activity reassigned to a colleague: the text is the mailbox owner's", async () => {
    const colleague = await createUser({
      email: `${FILE_PREFIX}-colleague@example.com`,
      name: 'Colleague',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const contactId = await createContact('retro-reassigned');
    const messageId = await sendTo(contactId, 'gm-retro-reassigned');
    await pool.query('UPDATE activities SET owner_id = $1 WHERE contact_id = $2', [
      colleague.id,
      contactId,
    ]);

    await setThreadPrivacy(messageId, userId, true, actor);

    expect(await filedActivity(contactId)).toMatchObject({
      subject: PRIVATE_EMAIL_SUBJECT,
      scrubbed: true,
    });
  });
});

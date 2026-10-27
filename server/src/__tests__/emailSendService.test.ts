/**
 * The send path against the real test database, with the provider faked at its seam.
 *
 * What is under test is everything after the driver: what is stored, how a reply threads,
 * what is matched and audited, and which API code each driver failure becomes.
 */

import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { simpleParser } from 'mailparser';
import { vi } from 'vitest';

import pool from '../db.js';
import { erasedAddressDigest } from '../services/mail/gdprRedaction.js';
import { createImapAccount, upsertOAuthAccount } from '../services/connectedAccountService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import {
  sendEmail,
  SENT_NOT_RECORDED,
  type SendIdempotency,
  requestHashOf,
} from '../services/emailSendService.js';
import type { MailProvider, SentMessage } from '../services/mail/mailProvider.js';
import { directionOf } from '../services/mail/messageBody.js';
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
import {
  sendEmailSchema,
  type SendEmailInput,
} from '@minicrm/shared/schemas/emailMessageSchema.js';

import {
  clearAuditLogFor,
  failMessageInsert,
  insertParkedMailbox,
  purgeFixtureUsers,
} from './testUtils.js';
import { PRIVATE_EMAIL_SUBJECT } from '../services/emailMessageService.js';

const FILE_PREFIX = 'emailsend';
const MAILBOX = `${FILE_PREFIX}-Mailbox@Example.com`;

let userId: string;
let otherUserId: string;
let accountId: string;
let otherAccountId: string;
let actor: { id: string; name: string };

/** A provider that records what it was handed and answers with the next queued result. */
function fakeSender(
  results: (SentMessage | Error)[] = [{ providerMessageId: 'sent-1', threadId: null }],
): {
  provider: MailProvider;
  calls: { mime: Buffer; threadHint: string | null }[];
} {
  const calls: { mime: Buffer; threadHint: string | null }[] = [];
  return {
    calls,
    provider: {
      async fetchSince() {
        throw new Error('not under test');
      },
      async send(_auth, mime, threadHint) {
        calls.push({ mime, threadHint });
        const next = results[Math.min(calls.length - 1, results.length - 1)]!;
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
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
  return result.rows[0]!.id;
}

async function storedRows(): Promise<
  {
    id: string;
    provider_message_id: string;
    thread_id: string;
    direction: string;
    from_address: string;
    rfc_message_id: string | null;
    message_body_html: string | null;
  }[]
> {
  const result = await pool.query(
    `SELECT id, provider_message_id, thread_id, direction, from_address, rfc_message_id,
            message_body_html
       FROM email_messages WHERE connected_account_id = $1 ORDER BY created_at`,
    [accountId],
  );
  return result.rows;
}

async function auditEntries(): Promise<{ new_value: string }[]> {
  const result = await pool.query<{ new_value: string }>(
    `SELECT new_value FROM audit_log
      WHERE event_type = 'email_sent' AND record_id = $1 ORDER BY created_at`,
    [accountId],
  );
  return result.rows;
}

async function deleteFixtures(): Promise<void> {
  await pool.query(
    `DELETE FROM activities WHERE owner_id IN
       (SELECT id FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com')`,
  );
  await pool.query(`DELETE FROM deals WHERE name LIKE '${FILE_PREFIX}-%'`);
  await pool.query(`DELETE FROM leads WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM contacts WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM accounts WHERE name LIKE '${FILE_PREFIX}-%'`);
  await pool.query(`DELETE FROM email_templates WHERE name LIKE '${FILE_PREFIX}-%'`);
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
}

beforeAll(async () => {
  await deleteFixtures();
  const user = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Send Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  userId = user.id;
  actor = { id: user.id, name: user.name };
  const other = await createUser({
    email: `${FILE_PREFIX}-other@example.com`,
    name: 'Other Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherUserId = other.id;

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
  otherAccountId = await insertParkedMailbox(otherUserId, `${FILE_PREFIX}-theirs@example.com`);
  // Out of the scheduler's reach: another suite's tick must not try to sync this mailbox.
  await pool.query(
    `UPDATE connected_accounts SET sync_next_attempt_at = NOW() + interval '1 day'
      WHERE id = $1`,
    [accountId],
  );
});

beforeEach(async () => {
  await pool.query('DELETE FROM email_send_intents WHERE connected_account_id = ANY($1::uuid[])', [
    [accountId, otherAccountId],
  ]);
  await pool.query('DELETE FROM email_messages WHERE connected_account_id = ANY($1::uuid[])', [
    [accountId, otherAccountId],
  ]);
  await clearAuditLogFor(userId);
  await pool.query(
    `UPDATE connected_accounts SET status = 'active', status_detail = NULL
                     WHERE id = $1`,
    [accountId],
  );
  await deleteFixturesKeepingUsers();
});

async function deleteFixturesKeepingUsers(): Promise<void> {
  await pool.query(`DELETE FROM activities WHERE owner_id = $1`, [userId]);
  await pool.query(`DELETE FROM deals WHERE name LIKE '${FILE_PREFIX}-%'`);
  await pool.query(`DELETE FROM leads WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM contacts WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM accounts WHERE name LIKE '${FILE_PREFIX}-%'`);
  await pool.query(`DELETE FROM email_templates WHERE name LIKE '${FILE_PREFIX}-%'`);
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await clearAuditLogFor(userId);
  await pool.query('DELETE FROM connected_accounts WHERE user_id = ANY($1::uuid[])', [
    [userId, otherUserId],
  ]);
  await deleteFixtures();
  await pool.end();
});

describe('sendEmail — storage', () => {
  it('stores the sent message as outbound under the id the provider returned', async () => {
    const { provider } = fakeSender();

    const sent = await sendEmail(typed(), userId, actor, freshKey(), { provider });

    const [row] = await storedRows();
    expect(row).toMatchObject({ id: sent.message.id, provider_message_id: 'sent-1' });
    expect(row!.direction).toBe('outbound');
    expect(sent.message.direction).toBe('outbound');
  });

  it('stores a from_address that a re-sync of the Sent copy still reads as outbound', async () => {
    const { provider } = fakeSender();

    await sendEmail(typed(), userId, actor, freshKey(), { provider });

    const [row] = await storedRows();
    expect(directionOf(row!.from_address, MAILBOX)).toBe('outbound');
  });

  it('stores the Message-ID the sent document carries', async () => {
    const { provider, calls } = fakeSender();

    await sendEmail(typed(), userId, actor, freshKey(), { provider });

    const parsed = await simpleParser(calls[0]!.mime);
    const [row] = await storedRows();
    expect(`<${row!.rfc_message_id}>`).toBe(parsed.messageId);
  });

  it('sends the HTML body the caller composed', async () => {
    const { provider, calls } = fakeSender();

    await sendEmail(typed({ body_html: '<p><b>bold</b></p>' }), userId, actor, freshKey(), {
      provider,
    });

    const parsed = await simpleParser(calls[0]!.mime);
    expect(parsed.html).toContain('<p><b>bold</b></p>');
  });

  it('keeps the send path thread when the sync engine stored the Sent copy first', async () => {
    await pool.query(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address)
       VALUES ($1, 'sent-1', 'rfc-root-thread', 'outbound', $2)`,
      [accountId, MAILBOX.toLowerCase()],
    );
    const parent = await storeParent({ threadId: 'parent-thread', rfcMessageId: 'p@x.test' });
    const { provider } = fakeSender();

    const sent = await sendEmail(
      typed({ in_reply_to_message_id: parent }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

    expect(sent.message.thread_id).toBe('parent-thread');
    expect((await storedRows()).filter((row) => row.provider_message_id === 'sent-1')).toHaveLength(
      1,
    );
  });
});

/** Stores an inbound message to reply to. */
async function storeParent(options: {
  threadId: string;
  rfcMessageId: string | null;
  references?: string | null;
  account?: string;
  bodyHtml?: string | null;
  bodyText?: string | null;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO email_messages
       (connected_account_id, provider_message_id, thread_id, direction, from_address,
        to_addresses, subject, sent_at, rfc_message_id, references_header,
        message_body_html, message_body_text)
     VALUES ($1, $2, $3, 'inbound', 'someone@example.net', $4, 'Original subject',
             '2026-10-01T12:00:00Z', $5, $6, $7, $8)
     RETURNING id`,
    [
      options.account ?? accountId,
      `parent-${options.threadId}`,
      options.threadId,
      [MAILBOX.toLowerCase()],
      options.rfcMessageId,
      options.references ?? null,
      options.bodyHtml ?? null,
      options.bodyText ?? null,
    ],
  );
  return result.rows[0]!.id;
}

describe('sendEmail — replies', () => {
  it('answers the parent by Message-ID and extends its References chain', async () => {
    const parent = await storeParent({
      threadId: 'gmail-thread-1',
      rfcMessageId: 'p2@x.test',
      references: '<p0@x.test> <p1@x.test>',
    });
    const { provider, calls } = fakeSender();

    await sendEmail(typed({ in_reply_to_message_id: parent }), userId, actor, freshKey(), {
      provider,
    });

    const parsed = await simpleParser(calls[0]!.mime);
    expect(parsed.inReplyTo).toBe('<p2@x.test>');
    expect(parsed.references).toEqual(['<p0@x.test>', '<p1@x.test>', '<p2@x.test>']);
  });

  it('stores the reply in its parent thread and hands that thread to the driver', async () => {
    const parent = await storeParent({ threadId: 'gmail-thread-1', rfcMessageId: 'p@x.test' });
    const { provider, calls } = fakeSender();

    const sent = await sendEmail(
      typed({ in_reply_to_message_id: parent }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

    expect(sent.message.thread_id).toBe('gmail-thread-1');
    expect(calls[0]!.threadHint).toBe('gmail-thread-1');
  });

  it('stores a new conversation under the provider thread id the sync engine will use', async () => {
    const { provider } = fakeSender([{ providerMessageId: 'sent-1', threadId: 'native-t1' }]);

    const sent = await sendEmail(typed(), userId, actor, freshKey(), { provider });

    expect(sent.message.thread_id).toBe('native-t1');
  });

  it('stores a reply under the thread the provider filed it in, which sync will use', async () => {
    const parent = await storeParent({ threadId: 'parent-t', rfcMessageId: 'p@x.test' });
    const { provider } = fakeSender([{ providerMessageId: 'sent-1', threadId: 'other-t' }]);

    const sent = await sendEmail(
      typed({ in_reply_to_message_id: parent }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

    expect(sent.message.thread_id).toBe('other-t');
  });

  it('falls back to the parent thread when the provider reports none', async () => {
    const parent = await storeParent({ threadId: 'parent-t2', rfcMessageId: 'p2@x.test' });
    const { provider } = fakeSender();

    const sent = await sendEmail(
      typed({ in_reply_to_message_id: parent }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

    expect(sent.message.thread_id).toBe('parent-t2');
  });

  it('starts a new thread when nothing is being answered', async () => {
    const { provider, calls } = fakeSender();

    await sendEmail(typed(), userId, actor, freshKey(), { provider });

    expect(calls[0]!.threadHint).toBeNull();
  });

  it('refuses to answer a message from another mailbox, before sending anything', async () => {
    const theirs = await storeParent({
      threadId: 'their-thread',
      rfcMessageId: 't@x.test',
      account: otherAccountId,
    });
    const { provider, calls } = fakeSender();

    await expect(
      sendEmail(typed({ in_reply_to_message_id: theirs }), userId, actor, freshKey(), { provider }),
    ).rejects.toMatchObject({ code: 'EMAIL_MESSAGE_NOT_FOUND' });
    expect(calls).toHaveLength(0);
  });
});

describe('sendEmail — forwards', () => {
  it('cites the original in References but answers nothing in In-Reply-To', async () => {
    const original = await storeParent({
      threadId: 'gmail-thread-2',
      rfcMessageId: 'o2@x.test',
      references: '<o1@x.test>',
      bodyHtml: '<p>Original words</p>',
    });
    const { provider, calls } = fakeSender();

    await sendEmail(typed({ forward_of_message_id: original }), userId, actor, freshKey(), {
      provider,
    });

    const parsed = await simpleParser(calls[0]!.mime);
    expect(parsed.inReplyTo).toBeUndefined();
    expect(parsed.references).toEqual(['<o1@x.test>', '<o2@x.test>']);
  });

  it('quotes the original beneath the new text, with its sender and subject', async () => {
    const original = await storeParent({
      threadId: 'gmail-thread-3',
      rfcMessageId: 'o3@x.test',
      bodyHtml: '<p>Original words</p>',
    });
    const { provider, calls } = fakeSender();

    await sendEmail(
      typed({ body_html: '<p>FYI</p>', forward_of_message_id: original }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const html = String((await simpleParser(calls[0]!.mime)).html);
    expect(html.indexOf('FYI')).toBeLessThan(html.indexOf('Forwarded message'));
    expect(html).toContain('From: someone@example.net');
    expect(html).toContain('Subject: Original subject');
    expect(html).toContain('<p>Original words</p>');
  });

  it('quotes a text-only original as escaped text', async () => {
    const original = await storeParent({
      threadId: 'gmail-thread-4',
      rfcMessageId: 'o4@x.test',
      bodyText: 'a < b\nnext line',
    });
    const { provider, calls } = fakeSender();

    await sendEmail(typed({ forward_of_message_id: original }), userId, actor, freshKey(), {
      provider,
    });

    expect(String((await simpleParser(calls[0]!.mime)).html)).toContain('a &lt; b<br>next line');
  });

  it('files the forward in the original conversation, as Gmail does', async () => {
    const original = await storeParent({ threadId: 'gmail-thread-5', rfcMessageId: 'o5@x.test' });
    const { provider, calls } = fakeSender();

    const sent = await sendEmail(
      typed({ forward_of_message_id: original }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

    expect(sent.message.thread_id).toBe('gmail-thread-5');
    expect(calls[0]!.threadHint).toBe('gmail-thread-5');
  });

  it('keeps the forwarded original out of the activity, which the whole record can read', async () => {
    const contactId = await createContact('forward-activity');
    const original = await storeParent({
      threadId: 'gmail-thread-6',
      rfcMessageId: 'o6@x.test',
      bodyHtml: '<p>Private original</p>',
    });
    const { provider } = fakeSender();

    await sendEmail(
      typed({
        body_html: '<p>See below</p>',
        forward_of_message_id: original,
        record_type: 'contact',
        record_id: contactId,
      }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const activity = await pool.query<{ notes: string }>(
      'SELECT notes FROM activities WHERE contact_id = $1',
      [contactId],
    );
    expect(activity.rows[0]!.notes).toBe('See below');
  });

  it('refuses to forward a message from another mailbox', async () => {
    const theirs = await storeParent({
      threadId: 'their-thread-2',
      rfcMessageId: 't2@x.test',
      account: otherAccountId,
    });
    const { provider, calls } = fakeSender();

    await expect(
      sendEmail(typed({ forward_of_message_id: theirs }), userId, actor, freshKey(), { provider }),
    ).rejects.toMatchObject({ code: 'EMAIL_MESSAGE_NOT_FOUND' });
    expect(calls).toHaveLength(0);
  });
});

describe('sendEmail — matching and audit', () => {
  it('links the message to a contact it names, inside the same transaction', async () => {
    const contactId = await createContact('matched');
    const { provider } = fakeSender();

    const sent = await sendEmail(
      typed({ to: [`${FILE_PREFIX}-matched@example.com`] }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const links = await pool.query(
      `SELECT record_type, record_id FROM email_message_links WHERE email_message_id = $1`,
      [sent.message.id],
    );
    expect(links.rows).toContainEqual({ record_type: 'contact', record_id: contactId });
  });

  it('files a message sent from a record against it, whatever its addresses match', async () => {
    const contactId = await createContact('sent-from');
    const { provider } = fakeSender();

    const sent = await sendEmail(
      typed({ to: ['unrelated@example.net'], record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const links = await pool.query(
      `SELECT record_type, record_id, match_type FROM email_message_links
        WHERE email_message_id = $1`,
      [sent.message.id],
    );
    expect(links.rows).toEqual([
      { record_type: 'contact', record_id: contactId, match_type: 'manual' },
    ]);
    const [entry] = await auditEntries();
    expect(JSON.parse(entry!.new_value).linked_records).toEqual([`contact:${contactId}`]);
  });

  it('files it against the record even when the sync engine stored it first', async () => {
    const contactId = await createContact('prestored-from');
    await pool.query(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address)
       VALUES ($1, 'sent-1', 't', 'outbound', $2)`,
      [accountId, MAILBOX.toLowerCase()],
    );
    const { provider } = fakeSender();

    const sent = await sendEmail(
      typed({ record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const links = await pool.query(
      'SELECT record_id FROM email_message_links WHERE email_message_id = $1',
      [sent.message.id],
    );
    expect(links.rows).toEqual([{ record_id: contactId }]);
  });

  it('audits the send with actor, recipients, and the records it was linked to', async () => {
    const contactId = await createContact('audited');
    const { provider } = fakeSender();

    await sendEmail(
      typed({ to: [`${FILE_PREFIX}-audited@example.com`], cc: ['cc@example.net'] }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const [entry] = await auditEntries();
    expect(JSON.parse(entry!.new_value)).toMatchObject({
      recipient_count: 2,
      to: [`${FILE_PREFIX}-audited@example.com`],
      cc: ['cc@example.net'],
      linked_records: [`contact:${contactId}`],
    });
    const actorRow = await pool.query(
      `SELECT changed_by_id FROM audit_log WHERE event_type = 'email_sent' AND record_id = $1`,
      [accountId],
    );
    expect(actorRow.rows[0]!.changed_by_id).toBe(userId);
  });

  it('does not re-match a row the sync engine stored first, but still audits the send', async () => {
    await createContact('prestored');
    await pool.query(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address,
          to_addresses)
       VALUES ($1, 'sent-1', 't', 'outbound', $2, $3)`,
      [accountId, MAILBOX.toLowerCase(), [`${FILE_PREFIX}-prestored@example.com`]],
    );
    const { provider } = fakeSender();

    const sent = await sendEmail(
      typed({ to: [`${FILE_PREFIX}-prestored@example.com`] }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const links = await pool.query(
      'SELECT 1 FROM email_message_links WHERE email_message_id = $1',
      [sent.message.id],
    );
    expect(links.rowCount).toBe(0);
    expect(await auditEntries()).toHaveLength(1);
  });
});

describe('sendEmail — activities', () => {
  async function pipelineStage(): Promise<{ pipelineId: string; stageId: string; name: string }> {
    const result = await pool.query<{ pipeline_id: string; id: string; name: string }>(
      'SELECT pipeline_id, id, name FROM pipeline_stages ORDER BY sort_order LIMIT 1',
    );
    const row = result.rows[0]!;
    return { pipelineId: row.pipeline_id, stageId: row.id, name: row.name };
  }

  async function activitiesFor(column: string, recordId: string): Promise<{ type: string }[]> {
    const result = await pool.query<{ type: string }>(
      `SELECT type FROM activities WHERE ${column} = $1`,
      [recordId],
    );
    return result.rows;
  }

  it('files an outbound Email activity against a contact it was sent from', async () => {
    const contactId = await createContact('activity');
    const { provider } = fakeSender();

    await sendEmail(
      typed({ record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

    expect(await activitiesFor('contact_id', contactId)).toEqual([{ type: 'Email' }]);
  });

  it('associates the activity with each contact the message names', async () => {
    const contactId = await createContact('activity-assoc');
    const { provider } = fakeSender();

    await sendEmail(
      typed({
        to: [`${FILE_PREFIX}-activity-assoc@example.com`],
        record_type: 'contact',
        record_id: contactId,
      }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const participants = await pool.query<{ record_type: string; record_id: string }>(
      `SELECT p.record_type, p.record_id FROM activity_participants p
         JOIN activities a ON a.id = p.activity_id
        WHERE a.contact_id = $1`,
      [contactId],
    );
    expect(participants.rows).toEqual([{ record_type: 'contact', record_id: contactId }]);
  });

  it('audits the activity in the same transaction, under the sender', async () => {
    const contactId = await createContact('activity-audit');
    const { provider } = fakeSender();

    await sendEmail(
      typed({ record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

    const activity = await pool.query<{ id: string }>(
      'SELECT id FROM activities WHERE contact_id = $1',
      [contactId],
    );
    const audit = await pool.query(
      `SELECT changed_by_id FROM audit_log
        WHERE record_type = 'activity' AND record_id = $1 AND event_type = 'created'`,
      [activity.rows[0]!.id],
    );
    expect(audit.rows).toEqual([{ changed_by_id: userId }]);
  });

  it('files the activity against an account', async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`${FILE_PREFIX}-acct`, userId],
    );
    const { provider } = fakeSender();

    await sendEmail(
      typed({ record_type: 'account', record_id: result.rows[0]!.id }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    expect(await activitiesFor('account_id', result.rows[0]!.id)).toHaveLength(1);
  });

  it('files the activity against a deal', async () => {
    const stage = await pipelineStage();
    const result = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`${FILE_PREFIX}-deal`, stage.name, userId, stage.pipelineId, stage.stageId],
    );
    const { provider } = fakeSender();

    await sendEmail(
      typed({ record_type: 'deal', record_id: result.rows[0]!.id }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

    expect(await activitiesFor('deal_id', result.rows[0]!.id)).toHaveLength(1);
  });

  it('writes no activity for a lead, which no activity can name', async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO leads (first_name, last_name, email, owner_id, status)
       VALUES ('Lea', 'Lead', $1, $2, 'New') RETURNING id`,
      [`${FILE_PREFIX}-lead@example.com`, userId],
    );
    const { provider } = fakeSender();

    await sendEmail(
      typed({ record_type: 'lead', record_id: result.rows[0]!.id }),
      userId,
      actor,
      freshKey(),
      {
        provider,
      },
    );

    const count = await pool.query('SELECT 1 FROM activities WHERE owner_id = $1', [userId]);
    expect(count.rowCount).toBe(0);
    expect(await storedRows()).toHaveLength(1);
  });

  it('files a message whose record no longer exists without its link or activity', async () => {
    const { provider } = fakeSender();
    const missing = '00000000-0000-4000-8000-000000000001';

    const response = await sendEmail(
      typed({ record_type: 'contact', record_id: missing }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const links = await pool.query('SELECT 1 FROM email_message_links WHERE record_id = $1', [
      missing,
    ]);
    const activities = await pool.query('SELECT 1 FROM activities WHERE contact_id = $1', [
      missing,
    ]);
    expect(response.message.id).toBeDefined();
    expect(links.rowCount).toBe(0);
    expect(activities.rowCount).toBe(0);
    expect(await auditEntries()).toHaveLength(1);
  });

  it('rolls back the stored message when storing fails after the send, and says it was sent', async () => {
    const { provider, calls } = fakeSender();
    failMessageInsert();

    await expect(sendEmail(typed(), userId, actor, freshKey(), { provider })).rejects.toMatchObject(
      {
        code: SENT_NOT_RECORDED,
      },
    );
    expect(calls).toHaveLength(1);
    expect(await storedRows()).toHaveLength(0);
    expect(await auditEntries()).toHaveLength(0);
  });
});

describe('sendEmail — templates', () => {
  async function createTemplate(
    enabled = true,
    subject = 'Hi {{contact.first_name}}',
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO email_templates (name, category, subject, body, enabled)
       VALUES ($1, 'general', $3,
               '<p>Dear {{contact.first_name}} at {{account.name | default: "your company"}}, {{contact.title}}</p>',
               $2)
       RETURNING id`,
      [`${FILE_PREFIX}-template`, enabled, subject],
    );
    return result.rows[0]!.id;
  }

  function fromTemplate(templateId: string, contactId: string): SendEmailInput {
    return typed({
      subject: undefined,
      body_html: undefined,
      template_id: templateId,
      record_type: 'contact',
      record_id: contactId,
    });
  }

  it('records a send whose rendered subject is longer than an activity subject can hold', async () => {
    const contactId = await createContact('long-subject');
    const templateId = await createTemplate(true, `${'x'.repeat(300)} {{contact.first_name}}`);
    const { provider } = fakeSender();

    await sendEmail(fromTemplate(templateId, contactId), userId, actor, freshKey(), { provider });

    const activity = await pool.query<{ subject: string }>(
      'SELECT subject FROM activities WHERE contact_id = $1',
      [contactId],
    );
    expect(activity.rows[0]!.subject).toHaveLength(255);
    expect(await storedRows()).toHaveLength(1);
  });

  it('names the activity for a subject that rendered empty', async () => {
    const contactId = await createContact('empty-subject');
    const templateId = await createTemplate(true, '{{contact.title}}');
    const { provider } = fakeSender();

    await sendEmail(fromTemplate(templateId, contactId), userId, actor, freshKey(), { provider });

    const activity = await pool.query<{ subject: string }>(
      'SELECT subject FROM activities WHERE contact_id = $1',
      [contactId],
    );
    expect(activity.rows[0]!.subject).toBe('(no subject)');
  });

  it('refuses a template that does not exist without sending', async () => {
    const contactId = await createContact('missing-template');
    const { provider, calls } = fakeSender();

    await expect(
      sendEmail(
        fromTemplate('00000000-0000-4000-8000-000000000009', contactId),
        userId,
        actor,
        freshKey(),
        {
          provider,
        },
      ),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
    expect(calls).toHaveLength(0);
  });

  it('renders the template against the record it was sent from', async () => {
    const contactId = await createContact('templated');
    const templateId = await createTemplate();
    const { provider, calls } = fakeSender();

    const sent = await sendEmail(
      typed({
        subject: undefined,
        body_html: undefined,
        template_id: templateId,
        record_type: 'contact',
        record_id: contactId,
      }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const parsed = await simpleParser(calls[0]!.mime);
    expect(parsed.subject).toBe('Hi Ada');
    expect(parsed.html).toContain('Dear Ada at your company');
    expect(sent.unresolved_merge_tags).toEqual(['contact.title']);
  });

  it('refuses a disabled template without sending', async () => {
    const contactId = await createContact('disabled');
    const templateId = await createTemplate(false);
    const { provider, calls } = fakeSender();

    await expect(
      sendEmail(
        typed({
          subject: undefined,
          body_html: undefined,
          template_id: templateId,
          record_type: 'contact',
          record_id: contactId,
        }),
        userId,
        actor,
        freshKey(),
        { provider },
      ),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
    expect(calls).toHaveLength(0);
  });
});

/** Ciphertext for an OAuth credential that has already expired. */
function expiredAuth(refreshToken: string | null): string {
  return encryptVersioned(
    JSON.stringify({
      kind: 'oauth',
      access_token: 'expired',
      refresh_token: refreshToken,
      expires_at: Date.now() - 60_000,
    }),
  ).ciphertext;
}

async function restoreValidAuth(): Promise<void> {
  await pool.query(`UPDATE connected_accounts SET auth_encrypted = $2 WHERE id = $1`, [
    accountId,
    encryptVersioned(
      JSON.stringify({
        kind: 'oauth',
        access_token: 'still-valid',
        refresh_token: 'refresh',
        expires_at: Date.now() + 24 * 60 * 60 * 1000,
      }),
    ).ciphertext,
  ]);
}

describe('sendEmail — refusals and failure mapping', () => {
  it('answers a mailbox the caller does not own as absent', async () => {
    const { provider } = fakeSender();

    await expect(
      sendEmail(typed({ connected_account_id: otherAccountId }), userId, actor, freshKey(), {
        provider,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ACCOUNT_NOT_FOUND' });
  });

  it('refuses an IMAP mailbox, which has no send driver yet', async () => {
    const imap = await createImapAccount(
      userId,
      {
        email_address: `${FILE_PREFIX}-imap@example.com`,
        host: 'imap.example.com',
        port: 993,
        username: `${FILE_PREFIX}-imap@example.com`,
        password: 'a-very-secret-password',
        secure: true,
      },
      actor,
    );
    try {
      await expect(
        sendEmail(typed({ connected_account_id: imap.id }), userId, actor, freshKey()),
      ).rejects.toMatchObject({ code: 'PROVIDER_SEND_UNSUPPORTED' });
    } finally {
      await pool.query('DELETE FROM connected_accounts WHERE id = $1', [imap.id]);
    }
  });

  it.each<[SendFailureCode, string]>([
    [SEND_NOT_SENT, 'SEND_FAILED'],
    [SEND_OUTCOME_UNKNOWN, 'SEND_NOT_CONFIRMED'],
    [SEND_RATE_LIMITED, 'RATE_LIMITED'],
    [SEND_SCOPE_MISSING, 'RECONNECT_REQUIRED'],
    [SEND_AUTH_EXPIRED, 'PROVIDER_AUTH_EXPIRED'],
  ])('maps the driver code %s to %s and stores nothing', async (driverCode, apiCode) => {
    const { provider } = fakeSender([sendFailure(driverCode, 'Gmail')]);

    await expect(sendEmail(typed(), userId, actor, freshKey(), { provider })).rejects.toMatchObject(
      {
        code: apiCode,
      },
    );
    expect(await storedRows()).toHaveLength(0);
  });

  it('asks for a reconnect when the grant cannot even read the mailbox', async () => {
    // No injected provider: the real Gmail driver refuses the empty grant at construction.
    await expect(sendEmail(typed(), userId, actor, freshKey())).rejects.toMatchObject({
      code: 'RECONNECT_REQUIRED',
    });
  });

  it('reports a token refresh that failed in transit as not sent', async () => {
    await pool.query(`UPDATE connected_accounts SET auth_encrypted = $2 WHERE id = $1`, [
      accountId,
      expiredAuth('refresh'),
    ]);
    const { provider, calls } = fakeSender();
    try {
      await expect(
        sendEmail(typed(), userId, actor, freshKey(), {
          provider,
          refresh: () => Promise.reject(new Error('socket hang up')),
        }),
      ).rejects.toMatchObject({ code: 'SEND_FAILED' });
      expect(calls).toHaveLength(0);
    } finally {
      await restoreValidAuth();
    }
  });

  it('asks for a reconnect when there is no refresh token to renew an expired one', async () => {
    await pool.query(`UPDATE connected_accounts SET auth_encrypted = $2 WHERE id = $1`, [
      accountId,
      expiredAuth(null),
    ]);
    const { provider, calls } = fakeSender();
    try {
      await expect(
        sendEmail(typed(), userId, actor, freshKey(), { provider }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_AUTH_EXPIRED',
      });
      expect(calls).toHaveLength(0);
    } finally {
      await restoreValidAuth();
    }
  });

  it('warns that an unconfirmed send may have gone out', async () => {
    const { provider } = fakeSender([sendFailure(SEND_OUTCOME_UNKNOWN, 'Gmail')]);

    await expect(sendEmail(typed(), userId, actor, freshKey(), { provider })).rejects.toThrow(
      /did not confirm/,
    );
  });

  it('records an expired credential on the mailbox', async () => {
    const { provider } = fakeSender([sendFailure(SEND_AUTH_EXPIRED, 'Gmail')]);

    await expect(sendEmail(typed(), userId, actor, freshKey(), { provider })).rejects.toBeDefined();

    const status = await pool.query(
      'SELECT status, status_detail FROM connected_accounts WHERE id = $1',
      [accountId],
    );
    expect(status.rows[0]).toEqual({ status: 'error', status_detail: 'PROVIDER_AUTH_EXPIRED' });
  });

  it.each<SendFailureCode>([SEND_SCOPE_MISSING, SEND_RATE_LIMITED])(
    'leaves the mailbox status alone on %s, which says nothing about syncing',
    async (driverCode) => {
      const { provider } = fakeSender([sendFailure(driverCode, 'Gmail')]);

      await expect(
        sendEmail(typed(), userId, actor, freshKey(), { provider }),
      ).rejects.toBeDefined();

      const status = await pool.query(
        'SELECT status, status_detail FROM connected_accounts WHERE id = $1',
        [accountId],
      );
      expect(status.rows[0]).toEqual({ status: 'active', status_detail: null });
    },
  );
});

describe('requestHashOf', () => {
  const base = {
    connected_account_id: '00000000-0000-4000-8000-0000000000a1',
    to: ['someone@example.net'],
    subject: 'Hello',
    body_html: '<p>Hi</p>',
  };
  const hashOf = (raw: Record<string, unknown>): string =>
    requestHashOf(sendEmailSchema.parse(raw));

  it('hashes the same request the same', () => {
    expect(hashOf(base)).toBe(hashOf({ ...base }));
  });

  it('hashes requests the schema normalizes alike as one', () => {
    expect(hashOf({ ...base, cc: [] })).toBe(hashOf(base));
    expect(hashOf({ ...base, subject: '  Hello  ' })).toBe(hashOf(base));
  });

  it('does not depend on the order of the fields', () => {
    const reordered = Object.fromEntries(Object.entries(sendEmailSchema.parse(base)).reverse());
    // Safe: the same parsed fields in another order, which is what is under test.
    expect(requestHashOf(reordered as SendEmailInput)).toBe(hashOf(base));
  });

  it.each<[string, Record<string, unknown>]>([
    ['mailbox', { connected_account_id: '00000000-0000-4000-8000-0000000000a2' }],
    ['recipient', { to: ['other@example.net'] }],
    ['cc', { cc: ['copy@example.net'] }],
    ['subject', { subject: 'Goodbye' }],
    ['body', { body_html: '<p>Bye</p>' }],
    ['record', { record_type: 'contact', record_id: '00000000-0000-4000-8000-0000000000a3' }],
    ['parent', { in_reply_to_message_id: '00000000-0000-4000-8000-0000000000a4' }],
    ['forwarded original', { forward_of_message_id: '00000000-0000-4000-8000-0000000000a5' }],
  ])('changes with the %s', (_field, change) => {
    expect(hashOf({ ...base, ...change })).not.toBe(hashOf(base));
  });

  it('changes with the template', () => {
    const fromTemplate = {
      connected_account_id: base.connected_account_id,
      to: base.to,
      record_type: 'contact',
      record_id: '00000000-0000-4000-8000-0000000000a3',
    };
    expect(
      hashOf({ ...fromTemplate, template_id: '00000000-0000-4000-8000-0000000000b1' }),
    ).not.toBe(hashOf({ ...fromTemplate, template_id: '00000000-0000-4000-8000-0000000000b2' }));
  });
});

describe('sendEmail — private threads', () => {
  async function privateParent(threadId: string): Promise<string> {
    const parent = await storeParent({ threadId, rfcMessageId: `${threadId}@x.test` });
    await pool.query('UPDATE email_messages SET is_private = true WHERE id = $1', [parent]);
    return parent;
  }

  async function activityFor(
    contactId: string,
  ): Promise<{ subject: string; notes: string | null }> {
    const result = await pool.query<{ subject: string; notes: string | null }>(
      'SELECT subject, notes FROM activities WHERE contact_id = $1',
      [contactId],
    );
    return result.rows[0]!; // Safe: each test sends exactly once from this contact.
  }

  it('stores a reply into a private thread as private and files its activity without a body', async () => {
    const parent = await privateParent('private-thread');
    const contactId = await createContact('private-reply');
    const { provider } = fakeSender();

    const sent = await sendEmail(
      typed({ in_reply_to_message_id: parent, record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    expect(sent.message.is_private).toBe(true);
    expect(await activityFor(contactId)).toEqual({ subject: PRIVATE_EMAIL_SUBJECT, notes: null });
  });

  it('keeps the body on the activity for a reply into a visible thread', async () => {
    const parent = await storeParent({ threadId: 'open-thread', rfcMessageId: 'open@x.test' });
    const contactId = await createContact('open-reply');
    const { provider } = fakeSender();

    await sendEmail(
      typed({ in_reply_to_message_id: parent, record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    expect((await activityFor(contactId)).notes).toContain('A typed body.');
  });

  it('makes private a Sent copy the sync stored first, once the send moves it into a private thread', async () => {
    await pool.query(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address)
       VALUES ($1, 'sent-1', 'rfc-root-thread', 'outbound', $2)`,
      [accountId, MAILBOX.toLowerCase()],
    );
    const parent = await privateParent('private-parent');
    const contactId = await createContact('moved-copy');
    const { provider } = fakeSender();

    const sent = await sendEmail(
      typed({ in_reply_to_message_id: parent, record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    expect(sent.message.thread_id).toBe('private-parent');
    expect(sent.message.is_private).toBe(true);
    expect((await activityFor(contactId)).notes).toBeNull();
  });
});

describe('sendEmail — an address already erased under GDPR', () => {
  const ERASED = 'erased-recipient@example.net';
  const ERASURE_RECORD = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  afterEach(async () => {
    await pool.query('DELETE FROM gdpr_deletion_log WHERE record_id = $1', [ERASURE_RECORD]);
  });

  it('files its activity without the text the stored copy lost, and answers redacted', async () => {
    await pool.query(
      `INSERT INTO gdpr_deletion_log
         (record_type, record_id, requested_by, erasure_scope, completed_at, erased_address_hmac)
       VALUES ('contact', $1, $2, '{}', now(), $3)`,
      [ERASURE_RECORD, userId, erasedAddressDigest(ERASED)],
    );
    const contactId = await createContact('erased-recipient-activity');
    const { provider } = fakeSender();

    const sent = await sendEmail(
      typed({ to: [ERASED], record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const activity = await pool.query<{ subject: string; notes: string | null }>(
      'SELECT subject, notes FROM activities WHERE contact_id = $1',
      [contactId],
    );
    expect(activity.rows).toEqual([{ subject: '[GDPR deleted]', notes: null }]);
    expect(sent.message.subject).toBe('[GDPR deleted]');
    expect(sent.message.to_addresses).toEqual([`gdpr-deleted-${ERASURE_RECORD}@gdpr.invalid`]);
  });

  it('drops the typed activity text of a forward to an erased address', async () => {
    await pool.query(
      `INSERT INTO gdpr_deletion_log
         (record_type, record_id, requested_by, erasure_scope, completed_at, erased_address_hmac)
       VALUES ('contact', $1, $2, '{}', now(), $3)`,
      [ERASURE_RECORD, userId, erasedAddressDigest(ERASED)],
    );
    const contactId = await createContact('erased-forward');
    const original = await storeParent({ threadId: 'erased-fwd', rfcMessageId: 'ef@x.test' });
    const { provider } = fakeSender();

    await sendEmail(
      typed({
        to: [ERASED],
        body_html: '<p>Forwarding about them</p>',
        forward_of_message_id: original,
        record_type: 'contact',
        record_id: contactId,
      }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const activity = await pool.query<{ notes: string | null }>(
      'SELECT notes FROM activities WHERE contact_id = $1',
      [contactId],
    );
    expect(activity.rows).toEqual([{ notes: null }]);
  });

  it('files no text for a Sent copy sync already stored as a GDPR tombstone', async () => {
    await pool.query(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address,
          subject, gdpr_redacted_at)
       VALUES ($1, 'sent-1', 'tomb-thread', 'outbound', $2, '[GDPR deleted]', now())`,
      [accountId, MAILBOX.toLowerCase()],
    );
    const contactId = await createContact('tombstone-filing');
    const { provider } = fakeSender();

    await sendEmail(
      typed({ record_type: 'contact', record_id: contactId }),
      userId,
      actor,
      freshKey(),
      { provider },
    );

    const activity = await pool.query<{ subject: string; notes: string | null }>(
      'SELECT subject, notes FROM activities WHERE contact_id = $1',
      [contactId],
    );
    expect(activity.rows).toEqual([{ subject: '[GDPR deleted]', notes: null }]);
  });

  it('stores the sent copy redacted, as sync would store it', async () => {
    await pool.query(
      `INSERT INTO gdpr_deletion_log
         (record_type, record_id, requested_by, erasure_scope, completed_at, erased_address_hmac)
       VALUES ('contact', $1, $2, '{}', now(), $3)`,
      [ERASURE_RECORD, userId, erasedAddressDigest(ERASED)],
    );
    const { provider } = fakeSender();

    await sendEmail(typed({ to: [ERASED] }), userId, actor, freshKey(), { provider });

    const stored = await pool.query<{
      to_addresses: string[];
      subject: string | null;
      redacted: boolean;
    }>(
      `SELECT to_addresses, subject, gdpr_redacted_at IS NOT NULL AS redacted
         FROM email_messages WHERE connected_account_id = $1 AND provider_message_id = 'sent-1'`,
      [accountId],
    );
    expect(stored.rows[0]).toEqual({
      to_addresses: [`gdpr-deleted-${ERASURE_RECORD}@gdpr.invalid`],
      subject: '[GDPR deleted]',
      redacted: true,
    });
  });
});

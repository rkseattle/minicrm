/**
 * Integration tests for reading synced mail.
 *
 * Against the real test database. What matters here is what the WHERE clauses exclude —
 * another user's mailbox, a private message, a message some record already claims — and
 * that is decided by SQL, so a mocked client would test nothing.
 */

import 'dotenv/config';

import { readFile } from 'node:fs/promises';

import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { listMessagesForRecord, listUnmatchedMessages } from '../services/emailMessageService.js';
import { insertParkedMailbox } from './testUtils.js';

const FILE_PREFIX = 'emailmsgsvc';

let repAId: string;
let repBId: string;
let accountAId: string;
let accountBId: string;
let contactId: string;

async function insertMessage(
  accountId: string,
  suffix: string,
  overrides: { threadId?: string; sentAt?: string | null; isPrivate?: boolean } = {},
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO email_messages
       (connected_account_id, provider_message_id, thread_id, direction, from_address,
        sent_at, is_private, message_snippet)
     VALUES ($1, $2, $3, 'inbound', 'someone@example.net', $4, $5, $6)
     RETURNING id`,
    [
      accountId,
      `INBOX:${suffix}`,
      overrides.threadId ?? `thread-${suffix}`,
      overrides.sentAt === undefined ? '2026-08-01T12:00:00Z' : overrides.sentAt,
      overrides.isPrivate ?? false,
      `snippet ${suffix}`,
    ],
  );
  return result.rows[0]!.id;
}

async function link(messageId: string, recordId: string = contactId): Promise<void> {
  await pool.query(
    `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
     VALUES ($1, 'contact', $2, 'auto')`,
    [messageId, recordId],
  );
}

async function deleteFixtures(): Promise<void> {
  await pool.query(`DELETE FROM contacts WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
}

beforeAll(async () => {
  await deleteFixtures();
  const repA = await createUser({
    email: `${FILE_PREFIX}-a@example.com`,
    name: 'Msg Rep A',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repAId = repA.id;
  const repB = await createUser({
    email: `${FILE_PREFIX}-b@example.com`,
    name: 'Msg Rep B',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repBId = repB.id;

  accountAId = await insertParkedMailbox(repAId, `${FILE_PREFIX}-mailbox-a@example.com`);
  accountBId = await insertParkedMailbox(repBId, `${FILE_PREFIX}-mailbox-b@example.com`);

  const contact = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Shared', 'Contact', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-shared@example.com`, repAId],
  );
  contactId = contact.rows[0]!.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM email_messages WHERE connected_account_id = ANY($1::uuid[])', [
    [accountAId, accountBId],
  ]);
});

afterAll(async () => {
  await deleteFixtures();
  await pool.end();
});

describe('listMessagesForRecord', () => {
  it('returns the messages linked to the record, grouped by thread', async () => {
    const first = await insertMessage(accountAId, '1', {
      threadId: 'conversation',
      sentAt: '2026-08-01T09:00:00Z',
    });
    const second = await insertMessage(accountAId, '2', {
      threadId: 'conversation',
      sentAt: '2026-08-01T10:00:00Z',
    });
    await link(first);
    await link(second);

    const result = await listMessagesForRecord('contact', contactId, repAId, 1, 25);

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.thread_id).toBe('conversation');
    // Oldest first within a thread, so a conversation reads top to bottom.
    expect(result.data[0]!.messages.map((m) => m.id)).toEqual([first, second]);
  });

  it('orders threads by their newest message', async () => {
    const older = await insertMessage(accountAId, '1', {
      threadId: 'older',
      sentAt: '2026-08-01T09:00:00Z',
    });
    const newer = await insertMessage(accountAId, '2', {
      threadId: 'newer',
      sentAt: '2026-08-02T09:00:00Z',
    });
    await link(older);
    await link(newer);

    const result = await listMessagesForRecord('contact', contactId, repAId, 1, 25);

    expect(result.data.map((t) => t.thread_id)).toEqual(['newer', 'older']);
  });

  it('counts threads rather than messages, so a page never splits one', async () => {
    for (const suffix of ['1', '2', '3']) {
      const id = await insertMessage(accountAId, suffix, { threadId: 'one-thread' });
      await link(id);
    }

    const result = await listMessagesForRecord('contact', contactId, repAId, 1, 25);

    // Three messages, one thread: total is the page unit, not the message count.
    expect(result.total).toBe(1);
    expect(result.data[0]!.messages).toHaveLength(3);
  });

  it('pages by thread, keeping each thread whole', async () => {
    for (const suffix of ['1', '2', '3']) {
      const id = await insertMessage(accountAId, suffix, {
        threadId: `t-${suffix}`,
        sentAt: `2026-08-0${suffix}T09:00:00Z`,
      });
      await link(id);
      const reply = await insertMessage(accountAId, `${suffix}-reply`, {
        threadId: `t-${suffix}`,
        sentAt: `2026-08-0${suffix}T10:00:00Z`,
      });
      await link(reply);
    }

    const first = await listMessagesForRecord('contact', contactId, repAId, 1, 2);
    const second = await listMessagesForRecord('contact', contactId, repAId, 2, 2);

    expect(first.total).toBe(3);
    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(1);
    // Every thread arrives complete on exactly one page.
    for (const thread of [...first.data, ...second.data]) {
      expect(thread.messages).toHaveLength(2);
    }
  });

  it("never returns another user's mail, even on a record both can see", async () => {
    const mine = await insertMessage(accountAId, '1');
    const theirs = await insertMessage(accountBId, '2');
    await link(mine);
    await link(theirs);

    const forA = await listMessagesForRecord('contact', contactId, repAId, 1, 25);
    const forB = await listMessagesForRecord('contact', contactId, repBId, 1, 25);

    expect(forA.data.flatMap((t) => t.messages.map((m) => m.id))).toEqual([mine]);
    expect(forB.data.flatMap((t) => t.messages.map((m) => m.id))).toEqual([theirs]);
  });

  it('names no is_private predicate, because mailbox ownership already subsumes it', async () => {
    // Not a behavior test: is_private restricts a message to its mailbox owner, and every
    // query here is already scoped to the caller's own mailboxes, so a predicate would be
    // unreachable. This fails the day a cross-mailbox read path is added without one —
    // which is the only way the column can start mattering.
    const source = await readFile(
      new URL('../services/emailMessageService.ts', import.meta.url),
      'utf8',
    );
    const sql = source.slice(source.indexOf('async function listThreadPage'));

    // Every SQL string here is a template literal, so a bound that stops at a backtick
    // would leave most of the function unchecked. The identifier must not appear at all.
    expect(sql).not.toMatch(/is_private/);
  });

  it('sorts a null sent_at last rather than dropping the message', async () => {
    const undated = await insertMessage(accountAId, '1', { threadId: 'undated', sentAt: null });
    const dated = await insertMessage(accountAId, '2', { threadId: 'dated' });
    await link(undated);
    await link(dated);

    const result = await listMessagesForRecord('contact', contactId, repAId, 1, 25);

    expect(result.data.map((t) => t.thread_id)).toEqual(['dated', 'undated']);
  });

  it('returns an empty page for a record nothing links to', async () => {
    const result = await listMessagesForRecord('contact', contactId, repAId, 1, 25);

    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 25 });
  });

  it('returns no body columns, only a snippet', async () => {
    const messageId = await insertMessage(accountAId, '1');
    await link(messageId);

    const result = await listMessagesForRecord('contact', contactId, repAId, 1, 25);

    const message = result.data[0]!.messages[0]!;
    expect(message.snippet).toBe('snippet 1');
    expect(message).not.toHaveProperty('message_body_html');
    expect(message).not.toHaveProperty('message_body_text');
  });
});

describe('listUnmatchedMessages', () => {
  it('returns only the caller’s messages that no record claims', async () => {
    const unmatched = await insertMessage(accountAId, '1', { threadId: 'loose' });
    const matched = await insertMessage(accountAId, '2', { threadId: 'filed' });
    await link(matched);

    const result = await listUnmatchedMessages(repAId, 1, 25);

    expect(result.total).toBe(1);
    expect(result.data.flatMap((t) => t.messages.map((m) => m.id))).toEqual([unmatched]);
  });

  it("never returns another rep's unmatched mail", async () => {
    await insertMessage(accountBId, '1');

    const result = await listUnmatchedMessages(repAId, 1, 25);

    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 25 });
  });

  it('drops a thread out of the list once any of its messages is linked', async () => {
    const first = await insertMessage(accountAId, '1', { threadId: 'shared' });
    await insertMessage(accountAId, '2', { threadId: 'shared' });

    const before = await listUnmatchedMessages(repAId, 1, 25);
    expect(before.data[0]!.messages).toHaveLength(2);

    await link(first);
    const after = await listUnmatchedMessages(repAId, 1, 25);

    // The thread stays, minus the message that now belongs to a record.
    expect(after.total).toBe(1);
    expect(after.data[0]!.messages).toHaveLength(1);
  });

  it('pages by thread', async () => {
    for (const suffix of ['1', '2', '3']) {
      await insertMessage(accountAId, suffix, {
        threadId: `u-${suffix}`,
        sentAt: `2026-08-0${suffix}T09:00:00Z`,
      });
    }

    const result = await listUnmatchedMessages(repAId, 1, 2);

    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(2);
    expect(result.data.map((t) => t.thread_id)).toEqual(['u-3', 'u-2']);
  });
});

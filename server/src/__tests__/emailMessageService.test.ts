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
import {
  findMessageForUser,
  inheritThreadPrivacy,
  listMessagesForRecord,
  listUnmatchedMessages,
  lockMailboxThreads,
  messageAccessPredicate,
  setThreadPrivacy,
} from '../services/emailMessageService.js';
import { clearAuditLogFor, insertParkedMailbox, purgeFixtureUsers } from './testUtils.js';

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
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
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

  it('scopes every read path through messageAccessPredicate, never a bare owner check', async () => {
    // Not a behavior test: today the owner term alone decides every read. This fails the
    // day a read path writes its own mailbox scope and so drops the privacy term with it.
    const source = await readFile(
      new URL('../services/emailMessageService.ts', import.meta.url),
      'utf8',
    );
    const search = await readFile(new URL('../services/searchService.ts', import.meta.url), 'utf8');
    // The two list paths pass the predicate twice: to pick threads, and to re-join their messages.
    for (const [name, text, uses] of [
      ['listMessagesForRecord', source, 2],
      ['listUnmatchedMessages', source, 2],
      ['findMessageForUser', source, 1],
      ['searchEmails', search, 1],
    ] as const) {
      const start = text.search(new RegExp(`async function ${name}\\(`));
      expect(start, name).toBeGreaterThan(-1);
      const body = text.slice(start, text.indexOf('\n}\n', start));
      expect(body.split('messageAccessPredicate(').length - 1, name).toBe(uses);
      expect(body, name).not.toMatch(/ca\.user_id\s*=/);
    }
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

    const result = await listUnmatchedMessages(repAId, 'rep', 1, 25);

    expect(result.total).toBe(1);
    expect(result.data.flatMap((t) => t.messages.map((m) => m.id))).toEqual([unmatched]);
  });

  it("never returns another rep's unmatched mail", async () => {
    await insertMessage(accountBId, '1');

    const result = await listUnmatchedMessages(repAId, 'rep', 1, 25);

    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 25 });
  });

  it('drops a thread out of the list once any of its messages is linked', async () => {
    const first = await insertMessage(accountAId, '1', { threadId: 'shared' });
    await insertMessage(accountAId, '2', { threadId: 'shared' });

    const before = await listUnmatchedMessages(repAId, 'rep', 1, 25);
    expect(before.data[0]!.messages).toHaveLength(2);

    await link(first);
    const after = await listUnmatchedMessages(repAId, 'rep', 1, 25);

    // The thread stays, minus the message that now belongs to a record.
    expect(after.total).toBe(1);
    expect(after.data[0]!.messages).toHaveLength(1);
  });

  /** Files a message against a contact rep B owns, which rep A may or may not read. */
  async function linkToForeignContact(local: string, threadId: string): Promise<string> {
    const foreign = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Foreign', 'Contact', $1, $2) RETURNING id`,
      [`${FILE_PREFIX}-${local}@example.com`, repBId],
    );
    const message = await insertMessage(accountAId, '1', { threadId });
    await link(message, foreign.rows[0]!.id);
    return message;
  }

  it('still lists a message linked only to a record the owner cannot see', async () => {
    // Matching runs in a system context, so it can file a rep's mail against another
    // rep's contact. Under a private policy the record endpoint answers 403, so counting
    // it as "matched" would leave the owner's own mail reachable through nothing.
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'contact'`,
    );
    try {
      const message = await linkToForeignContact('foreign', 'hidden');

      const result = await listUnmatchedMessages(repAId, 'rep', 1, 25);

      expect(result.data.flatMap((t) => t.messages.map((m) => m.id))).toEqual([message]);
    } finally {
      await pool.query(
        `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'contact'`,
      );
    }
  });

  it('hides that message under the org policy, where the rep can read the record', async () => {
    // The mirror of the case above, and the default install: the inbox must agree with the
    // record endpoint in BOTH directions, not merely err toward showing everything.
    await linkToForeignContact('visible-foreign', 'shown');

    const result = await listUnmatchedMessages(repAId, 'rep', 1, 25);

    expect(result.total).toBe(0);
  });

  it('hides a message from an admin, who can see every record it names', async () => {
    const message = await insertMessage(accountAId, '1', { threadId: 'filed' });
    await link(message);

    const result = await listUnmatchedMessages(repAId, 'admin', 1, 25);

    expect(result.total).toBe(0);
  });

  it('pages by thread', async () => {
    for (const suffix of ['1', '2', '3']) {
      await insertMessage(accountAId, suffix, {
        threadId: `u-${suffix}`,
        sentAt: `2026-08-0${suffix}T09:00:00Z`,
      });
    }

    const result = await listUnmatchedMessages(repAId, 'rep', 1, 2);

    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(2);
    expect(result.data.map((t) => t.thread_id)).toEqual(['u-3', 'u-2']);
  });
});

describe('findMessageForUser', () => {
  async function withBodies(messageId: string): Promise<void> {
    await pool.query(
      `UPDATE email_messages
          SET message_body_text = 'Plain body', message_body_html = '<p>Html <b>body</b></p>'
        WHERE id = $1`,
      [messageId],
    );
  }

  it("returns the caller's own message with both bodies, unsanitized", async () => {
    const messageId = await insertMessage(accountAId, 'detail-own');
    await withBodies(messageId);

    const message = await findMessageForUser(messageId, repAId);

    expect(message).toMatchObject({
      id: messageId,
      body_text: 'Plain body',
      body_html: '<p>Html <b>body</b></p>',
    });
  });

  it("returns nothing for another rep's message, even one filed on a record both can see", async () => {
    const messageId = await insertMessage(accountBId, 'detail-theirs');
    await withBodies(messageId);
    await link(messageId);

    expect(await findMessageForUser(messageId, repAId)).toBeNull();
  });

  it('returns the caller their own private message', async () => {
    const messageId = await insertMessage(accountAId, 'detail-private', { isPrivate: true });

    expect((await findMessageForUser(messageId, repAId))?.is_private).toBe(true);
  });

  it('returns nothing for an id that names no message', async () => {
    expect(await findMessageForUser('00000000-0000-4000-8000-0000000000d1', repAId)).toBeNull();
  });
});

describe('thread privacy', () => {
  const ACTOR = { id: '', name: 'Msg Rep A' };

  beforeEach(() => {
    ACTOR.id = repAId;
  });

  async function privacyOf(ids: string[]): Promise<boolean[]> {
    const rows = await pool.query<{ id: string; is_private: boolean }>(
      'SELECT id, is_private FROM email_messages WHERE id = ANY($1::uuid[])',
      [ids],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.is_private]));
    return ids.map((id) => byId.get(id) ?? false);
  }

  async function privacyAudits(): Promise<{ old_value: string; new_value: string }[]> {
    const rows = await pool.query<{ old_value: string; new_value: string }>(
      `SELECT old_value, new_value FROM audit_log
        WHERE record_id = $1 AND event_type = 'email_thread_privacy_changed'
        ORDER BY created_at`,
      [accountAId],
    );
    return rows.rows;
  }

  beforeEach(async () => {
    await clearAuditLogFor(repAId);
  });

  /** Waits until a backend is blocked on the mailbox-thread lock, so a race is really staged. */
  async function untilAdvisoryLockWaiter(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND classid::bigint = (hashtext('email_thread_privacy')::bigint + 4294967296) % 4294967296`,
      );
      if (Number(waiting.rows[0]!.n) > 0) return; // Safe: count(*) always yields a row.
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('the toggle never waited on the mailbox lock');
  }

  it("hides another user's private mail on its own when the mailbox scope is widened", async () => {
    // Owner scoping alone hides everything today, so widen it to every mailbox to prove
    // the privacy term, not the owner term, is what keeps rep A's private thread hidden.
    const privateA = await insertMessage(accountAId, '1', { threadId: 'p', isPrivate: true });
    const publicA = await insertMessage(accountAId, '2', { threadId: 'q' });
    const privateB = await insertMessage(accountBId, '3', { threadId: 'r', isPrivate: true });

    const visibleToRepB = await pool.query<{ id: string }>(
      `SELECT m.id FROM email_messages m
         JOIN connected_accounts ca ON ca.id = m.connected_account_id
        WHERE ${messageAccessPredicate('$1', 'TRUE')}
          AND m.connected_account_id = ANY($2::uuid[])`,
      [repBId, [accountAId, accountBId]],
    );

    const ids = visibleToRepB.rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([publicA, privateB]));
    expect(ids).not.toContain(privateA);
  });

  it('marks every message in the thread, and only that thread in that mailbox', async () => {
    const first = await insertMessage(accountAId, '1', { threadId: 'conv' });
    const second = await insertMessage(accountAId, '2', { threadId: 'conv' });
    const otherThread = await insertMessage(accountAId, '3', { threadId: 'elsewhere' });
    const otherMailbox = await insertMessage(accountBId, '4', { threadId: 'conv' });

    const result = await setThreadPrivacy(first, repAId, true, ACTOR);

    expect(result).toEqual({ isPrivate: true, updated: 2 });
    expect(await privacyOf([first, second, otherThread, otherMailbox])).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('makes the thread visible again, auditing each real change once', async () => {
    const first = await insertMessage(accountAId, '1', { threadId: 'conv' });

    await setThreadPrivacy(first, repAId, true, ACTOR);
    await setThreadPrivacy(first, repAId, true, ACTOR);
    await setThreadPrivacy(first, repAId, false, ACTOR);

    expect(await privacyOf([first])).toEqual([false]);
    expect(await privacyAudits()).toEqual([
      { old_value: null, new_value: 'private (1 messages)' },
      { old_value: null, new_value: 'visible (1 messages)' },
    ]);
  });

  it("returns null for another user's message and changes nothing", async () => {
    const message = await insertMessage(accountAId, '1', { threadId: 'conv' });

    expect(await setThreadPrivacy(message, repBId, true, ACTOR)).toBeNull();
    expect(await privacyOf([message])).toEqual([false]);
  });

  it("gives a new message its private thread's setting, and leaves public threads alone", async () => {
    const existing = await insertMessage(accountAId, '1', { threadId: 'conv', isPrivate: true });
    const arrived = await insertMessage(accountAId, '2', { threadId: 'conv' });
    const publicThread = await insertMessage(accountAId, '3', { threadId: 'open' });

    const client = await pool.connect();
    try {
      const flags = await inheritThreadPrivacy(client, accountAId, ['INBOX:2', 'INBOX:3']);
      expect(flags.get(arrived)).toBe(true);
      expect(flags.get(publicThread)).toBe(false);
    } finally {
      client.release();
    }
    expect(await privacyOf([existing, arrived, publicThread])).toEqual([true, true, false]);
  });

  it("gives a message moved into a private thread that thread's setting", async () => {
    await insertMessage(accountAId, '1', { threadId: 'conv', isPrivate: true });
    const moved = await insertMessage(accountAId, '2', { threadId: 'was-elsewhere' });
    await pool.query(`UPDATE email_messages SET thread_id = 'conv' WHERE id = $1`, [moved]);

    const client = await pool.connect();
    try {
      await inheritThreadPrivacy(client, accountAId, ['INBOX:2']);
    } finally {
      client.release();
    }
    expect(await privacyOf([moved])).toEqual([true]);
  });

  it('marks the thread a message is in when the toggle runs, not when it was requested', async () => {
    const message = await insertMessage(accountAId, '1', { threadId: 'before' });
    const syncing = await pool.connect();
    try {
      // A sync page holds the mailbox and moves the message into another thread.
      await syncing.query('BEGIN');
      await lockMailboxThreads(syncing, accountAId);
      await syncing.query(`UPDATE email_messages SET thread_id = 'after' WHERE id = $1`, [message]);

      const toggle = setThreadPrivacy(message, repAId, true, ACTOR);
      await untilAdvisoryLockWaiter();
      await syncing.query('COMMIT');
      expect(await toggle).toEqual({ isPrivate: true, updated: 1 });
    } finally {
      syncing.release();
    }

    expect(await privacyOf([message])).toEqual([true]);
  });

  it('leaves no public row when a toggle races an insert still in flight', async () => {
    const first = await insertMessage(accountAId, '1', { threadId: 'conv' });
    const inserting = await pool.connect();
    let arrived = '';
    try {
      await inserting.query('BEGIN');
      await lockMailboxThreads(inserting, accountAId);
      const row = await inserting.query<{ id: string }>(
        `INSERT INTO email_messages
           (connected_account_id, provider_message_id, thread_id, direction, from_address)
         VALUES ($1, 'INBOX:2', 'conv', 'inbound', 'someone@example.net') RETURNING id`,
        [accountAId],
      );
      arrived = row.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
      // No private sibling exists yet, so this inherits nothing.
      await inheritThreadPrivacy(inserting, accountAId, ['INBOX:2']);

      // Waits on the mailbox lock instead of updating around the uncommitted row.
      const toggle = setThreadPrivacy(first, repAId, true, ACTOR);
      await untilAdvisoryLockWaiter();
      await inserting.query('COMMIT');
      await toggle;
    } finally {
      inserting.release();
    }

    expect(await privacyOf([first, arrived])).toEqual([true, true]);
  });
});

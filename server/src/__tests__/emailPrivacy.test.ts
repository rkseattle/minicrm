/**
 * Horizontal privilege for private threads, through every endpoint that reads synced mail.
 *
 * Rep A marks a thread private. Rep B, who received the same conversation in their own
 * mailbox, and an admin must get nothing of rep A's copy from the record list, the
 * unmatched inbox, the detail endpoint, or global search. Rep B still sees their own copy:
 * privacy belongs to a mailbox's copy, not to the conversation.
 *
 * Owner scoping already yields these results; the test that proves the privacy term on its
 * own, with the scope widened, is in emailMessageService.test.ts.
 */

import 'dotenv/config';
import request from 'supertest';

import { threadPrivacyResponseSchema } from '@minicrm/shared/schemas/emailMessageSchema.js';

import app from '../app.js';
import pool from '../db.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';
import { setThreadPrivacy } from '../services/emailMessageService.js';
import { createUser } from '../services/userService.js';
import { insertParkedMailbox, makeAuthCookie, purgeFixtureUsers } from './testUtils.js';

const FILE_PREFIX = 'emailprivacy';
const NEEDLE = 'quokkaprivate';
const THREAD = 'thread-private';

interface Person {
  id: string;
  cookie: string;
}

let repA: Person;
let repB: Person;
let admin: Person;
let mailboxA: string;
let mailboxB: string;
let contactId: string;
let privateMessageA: string;
let unmatchedPrivateA: string;
let copyInMailboxB: string;

async function person(suffix: string, role: 'admin' | 'rep'): Promise<Person> {
  const created = await createUser({
    email: `${FILE_PREFIX}-${suffix}@example.com`,
    name: `Privacy ${suffix}`,
    role,
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  return {
    id: created.id,
    cookie: makeAuthCookie({
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
    }),
  };
}

async function insertMessage(mailboxId: string, suffix: string, threadId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO email_messages
       (connected_account_id, provider_message_id, thread_id, direction, from_address,
        subject, message_snippet, message_body_text, sent_at)
     VALUES ($1, $2, $3, 'inbound', $4, $5, $5, 'the body', '2026-08-01T12:00:00Z')
     RETURNING id`,
    [mailboxId, `INBOX:${suffix}`, threadId, `${FILE_PREFIX}-contact@example.com`, NEEDLE],
  );
  // Safe: INSERT ... RETURNING yields exactly one row.
  return result.rows[0]!.id;
}

async function linkToContact(messageId: string): Promise<void> {
  await pool.query(
    `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
     VALUES ($1, 'contact', $2, 'auto')`,
    [messageId, contactId],
  );
}

async function deleteFixtures(): Promise<void> {
  await pool.query(`DELETE FROM contacts WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
}

beforeAll(async () => {
  await deleteFixtures();
  repA = await person('rep-a', 'rep');
  repB = await person('rep-b', 'rep');
  admin = await person('admin', 'admin');
  mailboxA = await insertParkedMailbox(repA.id, `${FILE_PREFIX}-mailbox-a@example.com`);
  mailboxB = await insertParkedMailbox(repB.id, `${FILE_PREFIX}-mailbox-b@example.com`);
  // Owned by an admin so every caller here may open the record itself.
  const contact = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Shared', 'Contact', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-contact@example.com`, admin.id],
  );
  contactId = contact.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.

  privateMessageA = await insertMessage(mailboxA, 'a1', THREAD);
  const secondInThread = await insertMessage(mailboxA, 'a2', THREAD);
  unmatchedPrivateA = await insertMessage(mailboxA, 'a3', 'thread-private-unmatched');
  copyInMailboxB = await insertMessage(mailboxB, 'b1', THREAD);
  for (const id of [privateMessageA, secondInThread, copyInMailboxB]) await linkToContact(id);

  await setThreadPrivacy(privateMessageA, repA.id, true, { id: repA.id, name: 'Privacy rep-a' });
  await setThreadPrivacy(unmatchedPrivateA, repA.id, true, { id: repA.id, name: 'Privacy rep-a' });

  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'email_sync'`);
  invalidateFeatureFlagCache();
});

afterAll(async () => {
  await deleteFixtures();
  // Seeded off; later serial suites assume what migrations left.
  await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
  invalidateFeatureFlagCache();
  await pool.end();
});

function listFor(caller: Person) {
  return request(app)
    .get('/api/v1/email-messages')
    .query({ record_type: 'contact', record_id: contactId })
    .set('Cookie', caller.cookie);
}

function messageIds(body: { data: { messages: { id: string }[] }[] }): string[] {
  return body.data.flatMap((thread) => thread.messages.map((m) => m.id));
}

describe.each([
  ['rep B', () => repB],
  ['an admin', () => admin],
])('%s reading rep A’s private thread', (_label, caller) => {
  it('gets none of it from the record list', async () => {
    const res = await listFor(caller());
    expect(res.status).toBe(200);
    expect(messageIds(res.body)).not.toContain(privateMessageA);
  });

  it('gets 404 from the detail endpoint', async () => {
    const res = await request(app)
      .get(`/api/v1/email-messages/${privateMessageA}`)
      .set('Cookie', caller().cookie);
    expect(res.status).toBe(404);
  });

  it('gets none of it from the unmatched inbox', async () => {
    const res = await request(app)
      .get('/api/v1/email-messages/unmatched')
      .set('Cookie', caller().cookie);
    expect(res.status).toBe(200);
    expect(messageIds(res.body)).not.toContain(unmatchedPrivateA);
  });

  it('gets none of it from global search', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: NEEDLE })
      .set('Cookie', caller().cookie);
    expect(res.status).toBe(200);
    const ids = (res.body.emails as { id: string }[]).map((e) => e.id);
    expect(ids).not.toContain(privateMessageA);
  });
});

describe('the owner and the other copy', () => {
  it('rep A still reads the whole private thread', async () => {
    const res = await listFor(repA);
    expect(res.status).toBe(200);
    const thread = res.body.data.find((t: { thread_id: string }) => t.thread_id === THREAD);
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages.every((m: { is_private: boolean }) => m.is_private)).toBe(true);
  });

  it('rep B still reads their own copy of the conversation', async () => {
    const res = await listFor(repB);
    expect(messageIds(res.body)).toEqual([copyInMailboxB]);
  });

  it('rep A still finds it in search and opens it', async () => {
    const search = await request(app)
      .get('/api/v1/search')
      .query({ q: NEEDLE })
      .set('Cookie', repA.cookie);
    expect((search.body.emails as { id: string }[]).map((e) => e.id)).toContain(privateMessageA);
    const detail = await request(app)
      .get(`/api/v1/email-messages/${privateMessageA}`)
      .set('Cookie', repA.cookie);
    expect(detail.status).toBe(200);
  });
});

describe('the index the thread update relies on', () => {
  it('exists on (connected_account_id, thread_id)', async () => {
    const result = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'email_messages' AND indexname = 'email_messages_account_thread_idx'`,
    );
    expect(result.rows[0]?.indexdef).toMatch(/\(connected_account_id, thread_id\)/);
  });
});

describe('PATCH /api/v1/email-messages/:id/thread-privacy', () => {
  function patch(messageId: string, caller: Person, body: unknown) {
    return request(app)
      .patch(`/api/v1/email-messages/${messageId}/thread-privacy`)
      .set('Cookie', caller.cookie)
      .send(body as object);
  }

  it('lets the owner make the thread visible and private again', async () => {
    const visible = await patch(privateMessageA, repA, { is_private: false });
    expect(visible.status).toBe(200);
    expect(threadPrivacyResponseSchema.parse(visible.body)).toEqual({
      is_private: false,
      updated: 2,
    });

    const restored = await patch(privateMessageA, repA, { is_private: true });
    expect(restored.body).toEqual({ is_private: true, updated: 2 });
  });

  it.each([
    ['rep B', () => repB],
    ['an admin', () => admin],
  ])('answers 404 to %s and changes nothing', async (_label, caller) => {
    const res = await patch(privateMessageA, caller(), { is_private: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    const row = await pool.query<{ is_private: boolean }>(
      'SELECT is_private FROM email_messages WHERE id = $1',
      [privateMessageA],
    );
    expect(row.rows[0]!.is_private).toBe(true);
  });

  it.each([
    ['a missing flag', {}],
    ['a non-boolean flag', { is_private: 'yes' }],
    ['an unknown field', { is_private: true, thread_id: 'other' }],
  ])('answers 400 to %s', async (_label, body) => {
    const res = await patch(privateMessageA, repA, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 400 to an id that is not a UUID', async () => {
    const res = await patch('not-a-uuid', repA, { is_private: true });
    expect(res.status).toBe(400);
  });

  it('answers 401 without a session', async () => {
    const res = await request(app)
      .patch(`/api/v1/email-messages/${privateMessageA}/thread-privacy`)
      .send({ is_private: true });
    expect(res.status).toBe(401);
  });
});

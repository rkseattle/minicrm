/**
 * Schema tests for email_message_links.
 *
 * The table's guarantees are constraints rather than code — two CHECKs, a composite UNIQUE
 * the contact-merge path has to work around, and the cascade that keeps a disconnected
 * mailbox from leaving links behind. Nothing in TypeScript enforces any of them, so a
 * corrective migration that widened or dropped one would otherwise land green.
 *
 * Against the real test database, following the email_sync_jobs schema block.
 */

import 'dotenv/config';

import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { insertParkedMailbox } from './testUtils.js';

const FILE_PREFIX = 'emliknkschema';

let accountId: string;
let messageId: string;
let contactId: string;

async function deleteFixtureUsers(): Promise<void> {
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
}

/** Inserts a message directly: no service writes this table outside the sync engine. */
async function insertMessage(suffix: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO email_messages
       (connected_account_id, provider_message_id, thread_id, direction, from_address)
     VALUES ($1, $2, $3, 'inbound', 'someone@example.net')
     RETURNING id`,
    [accountId, `INBOX:${suffix}`, `thread-${suffix}`],
  );
  return result.rows[0]!.id;
}

async function insertLink(
  emailMessageId: string,
  recordType: string,
  recordId: string,
  matchType = 'auto',
): Promise<void> {
  await pool.query(
    `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
     VALUES ($1, $2, $3, $4)`,
    [emailMessageId, recordType, recordId, matchType],
  );
}

beforeAll(async () => {
  await deleteFixtureUsers();
  const rep = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Link Schema Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });

  accountId = await insertParkedMailbox(rep.id, `${FILE_PREFIX}-owner@example.com`);

  const contact = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Link', 'Target', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-contact@example.com`, rep.id],
  );
  contactId = contact.rows[0]!.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM email_messages WHERE connected_account_id = $1', [accountId]);
  messageId = await insertMessage('1');
});

afterAll(async () => {
  await pool.query(`DELETE FROM contacts WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await deleteFixtureUsers();
  await pool.end();
});

describe('the email_message_links schema', () => {
  it('accepts every record_type the matching engine produces', async () => {
    for (const recordType of ['contact', 'lead', 'account', 'deal']) {
      await insertLink(messageId, recordType, contactId);
    }

    const stored = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM email_message_links WHERE email_message_id = $1',
      [messageId],
    );
    expect(stored.rows[0]!.count).toBe('4');
  });

  it('rejects a record_type outside the CHECK constraint', async () => {
    // Matches the PG check-violation code rather than the constraint name, so a
    // corrective migration may rename the constraint without breaking this.
    await expect(insertLink(messageId, 'activity', contactId)).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('rejects a match_type outside the CHECK constraint', async () => {
    await expect(insertLink(messageId, 'contact', contactId, 'inferred')).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('rejects the same record linked to one message twice', async () => {
    await insertLink(messageId, 'contact', contactId);

    await expect(insertLink(messageId, 'contact', contactId, 'manual')).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('allows the same record on a different message, and a different record on this one', async () => {
    await insertLink(messageId, 'contact', contactId);
    const other = await insertMessage('2');

    await insertLink(other, 'contact', contactId);
    await insertLink(messageId, 'account', contactId);

    const stored = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM email_message_links WHERE record_id = $1',
      [contactId],
    );
    expect(stored.rows[0]!.count).toBe('3');
  });

  it('deletes its links when the message is deleted', async () => {
    await insertLink(messageId, 'contact', contactId);
    const survivor = await insertMessage('3');
    await insertLink(survivor, 'contact', contactId);

    await pool.query('DELETE FROM email_messages WHERE id = $1', [messageId]);

    const remaining = await pool.query<{ email_message_id: string }>(
      'SELECT email_message_id FROM email_message_links WHERE record_id = $1',
      [contactId],
    );
    // Scoped to the deleted message: the other message's link is untouched.
    expect(remaining.rows).toEqual([{ email_message_id: survivor }]);
  });

  it('deletes its links when the connected account is deleted, through the message cascade', async () => {
    // Its own account and user: deleting the suite's shared account would strand every
    // later test's beforeEach, which inserts a message against it.
    const rep = await createUser({
      email: `${FILE_PREFIX}-cascade@example.com`,
      name: 'Cascade Rep',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const doomedId = await insertParkedMailbox(rep.id, `${FILE_PREFIX}-cascade@example.com`);

    const doomedMessage = await pool.query<{ id: string }>(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address)
       VALUES ($1, 'INBOX:cascade', 'thread-cascade', 'inbound', 'someone@example.net')
       RETURNING id`,
      [doomedId],
    );
    await insertLink(doomedMessage.rows[0]!.id, 'contact', contactId);
    await insertLink(messageId, 'contact', contactId);

    await pool.query('DELETE FROM connected_accounts WHERE id = $1', [doomedId]);

    const remaining = await pool.query<{ email_message_id: string }>(
      'SELECT email_message_id FROM email_message_links WHERE record_id = $1',
      [contactId],
    );
    // Two cascades deep — account to message to link — and scoped to that account.
    expect(remaining.rows).toEqual([{ email_message_id: messageId }]);
  });
});

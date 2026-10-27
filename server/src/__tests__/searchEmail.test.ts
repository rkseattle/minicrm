/**
 * Integration tests for global search over email.
 *
 * Against the real test database: who may find which message is decided by the SQL's
 * mailbox and link predicates, and a mocked client would test none of it.
 */

import pool from '../db.js';
import { globalSearch } from '../services/searchService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';
import { createUser } from '../services/userService.js';
import { insertParkedMailbox, purgeFixtureUsers } from './testUtils.js';

const FILE_PREFIX = 'searchemail';
const NEEDLE = 'zebracorn';

let repAId: string;
let repBId: string;
let adminId: string;
let viewerId: string;
let mailboxAId: string;
let mailboxViewerId: string;
let contactAId: string;
let contactBId: string;
let leadBId: string;
let flagWasEnabled: boolean;

async function insertMessage(
  mailboxId: string,
  suffix: string,
  fields: { subject?: string | null; snippet?: string | null } = {},
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO email_messages
       (connected_account_id, provider_message_id, thread_id, direction, from_address,
        subject, message_snippet, sent_at)
     VALUES ($1, $2, $3, 'inbound', 'someone@example.net', $4, $5, '2026-08-01T12:00:00Z')
     RETURNING id`,
    [
      mailboxId,
      `INBOX:${suffix}`,
      `thread-${suffix}`,
      fields.subject === undefined ? null : fields.subject,
      fields.snippet === undefined ? null : fields.snippet,
    ],
  );
  // Safe: INSERT ... RETURNING yields exactly one row.
  return result.rows[0]!.id;
}

async function link(
  messageId: string,
  recordId: string,
  recordType: 'contact' | 'lead' = 'contact',
): Promise<void> {
  await pool.query(
    `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
     VALUES ($1, $3, $2, 'auto')`,
    [messageId, recordId, recordType],
  );
}

async function setEmailSync(enabled: boolean): Promise<void> {
  await pool.query(`UPDATE feature_flags SET enabled = $1 WHERE flag_key = 'email_sync'`, [
    enabled,
  ]);
  invalidateFeatureFlagCache();
}

async function insertContact(ownerId: string, suffix: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Search', 'Mail', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-${suffix}@example.com`, ownerId],
  );
  // Safe: as above.
  return result.rows[0]!.id;
}

async function deleteFixtures(): Promise<void> {
  await pool.query(`DELETE FROM contacts WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM leads WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
}

async function user(suffix: string, role: 'admin' | 'rep' | 'viewer'): Promise<string> {
  const created = await createUser({
    email: `${FILE_PREFIX}-${suffix}@example.com`,
    name: `Search ${suffix}`,
    role,
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  return created.id;
}

beforeAll(async () => {
  await deleteFixtures();
  const flag = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM feature_flags WHERE flag_key = 'email_sync'`,
  );
  flagWasEnabled = flag.rows[0]?.enabled ?? false;

  repAId = await user('rep-a', 'rep');
  repBId = await user('rep-b', 'rep');
  adminId = await user('admin', 'admin');
  viewerId = await user('viewer', 'viewer');
  mailboxAId = await insertParkedMailbox(repAId, `${FILE_PREFIX}-mailbox-a@example.com`);
  mailboxViewerId = await insertParkedMailbox(viewerId, `${FILE_PREFIX}-mailbox-v@example.com`);
  contactAId = await insertContact(repAId, 'contact-a');
  contactBId = await insertContact(repBId, 'contact-b');
  const lead = await pool.query<{ id: string }>(
    `INSERT INTO leads (first_name, email, owner_id) VALUES ('Lead', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-lead-b@example.com`, repBId],
  );
  // Safe: INSERT ... RETURNING yields exactly one row.
  leadBId = lead.rows[0]!.id;
});

beforeEach(async () => {
  await setEmailSync(true);
  await pool.query('DELETE FROM email_messages WHERE connected_account_id = ANY($1::uuid[])', [
    [mailboxAId, mailboxViewerId],
  ]);
});

afterAll(async () => {
  await setEmailSync(flagWasEnabled);
  await deleteFixtures();
  await pool.end();
});

describe('globalSearch — emails', () => {
  it('finds a message by its subject, naming the record it opens', async () => {
    const id = await insertMessage(mailboxAId, 'subject', { subject: `About ${NEEDLE} pricing` });
    await link(id, contactAId);

    const results = await globalSearch(NEEDLE, { userId: repAId, role: 'rep' });

    expect(results.emails).toEqual([
      {
        id,
        subject: `About ${NEEDLE} pricing`,
        snippet: null,
        from_address: 'someone@example.net',
        sent_at: '2026-08-01T12:00:00.000Z',
        record_type: 'contact',
        record_id: contactAId,
      },
    ]);
  });

  it('finds a message by its snippet, case-insensitively', async () => {
    const id = await insertMessage(mailboxAId, 'snippet', {
      subject: 'Hello',
      snippet: `the ${NEEDLE.toUpperCase()} plan`,
    });
    await link(id, contactAId);

    const results = await globalSearch(NEEDLE, { userId: repAId, role: 'rep' });

    expect(results.emails.map((email) => email.id)).toEqual([id]);
  });

  it('never shows one rep another rep’s mail, even about a record both can open', async () => {
    const id = await insertMessage(mailboxAId, 'shared', { subject: NEEDLE });
    await link(id, contactBId);

    const results = await globalSearch(NEEDLE, { userId: repBId, role: 'rep' });

    expect(results.emails).toEqual([]);
  });

  it('does not let an admin read mail org-wide', async () => {
    const id = await insertMessage(mailboxAId, 'admin', { subject: NEEDLE });
    await link(id, contactAId);

    const results = await globalSearch(NEEDLE, { userId: adminId, role: 'admin' });

    expect(results.emails).toEqual([]);
  });

  it('leaves out a message with no linked record to open', async () => {
    await insertMessage(mailboxAId, 'unlinked', { subject: NEEDLE });

    const results = await globalSearch(NEEDLE, { userId: repAId, role: 'rep' });

    expect(results.emails).toEqual([]);
  });

  // A lead is readable only by its owner and admins, whatever the org's contact policy.
  it('opens only a linked record the caller can see', async () => {
    const hidden = await insertMessage(mailboxAId, 'hidden', { subject: NEEDLE });
    await link(hidden, leadBId, 'lead');
    const mixed = await insertMessage(mailboxAId, 'mixed', { subject: `${NEEDLE} two` });
    await link(mixed, leadBId, 'lead');
    await link(mixed, contactAId);

    const results = await globalSearch(NEEDLE, { userId: repAId, role: 'rep' });

    expect(results.emails.map((email) => [email.id, email.record_id])).toEqual([
      [mixed, contactAId],
    ]);
  });

  it('finds no mail while email sync is off', async () => {
    const id = await insertMessage(mailboxAId, 'flag', { subject: NEEDLE });
    await link(id, contactAId);
    await setEmailSync(false);

    const results = await globalSearch(NEEDLE, { userId: repAId, role: 'rep' });

    expect(results.emails).toEqual([]);
  });

  it('finds no mail for a role without mailbox access', async () => {
    const contactForViewer = await insertContact(viewerId, 'contact-v');
    const id = await insertMessage(mailboxViewerId, 'viewer', { subject: NEEDLE });
    await link(id, contactForViewer);

    const results = await globalSearch(NEEDLE, { userId: viewerId, role: 'viewer' });

    expect(results.emails).toEqual([]);
  });

  it('treats % in the query as a literal', async () => {
    const id = await insertMessage(mailboxAId, 'percent', { subject: 'Nothing special' });
    await link(id, contactAId);

    const results = await globalSearch('%%', { userId: repAId, role: 'rep' });

    expect(results.emails).toEqual([]);
  });
});

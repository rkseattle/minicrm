/**
 * HTTP contract tests for emailMessageController.
 *
 * Covers the auth boundary on every route, the Zod boundary, the horizontal-privilege
 * boundary over HTTP, and that no response carries a message body.
 */

import 'dotenv/config';

import request from 'supertest';

import app from '../app.js';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'emailmsgctl';

let repAId: string;
let repBId: string;
let repACookie: string;
let repBCookie: string;
let adminCookie: string;
let accountAId: string;
let accountBId: string;
let contactAId: string;
let contactBId: string;

async function insertParkedAccount(userId: string, suffix: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO connected_accounts
       (user_id, provider, email_address, auth_encrypted, sync_next_attempt_at)
     VALUES ($1, 'imap', $2, 'not-a-real-credential', NOW() + interval '1 hour')
     RETURNING id`,
    [userId, `${FILE_PREFIX}-${suffix}@example.com`],
  );
  return result.rows[0]!.id;
}

async function createContact(local: string, ownerId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Ctl', 'Target', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-${local}@example.com`, ownerId],
  );
  return result.rows[0]!.id;
}

async function deleteFixtures(): Promise<void> {
  // Leads and contacts before users: both hold owner_id ON DELETE RESTRICT, so one left
  // behind blocks the user delete and strands every later run of this file.
  await pool.query(`DELETE FROM leads WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM contacts WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
}

beforeAll(async () => {
  await deleteFixtures();

  const repA = await createUser({
    email: `${FILE_PREFIX}-a@example.com`,
    name: 'Ctl Rep A',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repAId = repA.id;
  repACookie = makeAuthCookie({ id: repA.id, email: repA.email, name: repA.name, role: repA.role });

  const repB = await createUser({
    email: `${FILE_PREFIX}-b@example.com`,
    name: 'Ctl Rep B',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repBId = repB.id;
  repBCookie = makeAuthCookie({ id: repB.id, email: repB.email, name: repB.name, role: repB.role });

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Ctl Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  accountAId = await insertParkedAccount(repAId, 'mailbox-a');
  accountBId = await insertParkedAccount(repBId, 'mailbox-b');
  contactAId = await createContact('owned-by-a', repAId);
  contactBId = await createContact('owned-by-b', repBId);
});

beforeEach(async () => {
  await pool.query('DELETE FROM email_messages WHERE connected_account_id = ANY($1::uuid[])', [
    [accountAId, accountBId],
  ]);
  // Seeded off by migration; every test below exercises the feature itself.
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'email_sync'`);
  // The service caches flags for 60s, so the write alone is invisible to the next read.
  invalidateFeatureFlagCache();
});

/**
 * Runs one assertion with contacts scoped to their owner, then restores the shared row.
 *
 * org_visibility_settings is a single global row several suites flip for their own
 * cross-owner tests. Restoring in a finally is what stops this file's window from
 * outliving its test and turning another file's expected 403 into a 200.
 */
async function withPrivateContactPolicy(assertion: () => Promise<void>): Promise<void> {
  await pool.query(
    `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'contact'`,
  );
  try {
    await assertion();
  } finally {
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'contact'`,
    );
  }
}

afterAll(async () => {
  await deleteFixtures();
  await pool.query(
    `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'contact'`,
  );
  await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
  await pool.end();
});

describe('authentication boundary', () => {
  it('returns 401 on the record list when unauthenticated', async () => {
    const res = await request(app).get(
      `/api/v1/email-messages?record_type=contact&record_id=${contactAId}`,
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 on the unmatched list when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/email-messages/unmatched');
    expect(res.status).toBe(401);
  });
});

describe('feature flag boundary', () => {
  it('returns 403 on both routes when email_sync is off', async () => {
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
    invalidateFeatureFlagCache();

    const unmatched = await request(app)
      .get('/api/v1/email-messages/unmatched')
      .set('Cookie', repACookie);
    const byRecord = await request(app)
      .get(`/api/v1/email-messages?record_type=contact&record_id=${contactAId}`)
      .set('Cookie', repACookie);

    // The gate is router-level, so both routes answer the same way.
    expect(unmatched.status).toBe(403);
    expect(byRecord.status).toBe(403);
  });
});

describe('GET /api/v1/email-messages', () => {
  it('returns 400 when record_type is not a linkable type', async () => {
    const res = await request(app)
      .get(`/api/v1/email-messages?record_type=activity&record_id=${contactAId}`)
      .set('Cookie', repACookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when record_id is not a UUID', async () => {
    const res = await request(app)
      .get('/api/v1/email-messages?record_type=contact&record_id=not-a-uuid')
      .set('Cookie', repACookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when record_type is missing entirely', async () => {
    const res = await request(app)
      .get(`/api/v1/email-messages?record_id=${contactAId}`)
      .set('Cookie', repACookie);

    expect(res.status).toBe(400);
  });

  it('returns 404 for a record that does not exist', async () => {
    const res = await request(app)
      .get(
        '/api/v1/email-messages?record_type=contact&record_id=00000000-0000-0000-0000-000000000000',
      )
      .set('Cookie', repACookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns an empty page for a visible record with no mail', async () => {
    const res = await request(app)
      .get(`/api/v1/email-messages?record_type=contact&record_id=${contactAId}`)
      .set('Cookie', repACookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], total: 0, page: 1, limit: 25 });
  });

  it('returns 403 when the visibility policy hides the record from the caller', async () => {
    // 'private' scopes a rep to their own records, so rep A cannot see rep B's contact —
    // and therefore cannot read the mail filed against it either.
    await withPrivateContactPolicy(async () => {
      const res = await request(app)
        .get(`/api/v1/email-messages?record_type=contact&record_id=${contactBId}`)
        .set('Cookie', repACookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  it('lets an admin read a record any rep owns', async () => {
    await withPrivateContactPolicy(async () => {
      const res = await request(app)
        .get(`/api/v1/email-messages?record_type=contact&record_id=${contactBId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
    });
  });

  it('returns 403 to a rep asking for a lead another rep owns', async () => {
    const lead = await pool.query<{ id: string }>(
      `INSERT INTO leads (first_name, last_name, email, owner_id, status)
       VALUES ('Ctl', 'Lead', $1, $2, 'New') RETURNING id`,
      [`${FILE_PREFIX}-lead@example.com`, repBId],
    );

    try {
      const res = await request(app)
        .get(`/api/v1/email-messages?record_type=lead&record_id=${lead.rows[0]!.id}`)
        .set('Cookie', repACookie);

      // Deliberately stricter than GET /leads/:id, which any authenticated user may read:
      // a lead's correspondence is not as open as the lead record itself.
      expect(res.status).toBe(403);
    } finally {
      await pool.query(`DELETE FROM leads WHERE email = $1`, [`${FILE_PREFIX}-lead@example.com`]);
    }
  });

  it("does not return another rep's message on a contact both can see", async () => {
    const message = await pool.query<{ id: string }>(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address,
          message_body_text, message_body_html)
       VALUES ($1, 'INBOX:secret', 'thread-secret', 'inbound', 'someone@example.net',
               'the plain body', '<p>the html body</p>')
       RETURNING id`,
      [accountAId],
    );
    await pool.query(
      `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
       VALUES ($1, 'contact', $2, 'auto')`,
      [message.rows[0]!.id, contactAId],
    );

    const forOwner = await request(app)
      .get(`/api/v1/email-messages?record_type=contact&record_id=${contactAId}`)
      .set('Cookie', repACookie);
    const forOther = await request(app)
      .get(`/api/v1/email-messages?record_type=contact&record_id=${contactAId}`)
      .set('Cookie', repBCookie);

    expect(forOwner.body.total).toBe(1);
    expect(forOther.body.total).toBe(0);
    // Nothing renders a body yet and the HTML is stored unsanitized, so no route emits it.
    expect(JSON.stringify(forOwner.body)).not.toContain('the plain body');
    expect(JSON.stringify(forOwner.body)).not.toContain('the html body');
  });
});

describe('GET /api/v1/email-messages/unmatched', () => {
  it('is matched before the record list, not shadowed by it', async () => {
    const res = await request(app)
      .get('/api/v1/email-messages/unmatched')
      .set('Cookie', repACookie);

    // The record list requires record_type; reaching 200 with none proves the literal
    // path won.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], total: 0, page: 1, limit: 25 });
  });

  it('returns 400 for an out-of-range limit', async () => {
    const res = await request(app)
      .get('/api/v1/email-messages/unmatched?limit=500')
      .set('Cookie', repACookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('shows each rep only their own unmatched mail', async () => {
    // Both mailboxes hold a message, so neither assertion can pass merely because the
    // other rep has nothing to see.
    for (const [accountId, suffix] of [
      [accountAId, 'a'],
      [accountBId, 'b'],
    ] as const) {
      await pool.query(
        `INSERT INTO email_messages
           (connected_account_id, provider_message_id, thread_id, direction, from_address)
         VALUES ($1, $2, $3, 'inbound', 'someone@example.net')`,
        [accountId, `INBOX:loose-${suffix}`, `thread-loose-${suffix}`],
      );
    }

    const forA = await request(app)
      .get('/api/v1/email-messages/unmatched')
      .set('Cookie', repACookie);
    const forB = await request(app)
      .get('/api/v1/email-messages/unmatched')
      .set('Cookie', repBCookie);

    expect(forA.body.total).toBe(1);
    expect(forA.body.data[0].thread_id).toBe('thread-loose-a');
    expect(forB.body.total).toBe(1);
    expect(forB.body.data[0].thread_id).toBe('thread-loose-b');
  });
});

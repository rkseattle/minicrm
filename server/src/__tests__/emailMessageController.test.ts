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
import { clearAuditLogFor, insertParkedMailbox, makeAuthCookie } from './testUtils.js';

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

  accountAId = await insertParkedMailbox(repAId, `${FILE_PREFIX}-mailbox-a@example.com`);
  accountBId = await insertParkedMailbox(repBId, `${FILE_PREFIX}-mailbox-b@example.com`);
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
  // Scoped to this file's mailboxes: an unqualified delete would empty rows a parallel
  // suite is mid-assertion on.
  await pool.query(
    `DELETE FROM email_message_links l
      USING email_messages m
      WHERE m.id = l.email_message_id AND m.connected_account_id = ANY($1::uuid[])`,
    [[accountAId, accountBId]],
  );
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

describe('POST /api/v1/email-messages/:id/links', () => {
  async function messageInMailboxA(suffix = 'link'): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address)
       VALUES ($1, $2, $3, 'inbound', 'someone@example.net')
       RETURNING id`,
      [accountAId, `INBOX:${suffix}`, `thread-${suffix}`],
    );
    return result.rows[0]!.id;
  }

  it('links a message to a contact and audits it against the mailbox', async () => {
    // Cleared here rather than in beforeEach: the helper takes a table-wide lock on
    // audit_log, which would serialize every parallel file that writes one.
    await clearAuditLogFor(repAId);
    const messageId = await messageInMailboxA();

    const res = await request(app)
      .post(`/api/v1/email-messages/${messageId}/links`)
      .set('Cookie', repACookie)
      .send({ record_type: 'contact', record_id: contactAId });

    expect(res.status).toBe(201);
    expect(res.body.link.match_type).toBe('manual');

    const audit = await pool.query<{ event_type: string; new_value: string; record_type: string }>(
      `SELECT event_type, new_value, record_type FROM audit_log
        WHERE changed_by_id = $1 AND event_type = 'email_linked'`,
      [repAId],
    );
    expect(audit.rows).toHaveLength(1);
    // Filed against the mailbox, naming the record — an entry on the contact would reach
    // a Change History panel that cannot render this event type.
    expect(audit.rows[0]!.record_type).toBe('connected_account');
    expect(audit.rows[0]!.new_value).toBe(`contact:${contactAId}`);
  });

  it('returns 409 when the record is already linked', async () => {
    const messageId = await messageInMailboxA();
    await request(app)
      .post(`/api/v1/email-messages/${messageId}/links`)
      .set('Cookie', repACookie)
      .send({ record_type: 'contact', record_id: contactAId });

    const res = await request(app)
      .post(`/api/v1/email-messages/${messageId}/links`)
      .set('Cookie', repACookie)
      .send({ record_type: 'contact', record_id: contactAId });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LINK_EXISTS');
  });

  it("returns 404 when the message is in another rep's mailbox", async () => {
    const messageId = await messageInMailboxA();

    const res = await request(app)
      .post(`/api/v1/email-messages/${messageId}/links`)
      .set('Cookie', repBCookie)
      .send({ record_type: 'contact', record_id: contactAId });

    // Absent rather than forbidden: whether another rep's message exists is not
    // this caller's to learn.
    expect(res.status).toBe(404);
    const links = await pool.query(
      'SELECT 1 FROM email_message_links WHERE email_message_id = $1',
      [messageId],
    );
    expect(links.rows).toHaveLength(0);
  });

  it('returns 404 for a record that does not exist', async () => {
    const messageId = await messageInMailboxA();

    const res = await request(app)
      .post(`/api/v1/email-messages/${messageId}/links`)
      .set('Cookie', repACookie)
      .send({ record_type: 'deal', record_id: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for a record type that is not linkable', async () => {
    const messageId = await messageInMailboxA();

    const res = await request(app)
      .post(`/api/v1/email-messages/${messageId}/links`)
      .set('Cookie', repACookie)
      .send({ record_type: 'activity', record_id: contactAId });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a malformed message id', async () => {
    const res = await request(app)
      .post('/api/v1/email-messages/not-a-uuid/links')
      .set('Cookie', repACookie)
      .send({ record_type: 'contact', record_id: contactAId });

    expect(res.status).toBe(400);
  });

  it('applies the same capability gate to leads and accounts as to contacts', async () => {
    // Accounts and leads carry no capability of their own and are gated on contacts:edit
    // wherever they are written. Exempting them here would let a role without it file mail
    // against a lead that it cannot file against a contact.
    await pool.query(
      `INSERT INTO role_capabilities (role_id, capability)
       SELECT id, 'connected_accounts:manage' FROM custom_roles WHERE name = 'viewer'
       ON CONFLICT DO NOTHING`,
    );
    const viewer = await createUser({
      email: `${FILE_PREFIX}-viewer-lead@example.com`,
      name: 'Ctl Viewer Lead',
      role: 'viewer',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const viewerCookie = makeAuthCookie({
      id: viewer.id,
      email: viewer.email,
      name: viewer.name,
      role: viewer.role,
    });
    // Owned by the viewer, so the ownership rule would ALLOW this: only the missing
    // contacts:edit can refuse it, which is what makes this test pin the capability gate.
    const lead = await pool.query<{ id: string }>(
      `INSERT INTO leads (first_name, last_name, email, owner_id, status)
       VALUES ('Ctl', 'GateLead', $1, $2, 'New') RETURNING id`,
      [`${FILE_PREFIX}-gatelead@example.com`, viewer.id],
    );
    const messageId = await messageInMailboxA('gate');

    try {
      const res = await request(app)
        .post(`/api/v1/email-messages/${messageId}/links`)
        .set('Cookie', viewerCookie)
        .send({ record_type: 'lead', record_id: lead.rows[0]!.id });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    } finally {
      await pool.query(
        `DELETE FROM role_capabilities WHERE capability = 'connected_accounts:manage'
           AND role_id IN (SELECT id FROM custom_roles WHERE name = 'viewer')`,
      );
      await pool.query(`DELETE FROM leads WHERE email = $1`, [
        `${FILE_PREFIX}-gatelead@example.com`,
      ]);
    }
  });

  it('links a deal as well as a contact', async () => {
    const deal = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, owner_id, pipeline_id, pipeline_stage_id)
       SELECT $1, 'Prospecting', $2, p.id, s.id
         FROM pipelines p
         JOIN pipeline_stages s ON s.pipeline_id = p.id AND s.is_terminal = false
        WHERE p.is_default = true
        ORDER BY s.sort_order LIMIT 1
       RETURNING id`,
      [`${FILE_PREFIX}-deal`, repAId],
    );
    const messageId = await messageInMailboxA('deal');

    try {
      const res = await request(app)
        .post(`/api/v1/email-messages/${messageId}/links`)
        .set('Cookie', repACookie)
        .send({ record_type: 'deal', record_id: deal.rows[0]!.id });

      expect(res.status).toBe(201);
      expect(res.body.link.record_type).toBe('deal');
    } finally {
      await pool.query(`DELETE FROM deals WHERE name = $1`, [`${FILE_PREFIX}-deal`]);
    }
  });

  it('returns 403 to a role that may manage mailboxes but not edit contacts', async () => {
    // viewer holds no contacts:edit; the mailbox gate alone must not be enough to file
    // mail against a CRM record.
    await pool.query(
      `INSERT INTO role_capabilities (role_id, capability)
       SELECT id, 'connected_accounts:manage' FROM custom_roles WHERE name = 'viewer'
       ON CONFLICT DO NOTHING`,
    );
    const viewer = await createUser({
      email: `${FILE_PREFIX}-viewer@example.com`,
      name: 'Ctl Viewer',
      role: 'viewer',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const viewerCookie = makeAuthCookie({
      id: viewer.id,
      email: viewer.email,
      name: viewer.name,
      role: viewer.role,
    });
    const messageId = await messageInMailboxA();

    try {
      const res = await request(app)
        .post(`/api/v1/email-messages/${messageId}/links`)
        .set('Cookie', viewerCookie)
        .send({ record_type: 'contact', record_id: contactAId });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    } finally {
      await pool.query(
        `DELETE FROM role_capabilities WHERE capability = 'connected_accounts:manage'
           AND role_id IN (SELECT id FROM custom_roles WHERE name = 'viewer')`,
      );
    }
  });
});

describe('DELETE /api/v1/email-messages/:id/links/:linkId', () => {
  async function linkedMessage(): Promise<{ messageId: string; linkId: string }> {
    const message = await pool.query<{ id: string }>(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address)
       VALUES ($1, 'INBOX:unlink', 'thread-unlink', 'inbound', 'someone@example.net')
       RETURNING id`,
      [accountAId],
    );
    const messageId = message.rows[0]!.id;
    const link = await pool.query<{ id: string }>(
      `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
       VALUES ($1, 'contact', $2, 'auto') RETURNING id`,
      [messageId, contactAId],
    );
    return { messageId, linkId: link.rows[0]!.id };
  }

  it('removes the link and audits it', async () => {
    await clearAuditLogFor(repAId);
    const { messageId, linkId } = await linkedMessage();

    const res = await request(app)
      .delete(`/api/v1/email-messages/${messageId}/links/${linkId}`)
      .set('Cookie', repACookie);

    expect(res.status).toBe(204);
    const remaining = await pool.query('SELECT 1 FROM email_message_links WHERE id = $1', [linkId]);
    expect(remaining.rows).toHaveLength(0);

    const audit = await pool.query<{ old_value: string }>(
      `SELECT old_value FROM audit_log WHERE changed_by_id = $1 AND event_type = 'email_unlinked'`,
      [repAId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.old_value).toBe(`contact:${contactAId}`);
  });

  it("returns 404 and removes nothing when the message is another rep's", async () => {
    const { messageId, linkId } = await linkedMessage();

    const res = await request(app)
      .delete(`/api/v1/email-messages/${messageId}/links/${linkId}`)
      .set('Cookie', repBCookie);

    expect(res.status).toBe(404);
    const remaining = await pool.query('SELECT 1 FROM email_message_links WHERE id = $1', [linkId]);
    expect(remaining.rows).toHaveLength(1);
  });

  it('returns 403 to a caller who may not edit the linked record', async () => {
    // Unlinking is as much a CRM write as linking, so it takes the same capability.
    await pool.query(
      `INSERT INTO role_capabilities (role_id, capability)
       SELECT id, 'connected_accounts:manage' FROM custom_roles WHERE name = 'viewer'
       ON CONFLICT DO NOTHING`,
    );
    const viewer = await createUser({
      email: `${FILE_PREFIX}-viewer-unlink@example.com`,
      name: 'Ctl Viewer Unlink',
      role: 'viewer',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const viewerCookie = makeAuthCookie({
      id: viewer.id,
      email: viewer.email,
      name: viewer.name,
      role: viewer.role,
    });
    // The viewer owns the mailbox and the message, so the mailbox gate passes and the
    // capability gate is the only thing left that can reject. Reusing repA's message
    // here would 404 first and the assertion would hold with the capability check
    // deleted entirely.
    const viewerMailboxId = await insertParkedMailbox(
      viewer.id,
      `${FILE_PREFIX}-viewer-mailbox@example.com`,
    );
    const viewerMessage = await pool.query<{ id: string }>(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address)
       VALUES ($1, 'INBOX:viewer-unlink', 'thread-viewer-unlink', 'inbound', 'someone@example.net')
       RETURNING id`,
      [viewerMailboxId],
    );
    const messageId = viewerMessage.rows[0]!.id;
    const viewerLink = await pool.query<{ id: string }>(
      `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
       VALUES ($1, 'contact', $2, 'auto') RETURNING id`,
      [messageId, contactAId],
    );
    const linkId = viewerLink.rows[0]!.id;

    try {
      const res = await request(app)
        .delete(`/api/v1/email-messages/${messageId}/links/${linkId}`)
        .set('Cookie', viewerCookie);

      expect(res.status).toBe(403);
      const remaining = await pool.query('SELECT 1 FROM email_message_links WHERE id = $1', [
        linkId,
      ]);
      expect(remaining.rows).toHaveLength(1);
    } finally {
      await pool.query(
        `DELETE FROM role_capabilities WHERE capability = 'connected_accounts:manage'
           AND role_id IN (SELECT id FROM custom_roles WHERE name = 'viewer')`,
      );
    }
  });

  it('returns 404 for a link id that does not exist', async () => {
    const { messageId } = await linkedMessage();

    const res = await request(app)
      .delete(`/api/v1/email-messages/${messageId}/links/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', repACookie);

    expect(res.status).toBe(404);
  });
});

/**
 * Integration tests for the GDPR AI cascade endpoints.
 *
 * Covers what gdprService.test.ts cannot: the record-type routing through a real
 * HTTP request. The contact and lead routes share one handler factory, so the
 * thing worth pinning is that each route reaches its own record type — a lead
 * request answered from contact state would 409 on every erased lead.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createLead } from '../services/leadsService.js';
import { createContact } from '../services/contactService.js';
import { eraseLead, eraseContact } from '../services/gdprService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'gdpr-ctrl';

let adminId: string;
let adminCookie: string;
let adminActor: { id: string; name: string };

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'GDPR Controller Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminActor = { id: admin.id, name: admin.name };
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
});

afterEach(async () => {
  await pool.query(
    // Keyed on the actor, not on a subquery over tables this same hook deletes:
    // the cascade is fire-and-forget, so its INSERT often lands after the
    // subquery has run and the parent row is already gone.
    `DELETE FROM ai_gdpr_cascade_log WHERE triggered_by = $1`,
    [adminId],
  );
  await pool.query('DELETE FROM gdpr_deletion_log WHERE requested_by = $1', [adminId]);
  await pool.query('DELETE FROM leads WHERE owner_id = $1', [adminId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [adminId]);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.end();
});

function makeLeadInput(suffix: string) {
  return {
    first_name: 'Lead',
    last_name: suffix,
    email: `${FILE_PREFIX}-${suffix}@example.com`,
    owner_id: adminId,
  };
}

/**
 * Polls a cascade-log route until it reports a row.
 *
 * The cascade is fire-and-forget, so the erase call returns before its row exists.
 */
async function pollForCascadeRows(id: string, segment: 'contacts' | 'leads'): Promise<unknown[]> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const res = await request(app)
      .get(`/api/v1/gdpr/${segment}/${id}/ai-cascade`)
      .set('Cookie', adminCookie);
    if (res.body.data.length > 0) return res.body.data;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`cascade log row never appeared for ${segment} ${id}`);
}

describe('POST /api/v1/gdpr/leads/:id/ai-cascade', () => {
  it('returns 409 before the lead has been erased', async () => {
    const lead = await createLead(makeLeadInput('unerased'), adminActor);

    const res = await request(app)
      .post(`/api/v1/gdpr/leads/${lead.id}/ai-cascade`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GDPR_ERASURE_NOT_FOUND');
    expect(res.body.error.message).toContain('lead');
  });

  it('returns 409 when no failed cascade recorded the original identifiers', async () => {
    const lead = await createLead(makeLeadInput('erased'), adminActor);
    await eraseLead(lead.id, adminActor);

    const res = await request(app)
      .post(`/api/v1/gdpr/leads/${lead.id}/ai-cascade`)
      .set('Cookie', adminCookie);

    // The erasure already cleared the row, and a successful cascade clears the
    // log's copy. Without either, a re-run could only search the synthetic
    // placeholder — matching nothing while recording a completed cascade.
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GDPR_CASCADE_PII_UNAVAILABLE');
  });

  it('returns 202 when a failed cascade left identifiers to search on', async () => {
    const lead = await createLead(makeLeadInput('retryable'), adminActor);
    await eraseLead(lead.id, adminActor);
    await pool.query(
      `INSERT INTO ai_gdpr_cascade_log
         (record_type, record_id, triggered_by, status, error_detail, original_name, original_email)
       VALUES ('lead', $1, $2, 'failed', 'simulated', 'Retryable Lead', $3)`,
      [lead.id, adminId, `${FILE_PREFIX}-retryable@example.com`],
    );

    const res = await request(app)
      .post(`/api/v1/gdpr/leads/${lead.id}/ai-cascade`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
  });

  it('does not accept an erased contact id on the lead route', async () => {
    const contact = await createContact(
      {
        first_name: 'Contact',
        last_name: 'CrossType',
        email: `${FILE_PREFIX}-cross@example.com`,
        owner_id: adminId,
      },
      adminActor,
    );
    await eraseContact(contact.id, adminActor);

    const res = await request(app)
      .post(`/api/v1/gdpr/leads/${contact.id}/ai-cascade`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(409);
  });

  it('returns 400 for a non-UUID id', async () => {
    const res = await request(app)
      .post('/api/v1/gdpr/leads/not-a-uuid/ai-cascade')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    const lead = await createLead(makeLeadInput('unauthed'), adminActor);

    const res = await request(app).post(`/api/v1/gdpr/leads/${lead.id}/ai-cascade`);

    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/gdpr/leads/:id/ai-cascade', () => {
  it('returns an empty log before any cascade has run', async () => {
    const lead = await createLead(makeLeadInput('emptylog'), adminActor);

    const res = await request(app)
      .get(`/api/v1/gdpr/leads/${lead.id}/ai-cascade`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('never returns the retained PII columns, even on a failed row', async () => {
    // No erasure here: the reader filters on record_type/record_id alone, and a
    // real erasure would fire a cascade whose Step 4b NULLs these columns —
    // the test would then pass because the PII was gone, not because it is omitted.
    const lead = await createLead(makeLeadInput('failedpii'), adminActor);
    const realName = 'Marguerite Vandenberg';
    const realEmail = `${FILE_PREFIX}-real@example.com`;
    // A failed cascade keeps the subject's real name and email so a re-run can
    // find the same rows — which is exactly why the endpoint must not echo them.
    await pool.query(
      `INSERT INTO ai_gdpr_cascade_log
         (record_type, record_id, triggered_by, status, error_detail, original_name, original_email)
       VALUES ('lead', $1, $2, 'failed', 'simulated', $3, $4)`,
      [lead.id, adminId, realName, realEmail],
    );

    const res = await request(app)
      .get(`/api/v1/gdpr/leads/${lead.id}/ai-cascade`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('failed');
    expect(res.body.data[0]).not.toHaveProperty('original_name');
    expect(res.body.data[0]).not.toHaveProperty('original_email');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(realName);
    expect(serialized).not.toContain(realEmail);
  });

  it('does not return a contact cascade row on the lead route', async () => {
    const contact = await createContact(
      {
        first_name: 'Contact',
        last_name: 'LogIsolation',
        email: `${FILE_PREFIX}-logiso@example.com`,
        owner_id: adminId,
      },
      adminActor,
    );
    await eraseContact(contact.id, adminActor);
    // Poll for the fire-and-forget cascade's row on the contact route.
    const contactRows = await pollForCascadeRows(contact.id, 'contacts');
    expect(contactRows.length).toBeGreaterThan(0);

    const res = await request(app)
      .get(`/api/v1/gdpr/leads/${contact.id}/ai-cascade`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

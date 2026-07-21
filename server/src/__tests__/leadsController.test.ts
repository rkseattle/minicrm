/**
 * HTTP contract tests for leadsController.
 * Verifies request validation, response shapes, ownership enforcement, and conversion.
 * (MINCRM-196)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createLead } from '../services/leadsService.js';
import { createTeam, addTeamMember } from '../services/teamService.js';
import { createNote } from '../services/noteService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

function makeNoteDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

const FILE_PREFIX = 'leads-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;
const OTHER_REP_EMAIL = `${FILE_PREFIX}-other@example.com`;
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;

let repId: string;
let repCookie: string;
let otherRepCookie: string;
let adminCookie: string;

/** Returns a fresh lead body with a unique email on each call. */
const makeLead = () => ({
  first_name: 'Dana',
  last_name: 'Kim',
  email: `${FILE_PREFIX}-${uid()}-dana@example.com`,
  company_name: 'Acme',
  lead_source: 'Web' as const,
});

beforeAll(async () => {
  await pool.query(
    'DELETE FROM notes WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Leads Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const otherRep = await createUser({
    email: OTHER_REP_EMAIL,
    name: 'Other Leads Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherRepCookie = makeAuthCookie({
    id: otherRep.id,
    email: otherRep.email,
    name: otherRep.name,
    role: otherRep.role,
  });

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Leads Admin',
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
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM notes WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  // Clean up in FK-safe order: child tables first, then parents
  await pool.query(
    'DELETE FROM notes WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  // Convert tests create contacts, accounts, deals — remove before deleting users
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── POST /api/leads ───────────────────────────────────────────────────────────

describe('POST /api/leads', () => {
  it('creates a lead and returns 201 with the lead object', async () => {
    const lead = makeLead();
    const res = await request(app).post('/api/v1/leads').set('Cookie', repCookie).send(lead);

    expect(res.status).toBe(201);
    expect(res.body.lead.first_name).toBe('Dana');
    expect(res.body.lead.email).toBe(lead.email);
    expect(res.body.lead.owner_id).toBe(repId);
    expect(res.body.lead.status).toBe('New');
  });

  it('returns 400 when email is missing', async () => {
    const { email: _removed, ...noEmail } = makeLead();
    const res = await request(app).post('/api/v1/leads').set('Cookie', repCookie).send(noEmail);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when email is not valid', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Cookie', repCookie)
      .send({ ...makeLead(), email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 DUPLICATE_EMAIL for an existing email', async () => {
    const dupLead = makeLead();
    await request(app).post('/api/v1/leads').set('Cookie', repCookie).send(dupLead);

    const res = await request(app).post('/api/v1/leads').set('Cookie', repCookie).send(dupLead);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(res.body.duplicate).toBeDefined();
  });

  it('bypasses duplicate check when ?force=true', async () => {
    const forceLead = makeLead();
    await request(app).post('/api/v1/leads').set('Cookie', repCookie).send(forceLead);

    const res = await request(app)
      .post('/api/v1/leads?force=true')
      .set('Cookie', repCookie)
      .send(forceLead);

    expect(res.status).toBe(201);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/v1/leads').send(makeLead());

    expect(res.status).toBe(401);
  });
});

// ── GET /api/leads ────────────────────────────────────────────────────────────

describe('GET /api/leads', () => {
  it('returns paginated leads list', async () => {
    await createLead({ ...makeLead(), owner_id: repId }, { id: repId, name: 'Leads Rep' });

    const res = await request(app).get('/api/v1/leads').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by ?owner=me', async () => {
    await createLead({ ...makeLead(), owner_id: repId }, { id: repId, name: 'Leads Rep' });

    const res = await request(app).get('/api/v1/leads?owner=me').set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    // The otherRep has no leads, so result should be empty
    expect(res.body.data).toHaveLength(0);
  });

  it('filters by status', async () => {
    await createLead({ ...makeLead(), owner_id: repId }, { id: repId, name: 'Leads Rep' });

    const res = await request(app).get('/api/v1/leads?status=New').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const lead of res.body.data as Array<{ status: string }>) {
      expect(lead.status).toBe('New');
    }
  });

  it('filters by lead_source', async () => {
    await createLead({ ...makeLead(), owner_id: repId }, { id: repId, name: 'Leads Rep' });

    const res = await request(app).get('/api/v1/leads?lead_source=Web').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

// ── GET /api/leads/export and /api/leads/export.pdf (MINCRM-651) ───────────

describe('GET /api/leads/export', () => {
  it('returns a CSV file with the correct Content-Type and Content-Disposition headers', async () => {
    await createLead({ ...makeLead(), owner_id: repId }, { id: repId, name: 'Leads Rep' });

    const res = await request(app).get('/api/v1/leads/export').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('only includes leads owned by the requesting rep when ?owner=me is passed', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .get('/api/v1/leads/export?owner=me')
      .set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(lead.email);
  });

  it('mirrors GET /api/leads visibility by default (org-wide, no owner filter)', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).get('/api/v1/leads/export').set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    expect(res.text).toContain(lead.email);
  });

  it('allows admins to export all leads via ?all=true', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).get('/api/v1/leads/export?all=true').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.text).toContain(lead.email);
  });

  it('returns 401 without authentication', async () => {
    await request(app).get('/api/v1/leads/export').expect(401);
  });
});

describe('GET /api/leads/export.pdf', () => {
  it('returns a PDF file with the correct Content-Type and Content-Disposition headers', async () => {
    await createLead({ ...makeLead(), owner_id: repId }, { id: repId, name: 'Leads Rep' });

    const res = await request(app)
      .get('/api/v1/leads/export.pdf')
      .set('Cookie', repCookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('returns 401 without authentication', async () => {
    await request(app).get('/api/v1/leads/export.pdf').expect(401);
  });
});

// ── GET /api/leads/:id ────────────────────────────────────────────────────────

describe('GET /api/leads/:id', () => {
  it('returns the lead when found', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).get(`/api/v1/leads/${lead.id}`).set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.lead.id).toBe(lead.id);
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .get('/api/v1/leads/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── GET /api/leads/:id/export.pdf (MINCRM-650) ──────────────────────────────

describe('GET /api/leads/:id/export.pdf', () => {
  it('returns a single-record PDF with the correct Content-Type and Content-Disposition headers', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );
    await createNote(
      'lead',
      lead.id,
      { body: makeNoteDoc('Lead PDF note'), visibility: 'team', tags: [] },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .get(`/api/v1/leads/${lead.id}/export.pdf`)
      .set('Cookie', repCookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .get('/api/v1/leads/00000000-0000-0000-0000-000000000000/export.pdf')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('allows any authenticated user to export a lead they do not own, matching GET /:id visibility', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .get(`/api/v1/leads/${lead.id}/export.pdf`)
      .set('Cookie', otherRepCookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
  });

  it('returns 401 without authentication', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );
    await request(app).get(`/api/v1/leads/${lead.id}/export.pdf`).expect(401);
  });
});

// ── PATCH /api/leads/:id ──────────────────────────────────────────────────────

describe('PATCH /api/leads/:id', () => {
  it('updates lead status and returns 200', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', repCookie)
      .send({ status: 'Contacted', version: lead.version });

    expect(res.status).toBe(200);
    expect(res.body.lead.status).toBe('Contacted');
  });

  it('returns 400 when status value is invalid', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', repCookie)
      .send({ status: 'NotAStatus', version: lead.version });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("returns 403 when a rep updates another rep's lead", async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', otherRepCookie)
      .send({ status: 'Contacted', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to update any lead', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', adminCookie)
      .send({ status: 'Qualified', version: lead.version });

    expect(res.status).toBe(200);
    expect(res.body.lead.status).toBe('Qualified');
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .patch('/api/v1/leads/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie)
      .send({ status: 'Contacted', version: 1 });

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/leads/:id ─────────────────────────────────────────────────────

describe('DELETE /api/leads/:id', () => {
  it('deletes the lead and returns 204', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).delete(`/api/v1/leads/${lead.id}`).set('Cookie', repCookie);

    expect(res.status).toBe(204);
  });

  it("returns 403 when a rep deletes another rep's lead", async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).delete(`/api/v1/leads/${lead.id}`).set('Cookie', otherRepCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to delete any lead', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).delete(`/api/v1/leads/${lead.id}`).set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .delete('/api/v1/leads/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
  });
});

// ── GET /api/leads/:id/status-history ────────────────────────────────────────

describe('GET /api/leads/:id/status-history', () => {
  it('returns the status history for a lead', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .get(`/api/v1/leads/${lead.id}/status-history`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.history)).toBe(true);
    // createLead writes an initial history entry
    expect(res.body.history.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .get('/api/v1/leads/00000000-0000-0000-0000-000000000000/status-history')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
  });
});

// ── POST /api/leads/:id/convert ───────────────────────────────────────────────

describe('POST /api/leads/:id/convert', () => {
  it('converts the lead and returns 201 with contact/account/deal IDs', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set('Cookie', repCookie)
      .send({
        contact: {
          first_name: 'Dana',
          last_name: 'Kim',
          email: `${FILE_PREFIX}-${uid()}-convert@example.com`,
        },
        account: { mode: 'create', name: 'Acme Corp Ctrl' },
        deal: { name: 'New Deal Ctrl', stage: 'Prospecting' },
      });

    expect(res.status).toBe(201);
    expect(res.body.conversion.contact_id).toBeDefined();
    expect(res.body.conversion.account_id).toBeDefined();
    expect(res.body.conversion.deal_id).toBeDefined();
  });

  it('returns 400 when contact is missing required fields', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set('Cookie', repCookie)
      .send({
        contact: { first_name: 'Dana' }, // missing email
        account: { mode: 'create', name: 'Acme' },
        deal: { name: 'New Deal' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 ALREADY_CONVERTED on second conversion attempt', async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const convertBody = {
      contact: {
        first_name: 'Dana',
        last_name: 'Kim',
        email: `${FILE_PREFIX}-${uid()}-convert2@example.com`,
      },
      account: { mode: 'create', name: 'Acme Corp Ctrl 2' },
      deal: { name: 'New Deal Ctrl 2', stage: 'Prospecting' },
    };

    // First conversion
    await request(app)
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set('Cookie', repCookie)
      .send(convertBody);

    // Second conversion attempt should conflict
    const res = await request(app)
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set('Cookie', repCookie)
      .send({
        ...convertBody,
        contact: { ...convertBody.contact, email: `${FILE_PREFIX}-${uid()}-convert3@example.com` },
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_CONVERTED');
  });

  it("returns 403 when a rep converts another rep's lead", async () => {
    const lead = await createLead(
      { ...makeLead(), owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set('Cookie', otherRepCookie)
      .send({
        contact: { first_name: 'Dana', last_name: 'Kim', email: 'x@x.com' },
        account: { mode: 'create', name: 'X Corp' },
        deal: { name: 'X Deal' },
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .post('/api/v1/leads/00000000-0000-0000-0000-000000000000/convert')
      .set('Cookie', repCookie)
      .send({
        contact: { first_name: 'Dana', last_name: 'Kim', email: 'x@x.com' },
        account: { mode: 'create', name: 'X Corp' },
        deal: { name: 'X Deal' },
      });

    expect(res.status).toBe(404);
  });
});

// ── GET /api/leads/accounts/search ────────────────────────────────────────────

describe('GET /api/leads/accounts/search', () => {
  it('returns accounts matching the query', async () => {
    // Insert an account to search
    await pool.query(`INSERT INTO accounts (name, owner_id) VALUES ($1, $2)`, [
      'SearchableAccount',
      repId,
    ]);

    const res = await request(app)
      .get('/api/v1/leads/accounts/search?q=Searchable')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts.length).toBeGreaterThan(0);

    await pool.query(`DELETE FROM accounts WHERE name = 'SearchableAccount'`);
  });

  it('returns 400 when q param is empty', async () => {
    const res = await request(app).get('/api/v1/leads/accounts/search?q=').set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when q param is missing', async () => {
    const res = await request(app).get('/api/v1/leads/accounts/search').set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── GET /api/leads — ?owner=my_team filter (MINCRM-545) ─────────────────────

describe('GET /api/leads — ?owner=my_team filter', () => {
  const TEAM_PREFIX = `${FILE_PREFIX}-my-team`;
  const ACTOR = { id: '00000000-0000-0000-0000-000000000001', name: 'Test Actor' };

  it('returns leads owned by all team co-members including the requesting user', async () => {
    const userA = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-a@example.com`,
      name: 'Lead Team A',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const userB = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-b@example.com`,
      name: 'Lead Team B',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const cookieA = makeAuthCookie({
      id: userA.id,
      email: userA.email,
      name: userA.name,
      role: userA.role,
    });

    const team = await createTeam({ name: `${TEAM_PREFIX}-${uid()}` }, ACTOR);
    await addTeamMember(team.id, userA.id, 'member', ACTOR);
    await addTeamMember(team.id, userB.id, 'member', ACTOR);

    const leadA = await createLead({ ...makeLead(), owner_id: userA.id });
    const leadB = await createLead({ ...makeLead(), owner_id: userB.id });

    const res = await request(app).get('/api/v1/leads?owner=my_team').set('Cookie', cookieA);

    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((l) => l.id);
    expect(ids).toContain(leadA.id);
    expect(ids).toContain(leadB.id);

    await pool.query('DELETE FROM lead_status_history WHERE lead_id = ANY($1::uuid[])', [
      [leadA.id, leadB.id],
    ]);
    await pool.query('DELETE FROM leads WHERE id = ANY($1::uuid[])', [[leadA.id, leadB.id]]);
    await pool.query('DELETE FROM team_memberships WHERE team_id = $1', [team.id]);
    await pool.query('DELETE FROM teams WHERE id = $1', [team.id]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userA.id, userB.id]]);
  });

  it('falls back to the requesting user only when they belong to no teams', async () => {
    const solo = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-solo@example.com`,
      name: 'Solo Lead User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const other = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-other@example.com`,
      name: 'Other Lead User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const soloCookie = makeAuthCookie({
      id: solo.id,
      email: solo.email,
      name: solo.name,
      role: solo.role,
    });

    const myLead = await createLead({ ...makeLead(), owner_id: solo.id });
    const otherLead = await createLead({ ...makeLead(), owner_id: other.id });

    const res = await request(app).get('/api/v1/leads?owner=my_team').set('Cookie', soloCookie);

    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((l) => l.id);
    expect(ids).toContain(myLead.id);
    expect(ids).not.toContain(otherLead.id);

    await pool.query('DELETE FROM lead_status_history WHERE lead_id = ANY($1::uuid[])', [
      [myLead.id, otherLead.id],
    ]);
    await pool.query('DELETE FROM leads WHERE id = ANY($1::uuid[])', [[myLead.id, otherLead.id]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[solo.id, other.id]]);
  });
});

describe('POST /api/v1/leads/routing-suggestion (MINCRM-475)', () => {
  it('returns 401 without authentication', async () => {
    await request(app).post('/api/v1/leads/routing-suggestion').send({}).expect(401);
  });

  it('returns either 204 (no confident suggestion) or a well-formed 200 suggestion for a profile with no differentiating data', async () => {
    // Weak assertion by design, matching leadRoutingService.test.ts's
    // computeLeadRoutingSuggestion DB-integration tests: gatherCandidates
    // queries every active rep/manager org-wide (see leadRoutingService.ts's
    // module doc comment), so under full-suite Vitest concurrency this
    // candidate pool is populated by whichever other test files' fixture
    // users happen to be active at request time. A hardcoded expect(204)
    // here previously only passed because of a since-fixed service bug
    // (MINCRM-475 / F-ROUTE3) that forced confidence to 'low' whenever the
    // workload/availability team averages were momentarily zero — masking
    // this file's lack of control over the org-wide pool rather than
    // actually asserting "no signal". This test can only correctly assert
    // the response is contractually valid, not which status code a shared,
    // uncontrolled candidate pool happens to produce.
    const response = await request(app)
      .post('/api/v1/leads/routing-suggestion')
      .set('Cookie', repCookie)
      .send({});
    expect([200, 204]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body.suggested_rep_id).toEqual(expect.any(String));
      expect(['medium', 'high']).toContain(response.body.confidence);
    } else {
      expect(response.body).toEqual({});
    }
  });

  it('returns 400 for an invalid body', async () => {
    await request(app)
      .post('/api/v1/leads/routing-suggestion')
      .set('Cookie', repCookie)
      .send({ territory: 123 })
      .expect(400);
  });
});

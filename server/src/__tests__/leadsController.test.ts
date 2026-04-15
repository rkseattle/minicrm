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
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const REP_EMAIL = 'rep-leads-ctrl@example.com';
const OTHER_REP_EMAIL = 'other-rep-leads-ctrl@example.com';
const ADMIN_EMAIL = 'admin-leads-ctrl@example.com';

let repId: string;
let repCookie: string;
let otherRepCookie: string;
let adminCookie: string;

/** Minimal valid lead body */
const BASE_LEAD = {
  first_name: 'Dana',
  last_name: 'Kim',
  email: 'dana.kim.ctrl@example.com',
  company_name: 'Acme',
  lead_source: 'Web',
};

beforeAll(async () => {
  await pool.query('DELETE FROM leads');
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [
    [REP_EMAIL, OTHER_REP_EMAIL, ADMIN_EMAIL],
  ]);

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
  await pool.query('DELETE FROM lead_status_history');
  await pool.query('DELETE FROM leads');
});

afterAll(async () => {
  // Clean up in FK-safe order: child tables first, then parents
  await pool.query('DELETE FROM lead_status_history');
  await pool.query('DELETE FROM leads');
  // Convert tests create contacts, accounts, deals — remove before deleting users
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals WHERE name LIKE $1', ['%Ctrl%']);
  await pool.query('DELETE FROM accounts WHERE name LIKE $1', ['%Ctrl%']);
  await pool.query(
    "DELETE FROM contacts WHERE email LIKE '%ctrl@example.com' OR email LIKE '%convert%'",
  );
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [
    [REP_EMAIL, OTHER_REP_EMAIL, ADMIN_EMAIL],
  ]);
});

// ── POST /api/leads ───────────────────────────────────────────────────────────

describe('POST /api/leads', () => {
  it('creates a lead and returns 201 with the lead object', async () => {
    const res = await request(app).post('/api/leads').set('Cookie', repCookie).send(BASE_LEAD);

    expect(res.status).toBe(201);
    expect(res.body.lead).toBeDefined();
    expect(res.body.lead.first_name).toBe('Dana');
    expect(res.body.lead.email).toBe('dana.kim.ctrl@example.com');
    expect(res.body.lead.owner_id).toBe(repId);
    expect(res.body.lead.status).toBe('New');
  });

  it('returns 400 when email is missing', async () => {
    const { email: _removed, ...noEmail } = BASE_LEAD;
    const res = await request(app).post('/api/leads').set('Cookie', repCookie).send(noEmail);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when email is not valid', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Cookie', repCookie)
      .send({ ...BASE_LEAD, email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 DUPLICATE_EMAIL for an existing email', async () => {
    await request(app).post('/api/leads').set('Cookie', repCookie).send(BASE_LEAD);

    const res = await request(app).post('/api/leads').set('Cookie', repCookie).send(BASE_LEAD);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(res.body.duplicate).toBeDefined();
  });

  it('bypasses duplicate check when ?force=true', async () => {
    await request(app).post('/api/leads').set('Cookie', repCookie).send(BASE_LEAD);

    const res = await request(app)
      .post('/api/leads?force=true')
      .set('Cookie', repCookie)
      .send(BASE_LEAD);

    expect(res.status).toBe(201);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/leads').send(BASE_LEAD);

    expect(res.status).toBe(401);
  });
});

// ── GET /api/leads ────────────────────────────────────────────────────────────

describe('GET /api/leads', () => {
  it('returns paginated leads list', async () => {
    await createLead({ ...BASE_LEAD, owner_id: repId }, { id: repId, name: 'Leads Rep' });

    const res = await request(app).get('/api/leads').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by ?owner=me', async () => {
    await createLead(
      { ...BASE_LEAD, email: 'other-ctrl@example.com', owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).get('/api/leads?owner=me').set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    // The otherRep has no leads, so result should be empty
    expect(res.body.data).toHaveLength(0);
  });

  it('filters by status', async () => {
    await createLead({ ...BASE_LEAD, owner_id: repId }, { id: repId, name: 'Leads Rep' });

    const res = await request(app).get('/api/leads?status=New').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const lead of res.body.data as Array<{ status: string }>) {
      expect(lead.status).toBe('New');
    }
  });

  it('filters by lead_source', async () => {
    await createLead({ ...BASE_LEAD, owner_id: repId }, { id: repId, name: 'Leads Rep' });

    const res = await request(app).get('/api/leads?lead_source=Web').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

// ── GET /api/leads/:id ────────────────────────────────────────────────────────

describe('GET /api/leads/:id', () => {
  it('returns the lead when found', async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).get(`/api/leads/${lead.id}`).set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.lead.id).toBe(lead.id);
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .get('/api/leads/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── PATCH /api/leads/:id ──────────────────────────────────────────────────────

describe('PATCH /api/leads/:id', () => {
  it('updates lead status and returns 200', async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set('Cookie', repCookie)
      .send({ status: 'Contacted' });

    expect(res.status).toBe(200);
    expect(res.body.lead.status).toBe('Contacted');
  });

  it('returns 400 when status value is invalid', async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set('Cookie', repCookie)
      .send({ status: 'NotAStatus' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("returns 403 when a rep updates another rep's lead", async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set('Cookie', otherRepCookie)
      .send({ status: 'Contacted' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to update any lead', async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set('Cookie', adminCookie)
      .send({ status: 'Qualified' });

    expect(res.status).toBe(200);
    expect(res.body.lead.status).toBe('Qualified');
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .patch('/api/leads/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie)
      .send({ status: 'Contacted' });

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/leads/:id ─────────────────────────────────────────────────────

describe('DELETE /api/leads/:id', () => {
  it('deletes the lead and returns 204', async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).delete(`/api/leads/${lead.id}`).set('Cookie', repCookie);

    expect(res.status).toBe(204);
  });

  it("returns 403 when a rep deletes another rep's lead", async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).delete(`/api/leads/${lead.id}`).set('Cookie', otherRepCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to delete any lead', async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app).delete(`/api/leads/${lead.id}`).set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .delete('/api/leads/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
  });
});

// ── GET /api/leads/:id/status-history ────────────────────────────────────────

describe('GET /api/leads/:id/status-history', () => {
  it('returns the status history for a lead', async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .get(`/api/leads/${lead.id}/status-history`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.history)).toBe(true);
    // createLead writes an initial history entry
    expect(res.body.history.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .get('/api/leads/00000000-0000-0000-0000-000000000000/status-history')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
  });
});

// ── POST /api/leads/:id/convert ───────────────────────────────────────────────

describe('POST /api/leads/:id/convert', () => {
  it('converts the lead and returns 201 with contact/account/deal IDs', async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set('Cookie', repCookie)
      .send({
        contact: {
          first_name: 'Dana',
          last_name: 'Kim',
          email: 'dana.convert.ctrl@example.com',
        },
        account: { mode: 'create', name: 'Acme Corp Ctrl' },
        deal: { name: 'New Deal Ctrl', stage: 'Prospecting' },
      });

    expect(res.status).toBe(201);
    expect(res.body.conversion).toBeDefined();
    expect(res.body.conversion.contact_id).toBeDefined();
    expect(res.body.conversion.account_id).toBeDefined();
    expect(res.body.conversion.deal_id).toBeDefined();
  });

  it('returns 400 when contact is missing required fields', async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
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
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const convertBody = {
      contact: {
        first_name: 'Dana',
        last_name: 'Kim',
        email: 'dana.convert2.ctrl@example.com',
      },
      account: { mode: 'create', name: 'Acme Corp Ctrl 2' },
      deal: { name: 'New Deal Ctrl 2', stage: 'Prospecting' },
    };

    // First conversion
    await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set('Cookie', repCookie)
      .send(convertBody);

    // Second conversion attempt should conflict
    const res = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set('Cookie', repCookie)
      .send({
        ...convertBody,
        contact: { ...convertBody.contact, email: 'dana.convert3.ctrl@example.com' },
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_CONVERTED');
  });

  it("returns 403 when a rep converts another rep's lead", async () => {
    const lead = await createLead(
      { ...BASE_LEAD, owner_id: repId },
      { id: repId, name: 'Leads Rep' },
    );

    const res = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set('Cookie', otherRepCookie)
      .send({
        contact: { first_name: 'Dana', email: 'x@x.com' },
        account: { mode: 'create', name: 'X Corp' },
        deal: { name: 'X Deal' },
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 for a non-existent lead', async () => {
    const res = await request(app)
      .post('/api/leads/00000000-0000-0000-0000-000000000000/convert')
      .set('Cookie', repCookie)
      .send({
        contact: { first_name: 'Dana', email: 'x@x.com' },
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
      .get('/api/leads/accounts/search?q=Searchable')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts.length).toBeGreaterThan(0);

    await pool.query(`DELETE FROM accounts WHERE name = 'SearchableAccount'`);
  });

  it('returns 400 when q param is empty', async () => {
    const res = await request(app).get('/api/leads/accounts/search?q=').set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when q param is missing', async () => {
    const res = await request(app).get('/api/leads/accounts/search').set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

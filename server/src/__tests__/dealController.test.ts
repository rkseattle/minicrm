/**
 * Integration tests for the deal controller. (MINCRM-295)
 *
 * Covers: create, list (with filters), get single, update (ownership + stage
 * validation), link/unlink contact, delete, and CSV export.
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createDeal } from '../services/dealService.js';
import { createContact } from '../services/contactService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'deal-ctrl';

const VALID_STAGE = 'Prospecting';
const CLOSED_WON = 'Closed Won';

const makeDealParams = () => ({
  name: `Deal-${uid()}`,
  stage: VALID_STAGE,
  value: 10000,
  currency: 'USD' as const,
});

let repId: string;
let repCookie: string;
let otherRepCookie: string;
let adminCookie: string;

beforeAll(async () => {
  // Clean slate for this file's test users and their records
  await pool.query(
    `DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Deal Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const otherRep = await createUser({
    email: `${FILE_PREFIX}-other@example.com`,
    name: 'Other Rep',
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
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Deal Admin',
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
    `DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── POST /api/deals ───────────────────────────────────────────────────────────

describe('POST /api/deals', () => {
  it('creates a deal and returns 201 with the deal body', async () => {
    const params = makeDealParams();
    const res = await request(app).post('/api/v1/deals').set('Cookie', repCookie).send(params);

    expect(res.status).toBe(201);
    expect(res.body.deal.name).toBe(params.name);
    expect(res.body.deal.stage).toBe(VALID_STAGE);
    expect(res.body.deal.owner_id).toBe(repId);
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/deals')
      .set('Cookie', repCookie)
      .send({ stage: VALID_STAGE });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for an invalid stage', async () => {
    const res = await request(app)
      .post('/api/v1/deals')
      .set('Cookie', repCookie)
      .send({ name: 'Bad Deal', stage: 'NonexistentStage' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/v1/deals')
      .send({ name: 'Unauth Deal', stage: VALID_STAGE });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/deals ────────────────────────────────────────────────────────────

describe('GET /api/deals', () => {
  it('returns 200 with a paginated list', async () => {
    await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app).get('/api/v1/deals?owner=me').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('filters to the authenticated rep when ?owner=me', async () => {
    await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app).get('/api/v1/deals?owner=me').set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('excludes terminal-stage deals when ?hideClosed=true', async () => {
    await createDeal({ ...makeDealParams(), owner_id: repId });
    await createDeal({
      ...makeDealParams(),
      name: `ClosedDeal-${uid()}`,
      stage: CLOSED_WON,
      owner_id: repId,
    });

    const res = await request(app)
      .get('/api/v1/deals?hideClosed=true&owner=me')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    const closedWonRows = (res.body.data as { stage: string }[]).filter(
      (d) => d.stage === CLOSED_WON,
    );
    expect(closedWonRows).toHaveLength(0);
  });

  it('returns 400 VALIDATION_ERROR for an invalid limit', async () => {
    const res = await request(app).get('/api/v1/deals?limit=999').set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/deals');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/deals/:id ────────────────────────────────────────────────────────

describe('GET /api/deals/:id', () => {
  it('returns the deal with its contacts array', async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app).get(`/api/v1/deals/${deal.id}`).set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.deal.id).toBe(deal.id);
    expect(Array.isArray(res.body.contacts)).toBe(true);
  });

  it('returns 404 for a non-existent deal', async () => {
    const res = await request(app)
      .get('/api/v1/deals/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── PATCH /api/deals/:id ─────────────────────────────────────────────────────

describe('PATCH /api/deals/:id — ownership', () => {
  it('allows the owning rep to update their own deal', async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', repCookie)
      .send({ name: 'Updated Name', version: deal.version });

    expect(res.status).toBe(200);
    expect(res.body.deal.name).toBe('Updated Name');
  });

  it("returns 403 when a rep tries to update another rep's deal", async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', otherRepCookie)
      .send({ name: 'Hijacked', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to update any deal', async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Admin Updated', version: deal.version });

    expect(res.status).toBe(200);
    expect(res.body.deal.name).toBe('Admin Updated');
  });

  it('returns 404 for a non-existent deal', async () => {
    const res = await request(app)
      .patch('/api/v1/deals/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie)
      .send({ name: 'Ghost', version: 1 });

    expect(res.status).toBe(404);
  });

  it('returns 400 when updating to an invalid stage', async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', repCookie)
      .send({ stage: 'NoSuchStage', version: deal.version });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when setting a future close_date on a terminal stage deal', async () => {
    const deal = await createDeal({
      ...makeDealParams(),
      stage: CLOSED_WON,
      owner_id: repId,
    });

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', repCookie)
      .send({ close_date: futureDate, version: deal.version });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── POST /api/deals/:id/contacts/:contactId ───────────────────────────────────

describe('POST /api/deals/:id/contacts/:contactId — link contact', () => {
  it('links a contact to a deal and returns the updated contacts list', async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });
    const contact = await createContact({
      first_name: 'Link',
      last_name: 'Test',
      email: `${FILE_PREFIX}-${uid()}-link@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .post(`/api/v1/deals/${deal.id}/contacts/${contact.id}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.contacts)).toBe(true);
    const ids = (res.body.contacts as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(contact.id);
  });

  it("returns 403 when a rep tries to link a contact to another rep's deal", async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });
    const contact = await createContact({
      first_name: 'Forbidden',
      last_name: 'Link',
      email: `${FILE_PREFIX}-${uid()}-forbidlink@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .post(`/api/v1/deals/${deal.id}/contacts/${contact.id}`)
      .set('Cookie', otherRepCookie);

    expect(res.status).toBe(403);
  });

  it('returns 404 when the deal does not exist', async () => {
    const contact = await createContact({
      first_name: 'Missing',
      last_name: 'Deal',
      email: `${FILE_PREFIX}-${uid()}-nodeal@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .post(`/api/v1/deals/00000000-0000-0000-0000-000000000000/contacts/${contact.id}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/deals/:id/contacts/:contactId ─────────────────────────────────

describe('DELETE /api/deals/:id/contacts/:contactId — unlink contact', () => {
  it('unlinks a contact and returns the updated contacts list', async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });
    const contact = await createContact({
      first_name: 'Unlink',
      last_name: 'Test',
      email: `${FILE_PREFIX}-${uid()}-unlink@example.com`,
      owner_id: repId,
    });

    // Link first, then unlink
    await request(app)
      .post(`/api/v1/deals/${deal.id}/contacts/${contact.id}`)
      .set('Cookie', repCookie);

    const res = await request(app)
      .delete(`/api/v1/deals/${deal.id}/contacts/${contact.id}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.contacts)).toBe(true);
    const ids = (res.body.contacts as { id: string }[]).map((c) => c.id);
    expect(ids).not.toContain(contact.id);
  });

  it("returns 403 when a rep tries to unlink from another rep's deal", async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });
    const contact = await createContact({
      first_name: 'Forbidden',
      last_name: 'Unlink',
      email: `${FILE_PREFIX}-${uid()}-forbidunlink@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .delete(`/api/v1/deals/${deal.id}/contacts/${contact.id}`)
      .set('Cookie', otherRepCookie);

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/deals/:id ─────────────────────────────────────────────────────

describe('DELETE /api/deals/:id — ownership', () => {
  it('allows the owning rep to delete their own deal', async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app).delete(`/api/v1/deals/${deal.id}`).set('Cookie', repCookie);

    expect(res.status).toBe(204);
  });

  it("returns 403 when a rep tries to delete another rep's deal", async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app).delete(`/api/v1/deals/${deal.id}`).set('Cookie', otherRepCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to delete any deal', async () => {
    const deal = await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app).delete(`/api/v1/deals/${deal.id}`).set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 404 for a non-existent deal', async () => {
    const res = await request(app)
      .delete('/api/v1/deals/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── GET /api/deals/export ─────────────────────────────────────────────────────

describe('GET /api/deals/export', () => {
  it('returns a CSV file with the correct Content-Type and Content-Disposition headers', async () => {
    await createDeal({ ...makeDealParams(), owner_id: repId });

    const res = await request(app).get('/api/v1/deals/export').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('returns 400 when account param is not a valid UUID', async () => {
    const res = await request(app)
      .get('/api/v1/deals/export?account=not-a-uuid')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

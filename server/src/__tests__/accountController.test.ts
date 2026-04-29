/**
 * Integration tests for account controller authorization.
 *
 * Verifies ownership enforcement on PATCH and DELETE endpoints:
 * - Reps may only modify accounts they own.
 * - Admins may modify any account.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createAccount } from '../services/accountService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'account-ctrl';

const BASE_ACCOUNT = {
  name: 'Test Corp',
  industry: 'Technology',
};

let repId: string;
let repCookie: string;
let otherRepCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Rep User',
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
    name: 'Admin User',
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
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── POST /api/accounts ───────────────────────────────────────────────────────

describe('POST /api/accounts', () => {
  it('creates an account and returns 201', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set('Cookie', repCookie)
      .send({ name: 'New Corp', industry: 'Finance' });

    expect(res.status).toBe(201);
    expect(res.body.account.name).toBe('New Corp');
    expect(res.body.account.owner_id).toBe(repId);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set('Cookie', repCookie)
      .send({ industry: 'Finance' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/accounts').send({ name: 'Test Corp' });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/accounts ────────────────────────────────────────────────────────

describe('GET /api/accounts', () => {
  it('returns all accounts', async () => {
    await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app).get('/api/accounts?owner=me').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters by owner when ?owner=me is passed', async () => {
    await createAccount({ ...BASE_ACCOUNT, name: 'Mine', owner_id: repId });

    const res = await request(app).get('/api/accounts?owner=me').set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ── PATCH /api/accounts/:id — ownership ──────────────────────────────────────

describe('PATCH /api/accounts/:id — ownership', () => {
  it('allows the owning rep to update their own account', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .patch(`/api/accounts/${account.id}`)
      .set('Cookie', repCookie)
      .send({ name: 'Updated Corp' });

    expect(res.status).toBe(200);
    expect(res.body.account.name).toBe('Updated Corp');
  });

  it("returns 403 when a rep attempts to update another rep's account", async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .patch(`/api/accounts/${account.id}`)
      .set('Cookie', otherRepCookie)
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to update any account', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .patch(`/api/accounts/${account.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Admin Updated' });

    expect(res.status).toBe(200);
    expect(res.body.account.name).toBe('Admin Updated');
  });

  it('returns 404 for a non-existent account', async () => {
    const res = await request(app)
      .patch('/api/accounts/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/accounts/:id — ownership ─────────────────────────────────────

describe('DELETE /api/accounts/:id — ownership', () => {
  it('allows the owning rep to delete their own account', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app).delete(`/api/accounts/${account.id}`).set('Cookie', repCookie);

    expect(res.status).toBe(204);
  });

  it("returns 403 when a rep attempts to delete another rep's account", async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .delete(`/api/accounts/${account.id}`)
      .set('Cookie', otherRepCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to delete any account', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app).delete(`/api/accounts/${account.id}`).set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 404 for a non-existent account', async () => {
    const res = await request(app)
      .delete('/api/accounts/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
  });
});

// ── GET /api/accounts — ?search filter ───────────────────────────────────────

describe('GET /api/accounts — ?search filter', () => {
  it('returns only accounts matching the search term', async () => {
    await createAccount({ name: 'Alpha Corp', industry: 'Technology', owner_id: repId });
    await createAccount({ name: 'Beta Inc', industry: 'Finance', owner_id: repId });

    const res = await request(app).get('/api/accounts?search=alpha').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Alpha Corp');
  });

  it('returns empty array when search matches nothing', async () => {
    await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app).get('/api/accounts?search=zzznomatch').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ── GET /api/accounts — ?industry filter ─────────────────────────────────────

describe('GET /api/accounts — ?industry filter', () => {
  it('returns only accounts in the specified industry', async () => {
    await createAccount({ name: 'Tech Co', industry: 'Technology', owner_id: repId });
    await createAccount({ name: 'Finance Co', industry: 'Finance', owner_id: repId });

    const res = await request(app)
      .get('/api/accounts?industry=Technology')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Tech Co');
  });

  it('ignores whitespace-only industry param', async () => {
    await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app).get('/api/accounts?industry=%20').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ── GET /api/accounts/:id — visibility ───────────────────────────────────────

describe('GET /api/accounts/:id — visibility', () => {
  it('allows any authenticated user to view any account', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app).get(`/api/accounts/${account.id}`).set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe(account.id);
  });
});

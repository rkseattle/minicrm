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
import { createTeam, addTeamMember } from '../services/teamService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

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
      .post('/api/v1/accounts')
      .set('Cookie', repCookie)
      .send({ name: 'New Corp', industry: 'Finance' });

    expect(res.status).toBe(201);
    expect(res.body.account.name).toBe('New Corp');
    expect(res.body.account.owner_id).toBe(repId);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', repCookie)
      .send({ industry: 'Finance' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/v1/accounts').send({ name: 'Test Corp' });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/accounts ────────────────────────────────────────────────────────

describe('GET /api/accounts', () => {
  it('returns all accounts', async () => {
    await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app).get('/api/v1/accounts?owner=me').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters by owner when ?owner=me is passed', async () => {
    await createAccount({ ...BASE_ACCOUNT, name: 'Mine', owner_id: repId });

    const res = await request(app).get('/api/v1/accounts?owner=me').set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ── PATCH /api/accounts/:id — ownership ──────────────────────────────────────

describe('PATCH /api/accounts/:id — ownership', () => {
  it('allows the owning rep to update their own account', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .patch(`/api/v1/accounts/${account.id}`)
      .set('Cookie', repCookie)
      .send({ name: 'Updated Corp', version: account.version });

    expect(res.status).toBe(200);
    expect(res.body.account.name).toBe('Updated Corp');
  });

  it("returns 403 when a rep attempts to update another rep's account", async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .patch(`/api/v1/accounts/${account.id}`)
      .set('Cookie', otherRepCookie)
      .send({ name: 'Hijacked', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to update any account', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .patch(`/api/v1/accounts/${account.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Admin Updated', version: account.version });

    expect(res.status).toBe(200);
    expect(res.body.account.name).toBe('Admin Updated');
  });

  it('returns 404 for a non-existent account', async () => {
    const res = await request(app)
      .patch('/api/v1/accounts/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie)
      .send({ name: 'Ghost', version: 1 });

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/accounts/:id — ownership ─────────────────────────────────────

// Per MINCRM-542 + migration 109: reps have contacts:delete and can delete their
// own accounts. Ownership check (owner_id = req.user.id OR role = 'admin') in
// the controller blocks deletion of accounts owned by other users.
describe('DELETE /api/accounts/:id — ownership', () => {
  it('allows a rep to delete their own account (MINCRM-542)', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .delete(`/api/v1/accounts/${account.id}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(204);
  });

  it("returns 403 FORBIDDEN when a rep attempts to delete another rep's account (MINCRM-542)", async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .delete(`/api/v1/accounts/${account.id}`)
      .set('Cookie', otherRepCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to delete any account', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .delete(`/api/v1/accounts/${account.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 404 for a non-existent account when rep has contacts:delete (MINCRM-542)', async () => {
    const res = await request(app)
      .delete('/api/v1/accounts/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    // Rep has contacts:delete so the capability gate passes; controller returns 404
    // because the account does not exist.
    expect(res.status).toBe(404);
  });
});

// ── GET /api/accounts — ?search filter ───────────────────────────────────────

describe('GET /api/accounts — ?search filter', () => {
  it('returns only accounts matching the search term', async () => {
    // Use FILE_PREFIX in names to avoid collision with accountService.test.ts which
    // also creates "Alpha Pharma" in the same DB when tests run concurrently.
    await createAccount({
      name: `${FILE_PREFIX}-Alpha Corp`,
      industry: 'Technology',
      owner_id: repId,
    });
    await createAccount({ name: `${FILE_PREFIX}-Beta Inc`, industry: 'Finance', owner_id: repId });

    const res = await request(app)
      .get(`/api/v1/accounts?search=${FILE_PREFIX}-alpha`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe(`${FILE_PREFIX}-Alpha Corp`);
  });

  it('returns empty array when search matches nothing', async () => {
    await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .get('/api/v1/accounts?search=zzznomatch')
      .set('Cookie', repCookie);

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
      .get('/api/v1/accounts?industry=Technology&owner=me')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Tech Co');
  });

  it('ignores whitespace-only industry param', async () => {
    await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app).get('/api/v1/accounts?industry=%20').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ── GET /api/accounts/:id — visibility ───────────────────────────────────────

describe('GET /api/accounts/:id — visibility', () => {
  it('allows any authenticated user to view any account', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: repId });

    const res = await request(app)
      .get(`/api/v1/accounts/${account.id}`)
      .set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe(account.id);
  });
});

// ── GET /api/accounts — ?owner=my_team filter (MINCRM-545) ──────────────────

describe('GET /api/accounts — ?owner=my_team filter', () => {
  const TEAM_PREFIX = `${FILE_PREFIX}-my-team`;
  const ACTOR = { id: '00000000-0000-0000-0000-000000000001', name: 'Test Actor' };

  it('returns accounts owned by all team co-members including the requesting user', async () => {
    const userA = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-a@example.com`,
      name: 'Acct Team A',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const userB = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-b@example.com`,
      name: 'Acct Team B',
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

    const accountA = await createAccount({ name: `AcctA-${uid()}`, owner_id: userA.id });
    const accountB = await createAccount({ name: `AcctB-${uid()}`, owner_id: userB.id });

    const res = await request(app).get('/api/v1/accounts?owner=my_team').set('Cookie', cookieA);

    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((a) => a.id);
    expect(ids).toContain(accountA.id);
    expect(ids).toContain(accountB.id);

    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [
      [accountA.id, accountB.id],
    ]);
    await pool.query('DELETE FROM team_memberships WHERE team_id = $1', [team.id]);
    await pool.query('DELETE FROM teams WHERE id = $1', [team.id]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userA.id, userB.id]]);
  });

  it('falls back to the requesting user only when they belong to no teams', async () => {
    const solo = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-solo@example.com`,
      name: 'Solo Acct User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const other = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-other@example.com`,
      name: 'Other Acct User',
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

    const myAccount = await createAccount({ name: `SoloAcct-${uid()}`, owner_id: solo.id });
    const otherAccount = await createAccount({ name: `OtherAcct-${uid()}`, owner_id: other.id });

    const res = await request(app).get('/api/v1/accounts?owner=my_team').set('Cookie', soloCookie);

    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((a) => a.id);
    expect(ids).toContain(myAccount.id);
    expect(ids).not.toContain(otherAccount.id);

    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [
      [myAccount.id, otherAccount.id],
    ]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[solo.id, other.id]]);
  });
});

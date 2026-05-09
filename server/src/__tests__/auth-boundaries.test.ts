/**
 * Auth boundary tests (MINCRM-80, MINCRM-81, MINCRM-88).
 *
 * MINCRM-80 — Role boundary enforcement:
 *   Verifies that reps receive 403 FORBIDDEN on all admin-only endpoints.
 *
 * MINCRM-81 — Horizontal privilege enforcement (contacts + accounts):
 *   Verifies that Rep A cannot modify or delete records owned by Rep B.
 *   Deals and activities are covered here as well (originally from MINCRM-88).
 *
 * MINCRM-88 — Horizontal privilege enforcement (deals + activities):
 *   Verifies that PATCH and DELETE endpoints for deals and activities enforce
 *   record ownership:
 *     - A rep cannot modify or delete another rep's records (→ 403 FORBIDDEN)
 *     - An admin can modify or delete any rep's records (→ 200/204)
 *     - Ownership check uses req.user from the auth middleware, not a body field
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { createDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const BASE_USER = {
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let repAId: string;
let _repACookie: string;
let repBCookie: string;
let adminCookie: string;

/** Account required as a linked record for activities */
let sharedAccountId: string;

beforeAll(async () => {
  await pool.query(
    "DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'bounds-%')",
  );
  await pool.query(
    "DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'bounds-%'))",
  );
  await pool.query(
    "DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'bounds-%')",
  );
  // Contacts before accounts (FK: contacts.account_id → accounts.id).
  // Also clean by email pattern to catch rows from partial prior runs where users
  // were deleted before contacts, making the owner_id subquery return zero rows.
  await pool.query("DELETE FROM contacts WHERE email LIKE 'bounds-contact-%'");
  await pool.query(
    "DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'bounds-%')",
  );
  await pool.query(
    "DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'bounds-%')",
  );
  await pool.query("DELETE FROM users WHERE email LIKE 'bounds-%'");

  const repA = await createUser({
    ...BASE_USER,
    email: 'bounds-rep-a@example.com',
    name: 'Rep A',
    role: 'rep',
  });
  repAId = repA.id;
  _repACookie = makeAuthCookie({
    id: repA.id,
    email: repA.email,
    name: repA.name,
    role: repA.role,
  });

  const repB = await createUser({
    ...BASE_USER,
    email: 'bounds-rep-b@example.com',
    name: 'Rep B',
    role: 'rep',
  });
  repBCookie = makeAuthCookie({ id: repB.id, email: repB.email, name: repB.name, role: repB.role });

  const admin = await createUser({
    ...BASE_USER,
    email: 'bounds-admin@example.com',
    name: 'Admin',
    role: 'admin',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  // Seed a shared account for activity link (activities need at least one linked record)
  const { rows } = await pool.query(
    `INSERT INTO accounts (name, owner_id) VALUES ('Bounds Test Co', $1) RETURNING id`,
    [repAId],
  );
  sharedAccountId = rows[0].id;
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'bounds-%')",
  );
  await pool.query(
    "DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'bounds-%'))",
  );
  await pool.query(
    "DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'bounds-%')",
  );
  // Contacts must be deleted before accounts (FK constraint: contacts.account_id → accounts.id).
  // Also clean by email pattern in case of partial prior run failure.
  await pool.query("DELETE FROM contacts WHERE email LIKE 'bounds-contact-%'");
  await pool.query(
    "DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'bounds-%')",
  );
  await pool.query('DELETE FROM accounts WHERE id = $1', [sharedAccountId]);
  await pool.query(
    "DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'bounds-%')",
  );
  await pool.query("DELETE FROM users WHERE email LIKE 'bounds-%'");
});

// ── Deals ─────────────────────────────────────────────────────────────────────

describe('MINCRM-88 — deal ownership enforcement', () => {
  it("returns 403 FORBIDDEN when rep B patches rep A's deal", async () => {
    const deal = await createDeal({
      name: 'Rep A Deal',
      stage: 'Prospecting',
      owner_id: repAId,
    });

    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', repBCookie)
      .send({ name: 'Hijacked Deal', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("returns 403 FORBIDDEN when rep B deletes rep A's deal", async () => {
    const deal = await createDeal({
      name: 'Rep A Deal To Delete',
      stage: 'Prospecting',
      owner_id: repAId,
    });

    const res = await request(app).delete(`/api/v1/deals/${deal.id}`).set('Cookie', repBCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("allows admin to patch rep A's deal", async () => {
    const deal = await createDeal({
      name: 'Rep A Deal Admin Edit',
      stage: 'Prospecting',
      owner_id: repAId,
    });

    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Admin Updated Deal', version: deal.version });

    expect(res.status).toBe(200);
    expect(res.body.deal.name).toBe('Admin Updated Deal');
  });

  it("allows admin to delete rep A's deal", async () => {
    const deal = await createDeal({
      name: 'Rep A Deal Admin Delete',
      stage: 'Prospecting',
      owner_id: repAId,
    });

    const res = await request(app).delete(`/api/v1/deals/${deal.id}`).set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });
});

// ── Activities ────────────────────────────────────────────────────────────────

describe('MINCRM-88 — activity ownership enforcement', () => {
  it("returns 403 FORBIDDEN when rep B patches rep A's activity", async () => {
    const activity = await createActivity({
      type: 'Task',
      subject: 'Rep A Task',
      account_id: sharedAccountId,
      owner_id: repAId,
    });

    const res = await request(app)
      .patch(`/api/v1/activities/${activity.id}`)
      .set('Cookie', repBCookie)
      .send({ subject: 'Hijacked Task', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("returns 403 FORBIDDEN when rep B deletes rep A's activity", async () => {
    const activity = await createActivity({
      type: 'Task',
      subject: 'Rep A Task To Delete',
      account_id: sharedAccountId,
      owner_id: repAId,
    });

    const res = await request(app)
      .delete(`/api/v1/activities/${activity.id}`)
      .set('Cookie', repBCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("allows admin to patch rep A's activity", async () => {
    const activity = await createActivity({
      type: 'Task',
      subject: 'Rep A Task Admin Edit',
      account_id: sharedAccountId,
      owner_id: repAId,
    });

    const res = await request(app)
      .patch(`/api/v1/activities/${activity.id}`)
      .set('Cookie', adminCookie)
      .send({ subject: 'Admin Updated Task', version: activity.version });

    expect(res.status).toBe(200);
    expect(res.body.activity.subject).toBe('Admin Updated Task');
  });

  it("allows admin to delete rep A's activity", async () => {
    const activity = await createActivity({
      type: 'Task',
      subject: 'Rep A Task Admin Delete',
      account_id: sharedAccountId,
      owner_id: repAId,
    });

    const res = await request(app)
      .delete(`/api/v1/activities/${activity.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });
});

// ── MINCRM-80: Role boundary enforcement ─────────────────────────────────────

describe('MINCRM-80 — rep cannot access admin-only endpoints', () => {
  it('returns 403 FORBIDDEN when rep POSTs to automation rules', async () => {
    const res = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', repBCookie)
      .send({
        name: 'Test Rule',
        enabled: true,
        trigger_type: 'deal_created',
        trigger_config: {},
        action_type: 'send_notification',
        action_config: { message: 'Hello' },
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('returns 403 FORBIDDEN when rep PATCHes the default language setting', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/default-language')
      .set('Cookie', repBCookie)
      .send({ language: 'es' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('returns 403 FORBIDDEN when rep attempts to change another user role', async () => {
    // PATCH /api/users/:id/role is admin-only; rep should be blocked
    const res = await request(app)
      .patch(`/api/v1/users/${repAId}/role`)
      .set('Cookie', repBCookie)
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('returns 403 FORBIDDEN when rep attempts to list all automation rules', async () => {
    const res = await request(app).get('/api/v1/automation/rules').set('Cookie', repBCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('returns 200 scoped to rep own data when rep accesses win/loss report', async () => {
    // Note: GET /api/reports/win-loss is intentionally accessible to reps.
    // Reps receive their own deals only (scoped by owner_id = req.user.id).
    // This is by design — the endpoint is NOT admin-only.
    const res = await request(app)
      .get('/api/v1/reports/win-loss?start=2026-01-01&end=2026-12-31')
      .set('Cookie', repBCookie);

    expect(res.status).toBe(200);
  });
});

// ── MINCRM-81: Horizontal privilege enforcement (contacts + accounts) ──────────

describe("MINCRM-81 — rep cannot modify another rep's contact", () => {
  it("returns 403 FORBIDDEN when rep B patches rep A's contact", async () => {
    const contact = await createContact({
      first_name: 'Rep',
      last_name: 'A Contact',
      email: 'bounds-contact-a@example.com',
      owner_id: repAId,
    });

    const res = await request(app)
      .patch(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', repBCookie)
      .send({ first_name: 'Hacked', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("returns 403 FORBIDDEN when rep B deletes rep A's contact", async () => {
    const contact = await createContact({
      first_name: 'Rep',
      last_name: 'A Contact Delete',
      email: 'bounds-contact-a-del@example.com',
      owner_id: repAId,
    });

    const res = await request(app)
      .delete(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', repBCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("allows admin to patch rep A's contact", async () => {
    const contact = await createContact({
      first_name: 'Rep',
      last_name: 'A Contact Admin',
      email: 'bounds-contact-admin-patch@example.com',
      owner_id: repAId,
    });

    const res = await request(app)
      .patch(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', adminCookie)
      .send({ first_name: 'Admin Updated', version: contact.version });

    expect(res.status).toBe(200);
    expect(res.body.contact.first_name).toBe('Admin Updated');
  });

  it("allows admin to delete rep A's contact", async () => {
    const contact = await createContact({
      first_name: 'Rep',
      last_name: 'A Contact Admin Delete',
      email: 'bounds-contact-admin-del@example.com',
      owner_id: repAId,
    });

    const res = await request(app)
      .delete(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });
});

describe("MINCRM-81 — rep cannot modify another rep's account", () => {
  it("returns 403 FORBIDDEN when rep B patches rep A's account", async () => {
    const account = await createAccount({
      name: 'Rep A Account Patch',
      owner_id: repAId,
    });

    const res = await request(app)
      .patch(`/api/v1/accounts/${account.id}`)
      .set('Cookie', repBCookie)
      .send({ name: 'Hacked Account', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("returns 403 FORBIDDEN when rep B deletes rep A's account", async () => {
    const account = await createAccount({
      name: 'Rep A Account Delete',
      owner_id: repAId,
    });

    const res = await request(app)
      .delete(`/api/v1/accounts/${account.id}`)
      .set('Cookie', repBCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("allows admin to patch rep A's account", async () => {
    const account = await createAccount({
      name: 'Rep A Account Admin Patch',
      owner_id: repAId,
    });

    const res = await request(app)
      .patch(`/api/v1/accounts/${account.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Admin Updated Account', version: account.version });

    expect(res.status).toBe(200);
    expect(res.body.account.name).toBe('Admin Updated Account');
  });

  it("allows admin to delete rep A's account", async () => {
    const account = await createAccount({
      name: 'Rep A Account Admin Delete',
      owner_id: repAId,
    });

    const res = await request(app)
      .delete(`/api/v1/accounts/${account.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });
});

// ── MINCRM-188: Bulk endpoint auth boundaries ─────────────────────────────────

describe('MINCRM-188 — bulk endpoints require authentication', () => {
  it('returns 401 when unauthenticated POST to /api/contacts/bulk', async () => {
    const res = await request(app)
      .post('/api/v1/contacts/bulk')
      .send({ action: 'delete', ids: [] });
    expect(res.status).toBe(401);
  });

  it('returns 401 when unauthenticated POST to /api/accounts/bulk', async () => {
    const res = await request(app)
      .post('/api/v1/accounts/bulk')
      .send({ action: 'delete', ids: [] });
    expect(res.status).toBe(401);
  });

  it('returns 401 when unauthenticated POST to /api/deals/bulk', async () => {
    const res = await request(app).post('/api/v1/deals/bulk').send({ action: 'delete', ids: [] });
    expect(res.status).toBe(401);
  });
});

describe('MINCRM-188 — bulk contacts ownership enforcement', () => {
  it('returns 403 when rep B tries to bulk-delete rep A contacts', async () => {
    const contact = await createContact({
      first_name: 'Rep',
      last_name: 'A Bulk Contact',
      email: 'bounds-contact-bulk-a@example.com',
      owner_id: repAId,
    });

    const res = await request(app)
      .post('/api/v1/contacts/bulk')
      .set('Cookie', repBCookie)
      .send({ action: 'delete', ids: [contact.id] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when rep B tries to bulk-reassign rep A contacts', async () => {
    const contact = await createContact({
      first_name: 'Rep',
      last_name: 'A Bulk Reassign',
      email: 'bounds-contact-bulk-reassign@example.com',
      owner_id: repAId,
    });

    const res = await request(app)
      .post('/api/v1/contacts/bulk')
      .set('Cookie', repBCookie)
      .send({ action: 'reassign', ids: [contact.id], owner_id: repAId });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows admin to bulk-delete any contacts', async () => {
    const contact = await createContact({
      first_name: 'Rep',
      last_name: 'A Bulk Admin Delete',
      email: 'bounds-contact-bulk-admin@example.com',
      owner_id: repAId,
    });

    const res = await request(app)
      .post('/api/v1/contacts/bulk')
      .set('Cookie', adminCookie)
      .send({ action: 'delete', ids: [contact.id] });

    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(1);
  });
});

// ── Ownership from req.user, not request body ─────────────────────────────────

describe('MINCRM-88 — ownership check uses req.user, not request body', () => {
  it('ignores owner_id in PATCH body for deals — rep B cannot escalate by sending rep A ID', async () => {
    const deal = await createDeal({
      name: 'Ownership Body Test Deal',
      stage: 'Prospecting',
      owner_id: repAId,
    });

    // Rep B sends a PATCH with owner_id set to rep A's ID — should still be blocked
    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', repBCookie)
      .send({ name: 'Hijacked', owner_id: repAId, version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ignores owner_id in PATCH body for activities — rep B cannot escalate by sending rep A ID', async () => {
    const activity = await createActivity({
      type: 'Task',
      subject: 'Body Injection Test Task',
      account_id: sharedAccountId,
      owner_id: repAId,
    });

    // Rep B sends a PATCH with owner_id set to rep A's ID — should still be blocked
    const res = await request(app)
      .patch(`/api/v1/activities/${activity.id}`)
      .set('Cookie', repBCookie)
      .send({ subject: 'Hijacked Task', owner_id: repAId, version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

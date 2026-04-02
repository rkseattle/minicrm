/**
 * Horizontal privilege escalation tests (MINCRM-88).
 *
 * Verifies that PATCH and DELETE endpoints for contacts, accounts, deals, and
 * activities enforce record ownership:
 *   - A rep cannot modify or delete another rep's records (→ 403 FORBIDDEN)
 *   - An admin can modify or delete any rep's records (→ 200/204)
 *   - Ownership check uses req.user from the auth middleware, not a body field
 *
 * Contacts and accounts have existing coverage in their own controller test files.
 * This file adds the missing coverage for deals and activities, then provides a
 * consolidated cross-entity summary for MINCRM-88 verification.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
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
  await pool.query('DELETE FROM accounts WHERE id = $1', [sharedAccountId]);
  await pool.query("DELETE FROM users WHERE email LIKE 'bounds-%'");
  await pool.end();
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
      .patch(`/api/deals/${deal.id}`)
      .set('Cookie', repBCookie)
      .send({ name: 'Hijacked Deal' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("returns 403 FORBIDDEN when rep B deletes rep A's deal", async () => {
    const deal = await createDeal({
      name: 'Rep A Deal To Delete',
      stage: 'Prospecting',
      owner_id: repAId,
    });

    const res = await request(app).delete(`/api/deals/${deal.id}`).set('Cookie', repBCookie);

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
      .patch(`/api/deals/${deal.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Admin Updated Deal' });

    expect(res.status).toBe(200);
    expect(res.body.deal.name).toBe('Admin Updated Deal');
  });

  it("allows admin to delete rep A's deal", async () => {
    const deal = await createDeal({
      name: 'Rep A Deal Admin Delete',
      stage: 'Prospecting',
      owner_id: repAId,
    });

    const res = await request(app).delete(`/api/deals/${deal.id}`).set('Cookie', adminCookie);

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
      .patch(`/api/activities/${activity.id}`)
      .set('Cookie', repBCookie)
      .send({ subject: 'Hijacked Task' });

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
      .delete(`/api/activities/${activity.id}`)
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
      .patch(`/api/activities/${activity.id}`)
      .set('Cookie', adminCookie)
      .send({ subject: 'Admin Updated Task' });

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
      .delete(`/api/activities/${activity.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
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
      .patch(`/api/deals/${deal.id}`)
      .set('Cookie', repBCookie)
      .send({ name: 'Hijacked', owner_id: repAId });

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
      .patch(`/api/activities/${activity.id}`)
      .set('Cookie', repBCookie)
      .send({ subject: 'Hijacked Task', owner_id: repAId });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

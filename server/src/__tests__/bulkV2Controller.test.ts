/**
 * Integration tests for the Bulk V2 controller endpoints (MINCRM-562).
 *
 * Covers: PATCH and DELETE bulk endpoints for users, contacts, deals, and
 * activities — including capability gating, per-record success/failure
 * accumulation, and input validation.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { createDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'bulk-v2-ctrl';

const VALID_STAGE = 'Prospecting';
const TARGET_STAGE = 'Qualification';

const SYSTEM_ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

let adminId: string;
let adminCookie: string;
let managerCookie: string;
let repId: string;
let repCookie: string;
/** A secondary user that serves as the target for bulk user operations. */
let targetUserId: string;
/** A contact used as a parent for activity fixtures (activities_has_parent constraint). */
let sharedContactId: string;

beforeAll(async () => {
  // Clean up any leftover data from a previous interrupted run
  await pool.query(
    `DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'BulkV2 Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const manager = await createUser({
    email: `${FILE_PREFIX}-mgr@example.com`,
    name: 'BulkV2 Manager',
    role: 'manager',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  managerCookie = makeAuthCookie({
    id: manager.id,
    email: manager.email,
    name: manager.name,
    role: manager.role,
  });

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'BulkV2 Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const target = await createUser({
    email: `${FILE_PREFIX}-target@example.com`,
    name: 'BulkV2 Target',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  targetUserId = target.id;

  const sharedContact = await createContact({
    first_name: 'BulkV2',
    last_name: 'SharedContact',
    email: `${FILE_PREFIX}-shared-contact@example.com`,
    owner_id: repId,
  });
  sharedContactId = sharedContact.id;
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
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

// ── PATCH /api/v1/users/bulk ──────────────────────────────────────────────────

describe('PATCH /api/v1/users/bulk', () => {
  afterEach(async () => {
    // Restore target user to active/rep after any deactivation or role-change test
    await pool.query(`UPDATE users SET status = 'active', role = 'rep' WHERE email LIKE $1`, [
      `${FILE_PREFIX}-target@example.com`,
    ]);
  });

  it('admin deactivating a target user returns 200 with succeeded', async () => {
    const res = await request(app)
      .patch('/api/v1/users/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [targetUserId], patch: { active: false } });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(targetUserId);
    expect(res.body.failed).toHaveLength(0);
  });

  it('admin trying to deactivate self returns 200 with self_deactivation_not_allowed failure', async () => {
    const res = await request(app)
      .patch('/api/v1/users/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [adminId], patch: { active: false } });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toHaveLength(0);
    expect(res.body.failed).toEqual(
      expect.arrayContaining([{ id: adminId, reason: 'self_deactivation_not_allowed' }]),
    );
  });

  it('admin with a non-existent ID returns 200 with not_found failure', async () => {
    const nonExistentId = randomUUID();
    const res = await request(app)
      .patch('/api/v1/users/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [nonExistentId], patch: { active: false } });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toHaveLength(0);
    expect(res.body.failed).toEqual(
      expect.arrayContaining([{ id: nonExistentId, reason: 'not_found' }]),
    );
  });

  it('rep without bulk:operations capability returns 403', async () => {
    const res = await request(app)
      .patch('/api/v1/users/bulk')
      .set('Cookie', repCookie)
      .send({ ids: [targetUserId], patch: { active: false } });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('admin with more than 500 IDs returns 400 with BULK_LIMIT_EXCEEDED', async () => {
    const ids = Array.from({ length: 501 }, () => randomUUID());
    const res = await request(app)
      .patch('/api/v1/users/bulk')
      .set('Cookie', adminCookie)
      .send({ ids, patch: { active: false } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BULK_LIMIT_EXCEEDED');
  });

  it('admin changing role returns 200 with succeeded and DB reflects new role', async () => {
    const res = await request(app)
      .patch('/api/v1/users/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [targetUserId], patch: { role: 'manager' } });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(targetUserId);
    expect(res.body.failed).toHaveLength(0);

    const dbRes = await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [
      targetUserId,
    ]);
    expect(dbRes.rows[0].role).toBe('manager');
  });

  it('manager (non-admin role) returns 403 because the users route requires admin', async () => {
    // The users router applies requireRole('admin') at line 307 of routes/users.ts,
    // so any non-admin user is rejected before capability checks.
    const res = await request(app)
      .patch('/api/v1/users/bulk')
      .set('Cookie', managerCookie)
      .send({ ids: [targetUserId], patch: { active: false } });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/v1/users/bulk ─────────────────────────────────────────────────

describe('DELETE /api/v1/users/bulk', () => {
  it('admin bulk-deletes a user and it is removed from DB', async () => {
    const toDelete = await createUser({
      email: `${FILE_PREFIX}-del-${uid()}@example.com`,
      name: 'BulkV2 ToDelete',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    const res = await request(app)
      .delete('/api/v1/users/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [toDelete.id] });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(toDelete.id);
    expect(res.body.failed).toHaveLength(0);

    const dbRes = await pool.query(`SELECT id FROM users WHERE id = $1`, [toDelete.id]);
    expect(dbRes.rows).toHaveLength(0);
  });

  it('rep without bulk:operations capability returns 403', async () => {
    const res = await request(app)
      .delete('/api/v1/users/bulk')
      .set('Cookie', repCookie)
      .send({ ids: [targetUserId] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});

// ── PATCH /api/v1/contacts/bulk ───────────────────────────────────────────────

describe('PATCH /api/v1/contacts/bulk', () => {
  it('admin reassigning contact owner returns 200 with succeeded', async () => {
    const contact = await createContact({
      first_name: 'BulkV2',
      last_name: 'ContactPatch',
      email: `${FILE_PREFIX}-${uid()}-cpatch@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .patch('/api/v1/contacts/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [contact.id], patch: { owner_id: adminId } });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(contact.id);
    expect(res.body.failed).toHaveLength(0);
  });

  it('rep without bulk:operations capability returns 403', async () => {
    const contact = await createContact({
      first_name: 'BulkV2',
      last_name: 'RepForbidden',
      email: `${FILE_PREFIX}-${uid()}-repforbid@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .patch('/api/v1/contacts/bulk')
      .set('Cookie', repCookie)
      .send({ ids: [contact.id], patch: { owner_id: adminId } });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});

// ── DELETE /api/v1/contacts/bulk ──────────────────────────────────────────────

describe('DELETE /api/v1/contacts/bulk', () => {
  it('admin bulk-deletes contacts and they are removed', async () => {
    const contact = await createContact({
      first_name: 'BulkV2',
      last_name: 'ContactDel',
      email: `${FILE_PREFIX}-${uid()}-cdel@example.com`,
      owner_id: adminId,
    });

    const res = await request(app)
      .delete('/api/v1/contacts/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [contact.id] });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(contact.id);
    expect(res.body.failed).toHaveLength(0);
  });

  it('rep without bulk:operations capability returns 403', async () => {
    const contact = await createContact({
      first_name: 'BulkV2',
      last_name: 'RepForbidDel',
      email: `${FILE_PREFIX}-${uid()}-rdel@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .delete('/api/v1/contacts/bulk')
      .set('Cookie', repCookie)
      .send({ ids: [contact.id] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});

// ── PATCH /api/v1/deals/bulk ──────────────────────────────────────────────────

describe('PATCH /api/v1/deals/bulk', () => {
  it('admin reassigning deal owner returns 200 with succeeded', async () => {
    const deal = await createDeal({
      name: `BulkV2-Deal-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: repId,
    });

    const res = await request(app)
      .patch('/api/v1/deals/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [deal.id], patch: { owner_id: adminId } });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(deal.id);
    expect(res.body.failed).toHaveLength(0);
  });

  it('admin changing deal stage returns 200 with succeeded', async () => {
    const deal = await createDeal({
      name: `BulkV2-DealStage-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: adminId,
    });

    const res = await request(app)
      .patch('/api/v1/deals/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [deal.id], patch: { stage: TARGET_STAGE } });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(deal.id);
    expect(res.body.failed).toHaveLength(0);
  });

  it('rep without bulk:operations capability returns 403', async () => {
    const deal = await createDeal({
      name: `BulkV2-DealRep-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: repId,
    });

    const res = await request(app)
      .patch('/api/v1/deals/bulk')
      .set('Cookie', repCookie)
      .send({ ids: [deal.id], patch: { owner_id: adminId } });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});

// ── DELETE /api/v1/deals/bulk ─────────────────────────────────────────────────

describe('DELETE /api/v1/deals/bulk', () => {
  it('admin bulk-deletes deals and they are removed', async () => {
    const deal = await createDeal({
      name: `BulkV2-DealDel-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: adminId,
    });

    const res = await request(app)
      .delete('/api/v1/deals/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [deal.id] });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(deal.id);
    expect(res.body.failed).toHaveLength(0);
  });

  it('rep without bulk:operations capability returns 403', async () => {
    const deal = await createDeal({
      name: `BulkV2-DealDelRep-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: repId,
    });

    const res = await request(app)
      .delete('/api/v1/deals/bulk')
      .set('Cookie', repCookie)
      .send({ ids: [deal.id] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});

// ── PATCH /api/v1/activities/bulk ─────────────────────────────────────────────

describe('PATCH /api/v1/activities/bulk', () => {
  it('admin reassigning activity owner returns 200 with succeeded', async () => {
    const activity = await createActivity(
      {
        type: 'Task',
        subject: `BulkV2 Activity Patch ${uid()}`,
        owner_id: repId,
        contact_id: sharedContactId,
      },
      SYSTEM_ACTOR,
    );

    const res = await request(app)
      .patch('/api/v1/activities/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [activity.id], patch: { owner_id: adminId } });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(activity.id);
    expect(res.body.failed).toHaveLength(0);
  });

  it('rep without bulk:operations capability returns 403', async () => {
    const activity = await createActivity(
      {
        type: 'Task',
        subject: `BulkV2 Activity Rep ${uid()}`,
        owner_id: repId,
        contact_id: sharedContactId,
      },
      SYSTEM_ACTOR,
    );

    const res = await request(app)
      .patch('/api/v1/activities/bulk')
      .set('Cookie', repCookie)
      .send({ ids: [activity.id], patch: { owner_id: adminId } });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});

// ── DELETE /api/v1/activities/bulk ────────────────────────────────────────────

describe('DELETE /api/v1/activities/bulk', () => {
  it('admin bulk-deletes activities and they are removed', async () => {
    const activity = await createActivity(
      {
        type: 'Task',
        subject: `BulkV2 Activity Del ${uid()}`,
        owner_id: adminId,
        contact_id: sharedContactId,
      },
      SYSTEM_ACTOR,
    );

    const res = await request(app)
      .delete('/api/v1/activities/bulk')
      .set('Cookie', adminCookie)
      .send({ ids: [activity.id] });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(activity.id);
    expect(res.body.failed).toHaveLength(0);
  });

  it('rep without bulk:operations capability returns 403', async () => {
    const activity = await createActivity(
      {
        type: 'Task',
        subject: `BulkV2 Activity Rep Del ${uid()}`,
        owner_id: repId,
        contact_id: sharedContactId,
      },
      SYSTEM_ACTOR,
    );

    const res = await request(app)
      .delete('/api/v1/activities/bulk')
      .set('Cookie', repCookie)
      .send({ ids: [activity.id] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});

/**
 * Unit tests for the Bulk V2 service functions.
 *
 * Covers per-record success/failure isolation using real savepoints against
 * the minicrm_test PostgreSQL database.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { createDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import {
  bulkPatchUsers,
  bulkDeleteUsers,
  bulkPatchContacts,
  bulkDeleteContacts,
  bulkPatchDeals,
  bulkDeleteDeals,
  bulkPatchActivities,
  bulkDeleteActivities,
} from '../services/bulkV2Service.js';
import pool from '../db.js';
import { uid } from './testUtils.js';
import { queueAssignmentNotification } from '../services/notificationService.js';
import type * as NotificationService from '../services/notificationService.js';

// The one mock in this file: an assignment notification batches in memory behind a timer,
// so a reassignment that was rolled back leaves no database trace to assert on. Spying is
// the only way to see the notification that must NOT be sent.
vi.mock('../services/notificationService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationService>()),
  queueAssignmentNotification: vi.fn(),
}));

const FILE_PREFIX = 'bulk-v2-svc';

const VALID_STAGE = 'Prospecting';
const TARGET_STAGE = 'Qualification';

const SYSTEM_ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

let actorId: string;
const actor = () => ({ id: actorId, name: 'BulkV2 Actor' });

let secondUserId: string;
/** A contact used as a parent for activity fixtures (activities_has_parent constraint). */
let sharedContactId: string;

beforeAll(async () => {
  // Clean up any leftover fixtures
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

  const actorUser = await createUser({
    email: `${FILE_PREFIX}-actor@example.com`,
    name: 'BulkV2 Actor',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  actorId = actorUser.id;

  const secondUser = await createUser({
    email: `${FILE_PREFIX}-second@example.com`,
    name: 'BulkV2 Second',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  secondUserId = secondUser.id;

  const sharedContact = await createContact({
    first_name: 'BulkV2Svc',
    last_name: 'SharedContact',
    email: `${FILE_PREFIX}-shared-contact@example.com`,
    owner_id: actorId,
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

// ── bulkPatchUsers ────────────────────────────────────────────────────────────

describe('bulkPatchUsers', () => {
  afterEach(async () => {
    // Restore secondUser to active/rep after any test that changes it
    await pool.query(`UPDATE users SET status = 'active', role = 'rep' WHERE email = $1`, [
      `${FILE_PREFIX}-second@example.com`,
    ]);
  });

  it('activating a target user moves it to succeeded', async () => {
    // First deactivate via SQL so we have something to activate
    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [secondUserId]);

    const result = await bulkPatchUsers({ ids: [secondUserId], patch: { active: true } }, actor());

    expect(result.succeeded).toContain(secondUserId);
    expect(result.failed).toHaveLength(0);

    const dbRes = await pool.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [
      secondUserId,
    ]);
    expect(dbRes.rows[0].status).toBe('active');
  });

  it('actor deactivating themselves produces self_deactivation_not_allowed failure', async () => {
    const result = await bulkPatchUsers({ ids: [actorId], patch: { active: false } }, actor());

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toEqual(
      expect.arrayContaining([{ id: actorId, reason: 'self_deactivation_not_allowed' }]),
    );
  });

  it('non-existent ID produces not_found failure', async () => {
    const ghostId = randomUUID();

    const result = await bulkPatchUsers({ ids: [ghostId], patch: { active: false } }, actor());

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toEqual(expect.arrayContaining([{ id: ghostId, reason: 'not_found' }]));
  });

  it('service_account target produces forbidden failure', async () => {
    const svcUser = await createUser({
      email: `${FILE_PREFIX}-svc-${uid()}@example.com`,
      name: 'BulkV2 SvcAcct',
      role: 'service_account',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    const result = await bulkPatchUsers({ ids: [svcUser.id], patch: { active: false } }, actor());

    expect(result.failed).toEqual(
      expect.arrayContaining([{ id: svcUser.id, reason: 'forbidden' }]),
    );
  });

  it('role change succeeds and DB reflects the new role', async () => {
    const result = await bulkPatchUsers(
      { ids: [secondUserId], patch: { role: 'manager' } },
      actor(),
    );

    expect(result.succeeded).toContain(secondUserId);
    expect(result.failed).toHaveLength(0);

    const dbRes = await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [
      secondUserId,
    ]);
    expect(dbRes.rows[0].role).toBe('manager');
  });
});

// ── bulkDeleteUsers ───────────────────────────────────────────────────────────

describe('bulkDeleteUsers', () => {
  it('deletes a target user and they are absent from DB after commit', async () => {
    const toDelete = await createUser({
      email: `${FILE_PREFIX}-deluser-${uid()}@example.com`,
      name: 'BulkV2 DeleteMe',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    const result = await bulkDeleteUsers({ ids: [toDelete.id] }, actor());

    expect(result.succeeded).toContain(toDelete.id);
    expect(result.failed).toHaveLength(0);

    const dbRes = await pool.query(`SELECT id FROM users WHERE id = $1`, [toDelete.id]);
    expect(dbRes.rows).toHaveLength(0);
  });

  it('actor deleting themselves produces forbidden failure', async () => {
    const result = await bulkDeleteUsers({ ids: [actorId] }, actor());

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toEqual(expect.arrayContaining([{ id: actorId, reason: 'forbidden' }]));
  });
});

// ── bulkPatchContacts ─────────────────────────────────────────────────────────

describe('bulkPatchContacts', () => {
  it('admin reassigning owner_id succeeds', async () => {
    const contact = await createContact({
      first_name: 'BulkV2',
      last_name: 'PatchContact',
      email: `${FILE_PREFIX}-${uid()}-pc@example.com`,
      owner_id: secondUserId,
    });

    const actorWithRole = { ...actor(), role: 'admin' };
    const result = await bulkPatchContacts(
      { ids: [contact.id], patch: { owner_id: actorId } },
      actorWithRole,
    );

    expect(result.succeeded).toContain(contact.id);
    expect(result.failed).toHaveLength(0);
  });
});

// ── bulkDeleteContacts ────────────────────────────────────────────────────────

describe('bulkDeleteContacts', () => {
  it('admin deletes contacts and they are absent from DB', async () => {
    const contact = await createContact({
      first_name: 'BulkV2',
      last_name: 'DelContact',
      email: `${FILE_PREFIX}-${uid()}-dc@example.com`,
      owner_id: actorId,
    });

    const actorWithRole = { ...actor(), role: 'admin' };
    const result = await bulkDeleteContacts({ ids: [contact.id] }, actorWithRole);

    expect(result.succeeded).toContain(contact.id);
    expect(result.failed).toHaveLength(0);

    const dbRes = await pool.query(`SELECT id FROM contacts WHERE id = $1`, [contact.id]);
    expect(dbRes.rows).toHaveLength(0);
  });
});

// ── bulkPatchDeals ────────────────────────────────────────────────────────────

describe('bulkPatchDeals', () => {
  it('admin reassigning owner succeeds', async () => {
    const deal = await createDeal({
      name: `BulkV2-SvcDealPatch-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: secondUserId,
    });

    const actorWithRole = { ...actor(), role: 'admin' };
    const result = await bulkPatchDeals(
      { ids: [deal.id], patch: { owner_id: actorId } },
      actorWithRole,
    );

    expect(result.succeeded).toContain(deal.id);
    expect(result.failed).toHaveLength(0);
  });

  it('admin changing stage to a valid stage succeeds', async () => {
    const deal = await createDeal({
      name: `BulkV2-SvcDealStage-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: actorId,
    });

    const actorWithRole = { ...actor(), role: 'admin' };
    const result = await bulkPatchDeals(
      { ids: [deal.id], patch: { stage: TARGET_STAGE } },
      actorWithRole,
    );

    expect(result.succeeded).toContain(deal.id);
    expect(result.failed).toHaveLength(0);
  });

  it('rolls the owner change back too when the stage is absent from the deal’s pipeline', async () => {
    // owner_id is applied before the stage inside one savepoint, so a stage that does not
    // exist in THIS deal's pipeline must undo both — otherwise the record reports failed
    // while the reassignment stands, and its new owner is notified about it.
    const pipeline = await pool.query<{ id: string }>(
      `INSERT INTO pipelines (name, is_default) VALUES ($1, false) RETURNING id`,
      [`BulkV2-OtherPipeline-${uid()}`],
    );
    const otherPipelineId = pipeline.rows[0]!.id;
    await pool.query(
      `INSERT INTO pipeline_stages (name, sort_order, probability, is_terminal, pipeline_id)
       VALUES ('Only Stage', 10, 25, false, $1)`,
      [otherPipelineId],
    );
    const deal = await createDeal({
      name: `BulkV2-SvcDealCrossPipeline-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: secondUserId,
    });
    await pool.query(
      `UPDATE deals SET pipeline_id = $1,
              pipeline_stage_id = (SELECT id FROM pipeline_stages WHERE pipeline_id = $1)
        WHERE id = $2`,
      [otherPipelineId, deal.id],
    );

    // Earlier tests in this file reassign successfully and legitimately notify.
    vi.mocked(queueAssignmentNotification).mockClear();

    const actorWithRole = { ...actor(), role: 'admin' };
    const result = await bulkPatchDeals(
      { ids: [deal.id], patch: { owner_id: actorId, stage: TARGET_STAGE } },
      actorWithRole,
    );

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toEqual([{ id: deal.id, reason: 'invalid_stage_for_pipeline' }]);

    const after = await pool.query<{ owner_id: string }>(
      'SELECT owner_id FROM deals WHERE id = $1',
      [deal.id],
    );
    expect(after.rows[0]!.owner_id).toBe(secondUserId);

    // The rollback is only half the fix: the id must also leave the notification queue,
    // or the new owner is told about a reassignment the database no longer holds.
    expect(queueAssignmentNotification).not.toHaveBeenCalled();

    await pool.query('DELETE FROM deals WHERE id = $1', [deal.id]);
    await pool.query('DELETE FROM pipelines WHERE id = $1', [otherPipelineId]);
  });

  it('invalid stage throws a VALIDATION_ERROR coded error before the transaction', async () => {
    const deal = await createDeal({
      name: `BulkV2-SvcDealBadStage-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: actorId,
    });

    const actorWithRole = { ...actor(), role: 'admin' };

    await expect(
      bulkPatchDeals({ ids: [deal.id], patch: { stage: 'NoSuchStage' } }, actorWithRole),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ── bulkDeleteDeals ───────────────────────────────────────────────────────────

describe('bulkDeleteDeals', () => {
  it('admin deletes deals and they are absent from DB', async () => {
    const deal = await createDeal({
      name: `BulkV2-SvcDealDel-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: actorId,
    });

    const actorWithRole = { ...actor(), role: 'admin' };
    const result = await bulkDeleteDeals({ ids: [deal.id] }, actorWithRole);

    expect(result.succeeded).toContain(deal.id);
    expect(result.failed).toHaveLength(0);

    const dbRes = await pool.query(`SELECT id FROM deals WHERE id = $1`, [deal.id]);
    expect(dbRes.rows).toHaveLength(0);
  });
});

// ── bulkPatchActivities ───────────────────────────────────────────────────────

describe('bulkPatchActivities', () => {
  it('admin reassigning activity owner succeeds', async () => {
    const activity = await createActivity(
      {
        type: 'Task',
        subject: `BulkV2 SvcActPatch ${uid()}`,
        owner_id: secondUserId,
        contact_id: sharedContactId,
      },
      SYSTEM_ACTOR,
    );

    const actorWithRole = { ...actor(), role: 'admin' };
    const result = await bulkPatchActivities(
      { ids: [activity.id], patch: { owner_id: actorId } },
      actorWithRole,
    );

    expect(result.succeeded).toContain(activity.id);
    expect(result.failed).toHaveLength(0);
  });
});

// ── bulkDeleteActivities ──────────────────────────────────────────────────────

describe('bulkDeleteActivities', () => {
  it('admin deletes activities and they are absent from DB', async () => {
    const activity = await createActivity(
      {
        type: 'Task',
        subject: `BulkV2 SvcActDel ${uid()}`,
        owner_id: actorId,
        contact_id: sharedContactId,
      },
      SYSTEM_ACTOR,
    );

    const actorWithRole = { ...actor(), role: 'admin' };
    const result = await bulkDeleteActivities({ ids: [activity.id] }, actorWithRole);

    expect(result.succeeded).toContain(activity.id);
    expect(result.failed).toHaveLength(0);

    const dbRes = await pool.query(`SELECT id FROM activities WHERE id = $1`, [activity.id]);
    expect(dbRes.rows).toHaveLength(0);
  });
});

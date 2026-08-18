/**
 * Integration tests for activityService.
 *
 * Runs against a real PostgreSQL test database.
 * A single test user, contact, account, and deal are created in beforeAll and reused.
 * The activities table is truncated before each test to ensure isolation.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import {
  createActivity,
  findActivityById,
  listActivities,
  listMyTasks,
  updateActivity,
  deleteActivity,
} from '../services/activityService.js';
import { createUser } from '../services/userService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import {
  createActivitySchema,
  updateActivitySchema,
} from '@minicrm/shared/schemas/activitySchema.js';
import pool from '../db.js';
import type { QueryResult } from 'pg';
import { waitUntil, clearAuditLogFor } from './testUtils.js';

const FILE_PREFIX = 'act-svc';

/** Minimal user fixture used as activity owner */
const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Activity Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let contactId: string;
let accountId: string;
let dealId: string;
let defaultPipelineId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;

  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
    ['Test Account', ownerId],
  );
  accountId = accountResult.rows[0].id;

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Test', 'Contact', '${FILE_PREFIX}-contact@example.com', $1) RETURNING id`,
    [ownerId],
  );
  contactId = contactResult.rows[0].id;

  defaultPipelineId = await getDefaultPipelineId();

  const stageIdForActivity = (
    await pool.query<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
      ['Prospecting', defaultPipelineId],
    )
  ).rows[0].id;
  const dealResult = await pool.query<{ id: string }>(
    `INSERT INTO deals (name, stage, owner_id, pipeline_id, pipeline_stage_id) VALUES ('Test Deal', 'Prospecting', $1, $2, $3) RETURNING id`,
    [ownerId, defaultPipelineId, stageIdForActivity],
  );
  dealId = dealResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
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

// ── createActivity ──────────────────────────────────────────────────────────────

describe('createActivity', () => {
  it('inserts a note activity linked to a contact and returns the full row', async () => {
    const activity = await createActivity({
      type: 'Note',
      subject: 'Initial outreach',
      contact_id: contactId,
      owner_id: ownerId,
    });

    expect(activity.id).toBeDefined();
    expect(activity.type).toBe('Note');
    expect(activity.subject).toBe('Initial outreach');
    expect(activity.status).toBe('open');
    expect(activity.contact_id).toBe(contactId);
    expect(activity.account_id).toBeNull();
    expect(activity.deal_id).toBeNull();
    expect(activity.notes).toBeNull();
    expect(activity.due_date).toBeNull();
    expect(activity.owner_id).toBe(ownerId);
    expect(activity.owner_name).toBe(OWNER_USER.name);
    expect(activity.created_at).toBeInstanceOf(Date);
  });

  it('stores notes and due_date for a Task type', async () => {
    const activity = await createActivity({
      type: 'Task',
      subject: 'Follow up call',
      notes: 'Discuss pricing',
      due_date: '2026-06-30',
      deal_id: dealId,
      owner_id: ownerId,
    });

    expect(activity.type).toBe('Task');
    expect(activity.notes).toBe('Discuss pricing');
    expect(activity.due_date).toBe('2026-06-30');
    expect(activity.deal_id).toBe(dealId);
  });

  it('links to an account when account_id is provided', async () => {
    const activity = await createActivity({
      type: 'Call',
      subject: 'Account check-in',
      account_id: accountId,
      owner_id: ownerId,
      direction: 'Outbound',
    });

    expect(activity.account_id).toBe(accountId);
  });

  it('stores direction and outcome for a Call activity', async () => {
    const activity = await createActivity({
      type: 'Call',
      subject: 'Intro call',
      direction: 'Outbound',
      outcome: 'Left voicemail',
      contact_id: contactId,
      owner_id: ownerId,
    });

    expect(activity.type).toBe('Call');
    expect(activity.direction).toBe('Outbound');
    expect(activity.outcome).toBe('Left voicemail');
  });

  it('stores direction for an Email activity with no outcome', async () => {
    const activity = await createActivity({
      type: 'Email',
      subject: 'Follow-up email',
      direction: 'Inbound',
      contact_id: contactId,
      owner_id: ownerId,
    });

    expect(activity.direction).toBe('Inbound');
    expect(activity.outcome).toBeNull();
  });

  it('stores null direction and outcome for a Note activity', async () => {
    const activity = await createActivity({
      type: 'Note',
      subject: 'Just a note',
      contact_id: contactId,
      owner_id: ownerId,
    });

    expect(activity.direction).toBeNull();
    expect(activity.outcome).toBeNull();
  });

  it('throws when owner_id does not reference a real user', async () => {
    await expect(
      createActivity({
        type: 'Note',
        subject: 'Ghost note',
        contact_id: contactId,
        owner_id: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow();
  });
});

// ── DB constraints ─────────────────────────────────────────────────────────────

describe('DB constraints — activities', () => {
  it('rejects an activity with a null subject (NOT NULL)', async () => {
    await expect(
      pool.query(
        `INSERT INTO activities (type, subject, contact_id, owner_id)
         VALUES ('Note', NULL, $1, $2)`,
        [contactId, ownerId],
      ),
    ).rejects.toThrow();
  });

  it('rejects an activity with an invalid type value', async () => {
    await expect(
      pool.query(
        `INSERT INTO activities (type, subject, contact_id, owner_id)
         VALUES ('Invalid', 'Subject', $1, $2)`,
        [contactId, ownerId],
      ),
    ).rejects.toThrow();
  });

  it('rejects an activity whose contact_id references a non-existent contact (FK)', async () => {
    await expect(
      createActivity({
        type: 'Note',
        subject: 'Bad FK activity',
        contact_id: '00000000-0000-0000-0000-000000000000',
        owner_id: ownerId,
      }),
    ).rejects.toThrow();
  });
});

// ── Schema validation — direction/type rules ────────────────────────────────────

describe('createActivitySchema — direction validation', () => {
  const base = { subject: 'S', contact_id: '00000000-0000-0000-0000-000000000001' };

  it('rejects a Call without direction', () => {
    const result = createActivitySchema.safeParse({ ...base, type: 'Call' });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0].message).toMatch(/direction is required/i);
  });

  it('rejects an Email without direction', () => {
    const result = createActivitySchema.safeParse({ ...base, type: 'Email' });
    expect(result.success).toBe(false);
  });

  it('accepts a Call with direction', () => {
    const result = createActivitySchema.safeParse({ ...base, type: 'Call', direction: 'Outbound' });
    expect(result.success).toBe(true);
  });

  it('accepts a Note without direction', () => {
    const result = createActivitySchema.safeParse({ ...base, type: 'Note' });
    expect(result.success).toBe(true);
  });
});

describe('updateActivitySchema — direction validation', () => {
  it('rejects a type change to Call without direction', () => {
    const result = updateActivitySchema.safeParse({ type: 'Call', version: 1 });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0].message).toMatch(/direction is required/i);
  });

  it('rejects a type change to Email without direction', () => {
    const result = updateActivitySchema.safeParse({ type: 'Email', version: 1 });
    expect(result.success).toBe(false);
  });

  it('accepts a type change to Call with direction provided', () => {
    const result = updateActivitySchema.safeParse({
      type: 'Call',
      direction: 'Inbound',
      version: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a subject-only patch (type not changing)', () => {
    const result = updateActivitySchema.safeParse({ subject: 'Updated', version: 1 });
    expect(result.success).toBe(true);
  });
});

// ── findActivityById ────────────────────────────────────────────────────────────

describe('findActivityById', () => {
  it('returns the activity row when found', async () => {
    const created = await createActivity({
      type: 'Email',
      subject: 'Proposal sent',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const found = await findActivityById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.subject).toBe('Proposal sent');
    expect(found!.owner_name).toBe(OWNER_USER.name);
  });

  it('returns null for a non-existent UUID', async () => {
    const found = await findActivityById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

// ── listActivities ──────────────────────────────────────────────────────────────

describe('listActivities', () => {
  it('returns an empty array when no activities exist', async () => {
    const result = await listActivities({ ownerId });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns all activities ordered by created_at descending', async () => {
    await createActivity({
      type: 'Note',
      subject: 'First',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Call',
      subject: 'Second',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const result = await listActivities({ ownerId });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    // Newest first
    expect(result.data[0].subject).toBe('Second');
    expect(result.data[1].subject).toBe('First');
    // Each row includes owner_name
    expect(result.data[0].owner_name).toBe(OWNER_USER.name);
  });

  it('filters by contactId when provided', async () => {
    await createActivity({
      type: 'Note',
      subject: 'Contact note',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Note',
      subject: 'Deal note',
      deal_id: dealId,
      owner_id: ownerId,
    });

    const result = await listActivities({ contactId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].subject).toBe('Contact note');
  });

  it('filters by accountId when provided', async () => {
    await createActivity({
      type: 'Meeting',
      subject: 'Account meeting',
      account_id: accountId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Note',
      subject: 'Other note',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const result = await listActivities({ accountId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].subject).toBe('Account meeting');
  });

  it('filters by dealId when provided', async () => {
    await createActivity({
      type: 'Task',
      subject: 'Deal task',
      deal_id: dealId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Note',
      subject: 'Contact note',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const result = await listActivities({ dealId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].subject).toBe('Deal task');
  });

  it('filters by ownerId when provided', async () => {
    const other = await createUser({
      ...OWNER_USER,
      email: `${FILE_PREFIX}-other-owner@example.com`,
    });

    await createActivity({
      type: 'Note',
      subject: 'My note',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Note',
      subject: 'Their note',
      contact_id: contactId,
      owner_id: other.id,
    });

    const result = await listActivities({ ownerId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].subject).toBe('My note');
  });
});

// ── listActivities — pagination ─────────────────────────────────────────────────

describe('listActivities — pagination', () => {
  it('returns correct page and limit metadata', async () => {
    await createActivity({
      type: 'Note',
      subject: 'Act 1',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Note',
      subject: 'Act 2',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Note',
      subject: 'Act 3',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const result = await listActivities({ ownerId, page: 1, limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });

  it('returns the correct slice for page 2', async () => {
    await createActivity({
      type: 'Note',
      subject: 'Oldest',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Note',
      subject: 'Middle',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Note',
      subject: 'Newest',
      contact_id: contactId,
      owner_id: ownerId,
    });

    // Activities are ordered newest-first, so page 2 of limit 2 returns the oldest
    const result = await listActivities({ ownerId, page: 2, limit: 2 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].subject).toBe('Oldest');
    expect(result.total).toBe(3);
  });
});

// ── listActivities — type/start/end filters ──────────────────────────────────────

describe('listActivities — type filter', () => {
  it('returns only activities matching the requested type', async () => {
    await createActivity({
      type: 'Note',
      subject: 'A note',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Call',
      subject: 'A call',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const result = await listActivities({ ownerId, type: 'Call' });
    const mine = result.data.filter((a) => a.owner_id === ownerId);
    expect(mine.every((a) => a.type === 'Call')).toBe(true);
    expect(mine.some((a) => a.subject === 'A call')).toBe(true);
  });

  it('returns no results when type matches nothing', async () => {
    await createActivity({
      type: 'Note',
      subject: 'Only note',
      contact_id: contactId,
      owner_id: ownerId,
    });
    const result = await listActivities({ ownerId, type: 'Meeting' });
    const mine = result.data.filter((a) => a.owner_id === ownerId);
    expect(mine).toHaveLength(0);
  });
});

// ── listMyTasks ─────────────────────────────────────────────────────────────────

describe('listMyTasks', () => {
  it('returns only Task-type activities for the given owner', async () => {
    await createActivity({
      type: 'Note',
      subject: 'Not a task',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Task',
      subject: 'My task',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const { tasks, total } = await listMyTasks(ownerId, 1, 25);
    expect(tasks).toHaveLength(1);
    expect(total).toBe(1);
    expect(tasks[0].subject).toBe('My task');
    expect(tasks[0].type).toBe('Task');
    expect(tasks[0].version).toBe(1);
  });

  it('excludes tasks owned by other users', async () => {
    const other = await createUser({
      ...OWNER_USER,
      email: `${FILE_PREFIX}-other-tasks@example.com`,
    });
    await createActivity({
      type: 'Task',
      subject: 'Their task',
      contact_id: contactId,
      owner_id: other.id,
    });
    await createActivity({
      type: 'Task',
      subject: 'My task',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const { tasks, total } = await listMyTasks(ownerId, 1, 25);
    expect(tasks).toHaveLength(1);
    expect(total).toBe(1);
    expect(tasks[0].subject).toBe('My task');
  });

  it('includes both open and complete tasks', async () => {
    const openTask = await createActivity({
      type: 'Task',
      subject: 'Open task',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await updateActivity(openTask.id, { status: 'complete', version: openTask.version });
    await createActivity({
      type: 'Task',
      subject: 'Another open task',
      deal_id: dealId,
      owner_id: ownerId,
    });

    const { tasks, total } = await listMyTasks(ownerId, 1, 25);
    expect(tasks).toHaveLength(2);
    expect(total).toBe(2);
    const statuses = tasks.map((t) => t.status);
    expect(statuses).toContain('open');
    expect(statuses).toContain('complete');
  });

  it('sorts tasks by due_date ascending with nulls last', async () => {
    await createActivity({
      type: 'Task',
      subject: 'Later',
      due_date: '2026-12-01',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Task',
      subject: 'No date',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Task',
      subject: 'Earlier',
      due_date: '2026-06-01',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const { tasks } = await listMyTasks(ownerId, 1, 25);
    expect(tasks[0].subject).toBe('Earlier');
    expect(tasks[1].subject).toBe('Later');
    expect(tasks[2].subject).toBe('No date');
  });

  it('includes linked_record_name and linked_record_type for contact tasks', async () => {
    await createActivity({
      type: 'Task',
      subject: 'Contact task',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const { tasks } = await listMyTasks(ownerId, 1, 25);
    expect(tasks[0].linked_record_type).toBe('contact');
    expect(tasks[0].linked_record_name).toBe('Test Contact');
  });

  it('includes linked_record_name and linked_record_type for account tasks', async () => {
    await createActivity({
      type: 'Task',
      subject: 'Account task',
      account_id: accountId,
      owner_id: ownerId,
    });

    const { tasks } = await listMyTasks(ownerId, 1, 25);
    expect(tasks[0].linked_record_type).toBe('account');
    expect(tasks[0].linked_record_name).toBe('Test Account');
  });

  it('includes linked_record_name and linked_record_type for deal tasks', async () => {
    await createActivity({
      type: 'Task',
      subject: 'Deal task',
      deal_id: dealId,
      owner_id: ownerId,
    });

    const { tasks } = await listMyTasks(ownerId, 1, 25);
    expect(tasks[0].linked_record_type).toBe('deal');
    expect(tasks[0].linked_record_name).toBe('Test Deal');
  });

  it('returns an empty result when the owner has no tasks', async () => {
    const { tasks, total } = await listMyTasks(ownerId, 1, 25);
    expect(tasks).toEqual([]);
    expect(total).toBe(0);
  });

  it('returns the correct page of results using LIMIT and OFFSET', async () => {
    for (let i = 1; i <= 3; i++) {
      await createActivity({
        type: 'Task',
        subject: `Task ${i}`,
        due_date: `2026-0${i}-01`,
        contact_id: contactId,
        owner_id: ownerId,
      });
    }

    const page1 = await listMyTasks(ownerId, 1, 2);
    expect(page1.tasks).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.tasks[0].subject).toBe('Task 1');
    expect(page1.tasks[1].subject).toBe('Task 2');

    const page2 = await listMyTasks(ownerId, 2, 2);
    expect(page2.tasks).toHaveLength(1);
    expect(page2.total).toBe(3);
    expect(page2.tasks[0].subject).toBe('Task 3');
  });

  it('total reflects all matching tasks regardless of the requested page', async () => {
    for (let i = 1; i <= 5; i++) {
      await createActivity({
        type: 'Task',
        subject: `Task ${i}`,
        contact_id: contactId,
        owner_id: ownerId,
      });
    }

    const { total } = await listMyTasks(ownerId, 2, 2);
    expect(total).toBe(5);
  });
});

// ── updateActivity ──────────────────────────────────────────────────────────────

describe('updateActivity', () => {
  it('updates the specified fields and returns the updated row', async () => {
    const activity = await createActivity({
      type: 'Note',
      subject: 'Original subject',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const updated = await updateActivity(activity.id, {
      subject: 'Updated subject',
      type: 'Call',
      version: activity.version,
    });
    expect(updated!.subject).toBe('Updated subject');
    expect(updated!.type).toBe('Call');
    // Unchanged fields remain intact
    expect(updated!.contact_id).toBe(contactId);
  });

  it('marks a task as complete by updating status', async () => {
    const activity = await createActivity({
      type: 'Task',
      subject: 'Todo item',
      deal_id: dealId,
      owner_id: ownerId,
    });

    expect(activity.status).toBe('open');

    const updated = await updateActivity(activity.id, {
      status: 'complete',
      version: activity.version,
    });
    expect(updated!.status).toBe('complete');
  });

  it('updates updated_at timestamp', async () => {
    const activity = await createActivity({
      type: 'Note',
      subject: 'Time test',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const updated = await updateActivity(activity.id, {
      notes: 'Added notes',
      version: activity.version,
    });
    expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(activity.updated_at.getTime());
  });

  it('returns null for a non-existent activity', async () => {
    const result = await updateActivity('00000000-0000-0000-0000-000000000000', {
      subject: 'Ghost',
      version: 1,
    });
    expect(result).toBeNull();
  });

  it('updates direction and outcome fields', async () => {
    const activity = await createActivity({
      type: 'Call',
      subject: 'Initial call',
      direction: 'Outbound',
      contact_id: contactId,
      owner_id: ownerId,
    });

    expect(activity.direction).toBe('Outbound');
    expect(activity.outcome).toBeNull();

    const updated = await updateActivity(activity.id, {
      direction: 'Inbound',
      outcome: 'Agreed to demo',
      version: activity.version,
    });

    expect(updated!.direction).toBe('Inbound');
    expect(updated!.outcome).toBe('Agreed to demo');
  });

  it('increments the version after each update', async () => {
    const activity = await createActivity({
      type: 'Note',
      subject: 'Version test',
      contact_id: contactId,
      owner_id: ownerId,
    });
    expect(activity.version).toBe(1);

    const updated = await updateActivity(activity.id, {
      subject: 'Version 2',
      version: activity.version,
    });
    expect(updated!.version).toBe(2);
  });

  it('throws OPTIMISTIC_LOCK_CONFLICT when the version is stale', async () => {
    const activity = await createActivity({
      type: 'Note',
      subject: 'Conflict test',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await updateActivity(activity.id, { subject: 'Concurrent update', version: activity.version });

    await expect(
      updateActivity(activity.id, { subject: 'Stale update', version: activity.version }),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_LOCK_CONFLICT' });
  });

  it('does not apply changes when the version is stale', async () => {
    const activity = await createActivity({
      type: 'Note',
      subject: 'Conflict data test',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await updateActivity(activity.id, { subject: 'Winner', version: activity.version });

    await expect(
      updateActivity(activity.id, { subject: 'Loser', version: activity.version }),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_LOCK_CONFLICT' });

    const found = await findActivityById(activity.id);
    expect(found!.subject).toBe('Winner');
  });
});

// ── deleteActivity ──────────────────────────────────────────────────────────────

describe('deleteActivity', () => {
  it('removes the activity and returns the deleted row', async () => {
    const activity = await createActivity({
      type: 'Note',
      subject: 'To be deleted',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const deleted = await deleteActivity(activity.id);
    expect(deleted!.id).toBe(activity.id);

    const found = await findActivityById(activity.id);
    expect(found).toBeNull();
  });

  it('returns null for a non-existent activity', async () => {
    const result = await deleteActivity('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ── Audit log coverage ─────────────────────────────────────────────

const TEST_ACTOR = { id: '00000000-0000-0000-0000-000000000001', name: 'Audit Test Actor' };

describe('audit log entries', () => {
  beforeEach(async () => {
    await clearAuditLogFor(TEST_ACTOR.id);
  });

  it('createActivity writes an audit entry with record_type=activity and event_type=created', async () => {
    const activity = await createActivity(
      { type: 'Note', subject: 'Audit create test', contact_id: contactId, owner_id: ownerId },
      TEST_ACTOR,
    );

    // writeAuditEntryBestEffort is fire-and-forget; poll for the row rather
    // than a fixed sleep — a fixed sleep races the real clock and produces a
    // coin-flip failure whenever the write is delayed under CI scheduling/DB
    // pool pressure (see waitUntil's doc comment).
    let result: QueryResult | undefined;
    await waitUntil(async () => {
      result = await pool.query(
        `SELECT * FROM audit_log WHERE record_id = $1 AND changed_by_id = $2`,
        [activity.id, TEST_ACTOR.id],
      );
      return result.rows.length > 0;
    }, 5_000);

    expect(result!.rows).toHaveLength(1);
    expect(result!.rows[0].record_type).toBe('activity');
    expect(result!.rows[0].event_type).toBe('created');
    expect(result!.rows[0].record_name).toBe('Audit create test');
  });

  it('updateActivity writes field-level audit entries within the transaction', async () => {
    const activity = await createActivity(
      { type: 'Note', subject: 'Before update', contact_id: contactId, owner_id: ownerId },
      TEST_ACTOR,
    );

    await updateActivity(
      activity.id,
      { subject: 'After update', version: activity.version },
      TEST_ACTOR,
    );

    const result = await pool.query(
      `SELECT * FROM audit_log WHERE record_id = $1 AND changed_by_id = $2 AND event_type = 'updated'`,
      [activity.id, TEST_ACTOR.id],
    );
    expect(result.rows.length).toBeGreaterThan(0);
    const subjectEntry = result.rows.find(
      (r: { field_name: string }) => r.field_name === 'subject',
    );
    expect(subjectEntry).toBeDefined();
    expect(subjectEntry.old_value).toBe('Before update');
    expect(subjectEntry.new_value).toBe('After update');
  });

  it('deleteActivity writes an audit entry with event_type=deleted', async () => {
    const activity = await createActivity(
      { type: 'Task', subject: 'To be deleted audit', contact_id: contactId, owner_id: ownerId },
      TEST_ACTOR,
    );
    const activityId = activity.id;

    await deleteActivity(activityId, TEST_ACTOR);

    // writeAuditEntryBestEffort is fire-and-forget; poll for the row rather
    // than a fixed sleep — see the createActivity audit test above.
    let result: QueryResult | undefined;
    await waitUntil(async () => {
      result = await pool.query(
        `SELECT * FROM audit_log WHERE record_id = $1 AND changed_by_id = $2 AND event_type = 'deleted'`,
        [activityId, TEST_ACTOR.id],
      );
      return result.rows.length > 0;
    }, 5_000);

    expect(result!.rows).toHaveLength(1);
    expect(result!.rows[0].record_type).toBe('activity');
    expect(result!.rows[0].record_name).toBe('To be deleted audit');
  });
});

// ── metadata jsonb column ───────────────────────────────────────
//
// Verifies that the metadata column exists and that JSONB payloads round-trip
// through the DB intact. The column is the designated extension point for
// type-specific fields on new activity types (see CLAUDE.md).

describe('activities metadata column', () => {
  it('accepts and returns a JSONB metadata payload', async () => {
    const payload = {
      thread_id: 'abc-123',
      connection_degree: 2,
      profile_url: 'https://example.com/p/1',
    };

    const insertResult = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, contact_id, owner_id, metadata)
       VALUES ('Call', 'Metadata test call', $1, $2, $3)
       RETURNING id`,
      [contactId, ownerId, JSON.stringify(payload)],
    );
    const id = insertResult.rows[0].id;

    const selectResult = await pool.query<{ metadata: unknown }>(
      `SELECT metadata FROM activities WHERE id = $1`,
      [id],
    );
    expect(selectResult.rows[0]?.metadata).toEqual(payload);

    await pool.query(`DELETE FROM activities WHERE id = $1`, [id]);
  });

  it('stores null metadata for activities that do not require type-specific fields', async () => {
    const insertResult = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, contact_id, owner_id)
       VALUES ('Task', 'No-metadata task', $1, $2)
       RETURNING id`,
      [contactId, ownerId],
    );
    const id = insertResult.rows[0].id;

    const selectResult = await pool.query<{ metadata: unknown }>(
      `SELECT metadata FROM activities WHERE id = $1`,
      [id],
    );
    expect(selectResult.rows[0]?.metadata).toBeNull();

    await pool.query(`DELETE FROM activities WHERE id = $1`, [id]);
  });
});

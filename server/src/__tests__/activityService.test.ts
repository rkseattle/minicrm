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
import {
  createActivitySchema,
  updateActivitySchema,
} from '@minicrm/shared/schemas/activitySchema.js';
import pool from '../db.js';

/** Minimal user fixture used as activity owner */
const OWNER_USER = {
  email: 'activity-owner@example.com',
  name: 'Activity Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let contactId: string;
let accountId: string;
let dealId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM activities');
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;

  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
    ['Test Account', ownerId],
  );
  accountId = accountResult.rows[0].id;

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Test', 'Contact', 'activity-contact@example.com', $1) RETURNING id`,
    [ownerId],
  );
  contactId = contactResult.rows[0].id;

  const dealResult = await pool.query<{ id: string }>(
    `INSERT INTO deals (name, stage, owner_id) VALUES ('Test Deal', 'Prospecting', $1) RETURNING id`,
    [ownerId],
  );
  dealId = dealResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM activities');
});

afterAll(async () => {
  await pool.query('DELETE FROM activities');
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);
  await pool.end();
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
    const result = updateActivitySchema.safeParse({ type: 'Call' });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0].message).toMatch(/direction is required/i);
  });

  it('rejects a type change to Email without direction', () => {
    const result = updateActivitySchema.safeParse({ type: 'Email' });
    expect(result.success).toBe(false);
  });

  it('accepts a type change to Call with direction provided', () => {
    const result = updateActivitySchema.safeParse({ type: 'Call', direction: 'Inbound' });
    expect(result.success).toBe(true);
  });

  it('accepts a subject-only patch (type not changing)', () => {
    const result = updateActivitySchema.safeParse({ subject: 'Updated' });
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
    const activities = await listActivities();
    expect(activities).toEqual([]);
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

    const activities = await listActivities();
    expect(activities).toHaveLength(2);
    // Newest first
    expect(activities[0].subject).toBe('Second');
    expect(activities[1].subject).toBe('First');
    // Each row includes owner_name
    expect(activities[0].owner_name).toBe(OWNER_USER.name);
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

    const activities = await listActivities({ contactId });
    expect(activities).toHaveLength(1);
    expect(activities[0].subject).toBe('Contact note');
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

    const activities = await listActivities({ accountId });
    expect(activities).toHaveLength(1);
    expect(activities[0].subject).toBe('Account meeting');
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

    const activities = await listActivities({ dealId });
    expect(activities).toHaveLength(1);
    expect(activities[0].subject).toBe('Deal task');
  });

  it('filters by ownerId when provided', async () => {
    const other = await createUser({ ...OWNER_USER, email: 'other-activity-owner@example.com' });

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

    const mine = await listActivities({ ownerId });
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe('My note');
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

    const tasks = await listMyTasks(ownerId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subject).toBe('My task');
    expect(tasks[0].type).toBe('Task');
  });

  it('excludes tasks owned by other users', async () => {
    const other = await createUser({ ...OWNER_USER, email: 'other-tasks-owner@example.com' });
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

    const tasks = await listMyTasks(ownerId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subject).toBe('My task');
  });

  it('includes both open and complete tasks', async () => {
    const openTask = await createActivity({
      type: 'Task',
      subject: 'Open task',
      contact_id: contactId,
      owner_id: ownerId,
    });
    await updateActivity(openTask.id, { status: 'complete' });
    await createActivity({
      type: 'Task',
      subject: 'Another open task',
      deal_id: dealId,
      owner_id: ownerId,
    });

    const tasks = await listMyTasks(ownerId);
    expect(tasks).toHaveLength(2);
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

    const tasks = await listMyTasks(ownerId);
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

    const tasks = await listMyTasks(ownerId);
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

    const tasks = await listMyTasks(ownerId);
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

    const tasks = await listMyTasks(ownerId);
    expect(tasks[0].linked_record_type).toBe('deal');
    expect(tasks[0].linked_record_name).toBe('Test Deal');
  });

  it('returns an empty array when the owner has no tasks', async () => {
    const tasks = await listMyTasks(ownerId);
    expect(tasks).toEqual([]);
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

    const updated = await updateActivity(activity.id, { subject: 'Updated subject', type: 'Call' });
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

    const updated = await updateActivity(activity.id, { status: 'complete' });
    expect(updated!.status).toBe('complete');
  });

  it('updates updated_at timestamp', async () => {
    const activity = await createActivity({
      type: 'Note',
      subject: 'Time test',
      contact_id: contactId,
      owner_id: ownerId,
    });

    const updated = await updateActivity(activity.id, { notes: 'Added notes' });
    expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(activity.updated_at.getTime());
  });

  it('returns null for a non-existent activity', async () => {
    const result = await updateActivity('00000000-0000-0000-0000-000000000000', {
      subject: 'Ghost',
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
    });

    expect(updated!.direction).toBe('Inbound');
    expect(updated!.outcome).toBe('Agreed to demo');
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

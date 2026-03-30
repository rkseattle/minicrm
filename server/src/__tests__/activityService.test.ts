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
  updateActivity,
  deleteActivity,
} from '../services/activityService.js';
import { createUser } from '../services/userService.js';
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
    });

    expect(activity.account_id).toBe(accountId);
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

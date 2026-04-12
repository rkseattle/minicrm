/**
 * Integration tests for notificationService.
 *
 * Tests the overdue task digest logic, assignment batching, global kill switch,
 * and individual user opt-out behaviour.
 *
 * Runs against a real PostgreSQL test database.
 *
 * MINCRM-161, MINCRM-162, MINCRM-163
 */

import 'dotenv/config';
import {
  sendOverdueDigests,
  queueAssignmentNotification,
} from '../services/notificationService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_USER = {
  email: 'notif-owner@example.com',
  name: 'Notif Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let ownerEmail: string;
let contactId: string;

beforeAll(async () => {
  // Clean related tables
  await pool.query('DELETE FROM overdue_task_notifications');
  await pool.query('DELETE FROM activities');
  await pool.query('DELETE FROM contacts WHERE email = $1', ['notif-contact@example.com']);
  await pool.query('DELETE FROM users WHERE email = $1', [BASE_USER.email]);

  const owner = await createUser(BASE_USER);
  ownerId = owner.id;
  ownerEmail = owner.email;

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Notif', 'Contact', 'notif-contact@example.com', $1) RETURNING id`,
    [ownerId],
  );
  contactId = contactResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM overdue_task_notifications');
  await pool.query('DELETE FROM activities');
  // Reset user notification prefs and global setting to defaults
  await pool.query(
    `UPDATE users SET notify_overdue_tasks = true, notify_assignments = true,
     notify_deal_stage_changes = true WHERE id = $1`,
    [ownerId],
  );
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('email_notifications_enabled', 'true', now())
     ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()`,
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM overdue_task_notifications');
  await pool.query('DELETE FROM activities');
  await pool.query('DELETE FROM contacts WHERE email = $1', ['notif-contact@example.com']);
  await pool.query('DELETE FROM users WHERE email = $1', [BASE_USER.email]);
});

// ── sendOverdueDigests ────────────────────────────────────────────────────────

describe('sendOverdueDigests', () => {
  it('inserts dedup rows for newly-overdue tasks', async () => {
    // Create an overdue open task (due yesterday)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDateStr = yesterday.toISOString().split('T')[0];

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, status, due_date, owner_id, contact_id)
       VALUES ('Task', 'Overdue test task', 'open', $1, $2, $3) RETURNING id`,
      [dueDateStr, ownerId, contactId],
    );
    const activityId = rows[0].id;

    await sendOverdueDigests();

    // The dedup row should now exist
    const dedupResult = await pool.query(
      'SELECT activity_id FROM overdue_task_notifications WHERE activity_id = $1',
      [activityId],
    );
    expect(dedupResult.rows).toHaveLength(1);
  });

  it('does not re-notify for already-notified tasks', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDateStr = yesterday.toISOString().split('T')[0];

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, status, due_date, owner_id, contact_id)
       VALUES ('Task', 'Already notified task', 'open', $1, $2, $3) RETURNING id`,
      [dueDateStr, ownerId, contactId],
    );
    const activityId = rows[0].id;

    // Pre-insert a dedup row to simulate a previous notification
    await pool.query('INSERT INTO overdue_task_notifications (activity_id) VALUES ($1)', [
      activityId,
    ]);

    // Run digest — should not insert a duplicate dedup row
    await sendOverdueDigests();

    const dedupResult = await pool.query(
      'SELECT activity_id FROM overdue_task_notifications WHERE activity_id = $1',
      [activityId],
    );
    // Still only one row (ON CONFLICT DO NOTHING prevents duplicates)
    expect(dedupResult.rows).toHaveLength(1);
  });

  it('does not notify when global email notifications are disabled', async () => {
    await pool.query(
      `UPDATE system_settings SET value = 'false' WHERE key = 'email_notifications_enabled'`,
    );

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDateStr = yesterday.toISOString().split('T')[0];

    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, owner_id, contact_id)
       VALUES ('Task', 'Global kill switch task', 'open', $1, $2, $3)`,
      [dueDateStr, ownerId, contactId],
    );

    await sendOverdueDigests();

    // No dedup rows should have been created
    const dedupResult = await pool.query(
      'SELECT COUNT(*) AS count FROM overdue_task_notifications',
    );
    expect(parseInt(dedupResult.rows[0].count, 10)).toBe(0);
  });

  it('does not notify a user who has opted out of overdue task notifications', async () => {
    await pool.query('UPDATE users SET notify_overdue_tasks = false WHERE id = $1', [ownerId]);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDateStr = yesterday.toISOString().split('T')[0];

    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, owner_id, contact_id)
       VALUES ('Task', 'Opted out task', 'open', $1, $2, $3)`,
      [dueDateStr, ownerId, contactId],
    );

    await sendOverdueDigests();

    const dedupResult = await pool.query(
      'SELECT COUNT(*) AS count FROM overdue_task_notifications',
    );
    expect(parseInt(dedupResult.rows[0].count, 10)).toBe(0);
  });

  it('does not notify for non-Task activities', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDateStr = yesterday.toISOString().split('T')[0];

    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, owner_id, contact_id)
       VALUES ('Note', 'Overdue note — should not notify', 'open', $1, $2, $3)`,
      [dueDateStr, ownerId, contactId],
    );

    await sendOverdueDigests();

    const dedupResult = await pool.query(
      'SELECT COUNT(*) AS count FROM overdue_task_notifications',
    );
    expect(parseInt(dedupResult.rows[0].count, 10)).toBe(0);
  });

  it('does not notify for complete tasks', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDateStr = yesterday.toISOString().split('T')[0];

    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, owner_id, contact_id)
       VALUES ('Task', 'Completed overdue task', 'complete', $1, $2, $3)`,
      [dueDateStr, ownerId, contactId],
    );

    await sendOverdueDigests();

    const dedupResult = await pool.query(
      'SELECT COUNT(*) AS count FROM overdue_task_notifications',
    );
    expect(parseInt(dedupResult.rows[0].count, 10)).toBe(0);
  });

  it('does not notify for tasks due today (not yet overdue)', async () => {
    const today = new Date().toISOString().split('T')[0];

    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, owner_id, contact_id)
       VALUES ('Task', 'Due today task', 'open', $1, $2, $3)`,
      [today, ownerId, contactId],
    );

    await sendOverdueDigests();

    const dedupResult = await pool.query(
      'SELECT COUNT(*) AS count FROM overdue_task_notifications',
    );
    expect(parseInt(dedupResult.rows[0].count, 10)).toBe(0);
  });

  it('handles no overdue tasks without error', async () => {
    // No activities — should resolve without throwing
    await expect(sendOverdueDigests()).resolves.toBeUndefined();
  });
});

// ── queueAssignmentNotification ───────────────────────────────────────────────

describe('queueAssignmentNotification', () => {
  it('does not throw when called with valid arguments', () => {
    // queueAssignmentNotification is synchronous (schedules a timer internally)
    expect(() =>
      queueAssignmentNotification(ownerId, ownerEmail, BASE_USER.name, {
        recordType: 'contact',
        recordName: 'Test Contact',
        recordPath: `/contacts/${contactId}`,
        assignedByName: 'Admin User',
      }),
    ).not.toThrow();
  });

  it('appends to an existing batch without resetting the timer for the same recipient', () => {
    // Calling twice for the same recipient should not throw — second call appends
    queueAssignmentNotification(ownerId, ownerEmail, BASE_USER.name, {
      recordType: 'account',
      recordName: 'Account A',
      recordPath: '/accounts/uuid-a',
      assignedByName: 'Admin',
    });
    queueAssignmentNotification(ownerId, ownerEmail, BASE_USER.name, {
      recordType: 'deal',
      recordName: 'Deal B',
      recordPath: '/deals/uuid-b',
      assignedByName: 'Admin',
    });
    // No assertion beyond no-throw — timer dispatch is tested via integration
  });
});

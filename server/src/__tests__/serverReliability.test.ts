/**
 * Tests for server reliability changes (MINCRM-108, MINCRM-122).
 *
 * MINCRM-122: Verifies that automation trigger execution is fire-and-forget —
 *   a trigger failure must not propagate to the calling service function, and
 *   the calling service must return the correct result regardless of trigger outcome.
 *   Logging behavior for the trigger itself is covered in automationService.test.ts.
 *
 * MINCRM-108: Graceful shutdown is exercised manually via `docker compose stop`.
 *   The unhandledRejection handler wired in server.ts surfaces any trigger failures
 *   that escape fireAutomationTrigger's internal catch — confirmed by code review.
 *
 * Runs against a real PostgreSQL test database.
 */

import 'dotenv/config';
import { createContact } from '../services/contactService.js';
import { createDeal, updateDeal } from '../services/dealService.js';
import { createUser } from '../services/userService.js';
import { createAutomationRule } from '../services/automationService.js';
import pool from '../db.js';

/** Minimal user fixture */
const OWNER_USER = {
  email: 'reliability-owner@example.com',
  name: 'Reliability Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let accountId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM automation_rule_logs');
  await pool.query('DELETE FROM automation_rules');
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
    ['Reliability Test Account', ownerId],
  );
  accountId = accountResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM automation_rule_logs');
  await pool.query('DELETE FROM automation_rules');
  await pool.query('DELETE FROM activities');
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
});

afterAll(async () => {
  await pool.query('DELETE FROM automation_rule_logs');
  await pool.query('DELETE FROM automation_rules');
  await pool.query('DELETE FROM activities');
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);
  await pool.end();
});

// ── MINCRM-122: fire-and-forget automation trigger ─────────────────────────

describe('MINCRM-122: fire-and-forget automation triggers', () => {
  it('createContact returns the new contact even when no automation rules exist', async () => {
    const contact = await createContact({
      first_name: 'Alice',
      last_name: 'Test',
      email: 'alice-reliability@example.com',
      owner_id: ownerId,
    });

    expect(contact.id).toBeDefined();
    expect(contact.first_name).toBe('Alice');
  });

  it('createContact returns the new contact when a matching automation rule exists', async () => {
    await createAutomationRule({
      name: 'Contact created rule',
      enabled: true,
      trigger_type: 'contact_created',
      trigger_config: {},
      action_type: 'create_task',
      action_config: {
        subject: 'Follow up with new contact',
        task_type: 'Task',
        assignee_type: 'owner',
        due_date_offset_days: 1,
      },
      created_by: ownerId,
    });

    const contact = await createContact({
      first_name: 'Bob',
      last_name: 'Reliability',
      email: 'bob-reliability@example.com',
      owner_id: ownerId,
    });

    // Service must return immediately with the correct result — trigger runs in background
    expect(contact.id).toBeDefined();
    expect(contact.first_name).toBe('Bob');

    // Settle: allow the background trigger to finish writing its log before
    // beforeEach deletes automation_rules (which would violate the FK on rule_logs)
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  it('updateDeal returns the updated deal when a stage-changed rule exists', async () => {
    const deal = await createDeal({
      name: 'Stage Change Deal',
      stage: 'Prospecting',
      owner_id: ownerId,
      account_id: accountId,
    });

    await createAutomationRule({
      name: 'Deal stage changed rule',
      enabled: true,
      trigger_type: 'deal_stage_changed',
      trigger_config: {},
      action_type: 'create_task',
      action_config: {
        subject: 'Follow up after stage change',
        task_type: 'Task',
        assignee_type: 'owner',
        due_date_offset_days: 2,
      },
      created_by: ownerId,
    });

    // Trigger runs fire-and-forget; updateDeal must return the correct result synchronously
    const updated = await updateDeal(deal.id, { stage: 'Qualification' });

    expect(updated).not.toBeNull();
    expect(updated!.stage).toBe('Qualification');

    // Settle: allow the background trigger to finish before beforeEach cleanup
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  // Note: the "failing rule does not abort the triggering operation" invariant is
  // covered by automationService.test.ts using awaited calls. Testing it here with
  // fire-and-forget would require synchronising with background work that races the
  // beforeEach cleanup of automation_rule_logs/automation_rules tables.
});

/**
 * Tests for server reliability changes (MINCRM-108, MINCRM-122, MINCRM-248).
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
 * MINCRM-248: Pool exhaustion → 503. The global error handler returns 503 when
 *   pool.connect() throws the pg timeout error string.
 *
 * Runs against a real PostgreSQL test database.
 */

import 'dotenv/config';
import { vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { createContact } from '../services/contactService.js';
import { createDeal, updateDeal } from '../services/dealService.js';
import { createUser } from '../services/userService.js';
import { createAutomationRule } from '../services/automationService.js';
import pool from '../db.js';
import { uid } from './testUtils.js';

const FILE_PREFIX = 'reliability';

/** Minimal user fixture */
const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Reliability Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let accountId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM automation_rule_logs WHERE rule_id IN (SELECT id FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
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
    ['Reliability Test Account', ownerId],
  );
  accountId = accountResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM automation_rule_logs WHERE rule_id IN (SELECT id FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
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
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM automation_rule_logs WHERE rule_id IN (SELECT id FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
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

// ── MINCRM-122: fire-and-forget automation trigger ─────────────────────────

describe('MINCRM-122: fire-and-forget automation triggers', () => {
  it('createContact returns the new contact even when no automation rules exist', async () => {
    const contact = await createContact({
      first_name: 'Alice',
      last_name: 'Test',
      email: `${FILE_PREFIX}-${uid()}-alice@example.com`,
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
      email: `${FILE_PREFIX}-${uid()}-bob@example.com`,
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
    const updated = await updateDeal(deal.id, { stage: 'Qualification', version: deal.version });

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

// ── MINCRM-248: pool exhaustion → 503 ─────────────────────────────────────────

describe('MINCRM-248: pool exhaustion returns 503', () => {
  it('returns 503 SERVICE_UNAVAILABLE when pool.connect times out', async () => {
    const { makeAuthCookie } = await import('./testUtils.js');
    const cookie = makeAuthCookie({
      id: ownerId,
      email: 'pool-test@example.com',
      role: 'rep',
      name: 'Test',
    });

    // findUserById (inside authenticate) uses pool.query — mock it to return a valid user.
    // userCapabilities (inside requireCapability middleware) uses pool.query — mock it to return
    // a contacts:create capability row so the middleware passes and pool.connect is attempted.
    // findContactByEmail also uses pool.query — return empty rows so it does not short-circuit
    // with a 409 before pool.connect is attempted.
    // pool.connect is used by service layer functions (createContact, setRlsUserId, etc.) —
    // mock it to throw a connection-timeout error, simulating pool exhaustion.
    const querySpy = vi.spyOn(pool, 'query').mockImplementation((sql: unknown) => {
      const sqlStr = typeof sql === 'string' ? sql : ((sql as { text?: string }).text ?? '');
      if (sqlStr.includes('user_custom_roles') || sqlStr.includes('role_capabilities')) {
        // Simulate the rep having contacts:create so requireCapability passes
        return Promise.resolve({
          rows: [{ capability: 'contacts:create' }],
          rowCount: 1,
        } as unknown as Awaited<ReturnType<typeof pool.query>>);
      }
      if (sqlStr.includes('FROM users')) {
        return Promise.resolve({
          rows: [
            {
              id: ownerId,
              email: 'pool-test@example.com',
              name: 'Test',
              role: 'rep',
              status: 'active',
              must_change_password: false,
              password_changed_at: null,
            },
          ],
          rowCount: 1,
        } as unknown as Awaited<ReturnType<typeof pool.query>>);
      }
      return Promise.resolve({
        rows: [],
        rowCount: 0,
      } as unknown as Awaited<ReturnType<typeof pool.query>>);
    });

    const connectSpy = vi
      .spyOn(pool, 'connect')
      .mockRejectedValue(new Error('timeout exceeded when trying to connect'));

    try {
      const res = await request(app)
        .post('/api/v1/contacts')
        .set('Cookie', cookie)
        .send({ first_name: 'A', last_name: 'B', email: 'pool-timeout@example.com' });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      querySpy.mockRestore();
      connectSpy.mockRestore();
    }
  });
});

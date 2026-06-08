/**
 * Row-Level Security enforcement tests. (MINCRM-518)
 *
 * Verifies that the PostgreSQL RLS policies enforced via `app_current_user_id()`
 * prevent cross-user data access at the database level, independent of any
 * application-layer ownership checks.
 *
 * Test strategy:
 *   - Creates two rep users (A and B) and one admin user via the superuser pool.
 *   - Each user owns one record of each protected entity type.
 *   - Enforcement assertions run using a separate `minicrm_app` pool — a
 *     non-superuser, NOBYPASSRLS role that is subject to RLS policy evaluation.
 *     (The primary `minicrm` role is a superuser and PostgreSQL exempts superusers
 *     from all RLS policies, making enforcement tests via that role impossible.)
 *   - Each assertion uses a BEGIN / set_config / query / COMMIT transaction so that
 *     `SET LOCAL app.current_user_id` is scoped to the transaction, exactly as the
 *     service layer does in production.
 *   - Asserts that:
 *     1. A rep can SELECT their own rows (owner policy passes).
 *     2. A rep CANNOT SELECT another rep's rows (owner + admin policies both fail).
 *     3. An admin CAN SELECT any rep's rows (admin bypass policy passes).
 *
 * These tests run against the real PostgreSQL test DB (minicrm_test) and exercise
 * actual RLS policy evaluation inside PostgreSQL, not application logic.
 *
 * The `minicrm_app` role is created by migration 092. It must exist before these
 * tests run; globalSetup applies all migrations before any test file executes.
 */

import 'dotenv/config';
import pg from 'pg';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { createDeal } from '../services/dealService.js';
import { createLead } from '../services/leadsService.js';
import { createActivity } from '../services/activityService.js';

// ── Test users ────────────────────────────────────────────────────────────────

const BASE_USER = {
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** IDs populated in beforeAll */
let repAId: string;
let repBId: string;
let adminId: string;

// ── Records owned by rep A ────────────────────────────────────────────────────

let repAContactId: string;
let repAAccountId: string;
let repADealId: string;
let repALeadId: string;
let repAActivityId: string;

// ── Records owned by rep B ────────────────────────────────────────────────────

let repBContactId: string;
let repBAccountId: string;
let repBDealId: string;
let repBLeadId: string;
let repBActivityId: string;

// ── Actors for service calls ──────────────────────────────────────────────────

const systemActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

// ── Restricted-role pool for RLS enforcement assertions ──────────────────────
//
// `minicrm_app` is a NOSUPERUSER NOBYPASSRLS role created by migration 092.
// Queries executed via this pool are subject to RLS policy evaluation.

let appPool: pg.Pool;

// ── Setup & teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  const { DB_HOST = 'localhost', DB_PORT = '5432', DB_NAME } = process.env;

  appPool = new pg.Pool({
    user: 'minicrm_app',
    password: 'minicrm_app',
    host: DB_HOST,
    port: Number(DB_PORT),
    database: DB_NAME,
    // Small pool — only used for RLS assertions, not fixture creation.
    max: 3,
  });

  // Clean up any leftover rows from previous runs (superuser pool — bypasses RLS)
  await pool.query(
    "DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%')",
  );
  await pool.query(
    "DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%'))",
  );
  await pool.query(
    "DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%')",
  );
  await pool.query(
    "DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%')",
  );
  await pool.query(
    "DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%')",
  );
  await pool.query(
    "DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%')",
  );
  await pool.query("DELETE FROM users WHERE email LIKE 'rls-%'");

  // Create users (superuser pool — no RLS on users table)
  const repA = await createUser({
    email: 'rls-rep-a@example.com',
    name: 'RLS Rep A',
    role: 'rep',
    ...BASE_USER,
  });
  repAId = repA.id;

  const repB = await createUser({
    email: 'rls-rep-b@example.com',
    name: 'RLS Rep B',
    role: 'rep',
    ...BASE_USER,
  });
  repBId = repB.id;

  const admin = await createUser({
    email: 'rls-admin@example.com',
    name: 'RLS Admin',
    role: 'admin',
    ...BASE_USER,
  });
  adminId = admin.id;

  // Create records owned by rep A — superuser pool bypasses RLS, so INSERT succeeds
  // regardless of what app.current_user_id is set to.
  const contactA = await createContact(
    {
      first_name: 'ContactA',
      last_name: 'RLS',
      email: 'rls-contact-a@example.com',
      owner_id: repAId,
    },
    systemActor,
  );
  repAContactId = contactA.id;

  const accountA = await createAccount({ name: 'Account RLS A', owner_id: repAId }, systemActor);
  repAAccountId = accountA.id;

  const dealA = await createDeal(
    { name: 'Deal RLS A', stage: 'Prospecting', owner_id: repAId },
    systemActor,
  );
  repADealId = dealA.id;

  const leadA = await createLead(
    { first_name: 'Lead', last_name: 'A', email: 'rls-lead-a@example.com', owner_id: repAId },
    systemActor,
  );
  repALeadId = leadA.id;

  const activityA = await createActivity(
    {
      type: 'Call',
      subject: 'RLS Activity A',
      direction: 'Outbound',
      contact_id: repAContactId,
      owner_id: repAId,
    },
    systemActor,
  );
  repAActivityId = activityA.id;

  // Create records owned by rep B
  const contactB = await createContact(
    {
      first_name: 'ContactB',
      last_name: 'RLS',
      email: 'rls-contact-b@example.com',
      owner_id: repBId,
    },
    systemActor,
  );
  repBContactId = contactB.id;

  const accountB = await createAccount({ name: 'Account RLS B', owner_id: repBId }, systemActor);
  repBAccountId = accountB.id;

  const dealB = await createDeal(
    { name: 'Deal RLS B', stage: 'Prospecting', owner_id: repBId },
    systemActor,
  );
  repBDealId = dealB.id;

  const leadB = await createLead(
    { first_name: 'Lead', last_name: 'B', email: 'rls-lead-b@example.com', owner_id: repBId },
    systemActor,
  );
  repBLeadId = leadB.id;

  const activityB = await createActivity(
    {
      type: 'Call',
      subject: 'RLS Activity B',
      direction: 'Outbound',
      contact_id: repBContactId,
      owner_id: repBId,
    },
    systemActor,
  );
  repBActivityId = activityB.id;
});

afterAll(async () => {
  // Drain the restricted-role pool
  await appPool.end();

  // Clean up fixtures via superuser pool (bypasses RLS)
  await pool.query(
    "DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%')",
  );
  await pool.query(
    "DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%'))",
  );
  await pool.query(
    "DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%')",
  );
  await pool.query(
    "DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%')",
  );
  await pool.query(
    "DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%')",
  );
  await pool.query(
    "DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'rls-%')",
  );
  await pool.query("DELETE FROM users WHERE email LIKE 'rls-%'");
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Execute a SELECT query as the given user via the restricted `minicrm_app` pool.
 * Sets `app.current_user_id` inside an explicit transaction so the RLS policies
 * on the target table evaluate it via `app_current_user_id()`.
 *
 * Returns the rows array. An empty array means RLS blocked all rows.
 */
async function queryAsUser<T extends pg.QueryResultRow>(
  userId: string,
  sql: string,
  params: (string | number | null)[] = [],
): Promise<T[]> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
    const result = await client.query<T>(sql, params);
    await client.query('COMMIT');
    return result.rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Contacts ──────────────────────────────────────────────────────────────────

describe('RLS — contacts', () => {
  it('rep A can SELECT their own contact by ID (owner policy passes)', async () => {
    const rows = await queryAsUser(repAId, 'SELECT id FROM contacts WHERE id = $1', [
      repAContactId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(repAContactId);
  });

  it('rep A cannot SELECT rep B contact by ID (both policies fail)', async () => {
    const rows = await queryAsUser(repAId, 'SELECT id FROM contacts WHERE id = $1', [
      repBContactId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('rep A list only returns their own contacts (owner policy filters)', async () => {
    const rows = await queryAsUser<{ id: string }>(
      repAId,
      'SELECT id FROM contacts WHERE id = ANY($1::uuid[])',
      // Pass both IDs — RLS should filter to only rep A's row
      [`{${repAContactId},${repBContactId}}`],
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(repAContactId);
    expect(ids).not.toContain(repBContactId);
  });

  it('admin can SELECT rep B contact by ID (admin bypass policy passes)', async () => {
    const rows = await queryAsUser(adminId, 'SELECT id FROM contacts WHERE id = $1', [
      repBContactId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(repBContactId);
  });

  it('admin list includes contacts from both reps', async () => {
    const rows = await queryAsUser<{ id: string }>(
      adminId,
      'SELECT id FROM contacts WHERE id = ANY($1::uuid[])',
      [`{${repAContactId},${repBContactId}}`],
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(repAContactId);
    expect(ids).toContain(repBContactId);
  });
});

// ── Accounts ──────────────────────────────────────────────────────────────────

describe('RLS — accounts', () => {
  it('rep A can SELECT their own account by ID', async () => {
    const rows = await queryAsUser(repAId, 'SELECT id FROM accounts WHERE id = $1', [
      repAAccountId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('rep A cannot SELECT rep B account by ID', async () => {
    const rows = await queryAsUser(repAId, 'SELECT id FROM accounts WHERE id = $1', [
      repBAccountId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('rep A list only returns their own accounts', async () => {
    const rows = await queryAsUser<{ id: string }>(
      repAId,
      'SELECT id FROM accounts WHERE id = ANY($1::uuid[])',
      [`{${repAAccountId},${repBAccountId}}`],
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(repAAccountId);
    expect(ids).not.toContain(repBAccountId);
  });

  it('admin can SELECT rep B account by ID', async () => {
    const rows = await queryAsUser(adminId, 'SELECT id FROM accounts WHERE id = $1', [
      repBAccountId,
    ]);
    expect(rows).toHaveLength(1);
  });
});

// ── Deals ─────────────────────────────────────────────────────────────────────

describe('RLS — deals', () => {
  it('rep A can SELECT their own deal by ID', async () => {
    const rows = await queryAsUser(repAId, 'SELECT id FROM deals WHERE id = $1', [repADealId]);
    expect(rows).toHaveLength(1);
  });

  it('rep A cannot SELECT rep B deal by ID', async () => {
    const rows = await queryAsUser(repAId, 'SELECT id FROM deals WHERE id = $1', [repBDealId]);
    expect(rows).toHaveLength(0);
  });

  it('rep A list only returns their own deals', async () => {
    const rows = await queryAsUser<{ id: string }>(
      repAId,
      'SELECT id FROM deals WHERE id = ANY($1::uuid[])',
      [`{${repADealId},${repBDealId}}`],
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(repADealId);
    expect(ids).not.toContain(repBDealId);
  });

  it('admin can SELECT rep B deal by ID', async () => {
    const rows = await queryAsUser(adminId, 'SELECT id FROM deals WHERE id = $1', [repBDealId]);
    expect(rows).toHaveLength(1);
  });
});

// ── Leads ─────────────────────────────────────────────────────────────────────

describe('RLS — leads', () => {
  it('rep A can SELECT their own lead by ID', async () => {
    const rows = await queryAsUser(repAId, 'SELECT id FROM leads WHERE id = $1', [repALeadId]);
    expect(rows).toHaveLength(1);
  });

  it('rep A cannot SELECT rep B lead by ID', async () => {
    const rows = await queryAsUser(repAId, 'SELECT id FROM leads WHERE id = $1', [repBLeadId]);
    expect(rows).toHaveLength(0);
  });

  it('rep A list only returns their own leads', async () => {
    const rows = await queryAsUser<{ id: string }>(
      repAId,
      'SELECT id FROM leads WHERE id = ANY($1::uuid[])',
      [`{${repALeadId},${repBLeadId}}`],
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(repALeadId);
    expect(ids).not.toContain(repBLeadId);
  });

  it('admin can SELECT rep B lead by ID', async () => {
    const rows = await queryAsUser(adminId, 'SELECT id FROM leads WHERE id = $1', [repBLeadId]);
    expect(rows).toHaveLength(1);
  });
});

// ── Activities ────────────────────────────────────────────────────────────────

describe('RLS — activities', () => {
  it('rep A can SELECT their own activity by ID', async () => {
    const rows = await queryAsUser(repAId, 'SELECT id FROM activities WHERE id = $1', [
      repAActivityId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('rep A cannot SELECT rep B activity by ID', async () => {
    const rows = await queryAsUser(repAId, 'SELECT id FROM activities WHERE id = $1', [
      repBActivityId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('rep A list only returns their own activities', async () => {
    const rows = await queryAsUser<{ id: string }>(
      repAId,
      'SELECT id FROM activities WHERE id = ANY($1::uuid[])',
      [`{${repAActivityId},${repBActivityId}}`],
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(repAActivityId);
    expect(ids).not.toContain(repBActivityId);
  });

  it('admin can SELECT rep B activity by ID', async () => {
    const rows = await queryAsUser(adminId, 'SELECT id FROM activities WHERE id = $1', [
      repBActivityId,
    ]);
    expect(rows).toHaveLength(1);
  });
});

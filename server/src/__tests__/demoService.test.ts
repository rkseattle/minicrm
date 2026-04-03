/**
 * Integration tests for demoService.
 * Verifies seed, remove, reset, and status operations against a real test DB. (MINCRM-103)
 *
 * Runs against the minicrm_test database.
 */

import 'dotenv/config';
import { createUser } from '../services/userService.js';
import { getDemoStatus, seedDemo, removeDemo, resetDemo } from '../services/demoService.js';
import pool from '../db.js';

const ADMIN_USER = {
  email: 'demo-svc-admin@example.com',
  name: 'Demo Service Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

beforeAll(async () => {
  await pool.query('DELETE FROM activities WHERE is_demo = true');
  await pool.query(
    `DELETE FROM deal_contacts
     WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)
        OR contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await pool.query('DELETE FROM deals WHERE is_demo = true');
  await pool.query('DELETE FROM contacts WHERE is_demo = true');
  await pool.query('DELETE FROM accounts WHERE is_demo = true');
  await pool.query('DELETE FROM users WHERE email = $1', [ADMIN_USER.email]);
  await createUser(ADMIN_USER);
});

beforeEach(async () => {
  // Remove any demo data between tests for isolation
  await pool.query('DELETE FROM activities WHERE is_demo = true');
  await pool.query(
    `DELETE FROM deal_contacts
     WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)
        OR contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await pool.query('DELETE FROM deals WHERE is_demo = true');
  await pool.query('DELETE FROM contacts WHERE is_demo = true');
  await pool.query('DELETE FROM accounts WHERE is_demo = true');
});

afterAll(async () => {
  // Clean up demo data first (respects FK order), then remove the test user.
  // Use CASCADE-safe ordering: activities → deal_contacts → deals → contacts → accounts → user.
  const adminResult = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    ADMIN_USER.email,
  ]);
  const adminId = adminResult.rows[0]?.id;

  if (adminId) {
    await pool.query(`DELETE FROM activities WHERE is_demo = true OR owner_id = $1`, [adminId]);
    await pool.query(
      `DELETE FROM deal_contacts
       WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true OR owner_id = $1)
          OR contact_id IN (SELECT id FROM contacts WHERE is_demo = true OR owner_id = $1)`,
      [adminId],
    );
    await pool.query(`DELETE FROM deals WHERE is_demo = true OR owner_id = $1`, [adminId]);
    await pool.query(`DELETE FROM contacts WHERE is_demo = true OR owner_id = $1`, [adminId]);
    await pool.query(`DELETE FROM accounts WHERE is_demo = true OR owner_id = $1`, [adminId]);
  }
  await pool.query('DELETE FROM users WHERE email = $1', [ADMIN_USER.email]);
  await pool.end();
});

// ── getDemoStatus ─────────────────────────────────────────────────────────────

describe('getDemoStatus', () => {
  it('returns active: false when no demo data exists', async () => {
    const status = await getDemoStatus();
    expect(status.active).toBe(false);
  });

  it('returns active: true after seeding', async () => {
    await seedDemo();
    const status = await getDemoStatus();
    expect(status.active).toBe(true);
  });
});

// ── seedDemo ──────────────────────────────────────────────────────────────────

describe('seedDemo', () => {
  it('inserts demo accounts, contacts, deals, and activities', async () => {
    await seedDemo();

    const accounts = await pool.query(`SELECT id FROM accounts WHERE is_demo = true`);
    const contacts = await pool.query(`SELECT id FROM contacts WHERE is_demo = true`);
    const deals = await pool.query(`SELECT id FROM deals WHERE is_demo = true`);
    const activities = await pool.query(`SELECT id FROM activities WHERE is_demo = true`);

    expect(accounts.rowCount).toBeGreaterThan(0);
    expect(contacts.rowCount).toBeGreaterThan(0);
    expect(deals.rowCount).toBeGreaterThan(0);
    expect(activities.rowCount).toBeGreaterThan(0);
  });

  it('returns seeded: true on first call', async () => {
    const result = await seedDemo();
    expect(result.seeded).toBe(true);
  });

  it('returns seeded: false with reason "already_exists" when called again', async () => {
    await seedDemo();
    const result = await seedDemo();
    expect(result.seeded).toBe(false);
    expect(result.reason).toBe('already_exists');
  });

  it('does not insert real data (all inserted rows have is_demo = true)', async () => {
    const beforeAccounts = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM accounts WHERE is_demo = false`,
    );
    await seedDemo();
    const afterAccounts = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM accounts WHERE is_demo = false`,
    );
    expect(afterAccounts.rows[0].count).toBe(beforeAccounts.rows[0].count);
  });
});

// ── removeDemo ────────────────────────────────────────────────────────────────

describe('removeDemo', () => {
  it('removes all demo-flagged records', async () => {
    await seedDemo();
    await removeDemo();

    const accounts = await pool.query(`SELECT id FROM accounts WHERE is_demo = true`);
    const contacts = await pool.query(`SELECT id FROM contacts WHERE is_demo = true`);
    const deals = await pool.query(`SELECT id FROM deals WHERE is_demo = true`);
    const activities = await pool.query(`SELECT id FROM activities WHERE is_demo = true`);

    expect(accounts.rowCount).toBe(0);
    expect(contacts.rowCount).toBe(0);
    expect(deals.rowCount).toBe(0);
    expect(activities.rowCount).toBe(0);
  });

  it('returns removed: true when demo data existed', async () => {
    await seedDemo();
    const result = await removeDemo();
    expect(result.removed).toBe(true);
  });

  it('returns removed: false with reason "not_present" when no demo data exists', async () => {
    const result = await removeDemo();
    expect(result.removed).toBe(false);
    expect(result.reason).toBe('not_present');
  });

  it('does not remove non-demo records', async () => {
    // Insert a real (non-demo) account
    const adminResult = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      ADMIN_USER.email,
    ]);
    const adminId = adminResult.rows[0].id;
    await pool.query(
      `INSERT INTO accounts (name, owner_id, is_demo) VALUES ('Real Account', $1, false)`,
      [adminId],
    );

    await seedDemo();
    await removeDemo();

    const real = await pool.query(`SELECT id FROM accounts WHERE is_demo = false`);
    expect(real.rowCount).toBeGreaterThanOrEqual(1);
  });
});

// ── resetDemo ─────────────────────────────────────────────────────────────────

describe('resetDemo', () => {
  it('returns reset: true', async () => {
    const result = await resetDemo();
    expect(result.reset).toBe(true);
  });

  it('leaves demo data present after reset', async () => {
    await resetDemo();
    const status = await getDemoStatus();
    expect(status.active).toBe(true);
  });

  it('replaces existing demo data (not additive)', async () => {
    await seedDemo();
    const beforeAccounts = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM accounts WHERE is_demo = true`,
    );

    await resetDemo();

    const afterAccounts = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM accounts WHERE is_demo = true`,
    );

    // After reset, count should equal the initial seed count — not double
    expect(afterAccounts.rows[0].count).toBe(beforeAccounts.rows[0].count);
  });
});

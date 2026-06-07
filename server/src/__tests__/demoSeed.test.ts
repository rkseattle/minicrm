/**
 * Integration tests for the is_demo column added by migration 013.
 *
 * Verifies that:
 * - is_demo defaults to false on newly inserted records
 * - Records can be explicitly inserted with is_demo = true
 * - Querying WHERE is_demo = true returns only demo rows
 * - Deleting WHERE is_demo = true removes only demo rows
 *
 * This covers the core DB contract that seed-demo.ts and remove-demo.ts rely on.
 * (MINCRM-102)
 *
 * Runs against a real PostgreSQL test database.
 */

import 'dotenv/config';
import { createUser } from '../services/userService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import pool from '../db.js';

const FILE_PREFIX = 'demo-seed';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Demo Seed Owner',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let defaultPipelineId: string;

async function cleanOwnerData(): Promise<void> {
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
}

beforeAll(async () => {
  await cleanOwnerData();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;
  defaultPipelineId = await getDefaultPipelineId();
});

beforeEach(async () => {
  await cleanOwnerData();
});

afterAll(async () => {
  await cleanOwnerData();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── Accounts ─────────────────────────────────────────────────────────────────

describe('is_demo column — accounts', () => {
  it('defaults to false', async () => {
    const result = await pool.query<{ is_demo: boolean }>(
      `INSERT INTO accounts (name, owner_id) VALUES ('Real Account', $1) RETURNING is_demo`,
      [ownerId],
    );
    expect(result.rows[0].is_demo).toBe(false);
  });

  it('can be set to true on insert', async () => {
    const result = await pool.query<{ is_demo: boolean }>(
      `INSERT INTO accounts (name, owner_id, is_demo) VALUES ('Demo Account', $1, true) RETURNING is_demo`,
      [ownerId],
    );
    expect(result.rows[0].is_demo).toBe(true);
  });

  it('WHERE is_demo = true returns only demo rows', async () => {
    await pool.query(
      `INSERT INTO accounts (name, owner_id, is_demo) VALUES ('Real', $1, false), ('Demo', $1, true)`,
      [ownerId],
    );
    const result = await pool.query<{ name: string }>(
      `SELECT name FROM accounts WHERE is_demo = true AND owner_id = $1`,
      [ownerId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Demo');
  });

  it('DELETE WHERE is_demo = true removes only demo rows', async () => {
    await pool.query(
      `INSERT INTO accounts (name, owner_id, is_demo) VALUES ('Real', $1, false), ('Demo', $1, true)`,
      [ownerId],
    );
    await pool.query(`DELETE FROM accounts WHERE is_demo = true`);
    const result = await pool.query<{ name: string }>(
      `SELECT name FROM accounts WHERE owner_id = $1`,
      [ownerId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Real');
  });
});

// ── Contacts ─────────────────────────────────────────────────────────────────

describe('is_demo column — contacts', () => {
  it('defaults to false', async () => {
    const result = await pool.query<{ is_demo: boolean }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Real', 'Person', 'real.person.seed@example.com', $1)
       RETURNING is_demo`,
      [ownerId],
    );
    expect(result.rows[0].is_demo).toBe(false);
  });

  it('can be set to true on insert', async () => {
    const result = await pool.query<{ is_demo: boolean }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id, is_demo)
       VALUES ('Demo', 'Person', 'demo.person.seed@example.com', $1, true)
       RETURNING is_demo`,
      [ownerId],
    );
    expect(result.rows[0].is_demo).toBe(true);
  });

  it('DELETE WHERE is_demo = true removes only demo rows', async () => {
    await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, owner_id, is_demo)
       VALUES ('Real', 'Person', 'real2.person.seed@example.com', $1, false),
              ('Demo', 'Person', 'demo2.person.seed@example.com', $1, true)`,
      [ownerId],
    );
    await pool.query(`DELETE FROM contacts WHERE is_demo = true`);
    const result = await pool.query<{ first_name: string }>(
      `SELECT first_name FROM contacts WHERE owner_id = $1`,
      [ownerId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].first_name).toBe('Real');
  });
});

// ── Deals ─────────────────────────────────────────────────────────────────────

describe('is_demo column — deals', () => {
  it('defaults to false', async () => {
    const result = await pool.query<{ is_demo: boolean }>(
      `INSERT INTO deals (name, stage, owner_id, pipeline_id) VALUES ('Real Deal', 'Prospecting', $1, $2) RETURNING is_demo`,
      [ownerId, defaultPipelineId],
    );
    expect(result.rows[0].is_demo).toBe(false);
  });

  it('can be set to true on insert', async () => {
    const result = await pool.query<{ is_demo: boolean }>(
      `INSERT INTO deals (name, stage, owner_id, is_demo, pipeline_id) VALUES ('Demo Deal', 'Prospecting', $1, true, $2) RETURNING is_demo`,
      [ownerId, defaultPipelineId],
    );
    expect(result.rows[0].is_demo).toBe(true);
  });

  it('DELETE WHERE is_demo = true removes only demo rows', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, owner_id, is_demo, pipeline_id)
       VALUES ('Real Deal', 'Prospecting', $1, false, $2),
              ('Demo Deal', 'Prospecting', $1, true, $2)`,
      [ownerId, defaultPipelineId],
    );
    await pool.query(`DELETE FROM deals WHERE is_demo = true`);
    const result = await pool.query<{ name: string }>(
      `SELECT name FROM deals WHERE owner_id = $1`,
      [ownerId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Real Deal');
  });
});

// ── Activities ────────────────────────────────────────────────────────────────

describe('is_demo column — activities', () => {
  let contactId: string;

  beforeEach(async () => {
    const contactResult = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Act', 'Owner', 'act.owner.seed@example.com', $1)
       RETURNING id`,
      [ownerId],
    );
    contactId = contactResult.rows[0].id;
  });

  it('defaults to false', async () => {
    const result = await pool.query<{ is_demo: boolean }>(
      `INSERT INTO activities (type, subject, status, contact_id, owner_id)
       VALUES ('Note', 'Real note', 'open', $1, $2)
       RETURNING is_demo`,
      [contactId, ownerId],
    );
    expect(result.rows[0].is_demo).toBe(false);
  });

  it('can be set to true on insert', async () => {
    const result = await pool.query<{ is_demo: boolean }>(
      `INSERT INTO activities (type, subject, status, contact_id, owner_id, is_demo)
       VALUES ('Note', 'Demo note', 'open', $1, $2, true)
       RETURNING is_demo`,
      [contactId, ownerId],
    );
    expect(result.rows[0].is_demo).toBe(true);
  });

  it('DELETE WHERE is_demo = true removes only demo rows', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, status, contact_id, owner_id, is_demo)
       VALUES ('Note', 'Real note', 'open', $1, $2, false),
              ('Note', 'Demo note', 'open', $1, $2, true)`,
      [contactId, ownerId],
    );
    await pool.query(`DELETE FROM activities WHERE is_demo = true`);
    const result = await pool.query<{ subject: string }>(
      `SELECT subject FROM activities WHERE owner_id = $1`,
      [ownerId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].subject).toBe('Real note');
  });
});

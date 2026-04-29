/**
 * Integration tests for dashboardService.
 *
 * Runs against a real PostgreSQL test database.
 * A single test user is created in beforeAll and reused.
 * The activities and deals tables are truncated before each test.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import { getDashboardSummary } from '../services/dashboardService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'dash-svc';

/** Rep user fixture */
const REP_USER = {
  email: `${FILE_PREFIX}-rep@example.com`,
  name: 'Dashboard Rep',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Another rep — used to verify admin sees both users' data */
const OTHER_REP_USER = {
  email: `${FILE_PREFIX}-other@example.com`,
  name: 'Dashboard Other',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let repId: string;
let otherRepId: string;
/** A contact used as the parent record for all test activities */
let contactId: string;

/** Returns today's date string in YYYY-MM-DD format (for test data) */
function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns yesterday's date string in YYYY-MM-DD format (for overdue tasks) */
function yesterdayString(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

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
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser(REP_USER);
  repId = rep.id;

  const other = await createUser(OTHER_REP_USER);
  otherRepId = other.id;

  // A shared contact used as the required parent record for all test activities
  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Dashboard', 'Contact', $1, $2)
     RETURNING id`,
    [`${FILE_PREFIX}-contact@example.com`, repId],
  );
  contactId = contactResult.rows[0].id;
});

beforeEach(async () => {
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
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── Task count tests ──────────────────────────────────────────────────────────

describe('getDashboardSummary — task counts', () => {
  it('returns zero counts when there are no tasks', async () => {
    const summary = await getDashboardSummary(repId);
    expect(summary.overdueTasks).toBe(0);
    expect(summary.tasksDueToday).toBe(0);
  });

  it('counts overdue open tasks correctly', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, contact_id, owner_id)
       VALUES ('Task', 'Overdue task', 'open', $1, $2, $3)`,
      [yesterdayString(), contactId, repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.overdueTasks).toBe(1);
  });

  it('does not count completed tasks as overdue', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, contact_id, owner_id)
       VALUES ('Task', 'Completed overdue', 'complete', $1, $2, $3)`,
      [yesterdayString(), contactId, repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.overdueTasks).toBe(0);
  });

  it('counts tasks due today correctly', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, contact_id, owner_id)
       VALUES ('Task', 'Due today', 'open', $1, $2, $3)`,
      [todayString(), contactId, repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.tasksDueToday).toBe(1);
    // Task due today is NOT overdue
    expect(summary.overdueTasks).toBe(0);
  });

  it('does not count non-Task activities', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, contact_id, owner_id)
       VALUES ('Note', 'Old note', 'open', $1, $2, $3)`,
      [yesterdayString(), contactId, repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.overdueTasks).toBe(0);
  });

  it('scopes task counts to the given owner when ownerId is provided', async () => {
    // Rep's overdue task
    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, contact_id, owner_id)
       VALUES ('Task', 'Rep overdue', 'open', $1, $2, $3)`,
      [yesterdayString(), contactId, repId],
    );
    // Other rep's overdue task — must not appear in rep's summary
    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, contact_id, owner_id)
       VALUES ('Task', 'Other overdue', 'open', $1, $2, $3)`,
      [yesterdayString(), contactId, otherRepId],
    );

    const summary = await getDashboardSummary(repId);
    expect(summary.overdueTasks).toBe(1);
  });

  it('returns team-wide task counts when ownerId is null (admin)', async () => {
    // Two users both have overdue tasks
    await pool.query(
      `INSERT INTO activities (type, subject, status, due_date, contact_id, owner_id)
       VALUES ('Task', 'Rep overdue', 'open', $1, $2, $3),
              ('Task', 'Other overdue', 'open', $1, $2, $4)`,
      [yesterdayString(), contactId, repId, otherRepId],
    );

    const summary = await getDashboardSummary(null);
    expect(summary.overdueTasks).toBe(2);
  });
});

// ── Deal aggregate tests ──────────────────────────────────────────────────────

describe('getDashboardSummary — deal aggregates', () => {
  it('returns zero deal count and zero value when there are no deals', async () => {
    const summary = await getDashboardSummary(repId);
    expect(summary.openDealCount).toBe(0);
    expect(summary.openPipelineValue).toBe('0');
    expect(summary.stageBreakdown).toHaveLength(0);
  });

  it('counts open deals and sums their value', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('Deal A', 'Prospecting', 25000, $1),
              ('Deal B', 'Qualification', 75000, $1)`,
      [repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.openDealCount).toBe(2);
    expect(parseFloat(summary.openPipelineValue)).toBe(100000);
  });

  it('excludes Closed Won and Closed Lost deals from metrics', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('Open deal', 'Prospecting', 10000, $1),
              ('Won deal', 'Closed Won', 50000, $1),
              ('Lost deal', 'Closed Lost', 20000, $1)`,
      [repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.openDealCount).toBe(1);
    expect(parseFloat(summary.openPipelineValue)).toBe(10000);
  });

  it('scopes deal counts to the given owner when ownerId is provided', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('Rep deal', 'Prospecting', 10000, $1),
              ('Other deal', 'Qualification', 20000, $2)`,
      [repId, otherRepId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.openDealCount).toBe(1);
  });

  it('returns team-wide deal counts when ownerId is null (admin)', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('Rep deal', 'Prospecting', 10000, $1),
              ('Other deal', 'Qualification', 20000, $2)`,
      [repId, otherRepId],
    );
    const summary = await getDashboardSummary(null);
    expect(summary.openDealCount).toBe(2);
    expect(parseFloat(summary.openPipelineValue)).toBe(30000);
  });
});

// ── Stage breakdown tests ─────────────────────────────────────────────────────

describe('getDashboardSummary — stage breakdown', () => {
  it('returns a breakdown row for each open stage', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('Deal 1', 'Prospecting', 10000, $1),
              ('Deal 2', 'Prospecting', 15000, $1),
              ('Deal 3', 'Qualification', 30000, $1)`,
      [repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.stageBreakdown).toHaveLength(2);

    const prospecting = summary.stageBreakdown.find((r) => r.stage === 'Prospecting');
    const qualification = summary.stageBreakdown.find((r) => r.stage === 'Qualification');

    expect(prospecting?.count).toBe(2);
    expect(parseFloat(prospecting?.value ?? '0')).toBe(25000);
    expect(qualification?.count).toBe(1);
    expect(parseFloat(qualification?.value ?? '0')).toBe(30000);
  });

  it('does not include closed stages in the breakdown', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('Won deal', 'Closed Won', 50000, $1)`,
      [repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.stageBreakdown).toHaveLength(0);
  });

  it('handles deals with null value in stage breakdown', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('No value deal', 'Proposal', NULL, $1)`,
      [repId],
    );
    const summary = await getDashboardSummary(repId);
    const proposal = summary.stageBreakdown.find((r) => r.stage === 'Proposal');
    expect(proposal?.count).toBe(1);
    expect(proposal?.value).toBe('0');
  });
});

// ── Weighted pipeline value (MINCRM-179) ──────────────────────────────────────────

describe('getDashboardSummary — weighted pipeline value', () => {
  it('returns weightedPipelineValue using stage default probability', async () => {
    // Prospecting default = 10%; value = $100,000 → weighted = $10,000
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('Weighted test', 'Prospecting', 100000, $1)`,
      [repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(parseFloat(summary.weightedPipelineValue)).toBeCloseTo(10000, 0);
  });

  it('uses per-deal probability override for weighted calculation', async () => {
    // Deal value = $100,000 with manual probability = 60% → weighted = $60,000
    await pool.query(
      `INSERT INTO deals (name, stage, value, probability, owner_id)
       VALUES ('Override deal', 'Prospecting', 100000, 60, $1)`,
      [repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(parseFloat(summary.weightedPipelineValue)).toBeCloseTo(60000, 0);
    // stageBreakdown should also reflect the per-deal override
    const prospecting = summary.stageBreakdown.find((r) => r.stage === 'Prospecting');
    expect(prospecting).toBeDefined();
    expect(parseFloat(prospecting!.weightedValue)).toBeCloseTo(60000, 0);
  });

  it('includes weighted_value in per-stage breakdown', async () => {
    // Qualification default = 25%; value = $80,000 → weighted = $20,000
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('Stage weighted', 'Qualification', 80000, $1)`,
      [repId],
    );
    const summary = await getDashboardSummary(repId);
    const qual = summary.stageBreakdown.find((r) => r.stage === 'Qualification');
    expect(qual).toBeDefined();
    expect(parseFloat(qual!.weightedValue)).toBeCloseTo(20000, 0);
  });

  it('returns 0 weighted value when all deals have null value', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('No value', 'Prospecting', NULL, $1)`,
      [repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(parseFloat(summary.weightedPipelineValue)).toBe(0);
  });

  it('excludes closed stages from weighted pipeline total', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, owner_id)
       VALUES ('Won deal', 'Closed Won', 100000, $1)`,
      [repId],
    );
    const summary = await getDashboardSummary(repId);
    // Closed Won is excluded; weighted total should remain 0
    expect(parseFloat(summary.weightedPipelineValue)).toBe(0);
  });
});

// ── Recent activities (MINCRM-185) ────────────────────────────────────────────

describe('getDashboardSummary — recentActivities', () => {
  it('returns an empty array when there are no activities', async () => {
    const summary = await getDashboardSummary(repId);
    expect(summary.recentActivities).toEqual([]);
  });

  it('returns activities for the given owner when ownerId is provided', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id)
       VALUES ('Note', 'My note', $1, $2)`,
      [contactId, repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.recentActivities).toHaveLength(1);
    expect(summary.recentActivities[0].subject).toBe('My note');
    expect(summary.recentActivities[0].type).toBe('Note');
  });

  it('does not return another rep activities when scoped by ownerId', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id)
       VALUES ('Call', 'Other rep call', $1, $2)`,
      [contactId, otherRepId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.recentActivities).toHaveLength(0);
  });

  it('returns all users activities when ownerId is null (admin)', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id)
       VALUES ('Note', 'Rep note', $1, $2),
              ('Email', 'Other email', $1, $3)`,
      [contactId, repId, otherRepId],
    );
    const summary = await getDashboardSummary(null);
    expect(summary.recentActivities.length).toBeGreaterThanOrEqual(2);
  });

  it('returns at most 10 activities', async () => {
    // Insert 15 activities
    for (let i = 0; i < 15; i++) {
      await pool.query(
        `INSERT INTO activities (type, subject, contact_id, owner_id)
         VALUES ('Note', $1, $2, $3)`,
        [`Note ${i}`, contactId, repId],
      );
    }
    const summary = await getDashboardSummary(repId);
    expect(summary.recentActivities.length).toBeLessThanOrEqual(10);
  });

  it('includes the linked record name and path for a contact-linked activity', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id)
       VALUES ('Call', 'Discovery call', $1, $2)`,
      [contactId, repId],
    );
    const summary = await getDashboardSummary(repId);
    const entry = summary.recentActivities[0];
    expect(entry.linkedRecordName).toBe('Dashboard Contact');
    expect(entry.linkedRecordPath).toBe(`/contacts/${contactId}`);
  });

  it('returns activities ordered by updated_at descending', async () => {
    // Insert two activities; second should appear first
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id, created_at, updated_at)
       VALUES
         ('Note', 'Older note', $1, $2, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour'),
         ('Note', 'Newer note', $1, $2, NOW(), NOW())`,
      [contactId, repId],
    );
    const summary = await getDashboardSummary(repId);
    expect(summary.recentActivities[0].subject).toBe('Newer note');
    expect(summary.recentActivities[1].subject).toBe('Older note');
  });
});

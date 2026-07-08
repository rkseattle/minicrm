/**
 * Integration tests for reportService.
 *
 * Runs against a real PostgreSQL test database.
 * Three test users are created in beforeAll and reused across tests:
 *   - repId      — the primary rep caller
 *   - otherRepId — a second rep; used to verify ownership isolation
 *   - adminId    — admin caller; used to verify My View scoping (MINCRM-264)
 * The deals / activities tables are truncated before each test.
 *
 * Ownership-scoping audit (MINCRM-264): both report queries in reportService.ts
 * already apply WHERE owner_id = $userId when ownerId is non-null, and omit the
 * clause (returning team-wide data) when ownerId is null. The controller enforces
 * that rep callers always receive ownerId = req.user.id, and admin callers receive
 * ownerId = null unless they explicitly pass ?owner_id=. No scoping gaps were found.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import {
  getWinLossReport,
  getActivityVolumeReport,
  getStageTrendReport,
  getLeadsSummaryReport,
} from '../services/reportService.js';
import { createUser } from '../services/userService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import pool from '../db.js';

const FILE_PREFIX = 'report-svc';

/** Rep user fixture */
const REP_USER = {
  email: `${FILE_PREFIX}-rep@example.com`,
  name: 'Report Rep',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Another rep — used to verify admin sees both users' data */
const OTHER_REP_USER = {
  email: `${FILE_PREFIX}-other@example.com`,
  name: 'Report Other',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Admin user — used to verify My View scoping (MINCRM-264) */
const ADMIN_USER = {
  email: `${FILE_PREFIX}-admin@example.com`,
  name: 'Report Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let repId: string;
let otherRepId: string;
let adminId: string;
/** A shared contact used as the required parent record for activity test data */
let contactId: string;
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
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
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

  const admin = await createUser(ADMIN_USER);
  adminId = admin.id;

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Report', 'Contact', $1, $2)
     RETURNING id`,
    [`${FILE_PREFIX}-contact@example.com`, repId],
  );
  contactId = contactResult.rows[0].id;
  defaultPipelineId = await getDefaultPipelineId();
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
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  // Reset currency rate history so historical-rate tests start from a clean state
  await pool.query('DELETE FROM currency_rate_history');
  // Reset to USD-only configuration
  await pool.query('DELETE FROM currencies WHERE is_home = false');
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
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

/** Default date range used across tests: all of 2025 */
const RANGE = { startDate: '2025-01-01', endDate: '2025-12-31' };

// ── Empty state ───────────────────────────────────────────────────────────────

describe('getWinLossReport — empty state', () => {
  it('returns zero counts and null winRate when there are no closed deals', async () => {
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(0);
    expect(report.wonValue).toBe('0');
    expect(report.lostCount).toBe(0);
    expect(report.lostValue).toBe('0');
    expect(report.winRate).toBeNull();
    expect(report.lossReasonBreakdown).toHaveLength(0);
  });

  it('excludes open (non-closed) deals', async () => {
    const stageIdProspecting = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Prospecting', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Open deal', 'Prospecting', 10000, '2025-06-01', $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdProspecting],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(0);
    expect(report.lostCount).toBe(0);
  });
});

// ── Won/lost counts and values ────────────────────────────────────────────────

describe('getWinLossReport — counts and values', () => {
  it('counts Closed Won and Closed Lost deals separately', async () => {
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    const stageIdClosedLost = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Lost', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Won A', 'Closed Won',  50000, '2025-03-15', $1, $2, $3),
              ('Won B', 'Closed Won',  30000, '2025-06-01', $1, $2, $3),
              ('Lost A', 'Closed Lost', 20000, '2025-04-10', $1, $2, $4)`,
      [repId, defaultPipelineId, stageIdClosedWon, stageIdClosedLost],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(2);
    expect(parseFloat(report.wonValue)).toBe(80000);
    expect(report.lostCount).toBe(1);
    expect(parseFloat(report.lostValue)).toBe(20000);
  });

  it('treats null deal value as zero in sums', async () => {
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Won no value', 'Closed Won', NULL, '2025-05-01', $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdClosedWon],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(1);
    expect(report.wonValue).toBe('0');
  });
});

// ── Win rate ──────────────────────────────────────────────────────────────────

describe('getWinLossReport — win rate', () => {
  it('computes win rate as wonCount / totalClosed', async () => {
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    const stageIdClosedLost = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Lost', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Won', 'Closed Won',  10000, '2025-01-15', $1, $2, $3),
              ('Won 2', 'Closed Won', 10000, '2025-02-15', $1, $2, $3),
              ('Lost', 'Closed Lost', 5000, '2025-03-15', $1, $2, $4)`,
      [repId, defaultPipelineId, stageIdClosedWon, stageIdClosedLost],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    // 2 won / 3 total = 0.666...
    expect(report.winRate).toBeCloseTo(2 / 3, 5);
  });

  it('returns winRate of 1 when all closed deals are Won', async () => {
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Won only', 'Closed Won', 10000, '2025-07-01', $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdClosedWon],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.winRate).toBe(1);
  });

  it('returns winRate of 0 when all closed deals are Lost', async () => {
    const stageIdClosedLost = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Lost', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Lost only', 'Closed Lost', 10000, '2025-08-01', $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdClosedLost],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.winRate).toBe(0);
  });

  it('returns null winRate when no closed deals exist', async () => {
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.winRate).toBeNull();
  });
});

// ── Date range filtering ──────────────────────────────────────────────────────

describe('getWinLossReport — date range filtering', () => {
  it('filters deals by close_date within the range (inclusive)', async () => {
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('In range',   'Closed Won',  10000, '2025-06-15', $1, $2, $3),
              ('Before',     'Closed Won',  20000, '2025-05-31', $1, $2, $3),
              ('After',      'Closed Won',  30000, '2025-07-01', $1, $2, $3),
              ('Start edge', 'Closed Won',   5000, '2025-06-01', $1, $2, $3),
              ('End edge',   'Closed Won',   5000, '2025-06-30', $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdClosedWon],
    );
    const report = await getWinLossReport({
      startDate: '2025-06-01',
      endDate: '2025-06-30',
      ownerId: repId,
    });
    // Only 3 deals fall within June (In range, Start edge, End edge)
    expect(report.wonCount).toBe(3);
    expect(parseFloat(report.wonValue)).toBe(20000);
  });

  it('excludes deals outside the date range', async () => {
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Outside', 'Closed Won', 10000, '2024-12-31', $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdClosedWon],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(0);
  });

  it('excludes deals with null close_date', async () => {
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('No close date', 'Closed Won', 10000, NULL, $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdClosedWon],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(0);
  });
});

// ── Owner scoping ─────────────────────────────────────────────────────────────
// MINCRM-264 audit: these cases confirm the three required scoping modes.

describe('getWinLossReport — owner scoping', () => {
  it('rep caller: scopes results to only their own deals', async () => {
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Rep Won',   'Closed Won',  10000, '2025-06-01', $1, $3, $4),
              ('Other Won', 'Closed Won',  20000, '2025-06-01', $2, $3, $4)`,
      [repId, otherRepId, defaultPipelineId, stageIdClosedWon],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(1);
    expect(parseFloat(report.wonValue)).toBe(10000);
  });

  it('admin Team View (null): returns team-wide data across all owners', async () => {
    // ownerId: null deliberately queries every Closed Won/Lost deal in the
    // date range across the whole database, so wonCount/wonValue can't be
    // asserted as exact values here — another test file inserting a Closed
    // Won deal dated in 2025 for a different owner would collide. Verify by
    // identity against the deals table instead (scoped to this file's two
    // owners, which is collision-proof), and only lower-bound the aggregate
    // report to confirm it actually includes team-wide data, not just repId's.
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Rep Won',   'Closed Won',  10000, '2025-06-01', $1, $3, $4),
              ('Other Won', 'Closed Won',  20000, '2025-06-01', $2, $3, $4)`,
      [repId, otherRepId, defaultPipelineId, stageIdClosedWon],
    );

    const insertedRows = await pool.query<{ name: string; owner_id: string; value: string }>(
      `SELECT name, owner_id, value FROM deals WHERE owner_id IN ($1, $2) AND stage = 'Closed Won'`,
      [repId, otherRepId],
    );
    expect(insertedRows.rows).toHaveLength(2);
    expect(insertedRows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Rep Won', owner_id: repId }),
        expect.objectContaining({ name: 'Other Won', owner_id: otherRepId }),
      ]),
    );

    const report = await getWinLossReport({ ...RANGE, ownerId: null });
    expect(report.wonCount).toBeGreaterThanOrEqual(2);
    expect(parseFloat(report.wonValue)).toBeGreaterThanOrEqual(30000);
  });

  it("admin My View: scopes results to only the admin's own deals", async () => {
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Admin Won', 'Closed Won',  15000, '2025-06-01', $1, $4, $5),
              ('Rep Won',   'Closed Won',  10000, '2025-06-01', $2, $4, $5),
              ('Other Won', 'Closed Won',  20000, '2025-06-01', $3, $4, $5)`,
      [adminId, repId, otherRepId, defaultPipelineId, stageIdClosedWon],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: adminId });
    expect(report.wonCount).toBe(1);
    expect(parseFloat(report.wonValue)).toBe(15000);
  });
});

// ── Loss reason breakdown ─────────────────────────────────────────────────────

describe('getWinLossReport — loss reason breakdown', () => {
  it('returns loss reasons sorted by count descending', async () => {
    const stageIdClosedLost = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Lost', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, loss_reason, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Lost 1', 'Closed Lost', 'Price too high',      '2025-01-15', $1, $2, $3),
              ('Lost 2', 'Closed Lost', 'Price too high',      '2025-02-15', $1, $2, $3),
              ('Lost 3', 'Closed Lost', 'Lost to competitor',  '2025-03-15', $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdClosedLost],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.lossReasonBreakdown).toHaveLength(2);
    expect(report.lossReasonBreakdown[0].reason).toBe('Price too high');
    expect(report.lossReasonBreakdown[0].count).toBe(2);
    expect(report.lossReasonBreakdown[1].reason).toBe('Lost to competitor');
    expect(report.lossReasonBreakdown[1].count).toBe(1);
  });

  it('excludes Closed Lost deals with null or empty loss_reason', async () => {
    const stageIdClosedLost = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Lost', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, loss_reason, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Lost null',  'Closed Lost', NULL, '2025-04-01', $1, $2, $3),
              ('Lost empty', 'Closed Lost', '',   '2025-04-02', $1, $2, $3),
              ('Lost real',  'Closed Lost', 'No budget', '2025-04-03', $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdClosedLost],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.lossReasonBreakdown).toHaveLength(1);
    expect(report.lossReasonBreakdown[0].reason).toBe('No budget');
  });

  it('returns empty breakdown when no loss reasons were captured', async () => {
    const stageIdClosedLost = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Lost', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Lost no reason', 'Closed Lost', '2025-05-01', $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdClosedLost],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.lossReasonBreakdown).toHaveLength(0);
  });

  it('does not include Closed Won deals in the loss reason breakdown', async () => {
    const stageIdClosedWon = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Won', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, loss_reason, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Won with reason', 'Closed Won', 'Some reason', '2025-06-01', $1, $2, $3)`,
      [repId, defaultPipelineId, stageIdClosedWon],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.lossReasonBreakdown).toHaveLength(0);
  });

  it('scopes loss reasons to the given owner', async () => {
    const stageIdClosedLost = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Closed Lost', defaultPipelineId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO deals (name, stage, loss_reason, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Rep lost',   'Closed Lost', 'Price',      '2025-07-01', $1, $3, $4),
              ('Other lost', 'Closed Lost', 'Competitor', '2025-07-01', $2, $3, $4)`,
      [repId, otherRepId, defaultPipelineId, stageIdClosedLost],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.lossReasonBreakdown).toHaveLength(1);
    expect(report.lossReasonBreakdown[0].reason).toBe('Price');
  });
});

// ── Activity Volume Report (MINCRM-181) ───────────────────────────────────────

/** Activity range covering 2025 — activities are matched by created_at */
const ACT_RANGE = { startDate: '2025-01-01', endDate: '2025-12-31' };

describe('getActivityVolumeReport — empty state', () => {
  it('returns empty rows and zero totals when there are no activities', async () => {
    const report = await getActivityVolumeReport({ ...ACT_RANGE, ownerId: repId });
    expect(report.rows).toHaveLength(0);
    expect(report.totals.total).toBe(0);
  });
});

describe('getActivityVolumeReport — counts by type', () => {
  it('counts each activity type correctly for a single rep', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id, created_at, updated_at)
       VALUES
         ('Note',    'n1', $1, $2, '2025-06-01', '2025-06-01'),
         ('Call',    'c1', $1, $2, '2025-06-02', '2025-06-02'),
         ('Call',    'c2', $1, $2, '2025-06-03', '2025-06-03'),
         ('Email',   'e1', $1, $2, '2025-07-01', '2025-07-01'),
         ('Meeting', 'm1', $1, $2, '2025-08-01', '2025-08-01'),
         ('Task',    't1', $1, $2, '2025-09-01', '2025-09-01')`,
      [contactId, repId],
    );
    const report = await getActivityVolumeReport({ ...ACT_RANGE, ownerId: repId });
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    expect(row.ownerId).toBe(repId);
    expect(row.counts.Note).toBe(1);
    expect(row.counts.Call).toBe(2);
    expect(row.counts.Email).toBe(1);
    expect(row.counts.Meeting).toBe(1);
    expect(row.counts.Task).toBe(1);
    expect(row.total).toBe(6);
  });

  it('computes column totals correctly', async () => {
    // repId: 2 notes; otherRepId: 1 call.
    // ownerId: null queries team-wide across the whole database, so exact
    // totals collide with any other file inserting activities in 2025.
    // Verify by identity instead: find this file's two owner rows in the
    // per-rep breakdown and check their individual counts — collision-proof
    // since it only reads rows keyed to this file's own owner ids.
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id, created_at, updated_at)
       VALUES
         ('Note', 'rep-n1', $1, $2, '2025-03-01', '2025-03-01'),
         ('Note', 'rep-n2', $1, $2, '2025-03-02', '2025-03-02'),
         ('Call', 'other-c1', $1, $3, '2025-04-01', '2025-04-01')`,
      [contactId, repId, otherRepId],
    );
    const report = await getActivityVolumeReport({ ...ACT_RANGE, ownerId: null });
    const repRow = report.rows.find((r) => r.ownerId === repId);
    const otherRow = report.rows.find((r) => r.ownerId === otherRepId);
    expect(repRow?.counts.Note).toBe(2);
    expect(otherRow?.counts.Call).toBe(1);
    expect(report.totals.Note).toBeGreaterThanOrEqual(2);
    expect(report.totals.Call).toBeGreaterThanOrEqual(1);
    expect(report.totals.total).toBeGreaterThanOrEqual(3);
  });
});

describe('getActivityVolumeReport — date range filtering', () => {
  it('filters activities by created_at date (inclusive)', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id, created_at, updated_at)
       VALUES
         ('Note', 'in range',    $1, $2, '2025-06-15', '2025-06-15'),
         ('Note', 'before',      $1, $2, '2025-05-31', '2025-05-31'),
         ('Note', 'after',       $1, $2, '2025-07-01', '2025-07-01'),
         ('Note', 'start edge',  $1, $2, '2025-06-01', '2025-06-01'),
         ('Note', 'end edge',    $1, $2, '2025-06-30', '2025-06-30')`,
      [contactId, repId],
    );
    const report = await getActivityVolumeReport({
      startDate: '2025-06-01',
      endDate: '2025-06-30',
      ownerId: repId,
    });
    const row = report.rows[0];
    // in range + start edge + end edge = 3
    expect(row.counts.Note).toBe(3);
  });
});

// MINCRM-264 audit: three required scoping modes for activity volume.
describe('getActivityVolumeReport — owner scoping', () => {
  it('rep caller: scopes results to only their own activities', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id, created_at, updated_at)
       VALUES
         ('Call', 'rep call',   $1, $2, '2025-05-01', '2025-05-01'),
         ('Email', 'other email', $1, $3, '2025-05-01', '2025-05-01')`,
      [contactId, repId, otherRepId],
    );
    const report = await getActivityVolumeReport({ ...ACT_RANGE, ownerId: repId });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].ownerId).toBe(repId);
    expect(report.rows[0].counts.Call).toBe(1);
  });

  it("admin Team View (null): returns all reps' activities", async () => {
    // ownerId: null is team-wide, so an exact rows-length collides with any
    // other owner's activities inserted by a concurrently-running file.
    // Verify by identity: both of this file's owners appear with the right
    // per-type counts, rather than asserting the total row count.
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id, created_at, updated_at)
       VALUES
         ('Note', 'rep note',   $1, $2, '2025-05-01', '2025-05-01'),
         ('Task', 'other task', $1, $3, '2025-05-02', '2025-05-02')`,
      [contactId, repId, otherRepId],
    );
    const report = await getActivityVolumeReport({ ...ACT_RANGE, ownerId: null });
    const repRow = report.rows.find((r) => r.ownerId === repId);
    const otherRow = report.rows.find((r) => r.ownerId === otherRepId);
    expect(repRow?.counts.Note).toBe(1);
    expect(otherRow?.counts.Task).toBe(1);
  });

  it("admin My View: scopes results to only the admin's own activities", async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id, created_at, updated_at)
       VALUES
         ('Meeting', 'admin meeting', $1, $2, '2025-05-01', '2025-05-01'),
         ('Note',    'rep note',      $1, $3, '2025-05-01', '2025-05-01'),
         ('Task',    'other task',    $1, $4, '2025-05-02', '2025-05-02')`,
      [contactId, adminId, repId, otherRepId],
    );
    const report = await getActivityVolumeReport({ ...ACT_RANGE, ownerId: adminId });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].ownerId).toBe(adminId);
    expect(report.rows[0].counts.Meeting).toBe(1);
  });
});

describe('getActivityVolumeReport — types default to zero', () => {
  it('returns zero for activity types not logged by a rep', async () => {
    await pool.query(
      `INSERT INTO activities (type, subject, contact_id, owner_id, created_at, updated_at)
       VALUES ('Note', 'only note', $1, $2, '2025-06-01', '2025-06-01')`,
      [contactId, repId],
    );
    const report = await getActivityVolumeReport({ ...ACT_RANGE, ownerId: repId });
    const row = report.rows[0];
    expect(row.counts.Call).toBe(0);
    expect(row.counts.Email).toBe(0);
    expect(row.counts.Meeting).toBe(0);
    expect(row.counts.Task).toBe(0);
  });
});

// ── getStageTrendReport (MINCRM-284) ──────────────────────────────────────────

/** Insert an audit_log entry recording a deal entering a given stage at a given timestamp */
async function insertDealStageEntry(
  dealId: string,
  stage: string,
  enteredAt: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (record_type, record_id, record_name, event_type, field_name, new_value, created_at)
     VALUES ('deal', $1, 'Test Deal', 'updated', 'stage', $2, $3)`,
    [dealId, stage, enteredAt],
  );
}

/** Sums entered count for a given stage across all periods in a report */
function stageTotalEntered(
  dataPoints: { stage: string; entered: number }[],
  stage: string,
): number {
  return dataPoints.filter((dp) => dp.stage === stage).reduce((sum, dp) => sum + dp.entered, 0);
}

/** Sums converted count for a given stage across all periods in a report */
function stageTotalConverted(
  dataPoints: { stage: string; converted: number }[],
  stage: string,
): number {
  return dataPoints.filter((dp) => dp.stage === stage).reduce((sum, dp) => sum + dp.converted, 0);
}

describe('getStageTrendReport — stage entry counting', () => {
  it('counts new deal entries within the window (delta increases after insert)', async () => {
    // Baseline before inserting test data
    const before = await getStageTrendReport(30);
    const beforeEntered = stageTotalEntered(before.dataPoints, 'Prospecting');

    // Create a deal and an audit entry within the last 30 days
    const stageIdProspecting = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Prospecting', defaultPipelineId],
      )
    ).rows[0].id;
    const dealResult = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, close_date, owner_id, pipeline_id, pipeline_stage_id) VALUES ('Trend Deal A', 'Prospecting', NOW()::date, $1, $2, $3) RETURNING id`,
      [repId, defaultPipelineId, stageIdProspecting],
    );
    const dealId = dealResult.rows[0].id;
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 5);
    await insertDealStageEntry(dealId, 'Prospecting', recentDate.toISOString());

    const after = await getStageTrendReport(30);
    const afterEntered = stageTotalEntered(after.dataPoints, 'Prospecting');
    expect(afterEntered).toBe(beforeEntered + 1);
  });

  it('excludes audit entries outside the look-back window (delta unchanged after old insert)', async () => {
    // Baseline before inserting test data
    const before = await getStageTrendReport(30);
    const beforeEntered = stageTotalEntered(before.dataPoints, 'Prospecting');

    // Create a deal and an audit entry 45 days ago — outside the 30-day window
    const stageIdProspectingOld = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Prospecting', defaultPipelineId],
      )
    ).rows[0].id;
    const dealResult = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, close_date, owner_id, pipeline_id, pipeline_stage_id) VALUES ('Trend Deal Old', 'Prospecting', NOW()::date, $1, $2, $3) RETURNING id`,
      [repId, defaultPipelineId, stageIdProspectingOld],
    );
    const dealId = dealResult.rows[0].id;
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 45);
    await insertDealStageEntry(dealId, 'Prospecting', oldDate.toISOString());

    const after = await getStageTrendReport(30);
    const afterEntered = stageTotalEntered(after.dataPoints, 'Prospecting');
    // Old entry must not increment the count
    expect(afterEntered).toBe(beforeEntered);
  });
});

describe('getStageTrendReport — conversion counting', () => {
  it('marks a deal as converted when it has a subsequent stage change (delta increases)', async () => {
    const before = await getStageTrendReport(30);
    const beforeConverted = stageTotalConverted(before.dataPoints, 'Qualification');

    const stageIdQualification = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Qualification', defaultPipelineId],
      )
    ).rows[0].id;
    const dealResult = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, close_date, owner_id, pipeline_id, pipeline_stage_id) VALUES ('Trend Deal Conv', 'Qualification', NOW()::date, $1, $2, $3) RETURNING id`,
      [repId, defaultPipelineId, stageIdQualification],
    );
    const dealId = dealResult.rows[0].id;

    const t1 = new Date();
    t1.setDate(t1.getDate() - 10);
    const t2 = new Date();
    t2.setDate(t2.getDate() - 5);

    // Deal entered Qualification at t1, then moved to Proposal at t2
    await insertDealStageEntry(dealId, 'Qualification', t1.toISOString());
    await insertDealStageEntry(dealId, 'Proposal', t2.toISOString());

    const after = await getStageTrendReport(30);
    const afterConverted = stageTotalConverted(after.dataPoints, 'Qualification');
    expect(afterConverted).toBe(beforeConverted + 1);
  });

  it('does not mark a deal as converted when it has no subsequent stage change (delta unchanged)', async () => {
    const before = await getStageTrendReport(30);
    const beforeConverted = stageTotalConverted(before.dataPoints, 'Prospecting');

    const stageIdProspectingNoConv = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Prospecting', defaultPipelineId],
      )
    ).rows[0].id;
    const dealResult = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, close_date, owner_id, pipeline_id, pipeline_stage_id) VALUES ('Trend Deal NoConv', 'Prospecting', NOW()::date, $1, $2, $3) RETURNING id`,
      [repId, defaultPipelineId, stageIdProspectingNoConv],
    );
    const dealId = dealResult.rows[0].id;

    const enteredAt = new Date();
    enteredAt.setDate(enteredAt.getDate() - 8);
    await insertDealStageEntry(dealId, 'Prospecting', enteredAt.toISOString());

    const after = await getStageTrendReport(30);
    const afterConverted = stageTotalConverted(after.dataPoints, 'Prospecting');
    // No subsequent entry — converted count must not increase
    expect(afterConverted).toBe(beforeConverted);
  });
});

describe('getStageTrendReport — metadata', () => {
  it('returns windowStart and windowEnd ISO date strings', async () => {
    const report = await getStageTrendReport(30);
    expect(report.windowStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.windowEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses monthly buckets for 60-day window', async () => {
    const stageIdProspecting60d = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Prospecting', defaultPipelineId],
      )
    ).rows[0].id;
    const dealResult = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, close_date, owner_id, pipeline_id, pipeline_stage_id) VALUES ('Trend Deal 60d', 'Prospecting', NOW()::date, $1, $2, $3) RETURNING id`,
      [repId, defaultPipelineId, stageIdProspecting60d],
    );
    const dealId = dealResult.rows[0].id;

    const enteredAt = new Date();
    enteredAt.setDate(enteredAt.getDate() - 10);
    await insertDealStageEntry(dealId, 'Prospecting', enteredAt.toISOString());

    const report = await getStageTrendReport(60);
    if (report.dataPoints.length > 0) {
      // Monthly bucket period should be the start of the month (day = '01')
      const period = report.dataPoints[0].period;
      expect(period).toMatch(/^\d{4}-\d{2}-01$/);
    }
  });
});

// ── Historical exchange rate conversion (MINCRM-526) ─────────────────────────
//
// Verifies that getWinLossReport uses the exchange rate that was in effect at
// the deal's close_date, not the current rate. This is the core correctness
// guarantee of the currency_rate_history feature.

describe('getWinLossReport — historical exchange rate conversion', () => {
  /** Looks up the pipeline_stage_id for a given stage name */
  async function stageId(name: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
      [name, defaultPipelineId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Stage not found: ${name}`);
    return row.id;
  }

  it('uses the historical rate at close_date, not the current rate', async () => {
    // Set up EUR at 0.90 on 2024-01-01 (the "historical" rate)
    await pool.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home, updated_at)
       VALUES ('EUR', 'Euro', '€', 0.90, false, now())
       ON CONFLICT (code) DO UPDATE
         SET rate_to_home = EXCLUDED.rate_to_home, updated_at = now()`,
    );
    // Snapshot the 0.90 rate as effective from 2024-01-01 (before the deal closed)
    await pool.query(
      `INSERT INTO currency_rate_history (code, rate_to_home, effective_from)
       VALUES ('EUR', 0.90, '2024-01-01T00:00:00Z')`,
    );
    // Now "update" EUR to 1.10 as of 2025-06-01 (after the deal closed)
    await pool.query(
      `INSERT INTO currency_rate_history (code, rate_to_home, effective_from)
       VALUES ('EUR', 1.10, '2025-06-01T00:00:00Z')`,
    );
    await pool.query(`UPDATE currencies SET rate_to_home = 1.10 WHERE code = 'EUR'`);

    // Deal closed on 2025-01-15 (after the 0.90 snapshot, before the 1.10 update)
    const wonStageId = await stageId('Closed Won');
    await pool.query(
      `INSERT INTO deals (name, stage, value, currency, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('EUR Historical Deal', 'Closed Won', 100000, 'EUR', '2025-01-15', $1, $2, $3)`,
      [repId, defaultPipelineId, wonStageId],
    );

    const report = await getWinLossReport({
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      ownerId: repId,
    });

    // At close_date 2025-01-15, the effective rate was 0.90 (effective_from 2024-01-01,
    // which is the latest snapshot <= 2025-01-15). The 1.10 snapshot (2025-06-01) is after close.
    // converted_won_value = 100000 * 0.90 = 90000
    expect(report.convertedWonValue).not.toBeNull();
    const converted = parseFloat(report.convertedWonValue!);
    expect(converted).toBeCloseTo(90000, 0);
  });

  it('falls back to the current rate when no history predates the close_date', async () => {
    // EUR exists at current rate 0.85 but has no history row before the deal's close_date
    await pool.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home, updated_at)
       VALUES ('EUR', 'Euro', '€', 0.85, false, now())
       ON CONFLICT (code) DO UPDATE
         SET rate_to_home = EXCLUDED.rate_to_home, updated_at = now()`,
    );

    const wonStageId = await stageId('Closed Won');
    await pool.query(
      `INSERT INTO deals (name, stage, value, currency, close_date, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('EUR No-History Deal', 'Closed Won', 50000, 'EUR', '2025-03-01', $1, $2, $3)`,
      [repId, defaultPipelineId, wonStageId],
    );

    const report = await getWinLossReport({
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      ownerId: repId,
    });

    // No history row predates 2025-03-01, so falls back to current rate 0.85
    // converted_won_value = 50000 * 0.85 = 42500
    expect(report.convertedWonValue).not.toBeNull();
    const converted = parseFloat(report.convertedWonValue!);
    expect(converted).toBeCloseTo(42500, 0);
  });
});

// ── Leads Summary Report (MINCRM-424) ────────────────────────────────────────

describe('getLeadsSummaryReport — empty state', () => {
  it('returns all statuses at zero count when there are no leads', async () => {
    const report = await getLeadsSummaryReport({ ownerId: repId });
    expect(report.total).toBe(0);
    expect(report.rows).toEqual([
      { status: 'New', count: 0 },
      { status: 'Contacted', count: 0 },
      { status: 'Qualified', count: 0 },
      { status: 'Disqualified', count: 0 },
    ]);
  });
});

describe('getLeadsSummaryReport — counts by status', () => {
  it('counts each lead status correctly for a single owner', async () => {
    await pool.query(
      `INSERT INTO leads (first_name, email, status, owner_id)
       VALUES
         ('New1', $1, 'New', $2),
         ('New2', $3, 'New', $2),
         ('Contacted1', $4, 'Contacted', $2),
         ('Qualified1', $5, 'Qualified', $2)`,
      [
        `${FILE_PREFIX}-lead-new1@example.com`,
        repId,
        `${FILE_PREFIX}-lead-new2@example.com`,
        `${FILE_PREFIX}-lead-contacted1@example.com`,
        `${FILE_PREFIX}-lead-qualified1@example.com`,
      ],
    );

    const report = await getLeadsSummaryReport({ ownerId: repId });
    expect(report.total).toBe(4);
    const byStatus = Object.fromEntries(report.rows.map((r) => [r.status, r.count]));
    expect(byStatus['New']).toBe(2);
    expect(byStatus['Contacted']).toBe(1);
    expect(byStatus['Qualified']).toBe(1);
    expect(byStatus['Disqualified']).toBe(0);
  });

  it('returns rows in LEAD_STATUSES order regardless of insertion order', async () => {
    await pool.query(
      `INSERT INTO leads (first_name, email, status, owner_id)
       VALUES ('Disq', $1, 'Disqualified', $2)`,
      [`${FILE_PREFIX}-lead-disq@example.com`, repId],
    );
    const report = await getLeadsSummaryReport({ ownerId: repId });
    expect(report.rows.map((r) => r.status)).toEqual([
      'New',
      'Contacted',
      'Qualified',
      'Disqualified',
    ]);
  });
});

describe('getLeadsSummaryReport — owner scoping', () => {
  it('scopes to a single owner when ownerId is provided', async () => {
    await pool.query(
      `INSERT INTO leads (first_name, email, status, owner_id)
       VALUES
         ('Mine', $1, 'New', $2),
         ('Theirs', $3, 'New', $4)`,
      [
        `${FILE_PREFIX}-lead-mine@example.com`,
        repId,
        `${FILE_PREFIX}-lead-theirs@example.com`,
        otherRepId,
      ],
    );
    const report = await getLeadsSummaryReport({ ownerId: repId });
    expect(report.total).toBe(1);
  });

  it('returns team-wide data when ownerId is null', async () => {
    // getLeadsSummaryReport only returns aggregate counts-by-status, not
    // individual lead rows, so we can't assert "the report includes lead X"
    // directly against its output. ownerId: null also deliberately queries
    // every lead in the database, so an exact or delta total is vulnerable to
    // other test files inserting/deleting leads concurrently in the shared
    // test DB. Instead: verify by identity against the leads table itself
    // (unique emails make this collision-proof regardless of concurrent
    // activity), and only assert the report's total is at least the two rows
    // this test just created — a weak bound that holds no matter what else
    // is happening, but still confirms ownerId: null isn't owner-filtering.
    const mineEmail = `${FILE_PREFIX}-lead-mine2@example.com`;
    const theirsEmail = `${FILE_PREFIX}-lead-theirs2@example.com`;

    await pool.query(
      `INSERT INTO leads (first_name, email, status, owner_id)
       VALUES
         ('Mine', $1, 'New', $2),
         ('Theirs', $3, 'New', $4)`,
      [mineEmail, repId, theirsEmail, otherRepId],
    );

    const insertedRows = await pool.query<{ email: string; owner_id: string; status: string }>(
      `SELECT email, owner_id, status FROM leads WHERE email IN ($1, $2)`,
      [mineEmail, theirsEmail],
    );
    expect(insertedRows.rows).toHaveLength(2);
    expect(insertedRows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: mineEmail, owner_id: repId, status: 'New' }),
        expect.objectContaining({ email: theirsEmail, owner_id: otherRepId, status: 'New' }),
      ]),
    );

    const report = await getLeadsSummaryReport({ ownerId: null });
    expect(report.total).toBeGreaterThanOrEqual(2);
  });
});

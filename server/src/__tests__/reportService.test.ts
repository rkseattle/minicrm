/**
 * Integration tests for reportService.
 *
 * Runs against a real PostgreSQL test database.
 * Two test users are created in beforeAll and reused across tests.
 * The deals table is truncated before each test.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import { getWinLossReport } from '../services/reportService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

/** Rep user fixture */
const REP_USER = {
  email: 'report-rep@example.com',
  name: 'Report Rep',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Another rep — used to verify admin sees both users' data */
const OTHER_REP_USER = {
  email: 'report-other@example.com',
  name: 'Report Other',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let repId: string;
let otherRepId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [
    [REP_USER.email, OTHER_REP_USER.email],
  ]);

  const rep = await createUser(REP_USER);
  repId = rep.id;

  const other = await createUser(OTHER_REP_USER);
  otherRepId = other.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
});

afterAll(async () => {
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [
    [REP_USER.email, OTHER_REP_USER.email],
  ]);
  await pool.end();
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
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('Open deal', 'Prospecting', 10000, '2025-06-01', $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(0);
    expect(report.lostCount).toBe(0);
  });
});

// ── Won/lost counts and values ────────────────────────────────────────────────

describe('getWinLossReport — counts and values', () => {
  it('counts Closed Won and Closed Lost deals separately', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('Won A', 'Closed Won',  50000, '2025-03-15', $1),
              ('Won B', 'Closed Won',  30000, '2025-06-01', $1),
              ('Lost A', 'Closed Lost', 20000, '2025-04-10', $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(2);
    expect(parseFloat(report.wonValue)).toBe(80000);
    expect(report.lostCount).toBe(1);
    expect(parseFloat(report.lostValue)).toBe(20000);
  });

  it('treats null deal value as zero in sums', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('Won no value', 'Closed Won', NULL, '2025-05-01', $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(1);
    expect(report.wonValue).toBe('0');
  });
});

// ── Win rate ──────────────────────────────────────────────────────────────────

describe('getWinLossReport — win rate', () => {
  it('computes win rate as wonCount / totalClosed', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('Won', 'Closed Won',  10000, '2025-01-15', $1),
              ('Won 2', 'Closed Won', 10000, '2025-02-15', $1),
              ('Lost', 'Closed Lost', 5000, '2025-03-15', $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    // 2 won / 3 total = 0.666...
    expect(report.winRate).toBeCloseTo(2 / 3, 5);
  });

  it('returns winRate of 1 when all closed deals are Won', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('Won only', 'Closed Won', 10000, '2025-07-01', $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.winRate).toBe(1);
  });

  it('returns winRate of 0 when all closed deals are Lost', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('Lost only', 'Closed Lost', 10000, '2025-08-01', $1)`,
      [repId],
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
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('In range',   'Closed Won',  10000, '2025-06-15', $1),
              ('Before',     'Closed Won',  20000, '2025-05-31', $1),
              ('After',      'Closed Won',  30000, '2025-07-01', $1),
              ('Start edge', 'Closed Won',   5000, '2025-06-01', $1),
              ('End edge',   'Closed Won',   5000, '2025-06-30', $1)`,
      [repId],
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
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('Outside', 'Closed Won', 10000, '2024-12-31', $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(0);
  });

  it('excludes deals with null close_date', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('No close date', 'Closed Won', 10000, NULL, $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(0);
  });
});

// ── Owner scoping ─────────────────────────────────────────────────────────────

describe('getWinLossReport — owner scoping', () => {
  it('scopes results to the given owner when ownerId is provided', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('Rep Won',   'Closed Won',  10000, '2025-06-01', $1),
              ('Other Won', 'Closed Won',  20000, '2025-06-01', $2)`,
      [repId, otherRepId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.wonCount).toBe(1);
    expect(parseFloat(report.wonValue)).toBe(10000);
  });

  it('returns team-wide data when ownerId is null (admin)', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, value, close_date, owner_id)
       VALUES ('Rep Won',   'Closed Won',  10000, '2025-06-01', $1),
              ('Other Won', 'Closed Won',  20000, '2025-06-01', $2)`,
      [repId, otherRepId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: null });
    expect(report.wonCount).toBe(2);
    expect(parseFloat(report.wonValue)).toBe(30000);
  });
});

// ── Loss reason breakdown ─────────────────────────────────────────────────────

describe('getWinLossReport — loss reason breakdown', () => {
  it('returns loss reasons sorted by count descending', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, loss_reason, close_date, owner_id)
       VALUES ('Lost 1', 'Closed Lost', 'Price too high',      '2025-01-15', $1),
              ('Lost 2', 'Closed Lost', 'Price too high',      '2025-02-15', $1),
              ('Lost 3', 'Closed Lost', 'Lost to competitor',  '2025-03-15', $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.lossReasonBreakdown).toHaveLength(2);
    expect(report.lossReasonBreakdown[0].reason).toBe('Price too high');
    expect(report.lossReasonBreakdown[0].count).toBe(2);
    expect(report.lossReasonBreakdown[1].reason).toBe('Lost to competitor');
    expect(report.lossReasonBreakdown[1].count).toBe(1);
  });

  it('excludes Closed Lost deals with null or empty loss_reason', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, loss_reason, close_date, owner_id)
       VALUES ('Lost null',  'Closed Lost', NULL, '2025-04-01', $1),
              ('Lost empty', 'Closed Lost', '',   '2025-04-02', $1),
              ('Lost real',  'Closed Lost', 'No budget', '2025-04-03', $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.lossReasonBreakdown).toHaveLength(1);
    expect(report.lossReasonBreakdown[0].reason).toBe('No budget');
  });

  it('returns empty breakdown when no loss reasons were captured', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, close_date, owner_id)
       VALUES ('Lost no reason', 'Closed Lost', '2025-05-01', $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.lossReasonBreakdown).toHaveLength(0);
  });

  it('does not include Closed Won deals in the loss reason breakdown', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, loss_reason, close_date, owner_id)
       VALUES ('Won with reason', 'Closed Won', 'Some reason', '2025-06-01', $1)`,
      [repId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.lossReasonBreakdown).toHaveLength(0);
  });

  it('scopes loss reasons to the given owner', async () => {
    await pool.query(
      `INSERT INTO deals (name, stage, loss_reason, close_date, owner_id)
       VALUES ('Rep lost',   'Closed Lost', 'Price',      '2025-07-01', $1),
              ('Other lost', 'Closed Lost', 'Competitor', '2025-07-01', $2)`,
      [repId, otherRepId],
    );
    const report = await getWinLossReport({ ...RANGE, ownerId: repId });
    expect(report.lossReasonBreakdown).toHaveLength(1);
    expect(report.lossReasonBreakdown[0].reason).toBe('Price');
  });
});

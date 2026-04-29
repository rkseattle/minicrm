/**
 * Tests for currency conversion in getDashboardSummary and getWinLossReport.
 *
 * Verifies that converted pipeline values and win/loss totals are computed
 * correctly when exchange rates are configured in the currencies table.
 * Implements MINCRM-253.
 *
 * Uses the real minicrm_test PostgreSQL database — no mocked pool.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { getDashboardSummary } from '../services/dashboardService.js';
import { getWinLossReport } from '../services/reportService.js';

const FILE_PREFIX = 'currency-conv';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;
const CONTACT_EMAIL = `${FILE_PREFIX}-contact@example.com`;

let repId: string;
let contactId: string;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Clean up any leftover data from prior runs
  await pool.query('DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email = $1)', [
    REP_EMAIL,
  ]);
  await pool.query('DELETE FROM contacts WHERE email = $1', [CONTACT_EMAIL]);
  await pool.query('DELETE FROM users WHERE email = $1', [REP_EMAIL]);

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Conversion Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Conversion', 'Contact', $1, $2)
     RETURNING id`,
    [CONTACT_EMAIL, repId],
  );
  contactId = contactResult.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM deals WHERE owner_id = $1', [repId]);
  await pool.query('DELETE FROM contacts WHERE email = $1', [CONTACT_EMAIL]);
  await pool.query('DELETE FROM users WHERE email = $1', [REP_EMAIL]);
  // Restore baseline currencies state (USD home, no non-home rows)
  await pool.query('DELETE FROM currencies');
  await pool.query(
    `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
     VALUES ('USD', 'US Dollar', '$', 1.000000, true)`,
  );
});

beforeEach(async () => {
  // Reset deals and currencies to a clean state before each test
  await pool.query('DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id = $1)', [repId]);
  await pool.query('DELETE FROM deals WHERE owner_id = $1', [repId]);
  await pool.query('DELETE FROM currencies');
  await pool.query(
    `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
     VALUES ('USD', 'US Dollar', '$', 1.000000, true)`,
  );
});

// ---------------------------------------------------------------------------
// Helper: insert an open deal
// ---------------------------------------------------------------------------

async function insertOpenDeal(opts: {
  value: number;
  currency: string;
  probability?: number;
  stage?: string;
}): Promise<void> {
  const stage = opts.stage ?? 'Prospecting';
  await pool.query(
    `INSERT INTO deals (name, stage, value, currency, probability, close_date, owner_id)
     VALUES ($1, $2, $3, $4, $5, '2030-12-31', $6)`,
    [
      `Test Deal ${opts.currency}`,
      stage,
      opts.value,
      opts.currency,
      opts.probability ?? null,
      repId,
    ],
  );
}

// ---------------------------------------------------------------------------
// Helper: insert a closed deal
// ---------------------------------------------------------------------------

async function insertClosedDeal(opts: {
  stage: 'Closed Won' | 'Closed Lost';
  value: number;
  currency: string;
  closeDate?: string;
  lossReason?: string;
}): Promise<void> {
  const closeDate = opts.closeDate ?? '2025-01-15';
  await pool.query(
    `INSERT INTO deals (name, stage, value, currency, close_date, loss_reason, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      `Closed ${opts.currency}`,
      opts.stage,
      opts.value,
      opts.currency,
      closeDate,
      opts.lossReason ?? null,
      repId,
    ],
  );
}

// ---------------------------------------------------------------------------
// getDashboardSummary — currency conversion (MINCRM-253)
// ---------------------------------------------------------------------------

describe('getDashboardSummary — currency conversion', () => {
  it('returns hasRates=false and null converted values when no non-home rates exist', async () => {
    // No non-home currencies — USD home only
    await insertOpenDeal({ value: 50000, currency: 'USD' });

    const summary = await getDashboardSummary(repId);

    expect(summary.hasRates).toBe(false);
    expect(summary.convertedPipelineValue).toBeNull();
    expect(summary.convertedWeightedPipelineValue).toBeNull();
  });

  it('returns converted totals in home currency when all deal currencies have rates', async () => {
    // Configure GBP as home, USD as non-home (1 GBP = 1.27 USD, so 1 USD = 1/1.27 GBP)
    // Simpler: home = USD, EUR non-home with rate 1.10 (1 EUR = 1.10 USD)
    await pool.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
       VALUES ('EUR', 'Euro', '€', 1.10, false)`,
    );

    // USD deal: $10,000 — USD is home so rate is 1.0
    await insertOpenDeal({ value: 10000, currency: 'USD' });
    // EUR deal: €5,000 — converts to $5,500 at rate 1.10
    await insertOpenDeal({ value: 5000, currency: 'EUR' });

    const summary = await getDashboardSummary(repId);

    expect(summary.hasRates).toBe(true);
    expect(summary.homeCurrency).toBe('USD');
    expect(summary.unratedCount).toBe(0);

    // Converted pipeline: 10,000 (USD) + 5,000 * 1.10 (EUR) = 15,500
    expect(summary.convertedPipelineValue).not.toBeNull();
    const convertedValue = parseFloat(summary.convertedPipelineValue!);
    expect(convertedValue).toBeCloseTo(15500, 1);
  });

  it('returns unratedCount > 0 when some deal currencies have no configured rate', async () => {
    // EUR has a rate, GBP does not
    await pool.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
       VALUES ('EUR', 'Euro', '€', 1.10, false)`,
    );

    await insertOpenDeal({ value: 5000, currency: 'EUR' });
    await insertOpenDeal({ value: 3000, currency: 'GBP' }); // no rate in currencies table

    const summary = await getDashboardSummary(repId);

    expect(summary.hasRates).toBe(true); // EUR has a rate
    expect(summary.unratedCount).toBe(1); // GBP has no rate
    // Converted value should only include EUR (GBP excluded via CASE WHEN)
    expect(summary.convertedPipelineValue).not.toBeNull();
    const convertedValue = parseFloat(summary.convertedPipelineValue!);
    // EUR: 5,000 * 1.10 = 5,500
    expect(convertedValue).toBeCloseTo(5500, 1);
  });

  it('returns hasRates=true and populated homeCurrency when rates table has non-home rows', async () => {
    await pool.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
       VALUES ('EUR', 'Euro', '€', 1.10, false)`,
    );

    const summary = await getDashboardSummary(null); // admin (team-wide)

    expect(summary.hasRates).toBe(true);
    expect(summary.homeCurrency).toBe('USD');
    expect(summary.homeSymbol).toBe('$');
  });
});

// ---------------------------------------------------------------------------
// getWinLossReport — currency conversion (MINCRM-253)
// ---------------------------------------------------------------------------

const DATE_RANGE = { startDate: '2025-01-01', endDate: '2025-12-31' };

describe('getWinLossReport — currency conversion', () => {
  it('returns hasRates=false and null converted values when no non-home rates exist', async () => {
    await insertClosedDeal({ stage: 'Closed Won', value: 50000, currency: 'USD' });

    const report = await getWinLossReport({ ...DATE_RANGE, ownerId: repId });

    expect(report.hasRates).toBe(false);
    expect(report.convertedWonValue).toBeNull();
    expect(report.convertedLostValue).toBeNull();
  });

  it('returns converted won and lost totals when all currencies have rates', async () => {
    await pool.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
       VALUES ('EUR', 'Euro', '€', 1.10, false)`,
    );

    // Won: $20,000 USD + €10,000 EUR (€ * 1.10 = $11,000)
    await insertClosedDeal({ stage: 'Closed Won', value: 20000, currency: 'USD' });
    await insertClosedDeal({ stage: 'Closed Won', value: 10000, currency: 'EUR' });

    // Lost: €5,000 EUR (€ * 1.10 = $5,500)
    await insertClosedDeal({
      stage: 'Closed Lost',
      value: 5000,
      currency: 'EUR',
      lossReason: 'Price',
    });

    const report = await getWinLossReport({ ...DATE_RANGE, ownerId: repId });

    expect(report.hasRates).toBe(true);
    expect(report.wonCount).toBe(2);
    expect(report.lostCount).toBe(1);

    expect(report.convertedWonValue).not.toBeNull();
    const convertedWon = parseFloat(report.convertedWonValue!);
    // 20,000 (USD * 1.0) + 10,000 * 1.10 (EUR) = 31,000
    expect(convertedWon).toBeCloseTo(31000, 1);

    expect(report.convertedLostValue).not.toBeNull();
    const convertedLost = parseFloat(report.convertedLostValue!);
    // 5,000 * 1.10 (EUR) = 5,500
    expect(convertedLost).toBeCloseTo(5500, 1);

    expect(report.homeCurrency).toBe('USD');
    expect(report.homeSymbol).toBe('$');
  });

  it('returns unratedCount > 0 when some deal currencies are missing rates', async () => {
    await pool.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
       VALUES ('EUR', 'Euro', '€', 1.10, false)`,
    );

    await insertClosedDeal({ stage: 'Closed Won', value: 10000, currency: 'EUR' });
    await insertClosedDeal({ stage: 'Closed Won', value: 8000, currency: 'GBP' }); // no rate

    const report = await getWinLossReport({ ...DATE_RANGE, ownerId: repId });

    expect(report.hasRates).toBe(true);
    expect(report.unratedCount).toBe(1); // GBP has no rate
    expect(report.convertedWonValue).not.toBeNull();
    // Only EUR contributes to converted total: 10,000 * 1.10 = 11,000
    const convertedWon = parseFloat(report.convertedWonValue!);
    expect(convertedWon).toBeCloseTo(11000, 1);
  });

  it('returns winRate correctly alongside conversion data', async () => {
    await pool.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
       VALUES ('EUR', 'Euro', '€', 1.10, false)`,
    );

    await insertClosedDeal({ stage: 'Closed Won', value: 5000, currency: 'EUR' });
    await insertClosedDeal({
      stage: 'Closed Lost',
      value: 2000,
      currency: 'EUR',
      lossReason: 'Budget',
    });

    const report = await getWinLossReport({ ...DATE_RANGE, ownerId: repId });

    // winRate = 1 won / (1 won + 1 lost) = 0.5
    expect(report.winRate).toBeCloseTo(0.5, 5);
    expect(report.ratesLastUpdated).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Verify contactId is referenced (avoids "declared but never read" lint error)
// ---------------------------------------------------------------------------

describe('setup sanity', () => {
  it('test contact was created', () => {
    expect(contactId).toBeTruthy();
  });
});

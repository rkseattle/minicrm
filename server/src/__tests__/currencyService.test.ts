/**
 * Tests for currencyService and the /api/v1/settings/currencies endpoints.
 *
 * Uses the real minicrm_test PostgreSQL database — no mocked pool.
 * Covers.
 */

import 'dotenv/config';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import app from '../app.js';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { makeAuthCookie } from './testUtils.js';
import {
  getCurrencies,
  updateCurrencies,
  getHomeCurrency,
  getRateToHome,
} from '../services/currencyService.js';

const FILE_PREFIX = 'currency-svc';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let adminCookie: string;
let repCookie: string;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Currency Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Currency Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

beforeEach(async () => {
  // Reset currencies and history tables to just the USD home row before each test
  await pool.query('DELETE FROM currency_rate_history');
  await pool.query('DELETE FROM currencies');
  await pool.query(
    `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
     VALUES ('USD', 'US Dollar', '$', 1.000000, true)`,
  );
});

// ---------------------------------------------------------------------------
// currencyService unit tests
// ---------------------------------------------------------------------------

describe('getCurrencies()', () => {
  it('returns USD as home currency after migration seed', async () => {
    const config = await getCurrencies();

    expect(config.home_currency).toBe('USD');
    expect(config.currencies).toHaveLength(1);
    const homeRow = config.currencies[0];
    expect(homeRow?.code).toBe('USD');
    expect(homeRow?.is_home).toBe(true);
    expect(homeRow?.rate_to_home).toBe(1);
  });
});

describe('updateCurrencies()', () => {
  it('replaces non-home currency set atomically', async () => {
    // Add EUR and GBP as non-home currencies
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [
          { code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.92 },
          { code: 'GBP', name: 'British Pound', symbol: '£', rate_to_home: 0.79 },
        ],
      },
      'US Dollar',
      '$',
    );

    const config = await getCurrencies();

    // Should have 3 rows: USD (home) + EUR + GBP
    expect(config.currencies).toHaveLength(3);
    const codes = config.currencies.map((c) => c.code).sort();
    expect(codes).toEqual(['EUR', 'GBP', 'USD']);

    // Verify USD remains home
    expect(config.home_currency).toBe('USD');
    const usd = config.currencies.find((c) => c.code === 'USD');
    expect(usd?.is_home).toBe(true);
    expect(usd?.rate_to_home).toBe(1);

    // Verify EUR rate
    const eur = config.currencies.find((c) => c.code === 'EUR');
    expect(eur?.rate_to_home).toBeCloseTo(0.92, 5);

    // Now replace with just CAD — EUR and GBP must be gone
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', rate_to_home: 1.36 }],
      },
      'US Dollar',
      '$',
    );

    const updated = await getCurrencies();
    const updatedCodes = updated.currencies.map((c) => c.code).sort();
    expect(updatedCodes).toEqual(['CAD', 'USD']);
  });

  it('changes home currency and sets rate_to_home = 1.000000 for the new home', async () => {
    // First add EUR as a non-home currency
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.92 }],
      },
      'US Dollar',
      '$',
    );

    // Switch home to GBP (new currency)
    await updateCurrencies(
      {
        home_currency: 'GBP',
        currencies: [
          { code: 'USD', name: 'US Dollar', symbol: '$', rate_to_home: 1.27 },
          { code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 1.16 },
        ],
      },
      'British Pound',
      '£',
    );

    const config = await getCurrencies();

    expect(config.home_currency).toBe('GBP');
    const gbp = config.currencies.find((c) => c.code === 'GBP');
    expect(gbp?.is_home).toBe(true);
    expect(gbp?.rate_to_home).toBe(1);

    // USD is now a non-home row
    const usd = config.currencies.find((c) => c.code === 'USD');
    expect(usd?.is_home).toBe(false);
    expect(usd?.rate_to_home).toBeCloseTo(1.27, 5);
  });

  it('promotes an existing non-home row to home when switching home currency', async () => {
    // Setup: USD home, EUR non-home
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.92 }],
      },
      'US Dollar',
      '$',
    );

    // Switch home to EUR (which already exists as a non-home row)
    await updateCurrencies(
      {
        home_currency: 'EUR',
        currencies: [{ code: 'USD', name: 'US Dollar', symbol: '$', rate_to_home: 1.09 }],
      },
      'Euro',
      '€',
    );

    const config = await getCurrencies();

    expect(config.home_currency).toBe('EUR');
    const eur = config.currencies.find((c) => c.code === 'EUR');
    expect(eur?.is_home).toBe(true);
    expect(eur?.rate_to_home).toBe(1);

    const usd = config.currencies.find((c) => c.code === 'USD');
    expect(usd?.is_home).toBe(false);
  });
});

describe('getHomeCurrency()', () => {
  it('returns USD from the seeded home row', async () => {
    const home = await getHomeCurrency();
    expect(home).toBe('USD');
  });

  it('returns the new home after switching', async () => {
    await updateCurrencies(
      {
        home_currency: 'EUR',
        currencies: [{ code: 'USD', name: 'US Dollar', symbol: '$', rate_to_home: 1.09 }],
      },
      'Euro',
      '€',
    );
    const home = await getHomeCurrency();
    expect(home).toBe('EUR');
  });
});

describe('getRateToHome()', () => {
  it('returns 1.0 for the home currency', async () => {
    const rate = await getRateToHome('USD');
    expect(rate).toBe(1);
  });

  it('returns the stored rate for a non-home currency', async () => {
    await pool.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
       VALUES ('EUR', 'Euro', '€', 0.920000, false)`,
    );
    const rate = await getRateToHome('EUR');
    expect(rate).toBeCloseTo(0.92, 5);
  });

  it('returns null when the currency is not in the table', async () => {
    const rate = await getRateToHome('XYZ');
    expect(rate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Controller / HTTP tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/settings/currencies', () => {
  it('returns 200 with home_currency and currencies array for admin', async () => {
    const res = await request(app).get('/api/v1/settings/currencies').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.home_currency).toBe('USD');
    expect(Array.isArray(res.body.currencies)).toBe(true);
    expect(res.body.currencies.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 200 for an authenticated rep', async () => {
    const res = await request(app).get('/api/v1/settings/currencies').set('Cookie', repCookie);
    expect(res.status).toBe(200);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/settings/currencies');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/v1/settings/currencies', () => {
  it('returns 200 and updates the currency configuration for admin', async () => {
    const payload = {
      home_currency: 'USD',
      currencies: [
        { code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.92 },
        { code: 'GBP', name: 'British Pound', symbol: '£', rate_to_home: 0.79 },
      ],
    };

    const res = await request(app)
      .put('/api/v1/settings/currencies')
      .set('Cookie', adminCookie)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.home_currency).toBe('USD');
    const codes = (res.body.currencies as Array<{ code: string }>).map((c) => c.code).sort();
    expect(codes).toContain('EUR');
    expect(codes).toContain('GBP');
    expect(codes).toContain('USD');
  });

  it('returns 403 when a rep attempts to update', async () => {
    const res = await request(app)
      .put('/api/v1/settings/currencies')
      .set('Cookie', repCookie)
      .send({
        home_currency: 'USD',
        currencies: [],
      });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .put('/api/v1/settings/currencies')
      .send({ home_currency: 'USD', currencies: [] });

    expect(res.status).toBe(401);
  });

  it('returns 400 when home_currency appears in currencies array', async () => {
    const res = await request(app)
      .put('/api/v1/settings/currencies')
      .set('Cookie', adminCookie)
      .send({
        home_currency: 'USD',
        currencies: [{ code: 'USD', name: 'US Dollar', symbol: '$', rate_to_home: 1.0 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when currency codes are not distinct', async () => {
    const res = await request(app)
      .put('/api/v1/settings/currencies')
      .set('Cookie', adminCookie)
      .send({
        home_currency: 'USD',
        currencies: [
          { code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.92 },
          { code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.91 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when rate_to_home is zero or negative', async () => {
    const res = await request(app)
      .put('/api/v1/settings/currencies')
      .set('Cookie', adminCookie)
      .send({
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: -1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// currency_rate_history snapshot tests
// ---------------------------------------------------------------------------

describe('updateCurrencies() — currency_rate_history snapshots', () => {
  it('writes a history row capturing the previous rate when a currency is updated', async () => {
    // First call: establish EUR at 0.92
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.92 }],
      },
      'US Dollar',
      '$',
    );

    // Second call: update EUR to 0.88 — should snapshot the 0.92 rate
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.88 }],
      },
      'US Dollar',
      '$',
    );

    const history = await pool.query<{ code: string; rate_to_home: string }>(
      `SELECT code, rate_to_home::float8 AS rate_to_home
       FROM currency_rate_history
       WHERE code = 'EUR'
       ORDER BY effective_from DESC`,
    );
    expect(history.rows.length).toBeGreaterThanOrEqual(1);
    expect(history.rows[0]?.rate_to_home).toBeCloseTo(0.92, 5);
  });

  it('does not write a history row for a brand-new currency (no prior rate to snapshot)', async () => {
    // First-ever call with GBP — no existing row to snapshot
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'GBP', name: 'British Pound', symbol: '£', rate_to_home: 0.79 }],
      },
      'US Dollar',
      '$',
    );

    const history = await pool.query(`SELECT * FROM currency_rate_history WHERE code = 'GBP'`);
    expect(history.rows).toHaveLength(0);
  });

  it('does not write a history row when a currency rate is unchanged on re-save', async () => {
    // Establish EUR at 0.92
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.92 }],
      },
      'US Dollar',
      '$',
    );
    // Re-save with the same EUR rate — no new history row should be written
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.92 }],
      },
      'US Dollar',
      '$',
    );

    const history = await pool.query(`SELECT * FROM currency_rate_history WHERE code = 'EUR'`);
    expect(history.rows).toHaveLength(0);
  });

  it('preserves history for a deleted currency after it is removed (no CASCADE)', async () => {
    // Establish EUR at 0.92, then update to 0.88 to generate a history row
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.92 }],
      },
      'US Dollar',
      '$',
    );
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.88 }],
      },
      'US Dollar',
      '$',
    );

    // Now remove EUR entirely — its history row must survive the DELETE
    await updateCurrencies({ home_currency: 'USD', currencies: [] }, 'US Dollar', '$');

    const currencyRow = await pool.query(`SELECT * FROM currencies WHERE code = 'EUR'`);
    expect(currencyRow.rows).toHaveLength(0); // currency deleted

    const history = await pool.query(`SELECT * FROM currency_rate_history WHERE code = 'EUR'`);
    expect(history.rows.length).toBeGreaterThanOrEqual(1); // history survives
  });

  it('accumulates multiple history rows across successive rate changes', async () => {
    // Establish EUR at 0.90
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.9 }],
      },
      'US Dollar',
      '$',
    );
    // Update EUR to 0.85 — snapshot 0.90
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.85 }],
      },
      'US Dollar',
      '$',
    );
    // Update EUR to 0.80 — snapshot 0.85
    await updateCurrencies(
      {
        home_currency: 'USD',
        currencies: [{ code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 0.8 }],
      },
      'US Dollar',
      '$',
    );

    const history = await pool.query<{ rate_to_home: string }>(
      `SELECT rate_to_home::float8 AS rate_to_home
       FROM currency_rate_history
       WHERE code = 'EUR'
       ORDER BY effective_from ASC`,
    );
    expect(history.rows).toHaveLength(2);
    expect(history.rows[0]?.rate_to_home).toBeCloseTo(0.9, 5);
    expect(history.rows[1]?.rate_to_home).toBeCloseTo(0.85, 5);
  });
});

/**
 * Currency service — all DB access for the currencies table. (MINCRM-251)
 *
 * Provides functions to read and update exchange rates.
 * All write operations use explicit transactions for atomicity.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CurrencyConfig,
  UpdateCurrenciesInput,
} from '@minicrm/shared/schemas/settingsSchema.js';

/** Raw row shape returned by PostgreSQL for the currencies table */
interface CurrencyDbRow {
  code: string;
  name: string;
  symbol: string;
  rate_to_home: string;
  is_home: boolean;
  updated_at: string;
}

/**
 * Returns the full currency configuration: home currency code and all rows ordered by code.
 *
 * @returns CurrencyConfig with home_currency and all currencies array
 */
export async function getCurrencies(): Promise<CurrencyConfig> {
  const result = await pool.query<CurrencyDbRow>(
    `SELECT code, name, symbol, rate_to_home::float8 AS rate_to_home, is_home, updated_at
     FROM currencies
     ORDER BY is_home DESC, code ASC`,
  );
  const homeRow = result.rows.find((r) => r.is_home);
  return {
    home_currency: homeRow?.code ?? 'USD',
    currencies: result.rows.map((r) => ({
      code: r.code,
      name: r.name,
      symbol: r.symbol,
      rate_to_home: parseFloat(r.rate_to_home),
      is_home: r.is_home,
      updated_at: r.updated_at,
    })),
  };
}

/**
 * Atomically replaces the non-home currency set and promotes the specified
 * home currency. The home currency row always has rate_to_home = 1.000000.
 *
 * @param config      - Validated input with home_currency and non-home currencies
 * @param homeName    - Display name for the home currency row
 * @param homeSymbol  - Symbol for the home currency row
 */
export async function updateCurrencies(
  config: UpdateCurrenciesInput,
  homeName: string,
  homeSymbol: string,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: Snapshot all current non-home rates BEFORE any deletes or updates.
    // This must run first so that currencies removed in Step 2 still have their last
    // known rate preserved in history. Home-currency rows (rate always 1.0) are
    // excluded — their rate is a definitional constant, not a meaningful exchange rate.
    // (MINCRM-526)
    await client.query(
      `INSERT INTO currency_rate_history (code, rate_to_home, effective_from)
       SELECT code, rate_to_home, now() FROM currencies WHERE is_home = false`,
    );

    // Step 2: Demote any existing home row (so we have no is_home constraint issues)
    await client.query('UPDATE currencies SET is_home = false WHERE is_home = true');

    // Step 3: Remove currencies that are not in the new non-home set and are not the new home
    const newNonHomeCodes = config.currencies.map((c) => c.code);
    const codesToKeep = [...newNonHomeCodes, config.home_currency];
    if (codesToKeep.length > 0) {
      await client.query('DELETE FROM currencies WHERE code <> ALL($1::varchar[])', [codesToKeep]);
    } else {
      await client.query('DELETE FROM currencies');
    }

    // Step 4: Upsert each new non-home currency
    for (const currency of config.currencies) {
      await client.query(
        `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home, updated_at)
         VALUES ($1, $2, $3, $4, false, now())
         ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name,
               symbol = EXCLUDED.symbol,
               rate_to_home = EXCLUDED.rate_to_home,
               is_home = false,
               updated_at = now()`,
        [currency.code, currency.name, currency.symbol, currency.rate_to_home],
      );
    }

    // Step 5: Upsert the home currency row (rate always 1.000000, is_home true)
    await client.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home, updated_at)
       VALUES ($1, $2, $3, 1.000000, true, now())
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             symbol = EXCLUDED.symbol,
             rate_to_home = 1.000000,
             is_home = true,
             updated_at = now()`,
      [config.home_currency, homeName, homeSymbol],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns the code of the current home currency.
 * Falls back to 'USD' when the currencies table is empty.
 *
 * @returns ISO 4217 currency code string
 */
export async function getHomeCurrency(): Promise<string> {
  const result = await pool.query<{ code: string }>(
    'SELECT code FROM currencies WHERE is_home = true LIMIT 1',
  );
  return result.rows[0]?.code ?? 'USD';
}

/**
 * Returns the rate_to_home for the given currency code, or null when the
 * currency is not found in the currencies table.
 *
 * @param currencyCode - ISO 4217 code to look up
 * @returns Numeric rate, or null when not found
 */
export async function getRateToHome(currencyCode: string): Promise<number | null> {
  const result = await pool.query<{ rate_to_home: string }>(
    'SELECT rate_to_home FROM currencies WHERE code = $1 LIMIT 1',
    [currencyCode],
  );
  if (!result.rows[0]) return null;
  return parseFloat(result.rows[0].rate_to_home);
}

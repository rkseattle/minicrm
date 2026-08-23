/**
 * Unit tests for the shared database liveness probe.
 *
 * The pool is faked so these tests do not require a live database. They assert
 * the probe's observable contract: it never leaves session state behind on the
 * connection it borrows, and it always releases that connection.
 */

import { vi, describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { probeDatabase } from '../services/dbHealthProbe.js';

/**
 * A fake pooled connection that models the one behavior that matters here:
 * PostgreSQL session state survives release, because pg-pool does not reset it.
 */
function createFakePool(options: { failOn?: string } = {}) {
  const sessionState = { statementTimeout: '30s' };
  let inTransaction = false;

  const client = {
    query: vi.fn(async (sql: string) => {
      if (options.failOn && sql.includes(options.failOn)) {
        throw new Error('probe failure');
      }
      if (/\bBEGIN\b/i.test(sql)) inTransaction = true;
      const setLocal = sql.match(/SET\s+LOCAL\s+statement_timeout\s*=\s*'?(\w+)'?/i);
      const bareSet = sql.match(/(?<!LOCAL\s)\bSET\s+statement_timeout\s*=\s*'?(\w+)'?/i);
      // SET LOCAL reverts at transaction end; a bare SET persists on the connection.
      if (setLocal && !inTransaction) sessionState.statementTimeout = setLocal[1];
      if (bareSet && !setLocal) sessionState.statementTimeout = bareSet[1];
      if (/\b(COMMIT|ROLLBACK)\b/i.test(sql)) inTransaction = false;
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };

  return { pool: { connect: async () => client } as unknown as Pool, client, sessionState };
}

describe('probeDatabase', () => {
  it('returns ok and leaves the connection at its original timeout', async () => {
    const { pool, client, sessionState } = createFakePool();

    const result = await probeDatabase(pool);

    expect(result).toEqual({ ok: true });
    // The next borrower must not inherit the probe's shorter bound.
    expect(sessionState.statementTimeout).toBe('30s');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('bounds every round trip, opening the transaction and the timeout together', async () => {
    const { pool, client } = createFakePool();

    await probeDatabase(pool);

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    const opening = statements.find((sql) => /\bBEGIN\b/i.test(sql));
    expect(opening, 'the probe must open a transaction').toBeDefined();
    // A standalone BEGIN would run under the pool's 30s default, which is the
    // window this probe exists to shorten.
    expect(opening).toMatch(/statement_timeout/i);
  });

  it('rolls back and reports the error when the probe query fails', async () => {
    const { pool, client } = createFakePool({ failOn: 'SELECT 1' });

    const result = await probeDatabase(pool);

    expect(result).toEqual({ ok: false, error: 'probe failure' });
    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('reports the error and releases nothing when the pool cannot connect', async () => {
    const pool = {
      connect: async () => {
        throw new Error('Connection refused');
      },
    } as unknown as Pool;

    const result = await probeDatabase(pool);

    expect(result).toEqual({ ok: false, error: 'Connection refused' });
  });
});

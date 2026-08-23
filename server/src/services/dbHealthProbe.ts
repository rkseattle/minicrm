/**
 * Shared database liveness probe for the health endpoints.
 *
 * Both /api/health and the coverage health report need the same check against
 * different pools, so the transaction boundary lives here and cannot drift
 * between them.
 */

import type { Pool } from 'pg';

/** Bounds the probe's round trip, well under the pools' 30s statement_timeout. */
const PROBE_TIMEOUT_MS = 2_000;

export type DbProbeResult = { ok: true } | { ok: false; error: string };

/**
 * Runs a bounded `SELECT 1` against `pool`.
 *
 * BEGIN and SET LOCAL are sent as one statement so no round trip runs unbounded:
 * a separate BEGIN would still be governed by the pool's 30s default, which is
 * the whole window this probe exists to shorten. SET LOCAL rather than SET
 * because pg-pool returns a client to the idle queue without resetting session
 * state, so a bare SET would leave the next borrower on the probe's 2s bound.
 *
 * @param pool - Connection pool to probe.
 * @returns `{ ok: true }` when the round trip succeeds, otherwise the error message.
 */
export async function probeDatabase(pool: Pool): Promise<DbProbeResult> {
  let client;
  try {
    client = await pool.connect();
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    await client.query(`BEGIN; SET LOCAL statement_timeout = '${PROBE_TIMEOUT_MS}ms';`);
    await client.query('SELECT 1');
    await client.query('COMMIT');
    return { ok: true };
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {
      // The connection is already unusable; the probe result is the error below.
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

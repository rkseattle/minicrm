/**
 * PostgreSQL connection pool.
 * All database access in the application goes through this pool.
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool, types } = pg;

// pg returns bigint (OID 20) as string by default to avoid JS number precision loss
// above 2^53. All token counts and budget limits in this app fit safely within Number.MAX_SAFE_INTEGER
// (~9 × 10^15), so we parse them as integers for consistent numeric arithmetic.
types.setTypeParser(20, (val: string) => parseInt(val, 10));

/** Default port for PostgreSQL */
const DEFAULT_DB_PORT = 5432;

/** Default maximum pool size — matches pg's own default so the value is visible in code */
const DEFAULT_POOL_MAX = 10;

/** Statement timeout in milliseconds — cancels any query running longer than this. */
const STATEMENT_TIMEOUT_MS = 30_000;

/**
 * Shared connection pool instance.
 * Reads connection parameters from environment variables.
 */
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT) || DEFAULT_DB_PORT,

  // Maximum connections to maintain in the pool.
  // Should not exceed PostgreSQL's max_connections (default 100).
  // Configurable via DB_POOL_MAX for environments with different limits.
  max: Number(process.env.DB_POOL_MAX) || DEFAULT_POOL_MAX,

  // Milliseconds a connection is held idle before being closed.
  // Balances connection reuse against server-side resource consumption.
  idleTimeoutMillis: 30_000,

  // Milliseconds to wait for a connection before throwing an error.
  // The pg default is 0, which causes requests to hang indefinitely under pool
  // exhaustion. A non-zero value causes a fast failure that the global error
  // handler converts to a 503 response.
  connectionTimeoutMillis: 5_000,

  // Sent in the PostgreSQL startup message — no separate SET query needed.
  // Avoids the pg@9 DeprecationWarning that fired when the previous connect-event
  // approach issued a fire-and-forget SET query before the client was acquired.
  statement_timeout: STATEMENT_TIMEOUT_MS,
});

pool.on('error', (err) => {
  // Rethrow fatal pool errors so the process crashes with a visible stack trace
  throw new Error(`Unexpected PostgreSQL pool error: ${err.message}`);
});

export default pool;

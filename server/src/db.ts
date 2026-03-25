/**
 * PostgreSQL connection pool.
 * All database access in the application goes through this pool.
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

/** Default port for PostgreSQL */
const DEFAULT_DB_PORT = 5432;

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
});

pool.on('error', (err) => {
  // Rethrow fatal pool errors so the process crashes with a visible stack trace
  throw new Error(`Unexpected PostgreSQL pool error: ${err.message}`);
});

export default pool;

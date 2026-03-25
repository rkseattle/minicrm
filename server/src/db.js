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
 * @type {pg.Pool}
 */
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT) || DEFAULT_DB_PORT,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
  process.exit(1);
});

export default pool;

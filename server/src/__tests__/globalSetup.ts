/**
 * Vitest global setup — runs once before all test suites.
 * Creates the test database if it doesn't exist and applies all migrations.
 *
 * DB credentials are read from .env.test via the DOTENV_CONFIG_PATH env var,
 * which must be set by the caller (the npm test scripts handle this for local
 * runs; CI injects real vars directly).
 */

import 'dotenv/config';
import { readdirSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import { runner as migrationRunner } from 'node-pg-migrate';

/** CWD is the server/ directory when running via npm test --workspace=minicrm-server */
const MIGRATIONS_DIR = resolve(process.cwd(), '../db/migrations');

export default async function globalSetup(): Promise<void> {
  const { DB_USER, DB_PASSWORD, DB_NAME, DB_HOST = 'localhost', DB_PORT = '5432' } = process.env;

  // Connect to the default postgres database to create the test DB if needed
  const adminClient = new pg.Client({
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    port: Number(DB_PORT),
    database: 'postgres',
  });

  await adminClient.connect();

  const { rows } = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    DB_NAME,
  ]);

  if (rows.length === 0) {
    // datname cannot be parameterized in CREATE DATABASE
    await adminClient.query(`CREATE DATABASE "${DB_NAME}"`);
  }

  await adminClient.end();

  // Run migrations against the test database
  const databaseUrl = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

  // Use the two-step fresh-bootstrap approach (MINCRM-528):
  // Step 1 runs only 000_baseline; step 2 fake-marks 001-101 without re-executing their SQL.
  // This prevents "relation already exists" errors on fresh CI databases where 000_baseline
  // and 001-101 would otherwise both try to CREATE TABLE.
  const SHARED_OPTIONS = {
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up' as const,
    migrationsTable: 'pgmigrations',
    checkOrder: false,
    log: () => {},
  };
  const baselineCoveredCount = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith('.js') && f !== '000_baseline.js',
  ).length;
  await migrationRunner({ ...SHARED_OPTIONS, count: 1 });
  await migrationRunner({ ...SHARED_OPTIONS, fake: true, count: baselineCoveredCount });
}

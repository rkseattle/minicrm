/**
 * Vitest global setup — runs once before all test suites.
 * Creates the test database if it doesn't exist and applies all migrations.
 *
 * DB credentials are read from .env.test via the DOTENV_CONFIG_PATH env var,
 * which must be set by the caller (the npm test scripts handle this for local
 * runs; CI injects real vars directly).
 */

import 'dotenv/config';
import pg from 'pg';
import { runner as migrationRunner } from 'node-pg-migrate';
import { MIGRATIONS_DIR, countBaselineCoveredMigrations, withMigrationLock } from '../migrate.js';

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

  // Use the same three-step fresh-bootstrap approach as runMigrations() in
  // ../migrate.ts (MINCRM-528): step 1 runs only 000_baseline; step 2 fake-marks
  // the fixed number of migrations 000_baseline was last regenerated to cover
  // (countBaselineCoveredMigrations() — NOT every file on disk, which would
  // silently skip real execution of any migration added since); step 3 runs
  // all remaining truly-pending migrations for real.
  const SHARED_OPTIONS = {
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up' as const,
    migrationsTable: 'pgmigrations',
    checkOrder: false,
    log: () => {},
  };

  // Shares the same advisory lock key as runMigrations(), create-e2e-db.ts, and
  // migrate-fresh.ts (MINCRM-658), so this bootstrap cannot interleave with a
  // concurrent migration run against the same database (e.g. a developer
  // running `npm test` while `server-e2e` is also booting against minicrm_test).
  await withMigrationLock(databaseUrl, async () => {
    await migrationRunner({ ...SHARED_OPTIONS, count: 1 });
    await migrationRunner({
      ...SHARED_OPTIONS,
      fake: true,
      count: countBaselineCoveredMigrations(),
    });
    await migrationRunner(SHARED_OPTIONS);
  });
}

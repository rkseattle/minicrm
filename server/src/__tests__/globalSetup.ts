/**
 * Vitest global setup — runs once before all test suites.
 * Creates the test database if it doesn't exist and applies all migrations,
 * for BOTH the product test database and the coverage/TIA test database
 * (see server/src/coverageDb.ts) — coverage tests (coverageModelService,
 * coverageSessionService, coverageMappingService, etc.) need
 * minicrm_coverage_test to exist and be migrated just as much as the
 * product-DB tests need minicrm_test. Missing this for the coverage
 * database reproduced as every coverage-suite test file failing with
 * `database "minicrm_coverage" does not exist` in CI (found via Greptile
 * PR review) — this file previously only provisioned the product database.
 *
 * DB credentials are read from .env.test via the DOTENV_CONFIG_PATH env var,
 * which must be set by the caller (the npm test scripts handle this for local
 * runs; CI injects real vars directly).
 */

import 'dotenv/config';
import pg from 'pg';
import { runner as migrationRunner } from 'node-pg-migrate';
import {
  MIGRATIONS_DIR,
  COVERAGE_MIGRATIONS_DIR,
  countBaselineCoveredMigrations,
  withMigrationLock,
} from '../migrate.js';
import { assertTestDatabasePort } from '../scripts/assertTestDatabaseTarget.js';

/** Creates `databaseName` (via the ambient 'postgres' maintenance database) if it doesn't already exist. */
async function ensureDatabaseExists(params: {
  user: string | undefined;
  password: string | undefined;
  host: string;
  port: number;
  databaseName: string | undefined;
}): Promise<void> {
  const adminClient = new pg.Client({
    user: params.user,
    password: params.password,
    host: params.host,
    port: params.port,
    database: 'postgres',
  });

  await adminClient.connect();
  try {
    const { rows } = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      params.databaseName,
    ]);
    if (rows.length === 0) {
      // datname cannot be parameterized in CREATE DATABASE
      await adminClient.query(`CREATE DATABASE "${params.databaseName?.replace(/"/g, '""')}"`);
    }
  } finally {
    await adminClient.end();
  }
}

export default async function globalSetup(): Promise<void> {
  // No 5432 default. This function runs CREATE DATABASE and the full migration
  // sequence, so a wrong port provisions minicrm_test on the DEV instance — the shared
  // setup that was removed. Isolation must not rest solely on .env.test carrying
  // DB_PORT: a bare `npx vitest run` (without the DOTENV_CONFIG_PATH that
  // server/package.json's `test` script sets) would otherwise silently target dev.
  // assertTestDatabasePort exempts CI, where 5432 is the only Postgres.
  const DB_PORT = assertTestDatabasePort('vitest-globalSetup');
  const { DB_USER, DB_PASSWORD, DB_NAME, DB_HOST = 'localhost' } = process.env;

  await ensureDatabaseExists({
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    port: Number(DB_PORT),
    databaseName: DB_NAME,
  });

  // Run migrations against the product test database
  const databaseUrl = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

  // Use the same three-step fresh-bootstrap approach as runMigrations() in
  // ../migrate.ts: step 1 runs only 000_baseline; step 2 fake-marks
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
  // migrate-fresh.ts, so this bootstrap cannot interleave with a
  // concurrent migration run against the same database (e.g. a developer
  // running `npm test` while the test server is also booting against minicrm_test).
  await withMigrationLock(databaseUrl, async () => {
    await migrationRunner({ ...SHARED_OPTIONS, count: 1 });
    await migrationRunner({
      ...SHARED_OPTIONS,
      fake: true,
      count: countBaselineCoveredMigrations(),
    });
    await migrationRunner(SHARED_OPTIONS);
  });

  // Same for the coverage/TIA test database — a separate database (see
  // coverageDb.ts) with its own migration sequence (qa/migrations/, no
  // baseline — starts fresh at 001), so no fake-mark bootstrap is needed
  // here, just a plain sequential run.
  const coverageDbName = process.env.COVERAGE_DB_NAME ?? 'minicrm_coverage_test';
  const coverageDbUser = process.env.COVERAGE_DB_USER ?? DB_USER;
  const coverageDbPassword = process.env.COVERAGE_DB_PASSWORD ?? DB_PASSWORD;
  const coverageDbHost = process.env.COVERAGE_DB_HOST ?? DB_HOST;
  const coverageDbPort = Number(process.env.COVERAGE_DB_PORT) || Number(DB_PORT);

  await ensureDatabaseExists({
    user: coverageDbUser,
    password: coverageDbPassword,
    host: coverageDbHost,
    port: coverageDbPort,
    databaseName: coverageDbName,
  });

  const coverageDatabaseUrl = `postgres://${coverageDbUser}:${coverageDbPassword}@${coverageDbHost}:${coverageDbPort}/${coverageDbName}`;

  await withMigrationLock(coverageDatabaseUrl, async () => {
    await migrationRunner({
      databaseUrl: coverageDatabaseUrl,
      dir: COVERAGE_MIGRATIONS_DIR,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      checkOrder: false,
      log: () => {},
    });
  });
}

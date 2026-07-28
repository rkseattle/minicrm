/**
 * create-coverage-e2e-db.ts — Create the minicrm_coverage_e2e database if it
 * does not exist, then run all coverage migrations (qa/migrations/) against
 * it.
 *
 * The coverage/TIA schema lives in its own database, separate from the
 * product schema (minicrm_e2e, migrated via server/src/scripts/create-e2e-db.ts) —
 * see qa/migrations/001_coverage_baseline.js's module docblock for why.
 * Called before the E2E suite runs locally, alongside (not instead of) the
 * product DB's own create:e2e-db script. Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run create:coverage-e2e-db --workspace=minicrm-qa
 *
 * Required environment variables:
 *   DB_USER, DB_PASSWORD, DB_HOST, DB_PORT
 */

import 'dotenv/config';
import pg from 'pg';
import { runner as migrationRunner } from 'node-pg-migrate';
import { join } from 'path';

const COVERAGE_E2E_DB_NAME = 'minicrm_coverage_e2e';

/** Host port of the dev Postgres — never a valid target for provisioning test data. */
const DEV_DB_PORT = '5432';
// __dirname, not import.meta.url — the qa workspace has no "type": "module"
// in its package.json (unlike server/), so its .ts files compile/run as
// CommonJS, where __dirname is the natural way to resolve a path relative
// to this file.
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function main(): Promise<void> {
  const dbUser = process.env.DB_USER ?? 'minicrm';
  const dbPassword = process.env.DB_PASSWORD ?? 'password';
  const dbHost = process.env.DB_HOST ?? 'localhost';
  // No 5432 fallback: provisioning the coverage database on the dev Postgres recreates
  // the shared-instance setup MINCRM-684 removed.
  //
  // Inlined rather than imported from server/src/scripts/assertTestDatabaseTarget.ts:
  // this workspace declares no dependency on server/, and adding one for a five-line
  // check would couple the QA workspace to the server build. The behaviour is
  // deliberately identical: unset or non-numeric rejected, dev port rejected off CI.
  // It is NOT unit-tested here: the qa workspace runs Playwright
  // only, with no vitest runner, so there is nowhere to put such a test without adding
  // test infrastructure to this workspace. The server-side copy is fully covered by
  // server/src/__tests__/assertTestDatabaseTarget.test.ts; keep the two in sync by hand.
  const rawDbPort = process.env.DB_PORT;
  if (!rawDbPort || !/^\d+$/.test(rawDbPort) || (rawDbPort === DEV_DB_PORT && !process.env.CI)) {
    throw new Error(
      `[create-coverage-e2e-db] REFUSING TO RUN: DB_PORT is ${rawDbPort ?? 'not set'}.\n` +
        `  It must be set, numeric, and not the dev database (${DEV_DB_PORT}).\n` +
        '  The test stack listens on 5433:\n' +
        '    docker compose -f docker-compose.test.yml up -d',
    );
  }
  const dbPort = Number(rawDbPort);

  const adminClient = new pg.Client({
    user: dbUser,
    password: dbPassword,
    host: dbHost,
    port: dbPort,
    database: 'postgres',
  });

  await adminClient.connect();

  const { rows } = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
    COVERAGE_E2E_DB_NAME,
  ]);

  if (rows.length === 0) {
    // datname cannot be parameterised in CREATE DATABASE.
    await adminClient.query(`CREATE DATABASE "${COVERAGE_E2E_DB_NAME}"`);
    console.log(`[create-coverage-e2e-db] Created database ${COVERAGE_E2E_DB_NAME}.`);
  } else {
    console.log(`[create-coverage-e2e-db] Database ${COVERAGE_E2E_DB_NAME} already exists.`);
  }

  await adminClient.end();

  console.log(`[create-coverage-e2e-db] Running migrations on ${COVERAGE_E2E_DB_NAME}...`);

  const databaseUrl = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${COVERAGE_E2E_DB_NAME}`;

  // No baseline/fake-mark bootstrap needed here (unlike the product DB's
  // create-e2e-db.ts) — the coverage schema has no 000_baseline; it starts
  // fresh at 001, so a plain sequential migration run is sufficient.
  await migrationRunner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    checkOrder: false,
    log: () => {},
  });

  console.log(`[create-coverage-e2e-db] Migrations complete on ${COVERAGE_E2E_DB_NAME}.`);
}

main().catch((err: unknown) => {
  throw err;
});

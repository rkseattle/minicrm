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
import { normalizeDbPort } from './test-stack-db-env.js';

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
  // Delegates to the shared resolver in this same workspace rather than inlining a
  // third hand-synced copy of the rule. An earlier revision inlined it, on the
  // grounds that the qa workspace had nowhere to unit-test such a check — that is
  // no longer true: qa/e2e/tests/framework/test-stack-db-env.spec.ts tests this
  // module under Playwright, with no new test infrastructure.
  //
  // The hand-synced copy is exactly how a defect survived here: the raw-string
  // comparison it carried accepted `05432`, which Number()s to 5432, so this
  // script would CREATE DATABASE on the dev Postgres. normalizeDbPort compares the
  // normalized number. (MINCRM-699)
  const rawDbPort = process.env.DB_PORT;
  if (!rawDbPort) {
    throw new Error(
      '[create-coverage-e2e-db] REFUSING TO RUN: DB_PORT is not set.\n' +
        `  It must be set, numeric, and not the dev database (${DEV_DB_PORT}).\n` +
        '  The test stack listens on 5433:\n' +
        '    docker compose -f docker-compose.test.yml up -d',
    );
  }

  let dbPort: number;
  try {
    dbPort = normalizeDbPort(rawDbPort);
  } catch {
    throw new Error(
      `[create-coverage-e2e-db] REFUSING TO RUN: DB_PORT is ${rawDbPort}.\n` +
        `  It must be set, numeric, and not the dev database (${DEV_DB_PORT}).\n` +
        '  The test stack listens on 5433:\n' +
        '    docker compose -f docker-compose.test.yml up -d',
    );
  }

  if (dbPort === Number(DEV_DB_PORT) && !process.env.CI) {
    throw new Error(
      `[create-coverage-e2e-db] REFUSING TO RUN: DB_PORT=${rawDbPort} is the dev database.\n` +
        '  Provisioning the coverage database there recreates the shared-instance setup\n' +
        '  MINCRM-684 removed. The test stack listens on 5433:\n' +
        '    docker compose -f docker-compose.test.yml up -d',
    );
  }

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

/**
 * create-e2e-db.ts — Create the minicrm_e2e database if it does not exist,
 * then run all migrations against it.
 *
 * Called by `npm run e2e:setup` (via `npm run create:e2e-db --workspace=minicrm-server`)
 * before the E2E suite runs locally. Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run create:e2e-db --workspace=minicrm-server
 *
 * Required environment variables:
 *   DB_USER, DB_PASSWORD, DB_HOST, DB_PORT
 *
 * MINCRM-330
 */

import 'dotenv/config';
import pg from 'pg';
import { runner as migrationRunner } from 'node-pg-migrate';
import { MIGRATIONS_DIR, countBaselineCoveredMigrations } from '../migrate.js';

const E2E_DB_NAME = 'minicrm_e2e';

async function main(): Promise<void> {
  const dbUser = process.env.DB_USER ?? 'minicrm';
  const dbPassword = process.env.DB_PASSWORD ?? 'password';
  const dbHost = process.env.DB_HOST ?? 'localhost';
  const dbPort = Number(process.env.DB_PORT) || 5432;

  // Connect to the postgres maintenance database to create the E2E DB if absent.
  const adminClient = new pg.Client({
    user: dbUser,
    password: dbPassword,
    host: dbHost,
    port: dbPort,
    database: 'postgres',
  });

  await adminClient.connect();

  const { rows } = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
    E2E_DB_NAME,
  ]);

  if (rows.length === 0) {
    // datname cannot be parameterised in CREATE DATABASE.
    await adminClient.query(`CREATE DATABASE "${E2E_DB_NAME}"`);
    console.log(`[create-e2e-db] Created database ${E2E_DB_NAME}.`);
  } else {
    console.log(`[create-e2e-db] Database ${E2E_DB_NAME} already exists.`);
  }

  await adminClient.end();

  // Run all pending migrations so the schema is always up-to-date.
  console.log(`[create-e2e-db] Running migrations on ${E2E_DB_NAME}...`);

  const databaseUrl = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${E2E_DB_NAME}`;

  // Use the three-step fresh-bootstrap approach (MINCRM-528): step 1 runs only
  // 000_baseline (prevents "relation already exists" on fresh databases); step 2
  // fake-marks the migrations 000_baseline was last regenerated to cover; step 3
  // runs any migrations added since then for real, so their schema changes apply.
  const SHARED_OPTIONS = {
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up' as const,
    migrationsTable: 'pgmigrations',
    checkOrder: false,
    log: () => {},
  };
  await migrationRunner({ ...SHARED_OPTIONS, count: 1 });
  await migrationRunner({
    ...SHARED_OPTIONS,
    fake: true,
    count: countBaselineCoveredMigrations(),
  });
  await migrationRunner(SHARED_OPTIONS);

  console.log(`[create-e2e-db] Migrations complete on ${E2E_DB_NAME}.`);
}

main().catch((err: unknown) => {
  throw err;
});

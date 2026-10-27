/**
 * create-e2e-db.ts — Create the minicrm_e2e_test database if it does not exist,
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
 *
 */

import 'dotenv/config';
import pg from 'pg';
import { migrateFromBaseline, productMigrationOptions } from '../migrate.js';
import { assertTestDatabasePort } from './assertTestDatabaseTarget.js';
import {
  E2E_DB_NAME,
  retiredDatabaseMessage,
  retiredNameOf,
} from '@minicrm/shared/testing/testStackDbNames.js';

async function main(): Promise<void> {
  const dbUser = process.env.DB_USER ?? 'minicrm';
  const dbPassword = process.env.DB_PASSWORD ?? 'password';
  const dbHost = process.env.DB_HOST ?? 'localhost';
  // No 5432 fallback: provisioning test databases on the dev instance recreates the
  // shared-Postgres setup this separation removed.
  const dbPort = Number(assertTestDatabasePort('create-e2e-db'));

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
    const retired = retiredNameOf(E2E_DB_NAME);
    const stale = retired
      ? await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [retired])
      : { rows: [] };
    if (retired && stale.rows.length > 0) {
      await adminClient.end();
      throw new Error(`[create-e2e-db] ${retiredDatabaseMessage(retired, E2E_DB_NAME)}`);
    }
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

  // Shares runMigrations()'s bootstrap and its advisory lock, so this script cannot
  // interleave with a concurrent server boot against the same database.
  await migrateFromBaseline(productMigrationOptions(databaseUrl, () => {}));

  console.log(`[create-e2e-db] Migrations complete on ${E2E_DB_NAME}.`);
}

main().catch((err: unknown) => {
  throw err;
});

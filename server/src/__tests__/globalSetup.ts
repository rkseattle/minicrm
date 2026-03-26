/**
 * Jest global setup — runs once before all test suites.
 * Creates the test database if it doesn't exist and applies all migrations.
 */

import 'dotenv/config';
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

  await migrationRunner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
}

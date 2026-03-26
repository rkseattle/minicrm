/**
 * Runs all pending database migrations using node-pg-migrate's programmatic API.
 * Safe to call on every startup — already-applied migrations are skipped.
 */

import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { runner as migrationRunner } from 'node-pg-migrate';
import logger from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the migrations directory */
const MIGRATIONS_DIR = resolve(__dirname, '../../db/migrations');

/**
 * Applies all pending migrations.
 */
export async function runMigrations(): Promise<void> {
  const databaseUrl = `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`;

  logger.info('Running database migrations...');

  await migrationRunner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: (msg: string) => logger.debug(msg),
  });

  logger.info('Migrations complete.');
}

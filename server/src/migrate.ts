/**
 * Runs all pending database migrations using node-pg-migrate's programmatic API.
 * Safe to call on every startup — already-applied migrations are skipped.
 *
 * Uses the two-step fresh-bootstrap strategy (MINCRM-528) so this function works
 * correctly on a brand-new database as well as an already-migrated one:
 *   1. Run count:1 — applies 000_baseline if not yet applied (no-op otherwise).
 *   2. Fake-mark the remaining baseline-covered migrations so they are never
 *      re-executed (no-op when they are already recorded in pgmigrations).
 *   3. Run all remaining truly-pending migrations for real.
 */

import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { readdirSync } from 'fs';
import { runner as migrationRunner } from 'node-pg-migrate';
import logger from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the migrations directory */
export const MIGRATIONS_DIR = resolve(__dirname, '../../db/migrations');

/**
 * Count of migration files covered by 000_baseline (every .js file except the
 * baseline itself). Used to bound the fake-mark step so post-baseline migrations
 * are not skipped.
 */
export function countBaselineCoveredMigrations(): number {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js') && f !== '000_baseline.js')
    .length;
}

export async function runMigrations(): Promise<void> {
  const databaseUrl = `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`;

  logger.info('Running database migrations...');

  const SHARED_OPTIONS = {
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up' as const,
    migrationsTable: 'pgmigrations',
    checkOrder: false, // 000_baseline was added after 001-101 on existing DBs (MINCRM-528)
    log: (msg: string) => logger.debug(msg),
  };

  // Step 1: apply 000_baseline (no-op if already applied).
  await migrationRunner({ ...SHARED_OPTIONS, count: 1 });

  // Step 2: fake-mark all baseline-covered migrations (no-op if already recorded).
  const baselineCoveredCount = countBaselineCoveredMigrations();
  await migrationRunner({ ...SHARED_OPTIONS, fake: true, count: baselineCoveredCount });

  // Step 3: run any truly-pending migrations (post-baseline) for real.
  await migrationRunner(SHARED_OPTIONS);

  logger.info('Migrations complete.');
}

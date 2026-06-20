/**
 * migrate-fresh.ts — Initialize a brand-new database using the schema baseline (MINCRM-528)
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * node-pg-migrate pre-computes the list of pending migrations before running any of them.
 * This means a migration cannot mark later migrations as "already applied" during its own
 * up() call — the runner has already decided to run them.
 *
 * To bootstrap a fresh database without replaying 107 individual migrations, this script:
 *   1. Runs ONLY `000_baseline` (count: 1) — creates the full schema via one migration
 *   2. Runs all remaining migrations with `fake: true` — records them in pgmigrations
 *      without executing their SQL (safe because the schema already contains everything
 *      those migrations would have created)
 *   3. From this point, `npm run migrate` behaves normally: only future migrations (114+)
 *      are pending and will be run for real.
 *
 * USAGE
 * -----
 *   npm run migrate:fresh --workspace=minicrm-server
 *
 * Required environment variables: DATABASE_URL
 * Optional: DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME (used as DATABASE_URL fallback)
 *
 * This script is idempotent: if 000_baseline has already been applied, step 1 is a no-op.
 * If run against a database that already has 001–101 applied, step 2 is also a no-op.
 *
 * The startup migration path in migrate.ts now uses the same two-step strategy, so
 * `docker compose up` on a fresh database works without running this script first.
 * This script is kept for CI and for explicit fresh-bootstrap use cases.
 *
 * MINCRM-528
 */

import 'dotenv/config';
import { runner as migrationRunner } from 'node-pg-migrate';
import { MIGRATIONS_DIR, countBaselineCoveredMigrations } from '../migrate.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  `postgres://${process.env.DB_USER ?? 'minicrm'}:${process.env.DB_PASSWORD ?? 'password'}@${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? '5432'}/${process.env.DB_NAME ?? 'minicrm'}`;

const SHARED_OPTIONS = {
  databaseUrl,
  dir: MIGRATIONS_DIR,
  direction: 'up' as const,
  migrationsTable: 'pgmigrations',
  checkOrder: false,
  log: (msg: string) => console.log(msg),
};

async function main(): Promise<void> {
  console.log('[migrate:fresh] Step 1 — applying 000_baseline schema...');
  const baselineResult = await migrationRunner({
    ...SHARED_OPTIONS,
    count: 1,
  });

  if (baselineResult.length === 0) {
    console.log('[migrate:fresh] 000_baseline already applied — schema is up to date.');
  } else {
    console.log(`[migrate:fresh] 000_baseline applied: ${baselineResult[0].name}`);
  }

  const baselineCoveredCount = countBaselineCoveredMigrations();
  console.log(
    `[migrate:fresh] Step 2 — fake-marking up to ${baselineCoveredCount} baseline-covered migration(s)...`,
  );
  const fakeResult = await migrationRunner({
    ...SHARED_OPTIONS,
    fake: true,
    count: baselineCoveredCount,
  });

  if (fakeResult.length === 0) {
    console.log('[migrate:fresh] No pending migrations to fake-mark — already up to date.');
  } else {
    console.log(`[migrate:fresh] Fake-marked ${fakeResult.length} migration(s) as applied.`);
  }

  console.log('[migrate:fresh] Done. Database is ready for use.');
}

main().catch((err: unknown) => {
  throw err;
});

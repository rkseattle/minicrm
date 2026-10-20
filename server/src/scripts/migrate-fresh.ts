/**
 * migrate-fresh.ts — Initialize a brand-new database using the schema baseline
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * node-pg-migrate pre-computes the list of pending migrations before running any of them.
 * This means a migration cannot mark later migrations as "already applied" during its own
 * up() call — the runner has already decided to run them.
 *
 * To bootstrap a fresh database without replaying every individual migration, this script
 * runs migrateFromBaseline() from migrate.ts: it applies `000_baseline`, records the
 * migrations the baseline covers by name without executing them, then runs every other
 * pending migration for real.
 *
 * USAGE
 * -----
 *   npm run migrate:fresh --workspace=minicrm-server
 *
 * Required environment variables: DATABASE_URL
 * Optional: DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME (used as DATABASE_URL fallback)
 *
 * This script is idempotent: every step is a no-op if already applied/recorded.
 *
 * The startup migration path in migrate.ts runs the same function, so
 * `docker compose up` on a fresh database works without running this script first.
 * This script is kept for CI and for explicit fresh-bootstrap use cases.
 *
 *
 */

import 'dotenv/config';
import { migrateFromBaseline, productMigrationOptions } from '../migrate.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  `postgres://${process.env.DB_USER ?? 'minicrm'}:${process.env.DB_PASSWORD ?? 'password'}@${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? '5432'}/${process.env.DB_NAME ?? 'minicrm'}`;

async function main(): Promise<void> {
  await migrateFromBaseline(productMigrationOptions(databaseUrl, (msg) => console.log(msg)));
  console.log('[migrate:fresh] Done. Database is ready for use.');
}

main().catch((err: unknown) => {
  throw err;
});

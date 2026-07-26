/**
 * create-coverage-db.ts — Provisions the coverage/TIA database (creates it
 * if absent, runs qa/migrations/ against it) for a standalone script
 * context that never boots the actual app server.
 *
 * server.ts's own boot sequence already calls runCoverageMigrations()
 * unconditionally, so a running server (e.g. e2e-functional, which starts
 * npm run start) always has a provisioned coverage database. Vitest's own
 * globalSetup.ts does the same for minicrm_coverage_test before any test
 * file runs. Neither path applies to ci.yml's tia-selection job or the
 * local pre-push hook — both call load-coverage-map.ts/select-tests.ts
 * directly via tsx, never starting the server or a Vitest run, so nothing
 * ever provisioned the coverage database for them (found in CI: "database
 * \"minicrm_coverage_test\" does not exist" — tia-selection's own
 * coverageDb queries had no database to connect to at all).
 *
 * Thin wrapper around migrate.ts's own runCoverageMigrations() — no
 * duplicated create/migrate logic; mirrors qa/scripts/create-coverage-e2e-db.ts's
 * role for the E2E case, generalized via COVERAGE_DB_NAME instead of a
 * hardcoded database name.
 *
 * Usage:
 *   COVERAGE_DB_NAME=minicrm_coverage_test tsx src/scripts/create-coverage-db.ts
 */

import { runCoverageMigrations } from '../migrate.js';
import coverageDb from '../coverageDb.js';

async function main(): Promise<void> {
  try {
    await runCoverageMigrations();
  } finally {
    await coverageDb.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[create-coverage-db] fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exitCode = 1;
});

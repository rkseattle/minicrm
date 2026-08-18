/**
 * assertTestDatabaseTarget.ts — refuse-to-run guard for the destructive E2E scripts.
 *
 * These scripts truncate and reseed every table they touch. reset-e2e-data.ts runs
 * `TRUNCATE audit_log CASCADE` plus mass DELETEs. Run against the wrong database they
 * destroy real data — which is exactly what happened: a test run resolved the dev
 * database and wiped it.
 *
 * Physical port separation (dev on 5432, test on 5433) makes the common mistake fail at
 * connect time, because the test databases no longer exist on the dev instance. This
 * guard closes the remaining hole: a caller that supplies a dev DB_NAME *and* the dev
 * port would still find a perfectly valid database to destroy. Ports reduce the chance
 * of a mistake; this makes the worst mistake impossible.
 *
 * Deliberately strict about DB_PORT rather than defaulting it. Roughly fifteen call
 * sites across the repo inline `?? '5432'`, and the local .env did not set DB_PORT at
 * all, so "unset" silently meant "the dev database" everywhere. An explicit value is
 * cheap; a silent wrong default cost a database.
 *
 * CI-safe: every CI job that touches a database sets DB_PORT and DB_NAME explicitly,
 * and the databases CI uses (minicrm_e2e, minicrm_test) are on the allowlist, so this is
 * inert there.
 */

// The port rule runs the SAME code as the QA-side resolver rather than a
// hand-synced copy. It lives in shared/ because this file is compiled into the
// server image and cannot import from qa/ — see that module's docblock.
import { normalizeDbPort, isDevDatabasePort } from '@minicrm/shared/testing/testStackDbPort.js';

/** Databases these scripts are permitted to touch. `minicrm` and `minicrm_coverage` are deliberately absent — those are the dev/production databases. */
const ALLOWED_TEST_DATABASES = [
  'minicrm_e2e',
  'minicrm_test',
  'minicrm_coverage_e2e',
  'minicrm_coverage_test',
] as const;

export interface TestDatabaseTarget {
  host: string;
  port: string;
  database: string;
}

/**
 * Throws when DB_PORT is unset or names the dev instance.
 *
 * For scripts that hardcode their own test database name (the `CREATE DATABASE`
 * helpers) and so have no DB_NAME to validate. They are not destructive to existing
 * data, but creating `minicrm_e2e` on the dev instance silently undoes the separation
 * this ticket establishes and restores the shared-instance failure mode.
 */
export function assertTestDatabasePort(scriptName: string): string {
  const port = process.env.DB_PORT;

  // Unset is rejected here rather than in normalizeDbPort: `Number('abc') || 5432`
  // at the call sites would otherwise silently resolve to the dev port, which is
  // the leak this guard exists to close.
  if (!port) {
    throw new Error(
      `[${scriptName}] REFUSING TO RUN: DB_PORT is not set.\n` +
        '  This script will not fall back to a default port — a wrong default is how the\n' +
        '  dev database was destroyed. The test stack listens on 5433:\n' +
        '    docker compose -f docker-compose.test.yml up -d',
    );
  }

  // normalizeDbPort rejects non-numeric and out-of-range values, and returns the
  // NORMALIZED number — which is what isDevDatabasePort must compare. A raw-string
  // comparison accepted `05432`, which Number()s back to 5432, sending the scripts
  // that run `TRUNCATE ... CASCADE` and `CREATE DATABASE` at the DEV database.
  let portNumber: number;
  try {
    portNumber = normalizeDbPort(port);
  } catch {
    throw new Error(
      `[${scriptName}] REFUSING TO RUN: DB_PORT is not a valid port number ("${port}").\n` +
        '  This script will not fall back to a default port — a wrong default is how the\n' +
        '  dev database was destroyed. The test stack listens on 5433:\n' +
        '    docker compose -f docker-compose.test.yml up -d',
    );
  }

  if (isDevDatabasePort(portNumber, Boolean(process.env.CI))) {
    throw new Error(
      `[${scriptName}] REFUSING TO RUN: DB_PORT=${port} is the dev database.\n` +
        '  Test databases belong on the isolated test stack (5433), not alongside the\n' +
        '  dev data — see docker-compose.test.yml.',
    );
  }

  // The normalized spelling, so a caller cannot pass `05432` onward to a
  // connection that would resolve it back to the dev port.
  return String(portNumber);
}

/**
 * Throws unless the resolved connection target is a known test database.
 *
 * @param scriptName - Name shown in the error, so the operator knows what refused.
 * @param databaseEnvVar - Which env var names the database; `create-coverage-e2e-db`
 *   and friends target the coverage DB via COVERAGE_DB_NAME rather than DB_NAME.
 */
export function assertTestDatabaseTarget(
  scriptName: string,
  databaseEnvVar: 'DB_NAME' | 'COVERAGE_DB_NAME' = 'DB_NAME',
): TestDatabaseTarget {
  // Delegated so the two guards can never diverge: this one protects the MORE
  // destructive scripts, so it must be at least as strict about the port.
  const port = assertTestDatabasePort(scriptName);
  const database = process.env[databaseEnvVar];
  const host = process.env.DB_HOST ?? 'localhost';

  if (!database) {
    throw new Error(
      `[${scriptName}] REFUSING TO RUN: ${databaseEnvVar} is not set.\n` +
        `  Expected one of: ${ALLOWED_TEST_DATABASES.join(', ')}.`,
    );
  }

  const allowed: readonly string[] = ALLOWED_TEST_DATABASES;
  if (!allowed.includes(database)) {
    throw new Error(
      `[${scriptName}] REFUSING TO RUN: ${databaseEnvVar}="${database}" is not a test database.\n` +
        '  This script truncates and reseeds every table it touches; running it against\n' +
        '  a dev or production database destroys real data.\n' +
        `  Allowed: ${ALLOWED_TEST_DATABASES.join(', ')}.`,
    );
  }

  return { host, port, database };
}

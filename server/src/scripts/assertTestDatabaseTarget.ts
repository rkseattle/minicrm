/**
 * assertTestDatabaseTarget.ts — refuse-to-run guard for the destructive E2E scripts.
 * (MINCRM-684)
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

/** Host port of the dev/production Postgres. Test scripts must never target it. */
const DEV_DB_PORT = '5432';

/** Highest valid TCP port. Anything above it cannot be listening, whatever the config says. */
const MAX_TCP_PORT = 65535;

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

  // Rejects unset AND non-numeric: `Number('abc') || 5432` at the call sites would
  // otherwise silently resolve to the dev port, which is the leak this guard exists to
  // close. Validating here means callers can use the returned value directly.
  //
  // The range check keeps this identical to normalizeDbPort in
  // qa/scripts/test-stack-db-env.ts, which the two files' docblocks claim of each
  // other. Port 0 and anything above 65535 cannot be listening, so accepting them
  // only trades a precise refusal for a confusing connect-time failure.
  if (!port || !/^\d+$/.test(port) || Number(port) === 0 || Number(port) > MAX_TCP_PORT) {
    throw new Error(
      `[${scriptName}] REFUSING TO RUN: DB_PORT is ${port ? `not a valid port number ("${port}")` : 'not set'}.\n` +
        '  This script will not fall back to a default port — a wrong default is how the\n' +
        '  dev database was destroyed. The test stack listens on 5433:\n' +
        '    docker compose -f docker-compose.test.yml up -d',
    );
  }

  // Compare the NORMALIZED number, not the raw string. `05432` passes the regex
  // above, is !== '5432', and every caller then does Number() on it and connects
  // to 5432 — the dev database, reached by the very scripts that run
  // `TRUNCATE ... CASCADE` and `CREATE DATABASE`. Verified before the fix:
  //   DB_PORT=5432   REFUSED
  //   DB_PORT=05432  ACCEPTED -> returns "05432" -> Number() = 5432
  // (MINCRM-699)
  //
  // CI has no dev stack — its Postgres service container is the only instance, on 5432,
  // and provisioning test databases there is correct. The 5432-is-dangerous rule is a
  // local-machine property, so it applies only off CI.
  const portNumber = Number(port);
  if (portNumber === Number(DEV_DB_PORT) && !process.env.CI) {
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

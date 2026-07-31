/**
 * Pure resolver for the test-stack database coordinates the pre-push TIA hook
 * hands to every subprocess it spawns. (MINCRM-698)
 *
 * Split out of scripts/pre-push-tia.ts for the same reason as
 * container-commit-sha.ts: root `scripts/` is covered by tsconfig.scripts.json
 * for typecheck ONLY — `npm run unit_test` runs the server/client/
 * coverage-dashboard workspaces and Playwright's testDir is qa/e2e/tests, so a
 * spec placed next to that script would never execute. Specs under
 * qa/e2e/tests/framework/ can import from here, and qa/scripts is already in
 * CI's `qa` paths filter, so this is the closest home that costs no new build
 * wiring. (Not counted by the c8 gate either — qa/package.json's
 * test:framework:coverage restricts --include to e2e/framework/**. The reason
 * to put it here is that its tests RUN, not that they score.)
 *
 * Only the resolution rule lives here. The process.exit and the console.error
 * stay in the hook, so these tests exercise real logic rather than a mock of
 * process control.
 */

/** The test stack's Postgres port (docker-compose.test.yml). */
export const TEST_DB_PORT = '5433';

/** The dev stack's Postgres port (docker-compose.yml) — never a valid target for this hook. */
export const DEV_DB_PORT = '5432';

/** Databases the hook's children must use. Hardcoded, never inherited: see resolveTestStackDbEnv. */
export const TEST_DB_NAME = 'minicrm_e2e';
export const TEST_COVERAGE_DB_NAME = 'minicrm_coverage_e2e';

export interface TestStackDbEnv {
  DB_HOST: string;
  DB_PORT: string;
  DB_NAME: string;
  COVERAGE_DB_NAME: string;
}

/** Thrown when the resolved port is the dev database. The caller decides how to report and exit. */
export class DevDatabaseRefusedError extends Error {
  constructor() {
    super(
      `DB_PORT=${DEV_DB_PORT} is the dev database. This hook runs E2E suites and ` +
        `rewrites coverage/TIA data. The test stack listens on ${TEST_DB_PORT}.`,
    );
    this.name = 'DevDatabaseRefusedError';
  }
}

/**
 * Resolves the database coordinates for every subprocess the pre-push hook spawns.
 *
 * `exportedPort`/`exportedHost` are the environment as it existed BEFORE any
 * .env file was loaded — NOT `process.env` at call time. That distinction is the
 * whole point of this function, and the defect it was extracted to fix:
 *
 * The hook loads root .env (for its secrets) and then qa/e2e/.env. loadEnvFile
 * is first-write-wins, so root's DEV coordinates (DB_PORT=5432) shadow
 * qa/e2e/.env's test ones (5433) — permanently, since root loads first. Reading
 * the post-load `process.env.DB_PORT` therefore saw 5432 on a completely healthy
 * machine and refused every push, with the test stack up and correct.
 *
 * Reading the pre-file snapshot keeps the guard's real contract: an operator who
 * deliberately EXPORTS the dev port is still refused outright — that is the case
 * it exists for, and it is what stopped a test run truncating the dev database
 * (MINCRM-684) — while a value that merely appeared in a file this hook chose to
 * load cannot trigger it.
 *
 * Database NAMES are hardcoded rather than resolved, so a stray DB_NAME in any
 * environment or file can never point a child at the dev database.
 * COVERAGE_DB_NAME must be minicrm_coverage_e2e (not _test): E2E runs deposit
 * coverage into the _e2e database, so pointing TIA at the unit-test database
 * would find zero mappings and silently degrade every push to a full-suite run.
 *
 * @throws DevDatabaseRefusedError when the resolved port is the dev port.
 */
export function resolveTestStackDbEnv(
  exportedPort: string | undefined,
  exportedHost: string | undefined,
): TestStackDbEnv {
  const dbPort = exportedPort ?? TEST_DB_PORT;

  if (dbPort === DEV_DB_PORT) {
    throw new DevDatabaseRefusedError();
  }

  return {
    DB_HOST: exportedHost ?? 'localhost',
    DB_PORT: dbPort,
    DB_NAME: TEST_DB_NAME,
    COVERAGE_DB_NAME: TEST_COVERAGE_DB_NAME,
  };
}

/**
 * Parses .env file contents into a plain record: `KEY=value` per line, `#`
 * comments and blank lines skipped, and everything after the FIRST `=` kept as
 * the value (so a value containing `=` survives).
 *
 * This is the real parser scripts/pre-push-tia.ts's loadEnvFile runs — not a
 * copy of it. That distinction is the point: an earlier version of this module
 * exported a standalone `applyFirstWriteWins` that duplicated the hook's inline
 * loop, so the tests asserted against the copy and would have stayed green while
 * the loop that actually runs drifted away from them. loadEnvFile now calls this
 * and does nothing but the process.env mutation, which is the one part a unit
 * test cannot exercise without leaking global state. (MINCRM-698)
 */
export function parseEnvFileContents(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    // First key wins within a single file too, matching the caller's
    // `if (!(key in process.env))` guard applied line by line.
    if (key in parsed) continue;
    parsed[key] = trimmed.slice(eqIdx + 1);
  }
  return parsed;
}

/**
 * Applies the first-write-wins rule across an ordered list of parsed .env files,
 * layered over the values already present in the environment.
 *
 * Models exactly what loadRootEnv() produces: `loadEnvFile(root)` then
 * `loadEnvFile(qa/e2e)`, each skipping keys already set. Exported so the
 * PRECEDENCE — root .env shadowing qa/e2e/.env, which is why the dev-port guard
 * cannot read process.env — is pinned by a test rather than only asserted in a
 * comment. (MINCRM-698, AC 4/5)
 */
export function applyFirstWriteWins(
  files: ReadonlyArray<Readonly<Record<string, string>>>,
  preExisting: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const result: Record<string, string> = { ...preExisting };
  for (const file of files) {
    for (const [key, value] of Object.entries(file)) {
      if (!(key in result)) result[key] = value;
    }
  }
  return result;
}

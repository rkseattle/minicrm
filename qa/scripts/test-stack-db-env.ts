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

/**
 * One layer of the precedence chain: a partial set of coordinates from a single
 * source (the real environment, or a .env file). Every field optional so an
 * absent key falls through to the next layer rather than pinning a value.
 */
export interface TestStackDbSource {
  DB_PORT?: string;
  DB_HOST?: string;
  DB_USER?: string;
  DB_PASSWORD?: string;
}

/** Credentials the test stack is provisioned with (docker-compose.test.yml). */
export const TEST_DB_USER = 'minicrm';
export const TEST_DB_PASSWORD = 'password';

export interface TestStackDbEnv {
  DB_HOST: string;
  DB_PORT: string;
  DB_NAME: string;
  COVERAGE_DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
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
 * PRECEDENCE, highest first. The source of a value matters as much as the value:
 *
 *   1. `exported` — the real environment, captured BEFORE any .env load. An
 *      operator who deliberately exports coordinates means it, including when
 *      they export the dev port, which is still refused outright. That refusal
 *      is what stopped a test run truncating the dev database (MINCRM-684).
 *   2. `fromE2eEnvFile` — qa/e2e/.env, the file that describes the TEST stack.
 *      Authoritative for these keys: a developer running the stack on a
 *      non-default host/port configures it there, and that must reach every
 *      child. An earlier revision of this fix ignored ALL file values to avoid
 *      root .env's dev port, which also silently discarded this legitimate
 *      customization and pinned everyone to localhost:5433.
 *   3. The test-stack defaults below.
 *
 * Root .env is deliberately absent from that chain. It describes the DEV stack,
 * is loaded only for secrets, and must never supply a database coordinate — the
 * distinction the original defect could not draw, because by the time it read
 * process.env both files had already been flattened into it.
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
  exported: Readonly<TestStackDbSource>,
  fromE2eEnvFile: Readonly<TestStackDbSource> = {},
): TestStackDbEnv {
  const dbPort = exported.DB_PORT ?? fromE2eEnvFile.DB_PORT ?? TEST_DB_PORT;

  if (dbPort === DEV_DB_PORT) {
    throw new DevDatabaseRefusedError();
  }

  return {
    DB_HOST: exported.DB_HOST ?? fromE2eEnvFile.DB_HOST ?? 'localhost',
    DB_PORT: dbPort,
    DB_NAME: TEST_DB_NAME,
    COVERAGE_DB_NAME: TEST_COVERAGE_DB_NAME,
    // Credentials follow the same chain, and are returned here rather than left
    // to each caller: pre-push-tia.ts previously handed children a corrected
    // host/port while DB_USER/DB_PASSWORD still fell through from root .env's
    // DEV values. Latent only because both stacks currently use
    // minicrm/password — a test stack with its own credentials could not run
    // Playwright, selection or attestation at all. (MINCRM-698, PR #369 review)
    DB_USER: exported.DB_USER ?? fromE2eEnvFile.DB_USER ?? TEST_DB_USER,
    DB_PASSWORD: exported.DB_PASSWORD ?? fromE2eEnvFile.DB_PASSWORD ?? TEST_DB_PASSWORD,
  };
}

/**
 * Extracts just the DB coordinates from parsed .env contents.
 *
 * Both callers (scripts/pre-push-tia.ts and scripts/e2e-setup.ts) re-read
 * qa/e2e/.env directly rather than consulting process.env, because by the time
 * they resolve, root .env has been flattened in and its DEV values shadow the
 * test ones. Going back to the file is what names these values as belonging to
 * the TEST stack. Absent keys are omitted rather than set to undefined, so the
 * resolver's `??` chain falls through cleanly. (MINCRM-698)
 */
export function pickDbCoordinates(parsed: Readonly<Record<string, string>>): TestStackDbSource {
  const coordinates: TestStackDbSource = {};
  if (parsed.DB_PORT) coordinates.DB_PORT = parsed.DB_PORT;
  if (parsed.DB_HOST) coordinates.DB_HOST = parsed.DB_HOST;
  if (parsed.DB_USER) coordinates.DB_USER = parsed.DB_USER;
  if (parsed.DB_PASSWORD) coordinates.DB_PASSWORD = parsed.DB_PASSWORD;
  return coordinates;
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

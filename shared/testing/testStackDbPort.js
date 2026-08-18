/**
 * The dev-port refusal rule, in one place.
 *
 * WHY THIS LIVES IN shared/ RATHER THAN IN EITHER GUARD
 *
 * Two refuse-to-run guards need this identical rule and neither can import the
 * other:
 *
 *   - `server/src/scripts/assertTestDatabaseTarget.ts` fronts the destructive
 *     scripts (`TRUNCATE ... CASCADE`, `CREATE DATABASE`) and is compiled into
 *     the server image, so it cannot import from `qa/` — `server/Dockerfile`
 *     copies only `server/` and `shared/`, and an extra input outside those
 *     would shift tsc's inferred `rootDir` out from under the Dockerfile's
 *     hardcoded `COPY`/`CMD` paths. CI never builds that image, so none of it
 *     would be caught there.
 *   - `qa/scripts/test-stack-db-env.ts` resolves coordinates for the pre-push
 *     hook and the Playwright harness, and must not depend on the server build.
 *
 * `shared/` is the one home both can reach: it is already copied into the server
 * image (`server/Dockerfile`), both workspaces already map `@minicrm/shared/*`
 * in their tsconfig paths, and it is consumed as a PACKAGE, so it adds no input
 * to either build's `rootDir` inference.
 *
 * DOCUMENTED EXCEPTION to CLAUDE.md's description of `shared/` as "Zod schemas
 * used by both client and server". This is neither a Zod schema nor
 * client-facing. It lives here because the alternative — the hand-synced copies
 * this replaces — put a silent bypass in front of the scripts that truncate
 * databases. `05432` passes `/^\d+$/`, is `!== '5432'`, and `Number()`s back to
 * 5432, so a raw-string comparison sent the destructive scripts at the DEV
 * database. That is exactly the leak this rule exists to prevent. A rule that must
 * not drift belongs in one file, not in a comment asking two files to agree.
 *
 * No `zod` import, no Node built-ins, no I/O — a pure function, so it stays
 * importable from every workspace including the pre-push hook.
 */
/** The test stack's Postgres port (docker-compose.test.yml). */
export const TEST_DB_PORT = '5433';
/** The dev/production stack's Postgres port (docker-compose.yml). Never a valid test target. */
export const DEV_DB_PORT = '5432';
/** Highest valid TCP port. Anything above it cannot be listening, whatever the config says. */
export const MAX_TCP_PORT = 65535;
/**
 * Validates a DB_PORT string and returns it as a number.
 *
 * The regex, rather than a bare `Number()`, is the point: `'05432'`, `' 5432 '`
 * and `'5432.0'` are all `!== '5432'` as strings but all become 5432 as numbers,
 * so a raw string comparison against DEV_DB_PORT lets every one of them reach
 * the dev database.
 *
 * **Callers must compare the NORMALIZED value this returns**, not the raw input.
 * Order is load-bearing: normalize first, then refuse.
 *
 * @throws Error when the value is not a plain integer in the valid TCP range.
 */
export function normalizeDbPort(port) {
  const portNumber = Number(port);
  if (!/^\d+$/.test(port) || portNumber === 0 || portNumber > MAX_TCP_PORT) {
    throw new Error(
      `DB_PORT="${port}" is not a valid port number. The test stack listens on ${TEST_DB_PORT}.`,
    );
  }
  return portNumber;
}
/**
 * True when a resolved port is the dev database and the caller is not on CI.
 *
 * CI's Postgres service container genuinely listens on 5432 and is the only
 * instance there, so provisioning test databases on it is correct. The
 * 5432-is-dangerous rule is a local-machine property.
 *
 * Takes the ALREADY-NORMALIZED number so a caller cannot accidentally pass a raw
 * string and reintroduce the spelling bypass.
 */
export function isDevDatabasePort(portNumber, isCi) {
  return portNumber === Number(DEV_DB_PORT) && !isCi;
}

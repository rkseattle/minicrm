/**
 * Playwright globalSetup — pre-authenticated admin session for storageState.
 *
 * POSTs credentials directly to the auth API, parses the Set-Cookie header,
 * and writes a storageState JSON file to `.auth/admin.json`. All non-auth test
 * workers load this file instead of navigating through the login UI, eliminating
 * per-test browser login overhead.
 *
 * Auth-specific specs (auth.spec.ts, password-reset.spec.ts, permissions.spec.ts)
 * opt out via `test.use({ storageState: undefined })` and perform real UI logins.
 *
 * The `.auth/` directory is gitignored and claudeignored — never committed.
 *
 * MINCRM-192, MINCRM-221, MINCRM-559
 */

import type { FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { resolveRuntimeTestStackDb } from '../scripts/test-stack-db-env.js';

/** Path where the admin session storageState is written. */
export const ADMIN_STORAGE_STATE = path.join(__dirname, '.auth', 'admin.json');

/** User count at which a stale-data warning is emitted (local only). */
const STALE_DATA_WARN_THRESHOLD = 500;

/** User count at which the run is aborted to prevent cascading failures (local only). */
const STALE_DATA_ABORT_THRESHOLD = 2000;

/**
 * Non-inactive user count at which a teardown-regression warning is emitted.
 *
 * "Active" here means `status <> 'inactive'`, so it counts `invited` users too
 * — an invited-and-abandoned row is a leak exactly like an activated one, and
 * the invite path is where the leaks were.
 *
 * Deliberately far below the total-row thresholds: cleanup deactivates every
 * user it creates, and `reset-e2e-data.ts` leaves exactly one row, so the
 * steady-state floor is ~1 plus whatever a run currently holds open. 100 is
 * loose enough that a large parallel run never trips it and tight enough that
 * a broken teardown does so within a session. (MINCRM-668)
 */
const STALE_ACTIVE_USER_WARN_THRESHOLD = 100;

/**
 * The stale-data count query.
 *
 * Exported so a framework spec can assert its shape without a database. Two
 * properties are load-bearing and neither is obvious from the call site: the
 * total is unfiltered (deactivated rows still cost pagination, which is the
 * MINCRM-544 failure), and the active count is a FILTER on the same scan rather
 * than a second query. (MINCRM-668)
 */
export const STALE_DATA_COUNT_SQL =
  "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status <> 'inactive') AS active FROM users";

/** Path fragment identifying the framework specs, which need no database. */
const FRAMEWORK_SPEC_DIR = 'tests/framework';

/**
 * Playwright CLI flags whose value is a SEPARATE argv entry (`--config file`
 * rather than `--config=file`). Their values must be skipped when scanning for
 * positional path filters, since several of them ARE paths — `--config
 * e2e/playwright.config.ts` would otherwise read as a selected spec.
 *
 * Extracted from `playwright/lib/program.js`'s option definitions rather than
 * hand-listed. BOTH spellings are required — re-derive with:
 *   grep -oE '\-\-[a-z-]+ <[^>]+>'      node_modules/playwright/lib/program.js
 *   grep -oE '\-[a-zA-Z], \-\-[a-z-]+'  node_modules/playwright/lib/program.js
 *
 * The short aliases are not optional. Omitting them made `-g tests/framework` —
 * a FULL-suite run with a grep pattern — parse as a framework-only selection and
 * silently skip the guard, which is the exact failure this ticket exists to
 * remove. `-c <config>` failed the other way, making a framework-only run
 * connect to a database it does not need.
 */
export const FLAGS_TAKING_A_VALUE = new Set([
  '--browser',
  '--config',
  '-c',
  '--global-timeout',
  '--grep',
  '-g',
  '--grep-invert',
  '-G',
  '--host',
  '--last-failed-file',
  '--loop',
  '--max-failures',
  '--output',
  '--port',
  // NOTE: --project is deliberately absent. It is variadic
  // (`--project <project-name...>`), so Playwright itself cannot tell
  // `--project desktop e2e/tests/framework/` from a two-project selection and
  // rejects it with "Project(s) ... not found". No valid invocation reaches this
  // parser with a path directly after a space-separated --project, so skipping
  // one entry after it would be wrong — it would swallow a real path filter in
  // `--project=desktop e2e/tests/framework/`, the form the npm scripts use.
  '--repeat-each',
  '--reporter',
  '--retries',
  '--run-agents',
  '--shard',
  '--test-list',
  '--test-list-invert',
  '--timeout',
  '--trace',
  '--tsconfig',
  '--ui-host',
  '--ui-port',
  '--update-source-method',
  '--workers',
  '-j',
  // NOTE: -u/--update-snapshots is absent. Its value is OPTIONAL
  // (`--update-snapshots [mode]`), so `-u e2e/tests/framework/` is a snapshot
  // update OF that path, not a flag value — skipping the next token would
  // swallow a real path filter. Snapshot modes are bare words with no '/' and
  // no '.ts', so an actual mode value is ignored by the path-shape test below.
]);

/**
 * Thrown when the E2E database holds too much accumulated test data.
 *
 * A distinct type rather than a message prefix: the guard previously re-threw
 * on `err.message.startsWith('[globalSetup]')`, which both let any unrelated
 * error with that prefix escape and, far worse, silently swallowed every real
 * connection failure. (MINCRM-699)
 */
export class StaleDataAbortError extends Error {
  constructor(userCount: number) {
    super(
      `[globalSetup] E2E database contains ${userCount} users — ` +
        "run 'npm run e2e:setup' to reset before testing locally.",
    );
    this.name = 'StaleDataAbortError';
  }
}

/**
 * True when this run selected only framework specs, which use no database.
 *
 * Derived from the resolved config's argv — a property of WHAT IS BEING RUN,
 * which is the only thing that answers "does this run need a database". An env
 * var cannot: E2E_ADMIN_PASSWORD is the obvious candidate and is wrong, because
 * qa/e2e/.env sets it and the documented E2E invocation exports that whole file,
 * so it actually tracks "did this shell source qa/e2e/.env". That would both
 * fail the DB-free framework gate for anyone who sourced it and silently skip
 * the guard on a full run where it happened to be unset — the exact
 * "skipped mistaken for passed" this ticket removes.
 *
 * config.testDir cannot discriminate either: every project reports e2e/tests
 * regardless of the file filter (verified against @playwright/test 1.62.1).
 *
 * Covers every invocation form: `npm run test:framework`,
 * `npm run test -- e2e/tests/framework/x.spec.ts`, CI's e2e-framework-specs job,
 * — none of which have to opt in.
 *
 * KNOWN GAP: a runner that does not put a literal `test` token in argv (the
 * Playwright VS Code extension drives the runner directly) is not recognised as
 * framework-only, so the guard runs and an IDE-launched framework spec hard-fails
 * when the test stack is down. That is fail-CLOSED and therefore safe, but it is a
 * real limitation, not full coverage. Recognising it would mean parsing a shape
 * this function has no contract for; the CLI forms above are what the npm scripts,
 * the DoD gate and CI actually use.
 */
function isFrameworkOnlyRun(config: FullConfig): boolean {
  // config.argv is a documented public member (FullConfig, @playwright/test
  // 1.62). Defensive check anyway so a future version that drops it fails
  // CLOSED — the guard runs — rather than silently skipping it.
  if (!Array.isArray(config.argv)) return false;

  return selectsOnlyFrameworkSpecs(config.argv);
}

/**
 * Extracts Playwright's positional path filters from an argv and reports whether
 * they all name framework specs. Exported for tests: the parsing rules below are
 * each a defect this function already had.
 *
 * Matching on path SHAPE rather than a `.spec.ts` suffix is load-bearing — the
 * npm scripts and CI pass a DIRECTORY (`e2e/tests/framework/`), so a suffix test
 * finds no filters and makes the DB-free DoD gate connect to a database it does
 * not need.
 */
/**
 * Index of the `test` subcommand in a `playwright test ...` argv, or -1.
 *
 * The first two entries are the interpreter and the binary, so scanning starts
 * after them; from there the first bare `test` that is not a flag's value is the
 * subcommand. Skipping flag values is what stops `--grep test` from being read as
 * the subcommand. (MINCRM-699)
 */
function findSubcommandIndex(args: readonly string[]): number {
  const FIRST_ARGUMENT_INDEX = 2; // [node, playwright, <subcommand>, ...]

  for (let i = FIRST_ARGUMENT_INDEX; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('-')) {
      if (!arg.includes('=') && FLAGS_TAKING_A_VALUE.has(arg)) i++;
      continue;
    }
    return arg === 'test' ? i : -1;
  }
  return -1;
}

export function selectsOnlyFrameworkSpecs(argv: readonly string[]): boolean {
  // Playwright does not parse args after `--`; they are passthrough. Including
  // them fails OPEN — `test -- tests/framework/x` on a full run would look
  // framework-only and silently skip the guard.
  const separatorIndex = argv.indexOf('--');
  const args = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);

  // Locate the `test` SUBCOMMAND, scanning forward past the interpreter and
  // binary entries while skipping flag values. Neither indexOf nor lastIndexOf
  // is safe on its own: indexOf matches an interpreter path segment equal to
  // `test`, and lastIndexOf matches a FLAG VALUE equal to `test` — verified,
  // `test <app-spec> --grep test <framework-spec>` re-anchored past the app spec
  // and reported framework-only, silently skipping the guard on a run that uses
  // the database. That is the one fail-OPEN this parser must not have.
  const testArgIndex = findSubcommandIndex(args);
  if (testArgIndex === -1) return false;

  const pathFilters: string[] = [];
  for (let i = testArgIndex + 1; i < args.length; i++) {
    const arg = args[i]!;

    // `--config VALUE` puts the value in its own argv entry, and that value is a
    // path — counting it as a filter makes every framework run look mixed.
    if (arg.startsWith('-')) {
      if (!arg.includes('=') && FLAGS_TAKING_A_VALUE.has(arg)) i++;
      continue;
    }

    if (arg.includes('/') || arg.endsWith('.ts')) pathFilters.push(arg);
  }

  return pathFilters.length > 0 && pathFilters.every((f) => f.includes(FRAMEWORK_SPEC_DIR));
}

/**
 * MINCRM-559: Check for accumulated test data in the local E2E database.
 *
 * Skipped in CI where the database is always freshly seeded. Locally, users
 * accumulate for two reasons, and the first is a defect rather than a cost of
 * skipping a reset: a teardown path that does not survive test failure. Until
 * MINCRM-668 the user-creation helpers cleaned up in `finally` blocks that an
 * earlier failing assertion threw straight past, and `registerAdminTeardown`
 * swallowed every delete error including the ones meaning the row was still
 * there — so a failing run leaked silently while reporting success. Cleanup is
 * now registered with `TestDataManager` and failures are annotated on the test.
 * The second reason is the ordinary one: rows genuinely survive across sessions
 * when `npm run e2e:setup` is skipped, since deactivation does not delete them.
 * 50k+ users have been observed, causing user-list pagination timeouts that
 * cascade across unrelated specs.
 *
 * Coordinates come from resolveRuntimeTestStackDb, the same chain every other
 * test-stack consumer uses, rather than from a separately composed
 * E2E_DATABASE_URL that could disagree with it. (MINCRM-699)
 *
 * FAILS CLOSED. An unreachable database aborts the run instead of warning and
 * continuing: this guard caught 2049 stale users during MINCRM-691's push gate,
 * and a guard that silently stops guarding is worse than no guard because it is
 * trusted. The only skips are the two that mean "this run does not use the E2E
 * database" — CI, and a framework-only selection.
 *
 * `config` and `env` are parameters rather than module state so this is
 * testable. `env` in particular: the CI check previously read a module-level
 * const captured at import, which no spec could vary.
 *
 * @throws StaleDataAbortError above the abort threshold.
 * @throws Error when the database cannot be reached or queried.
 */
export async function assertStaleDataGuard(
  config: FullConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (env['CI']) return;

  if (isFrameworkOnlyRun(config)) {
    console.log('[globalSetup] Framework-only run — skipping stale-data guard (no database used).');
    return;
  }

  const connection = resolveRuntimeTestStackDb(env);
  const client = new Client(connection);
  try {
    await client.connect();
    // TWO counts, because they answer different questions and one query cannot
    // serve both. (MINCRM-668)
    //
    // total — the abort/warn signal, unchanged. MINCRM-544 was a PAGINATION
    // failure, and `listUsers` (userService.ts:294-300) counts and pages over
    // every row with no status filter, so a deactivated user costs exactly what
    // an active one does. Counting only active users here would let 50k
    // deactivated rows accumulate with the guard reporting near zero — blinding
    // it to the very incident it exists to prevent.
    //
    // active — leak observability. Cleanup deactivates rather than deletes, so
    // the total is identical whether every teardown fired or every one leaked.
    // The active count is the one that moves when teardown breaks, and it is
    // reported alongside the total rather than replacing it.
    const result = await client.query<{ total: string; active: string }>(STALE_DATA_COUNT_SQL);
    const userCount = parseInt(result.rows[0].total, 10);
    const activeUserCount = parseInt(result.rows[0].active, 10);

    if (userCount >= STALE_DATA_ABORT_THRESHOLD) {
      throw new StaleDataAbortError(userCount);
    }

    if (userCount >= STALE_DATA_WARN_THRESHOLD) {
      console.warn(
        `[globalSetup] E2E database contains ${userCount} users ` +
          `(${activeUserCount} active) — ` +
          "run 'npm run e2e:setup' to reset before testing locally.",
      );
    }

    // A large ACTIVE population is a different signal from a large total: rows
    // survive a session by design, but users left active are ones a teardown
    // did not deactivate. Warned separately so a teardown regression is
    // visible well before the total trips anything.
    if (activeUserCount >= STALE_ACTIVE_USER_WARN_THRESHOLD) {
      console.warn(
        `[globalSetup] ${activeUserCount} users are still ACTIVE. Cleanup ` +
          'deactivates users, so a population this size suggests teardown is ' +
          'not running — check for teardown-failed annotations. (MINCRM-668)',
      );
    }
  } catch (err) {
    if (err instanceof StaleDataAbortError) throw err;
    // Everything else is a real failure to reach the database. Name the
    // coordinates tried — never the password — so the operator can see which
    // stack was targeted rather than guessing.
    throw new Error(
      `[globalSetup] Stale-data guard could not query the E2E database at ` +
        `${connection.host}:${connection.port}/${connection.database} as ${connection.user}: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        '  Start the test stack: docker compose -f docker-compose.test.yml up -d',
    );
  } finally {
    await client.end().catch(() => {
      // Ignore end() errors on an unconnected client.
    });
  }
}

/**
 * globalSetup entry point called once before all workers start.
 *
 * @param config - The resolved Playwright configuration. Passed to the stale-data
 *   guard, which reads the selected spec files from it to tell a framework-only
 *   run (no database) from one that needs the E2E stack. Auth is env-driven.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  // MINCRM-559: Abort or warn early if the local E2E database has accumulated
  // too many users from prior test sessions. Runs before anything else so
  // cascading failures from stale data are caught before any worker starts.
  await assertStaleDataGuard(config);

  const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
  const adminPassword = process.env['E2E_ADMIN_PASSWORD'];

  // When E2E_ADMIN_PASSWORD is absent (e.g. the framework-specs CI job, which
  // runs unit tests with no app server), skip the login and write an empty
  // storageState. Framework specs never use storageState so this is safe.
  if (!adminPassword) {
    const authDir = path.dirname(ADMIN_STORAGE_STATE);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    fs.writeFileSync(ADMIN_STORAGE_STATE, JSON.stringify({ cookies: [], origins: [] }, null, 2));
    console.log(
      '[globalSetup] E2E_ADMIN_PASSWORD not set — skipping login, wrote empty storageState',
    );
    return;
  }

  // Only past this point does globalSetup actually need an app server, so the guard
  // lives here rather than at the top: framework-only runs (qa/e2e/tests/framework/)
  // return above with no E2E_ADMIN_PASSWORD and must not be forced to supply an API
  // target they never use.
  //
  // No default outside CI. A silent fallback to :3001 points the suite at the DEV server
  // and, through it, the dev database — the leak class MINCRM-684 exists to close. Every
  // documented local invocation sources qa/e2e/.env (which sets :3002). CI sets
  // E2E_API_URL explicitly in every job, so the fallback is kept for that path only.
  const E2E_API_URL =
    process.env['E2E_API_URL'] ?? (process.env['CI'] ? 'http://localhost:3001' : '');
  if (!E2E_API_URL) {
    throw new Error(
      'E2E_API_URL is not set. Local E2E runs must target the test stack on ' +
        'http://localhost:3002 — never the dev server on :3001. Source qa/e2e/.env first:\n' +
        "  cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) npm run test",
    );
  }
  const loginUrl = `${E2E_API_URL}/api/v1/auth/login`;

  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });

  if (!response.ok) {
    throw new Error(
      `[globalSetup] Login request to ${loginUrl} failed with status ${response.status}`,
    );
  }

  // Cookie name is env-driven so the test stack can use its own and avoid clobbering
  // the dev stack's session in the shared localhost cookie jar. (MINCRM-684)
  const authCookieName = process.env['AUTH_COOKIE_NAME'] ?? 'minicrm_token';

  // Extract the auth cookie value from the Set-Cookie header.
  const setCookieHeader = response.headers.get('set-cookie') ?? '';
  const tokenMatch = setCookieHeader.match(new RegExp(`${authCookieName}=([^;]+)`));
  if (!tokenMatch) {
    throw new Error(
      `[globalSetup] ${authCookieName} not found in Set-Cookie header from ${loginUrl}`,
    );
  }
  const cookieValue = tokenMatch[1];

  // Mark onboarding as completed so the banner does not appear during E2E runs.
  // The banner is a first-run experience; its own spec manages the flag directly.
  const onboardingUrl = `${E2E_API_URL}/api/v1/settings/onboarding`;
  const onboardingRes = await fetch(onboardingUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${authCookieName}=${cookieValue}`,
    },
    body: JSON.stringify({ onboarding_completed: true }),
  });
  if (!onboardingRes.ok) {
    throw new Error(
      `[globalSetup] PUT ${onboardingUrl} failed with status ${onboardingRes.status}`,
    );
  }

  // Derive the domain from the API URL so the cookie is scoped correctly.
  const apiDomain = new URL(E2E_API_URL).hostname;

  const storageState = {
    cookies: [
      {
        name: authCookieName,
        value: cookieValue,
        domain: apiDomain,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };

  // Ensure the .auth/ output directory exists.
  const authDir = path.dirname(ADMIN_STORAGE_STATE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  fs.writeFileSync(ADMIN_STORAGE_STATE, JSON.stringify(storageState, null, 2));

  console.log('[globalSetup] Admin storageState saved to', ADMIN_STORAGE_STATE);
}

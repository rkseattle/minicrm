/**
 * Unit tests for globalSetup's stale-data guard. (MINCRM-699)
 *
 * The defect these pin: the guard built its client from E2E_DATABASE_URL — a
 * second, independent source of the test-stack coordinates, unreconciled with
 * the precedence chain MINCRM-698 established. A developer who moved their test
 * stack and updated DB_HOST/DB_PORT but not the URL got the two disagreeing, and
 * the failure was SILENT: the catch re-threw only errors whose message began
 * with '[globalSetup]', so a URL pointing at nothing degraded to "guard skipped"
 * rather than a loud failure. The guard stopped guarding with no signal — and it
 * is the guard that caught 2049 stale users during MINCRM-691's push gate.
 *
 * Importing globalSetup.ts is safe from a spec: its module scope is only
 * constants, and importing the named export does not invoke the default export
 * (Playwright calls that itself, from the config's `globalSetup` slot). This is
 * a Playwright lifecycle module rather than an ordinary helper, so it is a
 * different shape from the cross-workspace imports elsewhere in this directory
 * — hence the explicit note about why it does not execute anything on import.
 */

import { test, expect } from '@playwright/test';
import type { FullConfig } from '@playwright/test';
import {
  assertStaleDataGuard,
  selectsOnlyFrameworkSpecs,
  StaleDataAbortError,
} from '../../globalSetup.js';
import {
  resolveRuntimeTestStackDb,
  TEST_DB_PORT,
  DEV_DB_PORT,
} from '../../../scripts/test-stack-db-env.js';

/**
 * A FullConfig carrying just the argv the guard reads. Cast because building a
 * real FullConfig means Playwright's entire resolved-config surface, none of
 * which the guard touches.
 */
function configWithArgv(...args: string[]): FullConfig {
  return { argv: ['node', 'playwright', 'test', ...args] } as unknown as FullConfig;
}

/**
 * Awaits a call expected to reject and returns its error, or null if it
 * resolved. Lets a test assert on the message rather than only that it threw.
 */
async function captureRejection(promise: Promise<void>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

/** Coordinates that resolve cleanly but point at a port nothing listens on. */
const UNREACHABLE_ENV: NodeJS.ProcessEnv = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '15433',
  DB_USER: 'nobody',
  DB_PASSWORD: 'wrong-password',
};

test.describe('assertStaleDataGuard — skip conditions', () => {
  // AC 4: CI behaviour is preserved. CI seeds a fresh database every run, and
  // its Playwright steps carry no DB coordinates at all, so the guard must not
  // connect there.
  test('returns early under CI without connecting', async () => {
    await assertStaleDataGuard(configWithArgv(), { ...UNREACHABLE_ENV, CI: 'true' });
  });

  // The invocation that actually ships. `npm run test:framework` and
  // `test:framework:coverage` pass a DIRECTORY, not a file, and the latter is a
  // mandatory pre-commit gate (definition-of-done.md) that must keep working
  // with no database. An earlier revision of this guard matched only paths
  // ending in `.spec.ts`, found no filters here, and made the gate connect —
  // green on any machine that happened to have the test stack up.
  test('returns early for the directory form npm run test:framework uses', async () => {
    await assertStaleDataGuard(
      configWithArgv(
        '--config=e2e/playwright.config.ts',
        '--project=desktop',
        'e2e/tests/framework/',
      ),
      UNREACHABLE_ENV,
    );
  });

  test('returns early for a framework-only file selection', async () => {
    await assertStaleDataGuard(
      configWithArgv('e2e/tests/framework/test-stack-db-env.spec.ts'),
      UNREACHABLE_ENV,
    );
  });

  test('returns early when every selected file is a framework spec', async () => {
    await assertStaleDataGuard(
      configWithArgv(
        'e2e/tests/framework/test-stack-db-env.spec.ts',
        'e2e/tests/framework/global-setup-guard.spec.ts',
      ),
      UNREACHABLE_ENV,
    );
  });
});

// argv parsing, tested directly. Every case here is a defect this function had:
// each one either broke the DB-free DoD gate (fails closed, loudly) or skipped
// the guard on a run that uses the database (fails OPEN, silently) — the second
// being exactly what this ticket exists to eliminate.
test.describe('selectsOnlyFrameworkSpecs — argv parsing', () => {
  const pw = (...args: string[]): string[] => ['/usr/bin/node', '/bin/playwright', 'test', ...args];

  test('accepts the directory form the npm scripts use', () => {
    expect(selectsOnlyFrameworkSpecs(pw('--project=desktop', 'e2e/tests/framework/'))).toBe(true);
  });

  // `--config VALUE` is two argv entries and the value IS a path. Counting it as
  // a selected spec made every framework run look mixed, so the gate connected.
  // (--project is not used in the space-separated form here: it is variadic, so
  // Playwright itself rejects `--project desktop <path>`.)
  test('does not mistake a space-separated flag value for a path filter', () => {
    expect(
      selectsOnlyFrameworkSpecs(
        pw('--config', 'e2e/playwright.config.ts', '--project=desktop', 'e2e/tests/framework/'),
      ),
    ).toBe(true);
  });

  test('handles the --flag=value form too', () => {
    expect(
      selectsOnlyFrameworkSpecs(
        pw('--config=e2e/playwright.config.ts', '--project=desktop', 'e2e/tests/framework/'),
      ),
    ).toBe(true);
  });

  // Playwright does not parse args after `--`. Treating them as filters fails
  // OPEN: a full run would look framework-only and skip the guard silently.
  test('ignores passthrough args after the -- separator', () => {
    expect(selectsOnlyFrameworkSpecs(pw('--', 'tests/framework/x'))).toBe(false);
  });

  // A wrapper or interpreter path containing a `test` segment must not anchor
  // the scan early and pull preceding entries in as filters.
  test('is not confused by a binary path containing a test segment', () => {
    expect(
      selectsOnlyFrameworkSpecs([
        '/opt/test/bin/node',
        '/opt/test/playwright',
        'test',
        'e2e/tests/framework/',
      ]),
    ).toBe(true);
  });

  test('reports false for a full-suite run with no path filter', () => {
    expect(selectsOnlyFrameworkSpecs(pw('--project=desktop', '--grep', '@functional'))).toBe(false);
  });

  test('reports false when an app spec is selected', () => {
    expect(
      selectsOnlyFrameworkSpecs(pw('e2e/tests/apps/minicrm/functional/contacts/c.spec.ts')),
    ).toBe(false);
  });

  test('reports false for a mixed selection', () => {
    expect(
      selectsOnlyFrameworkSpecs(
        pw('e2e/tests/framework/x.spec.ts', 'e2e/tests/apps/minicrm/functional/c.spec.ts'),
      ),
    ).toBe(false);
  });

  // A --grep value that happens to look path-ish must not count as a filter.
  test('does not treat a grep pattern value as a path filter', () => {
    expect(selectsOnlyFrameworkSpecs(pw('--grep', 'tests/framework', '--project=desktop'))).toBe(
      false,
    );
  });
});

test.describe('assertStaleDataGuard — fails closed', () => {
  // AC 3, and the heart of this ticket: "guard skipped" must never be mistaken
  // for "guard passed". Each of these previously hit the warn-and-return path.
  test('throws when the database cannot be reached', async () => {
    await expect(assertStaleDataGuard(configWithArgv(), UNREACHABLE_ENV)).rejects.toThrow(
      /could not query the E2E database/,
    );
  });

  // A run that selects app specs is not framework-only, so the guard applies.
  test('throws for an app-spec selection rather than skipping', async () => {
    await expect(
      assertStaleDataGuard(
        configWithArgv('e2e/tests/apps/minicrm/functional/contacts/contacts.spec.ts'),
        UNREACHABLE_ENV,
      ),
    ).rejects.toThrow(/could not query the E2E database/);
  });

  // A mixed selection must NOT take the framework-only skip — one app spec means
  // the run touches the database.
  test('throws when a framework spec is selected alongside an app spec', async () => {
    await expect(
      assertStaleDataGuard(
        configWithArgv(
          'e2e/tests/framework/test-stack-db-env.spec.ts',
          'e2e/tests/apps/minicrm/functional/contacts/contacts.spec.ts',
        ),
        UNREACHABLE_ENV,
      ),
    ).rejects.toThrow(/could not query the E2E database/);
  });

  test('names the coordinates it tried so the operator can see the target', async () => {
    await expect(assertStaleDataGuard(configWithArgv(), UNREACHABLE_ENV)).rejects.toThrow(
      /127\.0\.0\.1:15433/,
    );
  });

  // The message is printed to a terminal and may be pasted into an issue.
  test('never leaks the password into the error message', async () => {
    const error = await captureRejection(assertStaleDataGuard(configWithArgv(), UNREACHABLE_ENV));

    expect(error).not.toBeNull();
    expect(error?.message).not.toContain('wrong-password');
  });

  test('tells the operator how to start the test stack', async () => {
    await expect(assertStaleDataGuard(configWithArgv(), UNREACHABLE_ENV)).rejects.toThrow(
      /docker compose -f docker-compose\.test\.yml up -d/,
    );
  });
});

test.describe('assertStaleDataGuard — coordinate resolution', () => {
  // AC 1/AC 2: the guard reads the same chain every other consumer uses, so a
  // leftover E2E_DATABASE_URL cannot send it somewhere else.
  test('ignores a leftover E2E_DATABASE_URL pointing at another stack', async () => {
    await expect(
      assertStaleDataGuard(configWithArgv(), {
        ...UNREACHABLE_ENV,
        E2E_DATABASE_URL: 'postgresql://minicrm:password@localhost:5432/minicrm',
      }),
    ).rejects.toThrow(/127\.0\.0\.1:15433/);
  });

  // The dev-port refusal reaches the guard through the shared resolver, so a
  // misconfigured local run cannot count users in the DEV database.
  test('refuses to target the dev port', async () => {
    await expect(
      assertStaleDataGuard(configWithArgv(), { ...UNREACHABLE_ENV, DB_PORT: DEV_DB_PORT }),
    ).rejects.toThrow(/dev database/);
  });

  // Asserted against the resolver directly rather than through a connection
  // attempt: a machine with the test stack up resolves cleanly and throws
  // nothing, so an assertion on the error message would pass vacuously there —
  // including if the guard were deleted outright.
  test('defaults to the test stack port when none is configured', () => {
    const connection = resolveRuntimeTestStackDb({
      DB_HOST: '127.0.0.1',
      DB_USER: 'nobody',
      DB_PASSWORD: 'wrong-password',
    });

    expect(connection.port).toBe(Number(TEST_DB_PORT));
    expect(connection.host).toBe('127.0.0.1');
  });
});

test.describe('StaleDataAbortError', () => {
  // The abort is identified by TYPE now, not by a message prefix. The old
  // startsWith('[globalSetup]') sniff let any error with that prefix escape
  // while swallowing every genuine connection failure.
  test('is distinguishable from a connection failure by instanceof', () => {
    expect(new StaleDataAbortError(2049)).toBeInstanceOf(StaleDataAbortError);
    expect(new Error('[globalSetup] something else entirely')).not.toBeInstanceOf(
      StaleDataAbortError,
    );
  });

  test('reports the user count and the remedy', () => {
    const error = new StaleDataAbortError(2049);

    expect(error.message).toContain('2049 users');
    expect(error.message).toContain('npm run e2e:setup');
  });
});

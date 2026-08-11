/**
 * Unit tests for the pre-push hook's test-stack database resolution.
 * (MINCRM-698)
 *
 * The defect these pin: the hook loads root .env (dev coordinates, DB_PORT=5432)
 * and then qa/e2e/.env (test coordinates, 5433) under a first-write-wins rule,
 * so root permanently shadows the test values. The dev-port guard then read the
 * post-load process.env, saw 5432, and refused EVERY push on a healthy machine
 * with the test stack up and correct — turning a safety guard into a blanket
 * block that trained people to reach for --no-verify.
 *
 * Two rules are pinned here, because the fix depends on both:
 *   1. resolveTestStackDbEnv reads the PRE-FILE environment, so a file-sourced
 *      dev port cannot trip the guard while a real export still does.
 *   2. applyFirstWriteWins documents the precedence that makes (1) necessary —
 *      so a future "fix" that reorders the loads instead is caught by a test
 *      rather than by another blocked push.
 */

import { test, expect } from '@playwright/test';
import {
  resolveTestStackDbEnv,
  resolveRuntimeTestStackDb,
  applyFirstWriteWins,
  parseEnvFileContents,
  pickDbCoordinates,
  DevDatabaseRefusedError,
  DEV_DB_PORT,
  TEST_DB_PORT,
  TEST_DB_NAME,
  TEST_COVERAGE_DB_NAME,
  TEST_DB_USER,
  TEST_DB_PASSWORD,
} from '../../../scripts/test-stack-db-env.js';

test.describe('resolveTestStackDbEnv', () => {
  test('defaults to the test stack when nothing was exported', () => {
    const env = resolveTestStackDbEnv({});

    expect(env.DB_PORT).toBe(TEST_DB_PORT);
    expect(env.DB_HOST).toBe('localhost');
  });

  // The regression itself: root .env's DB_PORT=5432 reaches process.env via
  // loadEnvFile, but is NOT an export — passing undefined here is exactly what
  // the hook now does, and the guard must stay silent.
  test('does not refuse when the dev port came from a .env file rather than an export', () => {
    const env = resolveTestStackDbEnv({});

    expect(env.DB_PORT).toBe(TEST_DB_PORT);
    expect(env.DB_PORT).not.toBe(DEV_DB_PORT);
  });

  // The guard's real contract, preserved: a deliberate export of the dev port is
  // still refused outright. This is the case that stopped a test run truncating
  // the dev database (MINCRM-684) and must not be weakened by the fix.
  test('refuses an explicitly exported dev port', () => {
    expect(() => resolveTestStackDbEnv({ DB_PORT: DEV_DB_PORT })).toThrow(DevDatabaseRefusedError);
  });

  // Same normalization hole as the runtime resolver, and worse here: this function
  // composes DB_PORT for every spawned child, including the destructive seed and
  // truncate scripts. '05432' is !== '5432' as a string but connects as 5432.
  // (MINCRM-699)
  for (const spelling of ['05432', '005432']) {
    test(`refuses a leading-zero spelling of the exported dev port (${spelling})`, () => {
      expect(() => resolveTestStackDbEnv({ DB_PORT: spelling })).toThrow(DevDatabaseRefusedError);
    });
  }

  test('rejects a malformed exported port rather than passing it to children', () => {
    expect(() => resolveTestStackDbEnv({ DB_PORT: ' 5432 ' })).toThrow(/not a valid port/);
    expect(() => resolveTestStackDbEnv({ DB_PORT: '5433.0' })).toThrow(/not a valid port/);
  });

  test('hands children the normalized port spelling', () => {
    expect(resolveTestStackDbEnv({ DB_PORT: '015433' }).DB_PORT).toBe('15433');
  });

  test('honors an exported non-default port for an operator running the stack elsewhere', () => {
    const env = resolveTestStackDbEnv({ DB_PORT: '15433', DB_HOST: '127.0.0.1' });

    expect(env.DB_PORT).toBe('15433');
    expect(env.DB_HOST).toBe('127.0.0.1');
  });

  // Database names are hardcoded, never inherited — a stray DB_NAME in any file
  // or environment must not be able to point a child at the dev database.
  test('always returns the test database names regardless of input', () => {
    const env = resolveTestStackDbEnv({ DB_PORT: '15433', DB_HOST: 'example.internal' });

    expect(env.DB_NAME).toBe(TEST_DB_NAME);
    expect(env.COVERAGE_DB_NAME).toBe(TEST_COVERAGE_DB_NAME);
  });

  // COVERAGE_DB_NAME must be the _e2e database, not _test: E2E runs deposit
  // coverage there, so pointing TIA at the unit-test database would find zero
  // mappings and silently degrade every push to a full-suite run.
  test('points coverage at the e2e database, not the unit-test one', () => {
    const env = resolveTestStackDbEnv({});

    expect(env.COVERAGE_DB_NAME).toBe('minicrm_coverage_e2e');
    expect(env.COVERAGE_DB_NAME).not.toContain('_test');
  });
});

test.describe('applyFirstWriteWins', () => {
  // This is the precedence that makes the pre-file snapshot necessary. If
  // someone later "fixes" the shadowing by reordering the loads or making the
  // second override, this test states what the current code actually does.
  test('lets the first file win for a key both files define', () => {
    const merged = applyFirstWriteWins([{ DB_PORT: '5432' }, { DB_PORT: '5433' }]);

    expect(merged.DB_PORT).toBe('5432');
  });

  test('takes a key from the later file when the earlier one omits it', () => {
    const merged = applyFirstWriteWins([{ DB_PORT: '5432' }, { E2E_ADMIN_EMAIL: 'a@b.test' }]);

    expect(merged.DB_PORT).toBe('5432');
    expect(merged.E2E_ADMIN_EMAIL).toBe('a@b.test');
  });

  test('lets a pre-existing environment value win over every file', () => {
    const merged = applyFirstWriteWins([{ DB_PORT: '5432' }, { DB_PORT: '5433' }], {
      DB_PORT: '15433',
    });

    expect(merged.DB_PORT).toBe('15433');
  });

  // The exact real-world shape: root .env then qa/e2e/.env, both defining the
  // DB coordinates. Root wins — which is why the guard cannot read process.env.
  test('reproduces root .env shadowing qa/e2e/.env for the DB coordinates', () => {
    const rootEnv = { DB_NAME: 'minicrm', DB_PORT: '5432', COVERAGE_DB_NAME: 'minicrm_coverage' };
    const qaEnv = {
      DB_NAME: 'minicrm_e2e',
      DB_PORT: '5433',
      COVERAGE_DB_NAME: 'minicrm_coverage_e2e',
      E2E_ADMIN_EMAIL: 'admin@example.test',
    };

    const merged = applyFirstWriteWins([rootEnv, qaEnv]);

    // Dev values win — the situation the resolver must not be fooled by.
    expect(merged.DB_PORT).toBe('5432');
    expect(merged.DB_NAME).toBe('minicrm');
    // And qa-only keys still arrive, which is why root-first loading is kept.
    expect(merged.E2E_ADMIN_EMAIL).toBe('admin@example.test');
  });
});

// parseEnvFileContents is the parser scripts/pre-push-tia.ts's loadEnvFile
// actually calls — not a copy of it — so these cases constrain the code that
// runs in the hook rather than a parallel implementation that could drift.
test.describe('parseEnvFileContents', () => {
  test('parses KEY=value lines', () => {
    expect(parseEnvFileContents('DB_PORT=5433\nDB_NAME=minicrm_e2e')).toEqual({
      DB_PORT: '5433',
      DB_NAME: 'minicrm_e2e',
    });
  });

  test('skips comments and blank lines', () => {
    expect(parseEnvFileContents('# a comment\n\nDB_PORT=5433\n   \n#another')).toEqual({
      DB_PORT: '5433',
    });
  });

  // Values legitimately contain '=' — a DATABASE_URL query string, a base64
  // secret. Splitting on every '=' would silently truncate them.
  test('keeps everything after the first = so a value containing = survives', () => {
    expect(parseEnvFileContents('DATABASE_URL=postgres://u:p@h:5433/db?opt=1&x=2')).toEqual({
      DATABASE_URL: 'postgres://u:p@h:5433/db?opt=1&x=2',
    });
  });

  test('ignores lines with no =', () => {
    expect(parseEnvFileContents('NOT_AN_ASSIGNMENT\nDB_PORT=5433')).toEqual({ DB_PORT: '5433' });
  });

  // Matches the caller's line-by-line `if (!(key in process.env))` guard: within
  // one file the first occurrence wins, exactly as it did when the check was
  // applied per line against process.env.
  test('keeps the first occurrence when a key is repeated in one file', () => {
    expect(parseEnvFileContents('DB_PORT=5433\nDB_PORT=5432')).toEqual({ DB_PORT: '5433' });
  });

  test('preserves an empty value', () => {
    expect(parseEnvFileContents('BASE_URL=')).toEqual({ BASE_URL: '' });
  });
});

// The precedence chain, and specifically the regression Greptile caught on
// PR #369: an earlier revision of this fix ignored ALL file values in order to
// avoid root .env's dev port, which also discarded a developer's legitimate
// non-default test-stack coordinates in qa/e2e/.env and pinned everyone to
// localhost:5433. Source matters as much as value — root .env is excluded from
// the chain entirely; qa/e2e/.env is authoritative. (MINCRM-698)
test.describe('resolveTestStackDbEnv — precedence', () => {
  test('uses qa/e2e/.env coordinates when nothing is exported', () => {
    const env = resolveTestStackDbEnv({}, { DB_PORT: '15433', DB_HOST: 'test-stack.internal' });

    expect(env.DB_PORT).toBe('15433');
    expect(env.DB_HOST).toBe('test-stack.internal');
  });

  test('lets an explicit export outrank qa/e2e/.env', () => {
    const env = resolveTestStackDbEnv(
      { DB_PORT: '25433', DB_HOST: 'exported.internal' },
      { DB_PORT: '15433', DB_HOST: 'file.internal' },
    );

    expect(env.DB_PORT).toBe('25433');
    expect(env.DB_HOST).toBe('exported.internal');
  });

  test('falls back to the test-stack default when neither source sets a port', () => {
    const env = resolveTestStackDbEnv({}, { DB_HOST: 'file.internal' });

    expect(env.DB_PORT).toBe(TEST_DB_PORT);
    // A host-only file entry still applies.
    expect(env.DB_HOST).toBe('file.internal');
  });

  // Root .env's DB_PORT=5432 must never reach this function — the caller reads
  // qa/e2e/.env directly rather than process.env for exactly that reason. If it
  // ever did arrive via the file argument, refusing is still the right answer.
  test('refuses the dev port even if it somehow arrives from the file source', () => {
    expect(() => resolveTestStackDbEnv({}, { DB_PORT: DEV_DB_PORT })).toThrow(
      DevDatabaseRefusedError,
    );
  });

  test('still refuses an exported dev port that a file would otherwise override', () => {
    expect(() => resolveTestStackDbEnv({ DB_PORT: DEV_DB_PORT }, { DB_PORT: '15433' })).toThrow(
      DevDatabaseRefusedError,
    );
  });
});

test.describe('pickDbCoordinates', () => {
  test('extracts only the DB coordinates', () => {
    expect(
      pickDbCoordinates({ DB_PORT: '15433', DB_HOST: 'h', E2E_ADMIN_EMAIL: 'a@b.test' }),
    ).toEqual({ DB_PORT: '15433', DB_HOST: 'h' });
  });

  // Absent keys are OMITTED, not set to undefined, so the resolver's ?? chain
  // falls through to the next source instead of stopping on an explicit undefined.
  test('omits absent keys rather than setting them undefined', () => {
    const picked = pickDbCoordinates({ E2E_ADMIN_EMAIL: 'a@b.test' });

    expect(picked).toEqual({});
    expect('DB_PORT' in picked).toBe(false);
  });

  test('treats an empty value as absent', () => {
    expect(pickDbCoordinates({ DB_PORT: '', DB_HOST: 'h' })).toEqual({ DB_HOST: 'h' });
  });
});

// Credentials follow the same chain as host/port, and are returned by the
// resolver rather than left to each caller. pre-push-tia.ts previously handed
// children a corrected host/port while DB_USER/DB_PASSWORD still fell through
// from root .env's DEV values — latent only because both stacks currently share
// minicrm/password. (MINCRM-698, PR #369 review)
test.describe('resolveTestStackDbEnv — credentials', () => {
  test('defaults to the test-stack credentials', () => {
    const env = resolveTestStackDbEnv({});

    expect(env.DB_USER).toBe(TEST_DB_USER);
    expect(env.DB_PASSWORD).toBe(TEST_DB_PASSWORD);
  });

  test('uses qa/e2e/.env credentials when nothing is exported', () => {
    const env = resolveTestStackDbEnv({}, { DB_USER: 'test_user', DB_PASSWORD: 'test_pw' });

    expect(env.DB_USER).toBe('test_user');
    expect(env.DB_PASSWORD).toBe('test_pw');
  });

  test('lets an explicit export outrank qa/e2e/.env credentials', () => {
    const env = resolveTestStackDbEnv(
      { DB_USER: 'exported_user', DB_PASSWORD: 'exported_pw' },
      { DB_USER: 'file_user', DB_PASSWORD: 'file_pw' },
    );

    expect(env.DB_USER).toBe('exported_user');
    expect(env.DB_PASSWORD).toBe('exported_pw');
  });

  // The regression this closes: root .env's DEV credentials must never reach a
  // child. They are not in either source, so the test-stack defaults win.
  test('never inherits credentials from an unlisted source', () => {
    const env = resolveTestStackDbEnv({}, { DB_PORT: '15433' });

    expect(env.DB_USER).toBe(TEST_DB_USER);
    expect(env.DB_PASSWORD).toBe(TEST_DB_PASSWORD);
  });
});

test.describe('pickDbCoordinates — credentials', () => {
  test('extracts credentials alongside host and port', () => {
    expect(
      pickDbCoordinates({ DB_PORT: '15433', DB_USER: 'u', DB_PASSWORD: 'p', OTHER: 'x' }),
    ).toEqual({ DB_PORT: '15433', DB_USER: 'u', DB_PASSWORD: 'p' });
  });
});

// The runtime half of the chain (MINCRM-699). resolveTestStackDbEnv PRODUCES the
// environment for spawned children; this CONSUMES the one that arrived, so a
// Playwright child reaches the stack its parent resolved rather than a separately
// composed E2E_DATABASE_URL that could disagree with it.
test.describe('resolveRuntimeTestStackDb', () => {
  test('defaults to the test stack when the environment carries no coordinates', () => {
    expect(resolveRuntimeTestStackDb({})).toEqual({
      host: 'localhost',
      port: Number(TEST_DB_PORT),
      database: TEST_DB_NAME,
      user: TEST_DB_USER,
      password: TEST_DB_PASSWORD,
    });
  });

  test('honors each coordinate the parent composed', () => {
    const connection = resolveRuntimeTestStackDb({
      DB_HOST: 'db.internal',
      DB_PORT: '15433',
      DB_USER: 'test_user',
      DB_PASSWORD: 'test_pw',
    });

    expect(connection.host).toBe('db.internal');
    expect(connection.port).toBe(15433);
    expect(connection.user).toBe('test_user');
    expect(connection.password).toBe('test_pw');
  });

  // A stale E2E_DATABASE_URL left in the environment must not influence the
  // result: the retired variable is not consulted, so a developer who edits
  // DB_PORT and forgets the URL gets the stack they configured. (AC 1/AC 2)
  test('ignores a leftover E2E_DATABASE_URL pointing somewhere else', () => {
    const connection = resolveRuntimeTestStackDb({
      DB_HOST: 'other-host',
      DB_PORT: '15999',
      E2E_DATABASE_URL: 'postgresql://minicrm:password@localhost:5432/minicrm',
    });

    expect(connection).toMatchObject({ host: 'other-host', port: 15999 });
    expect(connection.database).toBe(TEST_DB_NAME);
  });

  // DB_NAME is pinned, matching resolveTestStackDbEnv: every live producer already
  // sets it to this value, and hardcoding keeps a stray name from redirecting the
  // guard at the dev database.
  test('ignores an environment-supplied DB_NAME in favor of the test database', () => {
    expect(resolveRuntimeTestStackDb({ DB_NAME: 'minicrm' }).database).toBe(TEST_DB_NAME);
  });

  test('refuses the dev port off CI', () => {
    expect(() => resolveRuntimeTestStackDb({ DB_PORT: DEV_DB_PORT })).toThrow(
      DevDatabaseRefusedError,
    );
  });

  // The invariant, not the implementation's shape: NO input may resolve to the dev
  // port off CI. A raw-string comparison lets '05432' through (it is !== '5432')
  // and then Number()s to 5432 — the dev database. These fail if the format check
  // and the port comparison are ever reordered, which a corpus of purely malformed
  // values would not catch.
  for (const spelling of ['05432', '005432']) {
    test(`refuses a leading-zero spelling of the dev port (${spelling})`, () => {
      expect(() => resolveRuntimeTestStackDb({ DB_PORT: spelling })).toThrow(
        DevDatabaseRefusedError,
      );
    });
  }

  test('never resolves to the dev port off CI, for any accepted input', () => {
    for (const candidate of ['5432', '05432', '005432', ' 5432 ', '5432.0']) {
      let resolvedPort: number | undefined;
      try {
        resolvedPort = resolveRuntimeTestStackDb({ DB_PORT: candidate }).port;
      } catch {
        continue; // Refused or rejected as malformed — both are correct outcomes.
      }
      expect(resolvedPort, `DB_PORT="${candidate}" resolved to the dev port`).not.toBe(
        Number(DEV_DB_PORT),
      );
    }
  });

  // CI's Postgres service container genuinely listens on 5432, so the
  // dev-port rule is a local-machine property — the same carve-out
  // server/src/scripts/assertTestDatabaseTarget.ts applies.
  test('allows the dev port under CI, where 5432 is the service container', () => {
    expect(resolveRuntimeTestStackDb({ DB_PORT: DEV_DB_PORT, CI: 'true' }).port).toBe(
      Number(DEV_DB_PORT),
    );
  });

  // Matches assertTestDatabaseTarget's /^\d+$/ rule. A plain Number() check would
  // accept every one of these: ' 5432 ' and '5432.0' coerce to the DEV port, which
  // would slip past the refusal above.
  for (const malformed of ['not-a-port', ' 5433 ', '5433.0', '0', '-1', '5433abc', '65536']) {
    test(`rejects a malformed DB_PORT (${JSON.stringify(malformed)})`, () => {
      expect(() => resolveRuntimeTestStackDb({ DB_PORT: malformed })).toThrow(/not a valid port/);
    });
  }

  // Matches pickDbCoordinates' empty-is-absent rule: `DB_PORT=` in a sourced .env
  // must fall through to the default rather than resolving to port 0.
  test('treats empty values as absent', () => {
    expect(resolveRuntimeTestStackDb({ DB_HOST: '', DB_PORT: '' })).toMatchObject({
      host: 'localhost',
      port: Number(TEST_DB_PORT),
    });
  });
});

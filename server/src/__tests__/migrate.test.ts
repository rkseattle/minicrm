/**
 * Regression coverage for the migration advisory lock (MINCRM-658).
 *
 * Uses the real minicrm_test database (per project convention — no mocked DB).
 * Fixture migrations live in a temp directory created per test so this suite
 * never touches the real db/migrations set or its pgmigrations rows.
 */

import 'dotenv/config';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { runner as migrationRunner } from 'node-pg-migrate';
import pool from '../db.js';
import {
  withMigrationLock,
  assertBaselineCoverageMatches,
  runCoverageMigrations,
  runMigrations,
} from '../migrate.js';
import { assertTestDatabasePort } from '../scripts/assertTestDatabaseTarget.js';

// No 5432 default: this file creates and drops scratch databases, so a wrong port acts
// on the dev instance. globalSetup validates first, making this belt-and-braces.
const DB_PORT = assertTestDatabasePort('migrate.test');
const { DB_USER, DB_PASSWORD, DB_NAME, DB_HOST = 'localhost' } = process.env;
const databaseUrl = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

const FIXTURE_TABLE = 'migrate_lock_test_widgets';
const FIXTURE_MIGRATIONS_TABLE = 'pgmigrations_lock_test';

function writeFixtureMigration(dir: string): void {
  const contents = `
exports.up = (pgm) => {
  pgm.createTable('${FIXTURE_TABLE}', {
    id: { type: 'serial', primaryKey: true },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('${FIXTURE_TABLE}');
};
`;
  writeFileSync(join(dir, '001_create_widgets.js'), contents);
}

async function dropFixtureState(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${FIXTURE_TABLE}`);
  await pool.query(`DROP TABLE IF EXISTS ${FIXTURE_MIGRATIONS_TABLE}`);
}

describe('withMigrationLock', () => {
  afterEach(async () => {
    await dropFixtureState();
  });

  it('serializes two concurrent callers so the second only runs after the first releases', async () => {
    const events: string[] = [];

    const first = withMigrationLock(databaseUrl, async () => {
      events.push('first-start');
      await new Promise((resolve) => setTimeout(resolve, 300));
      events.push('first-end');
    });

    // Give the first call a head start so it reliably acquires the lock first.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = withMigrationLock(databaseUrl, async () => {
      events.push('second-start');
      events.push('second-end');
    });

    await Promise.all([first, second]);

    expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('respects MIGRATION_LOCK_TIMEOUT_MS to fail fast sooner than the default 60s', async () => {
    const originalTimeout = process.env.MIGRATION_LOCK_TIMEOUT_MS;
    process.env.MIGRATION_LOCK_TIMEOUT_MS = '200';

    try {
      const holder = withMigrationLock(databaseUrl, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      });

      // Give the holder a head start so it reliably acquires the lock first.
      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(withMigrationLock(databaseUrl, async () => {})).rejects.toThrow(
        /Timed out after 200ms waiting for migration lock/,
      );

      await holder;
    } finally {
      if (originalTimeout === undefined) {
        delete process.env.MIGRATION_LOCK_TIMEOUT_MS;
      } else {
        process.env.MIGRATION_LOCK_TIMEOUT_MS = originalTimeout;
      }
    }
  });

  it('releases the lock even when the wrapped function throws, so a subsequent caller is not blocked', async () => {
    await expect(
      withMigrationLock(databaseUrl, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const events: string[] = [];
    await withMigrationLock(databaseUrl, async () => {
      events.push('ran-after-failure');
    });

    expect(events).toEqual(['ran-after-failure']);
  });

  it('does not record a pgmigrations row without its schema change when two real migration runs race', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'mincrm-migrate-lock-test-'));
    writeFixtureMigration(fixtureDir);

    const SHARED_OPTIONS = {
      databaseUrl,
      dir: fixtureDir,
      direction: 'up' as const,
      migrationsTable: FIXTURE_MIGRATIONS_TABLE,
      checkOrder: false,
      log: () => {},
      // node-pg-migrate takes its own internal advisory lock around every
      // migrationRunner() call by default, which would make this test pass
      // even without withMigrationLock. Disabling it here means the assertions
      // below can only hold if withMigrationLock is doing the serializing.
      noLock: true,
    };

    try {
      // Two concurrent runs against the same fixture migration, each wrapped in
      // the shared lock — this is the exact race from MINCRM-658 (two migration
      // runners against the same database), just against a throwaway fixture
      // table instead of the real schema.
      await Promise.all([
        withMigrationLock(databaseUrl, () => migrationRunner(SHARED_OPTIONS)),
        withMigrationLock(databaseUrl, () => migrationRunner(SHARED_OPTIONS)),
      ]);

      const { rows: migrationRows } = await pool.query(
        `SELECT name FROM ${FIXTURE_MIGRATIONS_TABLE}`,
      );
      const { rows: tableRows } = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
        [FIXTURE_TABLE],
      );

      // The migration is recorded exactly once (no duplicate/corrupted row from
      // the race) and its schema change actually landed.
      expect(migrationRows).toHaveLength(1);
      expect(tableRows).toHaveLength(1);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

describe('assertBaselineCoverageMatches', () => {
  it("throws when BASELINE_COVERED_MIGRATION_COUNT disagrees with 000_baseline.js's own declared coverage", () => {
    // Simulates a stale server build (old migrate.ts, old constant) paired with
    // a rebuilt/newer baseline file, or vice versa — the exact bidirectional
    // drift a same-numbered-file-exists check alone cannot catch, since files
    // are never deleted when the baseline is regenerated (MINCRM-658).
    expect(() =>
      assertBaselineCoverageMatches(152, 136, ['001_create_users.js', '152_add_x.js']),
    ).toThrow(
      /does not match db\/migrations\/000_baseline\.js's baselineCoveredMigrationCount \(136\)/,
    );
  });

  it('throws when the migrations directory is missing files within the covered range (gap detection)', () => {
    // baselineCoveredCount (152) matches expectedCount (152), so this exercises
    // the gap check in isolation: the directory is missing files even though
    // the migration numbered exactly 152 is present.
    expect(() =>
      assertBaselineCoverageMatches(152, 152, [
        '001_create_users.js',
        '152_add_followup_timing_suggestions.js',
      ]),
    ).toThrow(/is missing: 2, 3, 4/);
  });

  it('does not throw when the count and directory both match', () => {
    const filenames = Array.from({ length: 5 }, (_, i) => `${String(i + 1).padStart(3, '0')}_x.js`);

    expect(() => assertBaselineCoverageMatches(5, 5, filenames)).not.toThrow();
  });
});

describe('runCoverageMigrations', () => {
  // Regression coverage for the "coverage database stays unprovisioned"
  // finding from Greptile PR review: a fresh environment had no path to
  // create the coverage database at all, so the first session/ingestion/
  // mapping request failed with "database ... does not exist" — reproduced
  // live in CI's server-tests job. Uses a throwaway, uniquely-named
  // database per test run (never the real minicrm_coverage_test other
  // suites share) so this test genuinely proves "creates a database that
  // does not exist yet" rather than exercising an already-provisioned one.
  const testDbName = `migrate_test_coverage_db_${randomUUID().replace(/-/g, '_')}`;
  const adminDatabaseUrl = `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST ?? 'localhost'}:${DB_PORT}/postgres`;

  afterEach(async () => {
    const adminClient = new pg.Client({ connectionString: adminDatabaseUrl });
    await adminClient.connect();
    try {
      // Terminate any lingering connections before dropping — a held
      // connection from this same test process would otherwise block DROP DATABASE.
      await adminClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [testDbName],
      );
      await adminClient.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
    } finally {
      await adminClient.end();
    }
  });

  it('creates the coverage database when it does not exist, then migrates it', async () => {
    process.env.COVERAGE_DB_NAME = testDbName;
    try {
      await runCoverageMigrations();

      const adminClient = new pg.Client({ connectionString: adminDatabaseUrl });
      await adminClient.connect();
      try {
        const { rows } = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [
          testDbName,
        ]);
        expect(rows).toHaveLength(1);
      } finally {
        await adminClient.end();
      }

      const coverageClient = new pg.Client({
        connectionString: `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST ?? 'localhost'}:${DB_PORT}/${testDbName}`,
      });
      await coverageClient.connect();
      try {
        const { rows } = await coverageClient.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'coverage_units'`,
        );
        expect(rows).toHaveLength(1);
      } finally {
        await coverageClient.end();
      }
    } finally {
      delete process.env.COVERAGE_DB_NAME;
    }
  });

  it('is idempotent — calling it again against an already-provisioned database is a no-op that does not throw', async () => {
    process.env.COVERAGE_DB_NAME = testDbName;
    try {
      await runCoverageMigrations();
      await expect(runCoverageMigrations()).resolves.not.toThrow();
    } finally {
      delete process.env.COVERAGE_DB_NAME;
    }
  });

  it('does not crash when two callers race to create the same not-yet-existing database (Greptile PR feedback)', async () => {
    // Regression test: ensureCoverageDatabaseExists' existence check and its
    // CREATE DATABASE were two separate statements, so two server replicas
    // starting concurrently against a fresh Postgres instance could both
    // observe "absent" and both attempt CREATE DATABASE — the loser crashed
    // on startup with a duplicate_database error instead of just treating
    // the database as now-existing (which is all any caller actually needs).
    process.env.COVERAGE_DB_NAME = testDbName;
    try {
      await expect(
        Promise.all([runCoverageMigrations(), runCoverageMigrations()]),
      ).resolves.not.toThrow();

      const adminClient = new pg.Client({ connectionString: adminDatabaseUrl });
      await adminClient.connect();
      try {
        const { rows } = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [
          testDbName,
        ]);
        expect(rows).toHaveLength(1);
      } finally {
        await adminClient.end();
      }
    } finally {
      delete process.env.COVERAGE_DB_NAME;
    }
  });

  it('connects successfully when COVERAGE_DB_PASSWORD contains URL-reserved characters (Greptile PR feedback)', async () => {
    // Regression test: databaseUrl was built via raw string interpolation of
    // user/password directly into postgres://user:pass@host/db — a character
    // like @, :, /, %, ?, or # in the password would change how the URL is
    // parsed, even though a structured pg.Client({ user, password, ... })
    // config (as ensureCoverageDatabaseExists uses) accepts the same
    // credentials verbatim. Creates a throwaway Postgres role whose password
    // contains '@' and ':' to prove the built connection string round-trips
    // correctly through encodeURIComponent.
    const reservedCharPassword = 'p@ss:word/with#reserved%chars?';
    const throwawayRole = `migrate_test_role_${randomUUID().replace(/-/g, '_')}`;

    const adminClient = new pg.Client({ connectionString: adminDatabaseUrl });
    await adminClient.connect();
    try {
      await adminClient.query(
        `CREATE ROLE "${throwawayRole}" WITH LOGIN SUPERUSER PASSWORD '${reservedCharPassword.replace(/'/g, "''")}'`,
      );
    } finally {
      await adminClient.end();
    }

    process.env.COVERAGE_DB_NAME = testDbName;
    process.env.COVERAGE_DB_USER = throwawayRole;
    process.env.COVERAGE_DB_PASSWORD = reservedCharPassword;
    try {
      await expect(runCoverageMigrations()).resolves.not.toThrow();
    } finally {
      delete process.env.COVERAGE_DB_NAME;
      delete process.env.COVERAGE_DB_USER;
      delete process.env.COVERAGE_DB_PASSWORD;

      // Drop the database THIS role owns (created via CREATE DATABASE as
      // throwawayRole above) before dropping the role itself — the outer
      // describe's own afterEach also drops testDbName, but only after this
      // finally block runs, and Postgres refuses to drop a role that still
      // owns a database.
      const cleanupClient = new pg.Client({ connectionString: adminDatabaseUrl });
      await cleanupClient.connect();
      try {
        await cleanupClient.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [testDbName],
        );
        await cleanupClient.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
        await cleanupClient.query(`DROP ROLE IF EXISTS "${throwawayRole}"`);
      } finally {
        await cleanupClient.end();
      }
    }
  });
});

describe('runMigrations', () => {
  // Regression coverage mirroring the identical fix/test for
  // runCoverageMigrations() above (MINCRM-664, found via Greptile PR review):
  // databaseUrl was built via raw string interpolation of user/password
  // directly into postgres://user:pass@host/db — a character like @, :, /, %,
  // ?, or # in the password would change how the URL is parsed, even though a
  // structured pg.Client({ user, password, ... }) config accepts the same
  // credentials verbatim. Creates a throwaway superuser role granted against
  // the existing minicrm_test database (runMigrations(), unlike
  // runCoverageMigrations(), has no "create the database if missing" step —
  // it always targets the already-provisioned DB_NAME) whose password
  // contains reserved characters, to prove the built connection string
  // round-trips correctly through encodeURIComponent. runMigrations() is
  // idempotent against an already-migrated database (see its own docblock),
  // so calling it under the throwaway role only proves the connection itself
  // succeeds — it is not expected to apply any new schema changes.
  it('connects successfully when DB_PASSWORD contains URL-reserved characters (Greptile PR feedback)', async () => {
    const reservedCharPassword = 'p@ss:word/with#reserved%chars?';
    const throwawayRole = `migrate_test_role_${randomUUID().replace(/-/g, '_')}`;

    const adminClient = new pg.Client({ connectionString: databaseUrl });
    await adminClient.connect();
    try {
      await adminClient.query(
        `CREATE ROLE "${throwawayRole}" WITH LOGIN SUPERUSER PASSWORD '${reservedCharPassword.replace(/'/g, "''")}'`,
      );
    } finally {
      await adminClient.end();
    }

    const originalDbUser = process.env.DB_USER;
    const originalDbPassword = process.env.DB_PASSWORD;
    process.env.DB_USER = throwawayRole;
    process.env.DB_PASSWORD = reservedCharPassword;
    try {
      await expect(runMigrations()).resolves.not.toThrow();
    } finally {
      if (originalDbUser === undefined) {
        delete process.env.DB_USER;
      } else {
        process.env.DB_USER = originalDbUser;
      }
      if (originalDbPassword === undefined) {
        delete process.env.DB_PASSWORD;
      } else {
        process.env.DB_PASSWORD = originalDbPassword;
      }

      const cleanupClient = new pg.Client({ connectionString: databaseUrl });
      await cleanupClient.connect();
      try {
        await cleanupClient.query(`DROP ROLE IF EXISTS "${throwawayRole}"`);
      } finally {
        await cleanupClient.end();
      }
    }
  });
});

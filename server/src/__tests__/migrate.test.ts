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
import { runner as migrationRunner } from 'node-pg-migrate';
import pool from '../db.js';
import { withMigrationLock, assertBaselineCoverageMatches } from '../migrate.js';

const { DB_USER, DB_PASSWORD, DB_NAME, DB_HOST = 'localhost', DB_PORT = '5432' } = process.env;
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

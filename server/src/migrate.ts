/**
 * Runs all pending database migrations using node-pg-migrate's programmatic API.
 * Safe to call on every startup — already-applied migrations are skipped.
 *
 * Uses the two-step fresh-bootstrap strategy (MINCRM-528) so this function works
 * correctly on a brand-new database as well as an already-migrated one:
 *   1. Run count:1 — applies 000_baseline if not yet applied (no-op otherwise).
 *   2. Fake-mark the remaining baseline-covered migrations so they are never
 *      re-executed (no-op when they are already recorded in pgmigrations).
 *   3. Run all remaining truly-pending migrations for real.
 *
 * The whole sequence is wrapped in a Postgres advisory lock (MINCRM-658) so that
 * concurrent invocations — e.g. `server-e2e`'s boot-time runMigrations() racing
 * a developer's `npm run e2e:setup` against the same database — serialize instead
 * of interleaving. See docs/dev/migrations.md "Concurrency & Locking".
 */

import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { readdirSync } from 'fs';
import { createRequire } from 'module';
import { runner as migrationRunner } from 'node-pg-migrate';
import pg from 'pg';
import logger from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Absolute path to the migrations directory */
export const MIGRATIONS_DIR = resolve(__dirname, '../../db/migrations');

/**
 * Advisory lock key for the migration sequence. Postgres advisory locks are
 * keyed by a bigint; this is a fixed, arbitrary constant unique to migrations
 * within this application (chosen so it does not collide with any other
 * advisory lock usage — there is none elsewhere in this codebase as of
 * MINCRM-658). Kept within Number.MAX_SAFE_INTEGER so pg can bind it as a
 * plain JS number rather than needing BigInt parameter support.
 * Session-scoped: held by one client connection for the lifetime of the
 * migration run, released explicitly or on disconnect.
 */
const MIGRATION_LOCK_KEY = 658_136_001;

/** How often to retry acquiring the migration lock while another process holds it. */
const LOCK_POLL_INTERVAL_MS = 500;

/**
 * Default total time to wait for the migration lock before failing fast.
 * Generous relative to a normal fresh-install run (target: under 10s, see
 * docs/dev/migrations.md), but a real production migration (e.g. a large
 * CREATE INDEX added in a future migration) can legitimately run longer —
 * override via MIGRATION_LOCK_TIMEOUT_MS so a waiting caller isn't forced to
 * fail behind a healthy, still-in-progress migration during a slow deploy.
 */
const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 60_000;

function getLockWaitTimeoutMs(): number {
  const override = Number(process.env.MIGRATION_LOCK_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_LOCK_WAIT_TIMEOUT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquires the migration advisory lock, runs `fn`, then releases the lock.
 * Polls `pg_try_advisory_lock` rather than blocking on `pg_advisory_lock` so a
 * timeout can be enforced — a stuck or crashed lock holder fails loudly rather
 * than hanging every subsequent server boot or `e2e:setup` invocation forever.
 */
export async function withMigrationLock<T>(databaseUrl: string, fn: () => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let acquired = false;
  const lockWaitTimeoutMs = getLockWaitTimeoutMs();

  try {
    const deadline = Date.now() + lockWaitTimeoutMs;

    while (Date.now() < deadline) {
      const { rows } = await client.query<{ pg_try_advisory_lock: boolean }>(
        'SELECT pg_try_advisory_lock($1)',
        [MIGRATION_LOCK_KEY],
      );
      acquired = rows[0].pg_try_advisory_lock;

      if (acquired) {
        break;
      }

      logger.info('Migration lock held by another process, waiting...');
      await sleep(LOCK_POLL_INTERVAL_MS);
    }

    if (!acquired) {
      throw new Error(
        `Timed out after ${lockWaitTimeoutMs}ms waiting for migration lock — another migration run appears stuck, or set MIGRATION_LOCK_TIMEOUT_MS higher if a legitimate migration is expected to take longer. Investigate the other process before retrying.`,
      );
    }

    return await fn();
  } finally {
    // Only unlock if this session actually acquired the lock — calling
    // pg_advisory_unlock on a lock this session never held returns false and
    // logs a spurious server-side WARNING on every timeout, which would add
    // noise during an on-call investigation of a stuck migration lock.
    if (acquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    }
    await client.end();
  }
}

/**
 * Number of migrations (001-N) that 000_baseline.js was last regenerated to cover.
 * This MUST be updated whenever 000_baseline.js is regenerated (see
 * docs/dev/migrations.md "Regenerating the Baseline") — it bounds the fake-mark
 * step so only migrations baseline actually captures are skipped; any migration
 * added after the last baseline regeneration is left pending and runs for real.
 *
 * Counting every .js file on disk except the baseline (the previous approach)
 * is wrong: it silently fake-marks (i.e. never executes) every migration added
 * since the baseline snapshot was taken, so their schema changes are never
 * applied on a fresh bootstrap (globalSetup.ts, migrate:fresh) — this broke
 * silently for the first migration added after MINCRM-528 shipped baseline
 * coverage through migration 136.
 */
export const BASELINE_COVERED_MIGRATION_COUNT = 152;

/** Matches the leading numeric prefix of a migration filename, e.g. "007" in "007_add_x.js". */
const MIGRATION_FILENAME_PREFIX = /^(\d+)_/;

/** Path to the baseline migration file, whose exports.baselineCoveredMigrationCount is the source of truth this function validates against. */
const BASELINE_FILE = resolve(MIGRATIONS_DIR, '000_baseline.js');

/**
 * Validates BASELINE_COVERED_MIGRATION_COUNT two ways (MINCRM-658) rather than
 * trusting the constant blindly. Pure function of its inputs so it can be unit
 * tested directly, without mocking fs or the require() of the baseline file.
 *
 *  1. Against 000_baseline.js's own declared coverage (`baselineCoveredCount`)
 *     — this catches drift in BOTH directions (a stale server build's constant
 *     that is lower than what the actual baseline file covers, e.g. an old
 *     migrate.ts paired with a rebuilt/newer baseline; or higher, e.g. the
 *     reverse). A same-numbered migration file is never deleted when the
 *     baseline is regenerated, so checking "does file N exist" alone cannot
 *     detect the stale-low case — only comparing against the baseline file's
 *     own declared coverage can.
 *  2. Against gaps in migration files 1..N on disk (`migrationFilenames`) —
 *     catches a partial/corrupt rebuild (e.g. a bad Docker layer copy) that is
 *     missing some files in that range even though the highest-numbered one
 *     happens to be present.
 *
 * Fails fast with a clear error on either mismatch instead of silently
 * mis-skipping or mis-executing migrations.
 */
export function assertBaselineCoverageMatches(
  expectedCount: number,
  baselineCoveredCount: number | undefined,
  migrationFilenames: string[],
): void {
  if (baselineCoveredCount !== expectedCount) {
    throw new Error(
      `BASELINE_COVERED_MIGRATION_COUNT in server/src/migrate.ts (${expectedCount}) does not match db/migrations/000_baseline.js's baselineCoveredMigrationCount (${baselineCoveredCount}) — these two files have drifted apart (e.g. a stale server build paired with a rebuilt migrations directory, or vice versa). Rebuild so both agree before running migrations.`,
    );
  }

  const coveredNumbers = new Set(
    migrationFilenames
      .map((file) => MIGRATION_FILENAME_PREFIX.exec(file))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1])),
  );
  const missing: number[] = [];
  for (let n = 1; n <= expectedCount; n++) {
    if (!coveredNumbers.has(n)) {
      missing.push(n);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `BASELINE_COVERED_MIGRATION_COUNT (${expectedCount}) expects migrations 1-${expectedCount} on disk, but ${MIGRATIONS_DIR} is missing: ${missing.join(', ')}. The migrations directory is incomplete — rebuild before running migrations.`,
    );
  }
}

/**
 * Count of migration files covered by 000_baseline. Used to bound the fake-mark
 * step so post-baseline migrations are not skipped. See
 * assertBaselineCoverageMatches() for the validation this performs.
 */
export function countBaselineCoveredMigrations(): number {
  const baseline = require(BASELINE_FILE) as { baselineCoveredMigrationCount?: number };
  const files = readdirSync(MIGRATIONS_DIR);

  assertBaselineCoverageMatches(
    BASELINE_COVERED_MIGRATION_COUNT,
    baseline.baselineCoveredMigrationCount,
    files,
  );

  return BASELINE_COVERED_MIGRATION_COUNT;
}

export async function runMigrations(): Promise<void> {
  const databaseUrl = `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`;

  logger.info('Running database migrations...');

  const SHARED_OPTIONS = {
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up' as const,
    migrationsTable: 'pgmigrations',
    checkOrder: false, // 000_baseline was added after 001-101 on existing DBs (MINCRM-528)
    log: (msg: string) => logger.debug(msg),
  };

  await withMigrationLock(databaseUrl, async () => {
    // Step 1: apply 000_baseline (no-op if already applied).
    await migrationRunner({ ...SHARED_OPTIONS, count: 1 });

    // Step 2: fake-mark all baseline-covered migrations (no-op if already recorded).
    const baselineCoveredCount = countBaselineCoveredMigrations();
    await migrationRunner({ ...SHARED_OPTIONS, fake: true, count: baselineCoveredCount });

    // Step 3: run any truly-pending migrations (post-baseline) for real.
    await migrationRunner(SHARED_OPTIONS);
  });

  logger.info('Migrations complete.');
}

/** Absolute path to the coverage/TIA migrations directory — a separate node-pg-migrate sequence from db/migrations/, see qa/migrations/001_coverage_baseline.js's own docblock for why. */
export const COVERAGE_MIGRATIONS_DIR = resolve(__dirname, '../../qa/migrations');

/**
 * Postgres error codes a losing concurrent CREATE DATABASE can surface —
 * both mean "the database now exists, just not because of this call".
 * duplicate_database (42P04) is the friendlier, name-level check Postgres
 * normally raises; under a tight enough race it can instead surface the
 * lower-level unique_violation (23505) on pg_database's own datname index
 * before that name-level check runs (reproduced live in a concurrent-caller
 * regression test — see the "does not crash when two callers race" test in
 * migrate.test.ts).
 */
const PG_DUPLICATE_DATABASE = '42P04';
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Ensures the coverage/TIA database itself exists before migrating it.
 * Unlike the product database (created out-of-band — POSTGRES_DB at
 * container init locally, or an operator-provisioned database in
 * production), the coverage database has no equivalent creation path: a
 * fresh deployment that enables any coverage feature would otherwise fail
 * on the very first session/ingestion/mapping request with "database
 * ... does not exist" (found via Greptile PR review — this was reproducing
 * in CI, whose server-tests job creates only the product test database).
 *
 * CREATE DATABASE cannot run inside a transaction or migration, so this
 * connects to the ambient 'postgres' maintenance database directly, the
 * same pattern qa/scripts/create-coverage-e2e-db.ts and
 * server/src/scripts/create-e2e-db.ts already use for their own databases.
 *
 * The existence check and the CREATE are two separate statements, so two
 * server replicas starting concurrently against a fresh Postgres instance
 * can both observe "absent" and both attempt CREATE DATABASE — the loser
 * would otherwise crash on startup with a duplicate_database error (found
 * via Greptile PR review). Catching that specific error code and treating
 * it as success is the standard way to make CREATE DATABASE idempotent
 * under concurrent callers: by the time this function returns, the
 * database exists either way, which is the only guarantee callers need.
 */
async function ensureCoverageDatabaseExists(): Promise<void> {
  const dbUser = process.env.COVERAGE_DB_USER ?? process.env.DB_USER;
  const dbPassword = process.env.COVERAGE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  const dbHost = process.env.COVERAGE_DB_HOST ?? process.env.DB_HOST ?? 'localhost';
  const dbPort = Number(process.env.COVERAGE_DB_PORT) || Number(process.env.DB_PORT) || 5432;
  const coverageDbName = process.env.COVERAGE_DB_NAME ?? 'minicrm_coverage';

  const adminClient = new pg.Client({
    user: dbUser,
    password: dbPassword,
    host: dbHost,
    port: dbPort,
    database: 'postgres',
  });

  await adminClient.connect();
  try {
    const { rows } = await adminClient.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [coverageDbName],
    );
    if (!rows[0].exists) {
      try {
        // datname cannot be parameterized in CREATE DATABASE.
        await adminClient.query(`CREATE DATABASE "${coverageDbName.replace(/"/g, '""')}"`);
        logger.info({ coverageDbName }, 'Created coverage database');
      } catch (err) {
        const isConcurrentCreation =
          err instanceof Error &&
          'code' in err &&
          (err.code === PG_DUPLICATE_DATABASE || err.code === PG_UNIQUE_VIOLATION);
        if (isConcurrentCreation) {
          logger.info(
            { coverageDbName },
            'Coverage database was created concurrently by another process',
          );
        } else {
          throw err;
        }
      }
    }
  } finally {
    await adminClient.end();
  }
}

/**
 * Runs all pending coverage/TIA migrations (qa/migrations/), creating the
 * coverage database first if it doesn't exist yet. Safe to call on every
 * startup, mirroring runMigrations()'s own idempotency — already-applied
 * migrations are skipped. No baseline/fake-mark bootstrap needed here
 * (unlike runMigrations above) — the coverage schema has no 000_baseline;
 * it starts fresh at 001, so a plain sequential migration run suffices.
 *
 * Called from server.ts's own startup sequence, alongside runMigrations(),
 * so a server can never finish booting with an unprovisioned coverage
 * database — the same fail-fast guarantee the product database already has.
 */
export async function runCoverageMigrations(): Promise<void> {
  await ensureCoverageDatabaseExists();

  const coverageDbName = process.env.COVERAGE_DB_NAME ?? 'minicrm_coverage';
  const coverageDbUser = process.env.COVERAGE_DB_USER ?? process.env.DB_USER ?? '';
  const coverageDbPassword = process.env.COVERAGE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '';
  const coverageDbHost = process.env.COVERAGE_DB_HOST ?? process.env.DB_HOST ?? 'localhost';
  const coverageDbPort = process.env.COVERAGE_DB_PORT ?? process.env.DB_PORT ?? '5432';
  // encodeURIComponent on user/password: a URL-reserved character in either
  // (e.g. @, :, /, %, ?, #) would otherwise change how postgres:// is parsed
  // even though the structured pg.Client config in ensureCoverageDatabaseExists
  // above accepts the same credentials verbatim — found via Greptile PR review.
  const databaseUrl = `postgres://${encodeURIComponent(coverageDbUser)}:${encodeURIComponent(coverageDbPassword)}@${coverageDbHost}:${coverageDbPort}/${coverageDbName}`;

  logger.info('Running coverage database migrations...');

  await withMigrationLock(databaseUrl, async () => {
    await migrationRunner({
      databaseUrl,
      dir: COVERAGE_MIGRATIONS_DIR,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      checkOrder: false,
      log: (msg: string) => logger.debug(msg),
    });
  });

  logger.info('Coverage database migrations complete.');
}

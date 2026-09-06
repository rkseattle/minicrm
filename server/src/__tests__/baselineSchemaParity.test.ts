/**
 * Pins `000_baseline.js` to the schema it claims to reproduce.
 *
 * The baseline is generated from a `pg_dump` of an already-migrated database, which makes
 * it silently reversible: a column a later migration dropped comes back if the database it
 * was dumped from never actually ran that migration, and nothing notices. That is not
 * hypothetical — `contacts`' flat address columns and `notes.tags`, dropped by migrations
 * 094 and 097, survived in the baseline for exactly this reason, so a fresh install and an
 * upgraded one disagreed about the schema.
 *
 * Object counts do not catch it: an empty `feature_flags` passes a table count, and a
 * resurrected column passes everything. So this asserts the specific facts a regeneration
 * is known to get wrong, against the database the suite is already running on — which
 * `globalSetup` builds through the baseline.
 *
 * A failure here means the baseline and the migrations disagree. Fix the baseline, not
 * this test: it names what the migrations specify.
 */

import 'dotenv/config';

import { readFile } from 'node:fs/promises';

import pool from '../db.js';

/** Columns a migration dropped, which a regeneration must not bring back. */
const DROPPED_COLUMNS: ReadonlyArray<{ table: string; column: string; migration: string }> = [
  { table: 'contacts', column: 'address_line1', migration: '094' },
  { table: 'contacts', column: 'address_line2', migration: '094' },
  { table: 'contacts', column: 'city', migration: '094' },
  { table: 'contacts', column: 'state_region', migration: '094' },
  { table: 'contacts', column: 'postal_code', migration: '094' },
  { table: 'contacts', column: 'country', migration: '094' },
  { table: 'notes', column: 'tags', migration: '097' },
];

/** Columns a migration added that a dump of a stale database would omit. */
const REQUIRED_COLUMNS: ReadonlyArray<{ table: string; column: string; migration: string }> = [
  { table: 'currency_rate_history', column: 'created_at', migration: '099' },
  { table: 'note_tags', column: 'created_at', migration: '097' },
  { table: 'email_messages', column: 'message_body_text', migration: '176' },
  { table: 'email_message_links', column: 'match_type', migration: '177' },
];

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return result.rows[0]!.exists;
}

afterAll(async () => {
  await pool.end();
});

describe('baseline schema parity', () => {
  it.each(DROPPED_COLUMNS)(
    'does not resurrect $table.$column, dropped by migration $migration',
    async ({ table, column }) => {
      expect(await columnExists(table, column)).toBe(false);
    },
  );

  it.each(REQUIRED_COLUMNS)(
    'carries $table.$column, added by migration $migration',
    async ({ table, column }) => {
      expect(await columnExists(table, column)).toBe(true);
    },
  );

  it('publishes source on the audit_events notification', async () => {
    // Without it the gRPC stream reads every event as human-originated and leaks
    // AI-written entries into a human-only filter.
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_proc
        WHERE proname = 'audit_log_notify' AND prosrc LIKE '%NEW.source%'`,
    );
    expect(result.rows[0]!.count).toBe('1');
  });

  it('seeds sso_jit_default_role_id as a role reference, not a literal uuid', async () => {
    // The value is a role id, so a baseline that seeds a literal UUID rather than a
    // subquery names nothing on a fresh install and SSO provisioning assigns no role.
    //
    // Asserted against the baseline's own source rather than the live row: ssoSettingsService's
    // suite deletes this key in beforeEach to exercise the unconfigured state, and it runs in
    // parallel against the same database. Every other case here reads schema or a cluster
    // role, which nothing mutates; this one alone reads a seeded row.
    const baseline = await readFile(
      new URL('../../../db/migrations/000_baseline.js', import.meta.url),
      'utf8',
    );
    const seed = baseline.slice(baseline.indexOf("'sso_jit_default_role_id'"));
    const statement = seed.slice(0, seed.indexOf('`)'));

    expect(statement).toMatch(/FROM public\.custom_roles/);
    expect(statement).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('seeds the rows the application cannot start without', async () => {
    // pg_dump --schema-only carries no rows, so a regeneration that forgets the seed
    // section leaves an install with no pipeline and no flags — and every object count
    // still matches.
    const result = await pool.query<{
      pipelines: string;
      stages: string;
      flags: string;
      currencies: string;
      roles: string;
    }>(
      `SELECT (SELECT COUNT(*)::text FROM pipelines) AS pipelines,
              (SELECT COUNT(*)::text FROM pipeline_stages) AS stages,
              (SELECT COUNT(*)::text FROM feature_flags) AS flags,
              (SELECT COUNT(*)::text FROM currencies) AS currencies,
              (SELECT COUNT(*)::text FROM custom_roles) AS roles`,
    );
    const counts = result.rows[0]!;
    expect(Number(counts.pipelines)).toBeGreaterThan(0);
    expect(Number(counts.stages)).toBeGreaterThan(0);
    expect(Number(counts.flags)).toBeGreaterThan(0);
    expect(Number(counts.currencies)).toBeGreaterThan(0);
    expect(Number(counts.roles)).toBeGreaterThan(0);
  });

  it('creates the minicrm_app role the RLS suite connects as', async () => {
    // Cluster-level, so pg_dump --schema-only never emits it.
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_roles WHERE rolname = 'minicrm_app'`,
    );
    expect(result.rows[0]!.count).toBe('1');
  });
});

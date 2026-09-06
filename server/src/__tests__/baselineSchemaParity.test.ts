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

  it('resolves sso_jit_default_role_id to a real role', async () => {
    // The value is a role id, so a baseline that seeds a literal UUID rather than a
    // subquery names nothing on a fresh install and SSO provisioning assigns no role.
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM system_settings s
         JOIN custom_roles r ON r.id::text = s.value
        WHERE s.key = 'sso_jit_default_role_id'`,
    );
    expect(result.rows[0]!.count).toBe('1');
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

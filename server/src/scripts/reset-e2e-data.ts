/**
 * reset-e2e-data.ts — Truncate accumulated E2E test data between runs.
 *
 * Deletes all rows from every data table EXCEPT:
 *   - The single E2E admin user (identified by E2E_ADMIN_EMAIL)
 *   - system_settings rows (managed by seed-e2e-storage/smtp/admin scripts)
 *   - feature_flags rows (seeded by migrations; reset state instead of deleting)
 *   - custom_roles builtin rows (seeded by migration 106; only non-builtin are removed)
 *   - pgmigrations (migration state)
 *
 * Also resets system_settings that tests commonly mutate back to their
 * safe defaults:
 *   - require_mfa → false
 *   - default_language → en
 *   - nav_layout → top
 *   - email_notifications_enabled → true
 *   - tags_restrict_creation → false
 *
 * feature_flags rows are updated (not deleted): enabled and role_overrides are restored
 * to their seeded values. Rows must not be deleted because migrations insert them with
 * ON CONFLICT DO NOTHING and won't re-insert if pgmigrations marks them applied.
 *
 * Removes any non-seed pipeline stages (custom stages created by tests).
 *
 * Without this step, test users accumulate across runs (51k+ users observed)
 * causing GET /api/v1/users pagination to reach page=496 and time out, which
 * cascades failures across user-management, visibility, deals, and onboarding
 * test suites.
 *
 * Usage:
 *   npm run reset:e2e-data --workspace=minicrm-server
 *
 * Required environment variables:
 *   DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT
 *   E2E_ADMIN_EMAIL
 */

import pg from 'pg';
import { assertTestDatabaseTarget } from './assertTestDatabaseTarget.js';
import { SEEDED_ROLE_OVERRIDES } from '@minicrm/shared/schemas/featureFlagSchema.js';

const { Pool } = pg;

// Refuse to run against anything but a test database — this script is destructive.
// The returned target IS the connection config: resolving DB_PORT/DB_NAME again from
// process.env would reintroduce the `|| 5432` fallback the guard exists to remove.
const testDbTarget = assertTestDatabaseTarget('reset-e2e-data');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: testDbTarget.database,
  host: testDbTarget.host,
  port: Number(testDbTarget.port),
});

// Seed pipeline stage names that must never be deleted.
const SEED_STAGE_NAMES = [
  'Prospecting',
  'Qualification',
  'Proposal',
  'Negotiation',
  'Closed Won',
  'Closed Lost',
];

async function main(adminEmail: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve the admin user id so we can preserve their row.
    const adminResult = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [adminEmail],
    );
    if (adminResult.rows.length === 0) {
      // Fresh database — nothing to reset yet. seedE2eAdmin() will populate it.
      await client.query('ROLLBACK');
      return;
    }
    const adminId = adminResult.rows[0].id;

    // ── Delete accumulated test data ────────────────────────────────────────
    // Order respects FK constraints: children before parents.
    // TRUNCATE ... CASCADE is used where a row-level trigger would reject DELETE.

    // audit_log has an append-only trigger that rejects DELETE; TRUNCATE bypasses it.
    await client.query(`TRUNCATE audit_log CASCADE`);

    // AI sessions and messages (messages first due to FK → ai_sessions)
    await client.query(`DELETE FROM ai_messages`);
    await client.query(`DELETE FROM ai_sessions`);

    // AI usage tracking
    await client.query(`DELETE FROM ai_token_usage`);
    await client.query(`DELETE FROM ai_token_budgets`);

    // Activity-related
    await client.query(`DELETE FROM overdue_task_notifications`);
    await client.query(`DELETE FROM activities`);

    // Notes (including note_tags junction)
    await client.query(`DELETE FROM note_tags`);
    await client.query(`DELETE FROM notes`);

    // Attachments (storage objects are ephemeral in test runs)
    await client.query(`DELETE FROM attachments`);

    // Custom fields
    await client.query(`DELETE FROM custom_field_values`);
    await client.query(`DELETE FROM custom_field_definitions`);

    // Custom reports
    await client.query(`DELETE FROM custom_reports`);

    // Sequences / automation
    await client.query(`DELETE FROM automation_rule_logs`);
    await client.query(`DELETE FROM automation_rules`);
    await client.query(`DELETE FROM sequence_enrollment_logs`);
    await client.query(`DELETE FROM sequence_enrollments`);
    await client.query(`DELETE FROM sales_sequence_steps`);
    await client.query(`DELETE FROM sales_sequences`);

    // Webhooks
    await client.query(`DELETE FROM webhook_delivery_logs`);
    await client.query(`DELETE FROM webhook_subscriptions`);

    // Import jobs
    await client.query(`DELETE FROM import_jobs`);

    // Tags (junctions first, then tags)
    await client.query(`DELETE FROM contact_tags`);
    await client.query(`DELETE FROM account_tags`);
    await client.query(`DELETE FROM deal_tags`);
    await client.query(`DELETE FROM tags`);

    // GDPR
    await client.query(`DELETE FROM gdpr_deletion_log`);

    // Feature flag usage
    await client.query(`DELETE FROM feature_flag_usage`);

    // Lead history
    await client.query(`DELETE FROM lead_status_history`);

    // Converted leads → contacts/accounts/deals: delete leads before targets.
    await client.query(`DELETE FROM leads`);

    // Deal contacts junction
    await client.query(`DELETE FROM deal_contacts`);

    // Deals
    await client.query(`DELETE FROM deals`);

    // Contact addresses
    await client.query(`DELETE FROM contact_addresses`);

    // Contacts
    await client.query(`DELETE FROM contacts`);

    // Accounts (nullify self-FK first to avoid constraint issues)
    await client.query(`UPDATE accounts SET parent_account_id = NULL`);
    await client.query(`DELETE FROM accounts`);

    // Org visibility settings
    await client.query(`DELETE FROM org_visibility_settings`);

    // Feature flags — reset enabled/role_overrides back to seed defaults; do NOT delete rows.
    // Seed rows are inserted by migrations and not re-seeded on subsequent runs.
    // Tests may toggle enabled or set role_overrides; undo both here.
    // mobile_access and demo_data default to false in migrations 066; keep them off.
    // ai_nli_page is enabled in E2E so tests can exercise the full AI feature surface;
    // the flag is synced with ai_configuration.enabled only in production via setAiEnabled.
    // Flags with a seeded map keep it: NULL would restore the role fall-through that
    // ai_lead_routing_suggestion's explicit `rep: false` exists to close.
    await client.query(
      `UPDATE feature_flags
       SET enabled = CASE WHEN flag_key IN ('mobile_access', 'demo_data') THEN false ELSE true END,
           role_overrides = ($1::jsonb) -> flag_key
       WHERE system_flag = true`,
      [JSON.stringify(SEEDED_ROLE_OVERRIDES)],
    );

    // User roles / custom role assignments
    await client.query(`DELETE FROM user_custom_roles`);
    await client.query(`DELETE FROM role_capabilities WHERE role_id IN (
      SELECT id FROM custom_roles WHERE is_builtin = false
    )`);
    await client.query(`DELETE FROM custom_roles WHERE is_builtin = false`);

    // Teams (nullify parent FK first to avoid self-FK violation)
    await client.query(`UPDATE teams SET parent_team_id = NULL`);
    await client.query(`DELETE FROM team_memberships`);
    await client.query(`DELETE FROM teams`);

    // Currencies — remove test-created non-home currencies and all rate history.
    // The home currency (USD, is_home = true) is seeded by migration 035 and must
    // not be deleted; migrations won't re-insert it once pgmigrations marks them applied.
    await client.query(`DELETE FROM currency_rate_history`);
    await client.query(`DELETE FROM currencies WHERE is_home = false`);

    // SMTP / AI configuration — reset to blank defaults; do NOT delete the singleton row.
    // seed-e2e-smtp and seed-e2e-storage use UPDATE which requires the row to exist
    // (guaranteed by migrations 087 and baseline). A DELETE here makes the UPDATE a no-op.
    await client.query(
      `UPDATE smtp_configuration SET host='', port=587, username='', pass_encrypted='', enabled=false`,
    );
    await client.query(
      `UPDATE ai_configuration SET api_key_encrypted='', enabled=false, dpa_acknowledged=false,
         dpa_acknowledged_by=NULL, dpa_acknowledged_at=NULL, dpa_acknowledged_for_provider='',
         base_url='', updated_by=NULL`,
    );

    // Users — preserve only the E2E admin
    await client.query(`DELETE FROM users WHERE id != $1`, [adminId]);

    // ── Remove non-seed pipeline stages ────────────────────────────────────
    const seedPlaceholders = SEED_STAGE_NAMES.map((_, i) => `$${i + 1}`).join(', ');
    const deletedStages = await client.query<{ name: string }>(
      `DELETE FROM pipeline_stages WHERE name NOT IN (${seedPlaceholders}) RETURNING name`,
      SEED_STAGE_NAMES,
    );
    if (deletedStages.rows.length > 0) {
      const names = deletedStages.rows.map((r) => r.name).join(', ');
      console.log(`[reset-e2e-data] Removed stale pipeline stages: ${names}`);
    }

    // ── Reset commonly-polluted system_settings ─────────────────────────────
    const settingResets: Array<[string, string]> = [
      ['require_mfa', 'false'],
      ['default_language', 'en'],
      ['nav_layout', 'top'],
      ['email_notifications_enabled', 'true'],
      ['tags_restrict_creation', 'false'],
    ];
    for (const [key, value] of settingResets) {
      await client.query(`UPDATE system_settings SET value = $2 WHERE key = $1`, [key, value]);
    }

    await client.query('COMMIT');

    console.log(`[reset-e2e-data] E2E test data cleared. Admin user ${adminEmail} preserved.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

const adminEmail = process.env.E2E_ADMIN_EMAIL;
if (!adminEmail) {
  throw new Error('[reset-e2e-data] E2E_ADMIN_EMAIL must be set.');
}

main(adminEmail).catch((err: unknown) => {
  throw err;
});

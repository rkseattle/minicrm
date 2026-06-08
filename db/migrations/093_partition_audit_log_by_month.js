'use strict';

/**
 * Migration 093: Convert audit_log to a monthly range-partitioned table. (MINCRM-521)
 *
 * ## Why partitioning, why now
 *
 * audit_log is the only table in MiniCRM with no physical growth bound. Every
 * field change, login, note event, automation trigger, and AI call appends a row.
 * At moderate usage (100 users, active automation, AI features) the table
 * accumulates hundreds of thousands of rows per year. Converting proactively —
 * while the table is small — avoids the multi-hour lock and data-copy that would
 * be required on a multi-million-row table later.
 *
 * ## Partition strategy: monthly range on created_at
 *
 * Monthly granularity bounds each partition to a predictable size (~83K rows/month
 * at 1K events/day), enables targeted archival without touching live data, and
 * keeps index maintenance scoped to the active partition. Quarterly would grow too
 * large before archival; weekly would create excessive partition management overhead.
 *
 * Partitions are named audit_log_y{YYYY}m{MM} (zero-padded month).
 * A default partition (audit_log_default) catches any rows whose created_at falls
 * outside the pre-created range partitions — this should never receive rows under
 * normal operation but prevents INSERT failures if the cron job falls behind.
 *
 * ## Trigger inheritance
 *
 * In PostgreSQL 16 declarative partitioning, row-level triggers created on the
 * parent table are automatically cloned to every existing and future child
 * partition. Triggers are therefore defined only on the parent; no per-partition
 * trigger management is needed.
 *
 * ## Future partition creation
 *
 * auditPartitionService.ensureAuditLogPartitions() is called at server startup
 * and on a monthly node-cron schedule (1st of each month at 00:00) to pre-create
 * partitions for the current month plus the next 3 months.
 *
 * ## Irreversibility
 *
 * Converting a partitioned table back to a plain heap table requires a full
 * table rewrite with an ACCESS EXCLUSIVE lock — equivalent in cost to the
 * original conversion. There is no supported down path; the down function raises
 * an explicit error to prevent accidental rollback attempts.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    -- ── Step 1: Rename the existing heap table to preserve all data ────────────
    ALTER TABLE audit_log RENAME TO audit_log_legacy;

    -- Rename legacy indexes so they do not collide with the new partitioned table's indexes.
    ALTER INDEX audit_log_pkey                        RENAME TO audit_log_legacy_pkey;
    ALTER INDEX audit_log_record_type_record_id_index RENAME TO audit_log_legacy_record_type_record_id_index;
    ALTER INDEX audit_log_changed_by_id_index         RENAME TO audit_log_legacy_changed_by_id_index;
    ALTER INDEX audit_log_created_at_index            RENAME TO audit_log_legacy_created_at_index;
    ALTER INDEX audit_log_event_type_index            RENAME TO audit_log_legacy_event_type_index;

    -- Rename legacy triggers so they do not collide on the new table.
    ALTER TRIGGER audit_log_no_modify    ON audit_log_legacy RENAME TO audit_log_legacy_no_modify;
    ALTER TRIGGER audit_log_after_insert ON audit_log_legacy RENAME TO audit_log_legacy_after_insert;

    -- ── Step 2: Create the partitioned parent table ────────────────────────────
    -- Column definitions are identical to the original table (migration 019 baseline,
    -- with constraints removed by migration 076).
    CREATE TABLE audit_log (
      id               uuid        NOT NULL DEFAULT gen_random_uuid(),
      record_type      text        NOT NULL,
      record_id        uuid,
      record_name      text,
      event_type       text        NOT NULL,
      field_name       text,
      old_value        text,
      new_value        text,
      changed_by_id    uuid,
      changed_by_name  text,
      created_at       timestamptz NOT NULL DEFAULT now()
    ) PARTITION BY RANGE (created_at);

    -- ── Step 3: Indexes on the parent ─────────────────────────────────────────
    -- In PG16 declarative partitioning, indexes defined on the parent are
    -- automatically created on every existing and future child partition.
    --
    -- The primary key must include the partition key (created_at) because
    -- PG16 requires all unique/PK constraints on a partitioned table to include
    -- the partition key columns. The (id, created_at) composite PK is logically
    -- equivalent for our access patterns — id is still globally unique across
    -- all partitions, and created_at is always present on every row.
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id, created_at);

    CREATE INDEX audit_log_record_type_record_id_index ON audit_log (record_type, record_id);
    CREATE INDEX audit_log_changed_by_id_index         ON audit_log (changed_by_id);
    CREATE INDEX audit_log_created_at_index            ON audit_log (created_at);
    CREATE INDEX audit_log_event_type_index            ON audit_log (event_type);

    -- ── Step 4: Append-only trigger (mirrors migration 019) ───────────────────
    -- audit_log_immutable() already exists in the DB from migration 019; we
    -- re-attach it to the new partitioned parent. PG16 clones this trigger to
    -- every child partition automatically.
    CREATE TRIGGER audit_log_no_modify
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

    -- ── Step 5: NOTIFY trigger (mirrors migration 052) ────────────────────────
    -- audit_log_notify() already exists; re-attach to the new parent.
    CREATE TRIGGER audit_log_after_insert
      AFTER INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_notify();

    -- ── Step 6: Preserve table comment from migration 076 ─────────────────────
    COMMENT ON TABLE audit_log IS
      'Append-only audit trail, partitioned monthly by created_at (MINCRM-521). '
      'Valid record_type values: contact, account, deal, lead, activity, user, system_settings, '
      'custom_report, sequence, sequence_enrollment, feature_flag, ai_settings. '
      'Valid event_type values: created, updated, deleted, login, logout, password_changed, '
      'role_changed, deactivated, reactivated, ownership_reassigned, merged, note_created, '
      'note_updated, note_deleted, note_visibility_changed, gdpr_erasure, mfa_enabled, '
      'mfa_disabled, sso_login, sso_provisioned, sso_linked, sso_unlinked. '
      'Enforced at service layer via AuditRecordType and AuditEventType TypeScript unions '
      'in server/src/services/auditService.ts. '
      'Partition naming: audit_log_y{YYYY}m{MM}. Default partition: audit_log_default. '
      'Future partitions created by auditPartitionService.ensureAuditLogPartitions().';

    -- ── Step 7: Default partition ──────────────────────────────────────────────
    -- Catches any rows whose created_at falls outside pre-created monthly partitions.
    -- Under normal operation (partition cron running) this partition should remain empty.
    CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

    -- ── Step 8: Pre-create monthly partitions ─────────────────────────────────
    -- Create partitions for the current month plus the next 3 months so that
    -- the server can start inserting rows immediately after migration, before
    -- the startup call to ensureAuditLogPartitions() completes.
    --
    -- auditPartitionService.ensureAuditLogPartitions() will idempotently create
    -- any additional months needed at server startup and monthly thereafter.
    DO $$
    DECLARE
      month_start  timestamptz;
      month_end    timestamptz;
      tbl_name     text;
      i            integer;
    BEGIN
      FOR i IN 0..3 LOOP
        month_start := date_trunc('month', now() + (i || ' months')::interval);
        month_end   := month_start + interval '1 month';
        tbl_name    := 'audit_log_y' || to_char(month_start, 'YYYY') || 'm' || to_char(month_start, 'MM');

        EXECUTE format(
          'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
          tbl_name, month_start, month_end
        );
      END LOOP;
    END;
    $$;

    -- ── Step 9: Migrate historical data ───────────────────────────────────────
    -- Copy all rows from the legacy heap table into the new partitioned table.
    -- Rows route to the correct monthly partition automatically via the partition key.
    -- Any rows whose created_at predates the pre-created partitions above will land
    -- in audit_log_default; the ensureAuditLogPartitions() service will not
    -- retroactively create historical partitions, so historical rows legitimately
    -- live in the default partition.
    INSERT INTO audit_log
      SELECT id, record_type, record_id, record_name, event_type, field_name,
             old_value, new_value, changed_by_id, changed_by_name, created_at
      FROM audit_log_legacy;

    -- ── Step 10: Drop the legacy heap table ───────────────────────────────────
    DROP TABLE audit_log_legacy;
  `);
};

/**
 * This migration is intentionally irreversible.
 *
 * Converting a partitioned table back to a plain heap table requires detaching
 * every partition, merging data, and rebuilding all indexes — an operation
 * equivalent in cost and lock duration to the original migration. There is no
 * safe automated down path.
 *
 * To recover from an accidental application of this migration:
 *   1. Restore the database from the pre-migration backup.
 *   2. Apply only the migrations up to 092.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      RAISE EXCEPTION
        'Migration 093 (audit_log partitioning) is irreversible. '
        'Restore from a pre-migration backup to revert. (MINCRM-521)';
    END; $$;
  `);
};

/**
 * Migration 019: create audit_log table.
 * Stores field-level change events for contacts, accounts, deals, users, and system settings.
 * Enforces append-only semantics via a DB trigger that blocks UPDATE and DELETE.
 * (MINCRM-170)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('audit_log', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    /** The type of entity that was changed */
    record_type: {
      type: 'text',
      notNull: true,
      check: "record_type IN ('contact', 'account', 'deal', 'user', 'system_settings')",
    },
    /** UUID of the affected record (null for system-level events like settings changes) */
    record_id: {
      type: 'uuid',
      notNull: false,
    },
    /**
     * Human-readable name of the record at the time of the event.
     * Stored so deleted records are still identifiable by name in the log.
     */
    record_name: {
      type: 'text',
      notNull: false,
    },
    /** Type of change event */
    event_type: {
      type: 'text',
      notNull: true,
      check: "event_type IN ('created','updated','deleted','login','logout','password_changed','role_changed','deactivated','reactivated','ownership_reassigned')",
    },
    /**
     * For 'updated' events: the name of the field that changed.
     * Null for non-field events (created, deleted, login, etc.).
     */
    field_name: {
      type: 'text',
      notNull: false,
    },
    /** Previous field value as a string; null for sensitive fields or non-field events */
    old_value: {
      type: 'text',
      notNull: false,
    },
    /** New field value as a string; null for sensitive fields or non-field events */
    new_value: {
      type: 'text',
      notNull: false,
    },
    /** UUID of the user who performed the action */
    changed_by_id: {
      type: 'uuid',
      notNull: false,
    },
    /** Display name of the actor at the time of the event (denormalized so it survives user deletion) */
    changed_by_name: {
      type: 'text',
      notNull: false,
    },
    /** UTC timestamp of the event */
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Indexes for common access patterns
  pgm.createIndex('audit_log', ['record_type', 'record_id']);
  pgm.createIndex('audit_log', ['changed_by_id']);
  pgm.createIndex('audit_log', ['created_at']);
  pgm.createIndex('audit_log', ['event_type']);

  // Append-only trigger: block UPDATE and DELETE on audit_log at the DB level
  pgm.sql(`
    CREATE OR REPLACE FUNCTION audit_log_immutable()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_log is append-only: UPDATE and DELETE are not permitted';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER audit_log_no_modify
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS audit_log_no_modify ON audit_log;
    DROP FUNCTION IF EXISTS audit_log_immutable();
  `);
  pgm.dropTable('audit_log');
};

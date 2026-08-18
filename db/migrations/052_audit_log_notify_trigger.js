'use strict';

/**
 * Migration 052: add AFTER INSERT trigger on audit_log that fires pg_notify
 * on the 'audit_events' channel so connected LISTEN clients receive new rows
 * in real time without polling.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION audit_log_notify()
    RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify(
        'audit_events',
        json_build_object(
          'id',              NEW.id,
          'record_type',     NEW.record_type,
          'record_id',       NEW.record_id,
          'record_name',     NEW.record_name,
          'event_type',      NEW.event_type,
          'field_name',      NEW.field_name,
          'old_value',       NEW.old_value,
          'new_value',       NEW.new_value,
          'changed_by_id',   NEW.changed_by_id,
          'changed_by_name', NEW.changed_by_name,
          'created_at',      NEW.created_at
        )::text
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER audit_log_after_insert
      AFTER INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_notify();
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS audit_log_after_insert ON audit_log;
    DROP FUNCTION IF EXISTS audit_log_notify();
  `);
};

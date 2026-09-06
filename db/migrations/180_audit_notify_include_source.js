'use strict';

/**
 * Migration 180 — Add `source` to the audit_events NOTIFY payload.
 *
 * Migration 128 added `audit_log.source` but never updated the trigger function that
 * publishes inserts, so a database built by running the migrations emits a payload
 * without it. Only the hand-maintained baseline carried the corrected body, which meant
 * the two bootstrap paths disagreed: a fresh install had the fix, an upgraded database
 * did not.
 *
 * The consequence is a filter that silently misroutes. `matchesStreamFilter` in
 * auditConnectService treats a missing source as human-originated, so an AI-written entry
 * reaches a subscriber that asked for human events only, and a subscriber asking for AI
 * events receives nothing at all.
 *
 * CREATE OR REPLACE rather than a guarded CREATE: the point is to correct a body that
 * already exists.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.audit_log_notify() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
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
            'source',          NEW.source,
            'created_at',      NEW.created_at
          )::text
        );
        RETURN NEW;
      END;
      $$
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.audit_log_notify() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
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
      $$
  `);
};

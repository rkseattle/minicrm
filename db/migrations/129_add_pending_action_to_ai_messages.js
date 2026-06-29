'use strict';

/**
 * Migration 129: Add pending_action JSONB column to ai_messages.
 *
 * Stores a pending mutation action awaiting user confirmation on the assistant
 * message so the client can render a confirmation prompt before any write
 * operation is executed. (MINCRM-425, MINCRM-426)
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_messages
      ADD COLUMN IF NOT EXISTS pending_action jsonb DEFAULT NULL
  `);
  pgm.sql(`COMMENT ON COLUMN public.ai_messages.pending_action IS 'Pending mutation action awaiting user confirmation. Object with {operation, entityType, entityId?, entityName?, fields, isBulk, bulkCount?, bulkSample?, isBulkDelete?, summary}. NULL when no confirmation is pending. (MINCRM-425, MINCRM-426)'`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE ai_messages DROP COLUMN IF EXISTS pending_action`);
};

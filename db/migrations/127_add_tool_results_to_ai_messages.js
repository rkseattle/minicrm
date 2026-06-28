'use strict';

/**
 * Migration 127: Add tool_results JSONB column to ai_messages.
 *
 * Stores the structured outputs from Claude tool calls alongside the assistant
 * message so the client can render native CRM result cards instead of raw text.
 * Only set on assistant messages that involved tool calls. (MINCRM-423, MINCRM-431)
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_messages
      ADD COLUMN IF NOT EXISTS tool_results jsonb DEFAULT NULL
  `);
  pgm.sql(`COMMENT ON COLUMN public.ai_messages.tool_results IS 'Structured tool call results for native CRM result rendering. Array of {toolName, input, output} objects. NULL for user messages and assistant messages that did not invoke tools. (MINCRM-423, MINCRM-431)'`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE ai_messages DROP COLUMN IF EXISTS tool_results`);
};

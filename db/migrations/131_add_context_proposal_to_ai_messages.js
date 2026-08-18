'use strict';

/**
 * Migration 131: Add context_proposal JSONB column to ai_messages.
 *
 * Stores an AI-generated context proposal on assistant messages. The server
 * extracts the structured proposal from Claude's response text, strips the
 * marker from the stored content, and persists the proposal here so the
 * client can render an inline accept/dismiss chip without re-parsing text.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_messages
      ADD COLUMN IF NOT EXISTS context_proposal jsonb DEFAULT NULL
  `);
  pgm.sql(`COMMENT ON COLUMN public.ai_messages.context_proposal IS 'AI-proposed context entry awaiting user accept/dismiss. Object with {key, value, reason}. NULL when no proposal is present. (MINCRM-429, MINCRM-430)'`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE ai_messages DROP COLUMN IF EXISTS context_proposal`);
};

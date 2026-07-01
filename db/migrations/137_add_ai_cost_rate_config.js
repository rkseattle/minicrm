'use strict';

/**
 * Migration 137: Add AI cost rate configuration columns to ai_configuration.
 *
 * Stores the admin-configured cost rate used to estimate AI spend on the usage
 * dashboard. Rates are stored as integer cents per 1,000,000 tokens (rather than
 * a decimal dollar amount) to avoid floating point drift when multiplying by
 * large token counts.
 *
 * Defaults approximate a Claude Sonnet-class rate; admins should confirm/adjust
 * for their actual provider agreement.
 *
 * (MINCRM-459)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      ADD COLUMN IF NOT EXISTS ai_input_cost_per_million_cents integer NOT NULL DEFAULT 300
        CONSTRAINT ai_configuration_input_cost_nonnegative
          CHECK (ai_input_cost_per_million_cents >= 0)
  `);

  pgm.sql(`
    ALTER TABLE public.ai_configuration
      ADD COLUMN IF NOT EXISTS ai_output_cost_per_million_cents integer NOT NULL DEFAULT 1500
        CONSTRAINT ai_configuration_output_cost_nonnegative
          CHECK (ai_output_cost_per_million_cents >= 0)
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.ai_configuration.ai_input_cost_per_million_cents IS
      'Admin-configured cost rate in cents per 1,000,000 input tokens, used to estimate spend on the AI usage dashboard. (MINCRM-459)'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.ai_configuration.ai_output_cost_per_million_cents IS
      'Admin-configured cost rate in cents per 1,000,000 output tokens, used to estimate spend on the AI usage dashboard. (MINCRM-459)'
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      DROP COLUMN IF EXISTS ai_input_cost_per_million_cents
  `);
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      DROP COLUMN IF EXISTS ai_output_cost_per_million_cents
  `);
};

'use strict';

/**
 * Migration 139: Create ai_field_exclusions table.
 *
 * Admin-configurable exclusion toggles for STANDARD (non-custom) entity fields,
 * consulted by the PII data minimization layer (server/src/ai/piiFilter.ts) in
 * addition to — never instead of — the hardcoded ALWAYS_EXCLUDED_FIELDS set.
 *
 * Immutable default exclusions (SSN, tax ID, bank account, password hashes,
 * etc.) intentionally do NOT live in this table — they stay hardcoded in code
 * so they can never be toggled off via this admin surface. Custom field PII
 * exclusion already has its own column (custom_field_definitions.pii_excluded,
 * migration 125) and is not duplicated here.
 *
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.ai_field_exclusions (
      id           uuid DEFAULT gen_random_uuid() NOT NULL,
      entity_type  varchar(16) NOT NULL,
      field_name   text NOT NULL,
      excluded     boolean NOT NULL DEFAULT false,
      created_at   timestamp with time zone DEFAULT now() NOT NULL,
      updated_at   timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT ai_field_exclusions_pkey PRIMARY KEY (id),
      CONSTRAINT ai_field_exclusions_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['contact'::character varying, 'account'::character varying, 'deal'::character varying])::text[])))
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.ai_field_exclusions IS
      'Admin-configurable AI payload exclusion toggles for standard entity fields. Immutable defaults live in code (ALWAYS_EXCLUDED_FIELDS), not here. (MINCRM-461)'
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_field_exclusions_entity_field_idx
      ON public.ai_field_exclusions USING btree (entity_type, field_name)
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.ai_field_exclusions`);
};

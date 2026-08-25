'use strict';

/**
 * Migration 168: index data_hygiene_findings.related_entity_id.
 *
 * Hard-deleting a contact, account, or deal now clears the findings that point at it,
 * matching on entity_id OR related_entity_id so a duplicate finding held by the
 * counterpart contact cannot outlive the record it names. Only (owner_id) and
 * (entity_type, entity_id) were indexed, so that OR arm forced a sequential scan on
 * every delete — including the bulk paths, which delete up to 500 records per call.
 *
 * Partial, because the column is populated only for contact_duplicate findings: the
 * index stays small and the planner still uses it for the equality lookups above.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS data_hygiene_findings_related_entity_idx
      ON public.data_hygiene_findings (related_entity_id)
      WHERE related_entity_id IS NOT NULL
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.data_hygiene_findings_related_entity_idx`);
};

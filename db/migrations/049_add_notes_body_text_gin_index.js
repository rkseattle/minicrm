/**
 * Migration 049: Add pg_trgm GIN index on notes.body_text for global search.
 *
 * searchService.ts now joins the notes table when running globalSearch() so
 * that records with matching note body text are included in results. Without
 * a trigram index, every %pattern% ILIKE scan on notes.body_text is a full
 * sequential table scan. Migration 041 added the pg_trgm extension and indexes
 * for contacts/accounts/deals — this migration extends coverage to notes.
 *
 * body_text is a text column (nullable). NULL rows are skipped by ILIKE, so
 * the index only needs to cover non-null values; a partial index would be a
 * minor optimisation but a full index is simpler and consistent with 041.
 *
 */

'use strict';

exports.up = (pgm) => {
  // pg_trgm was enabled in migration 041; IF NOT EXISTS is a safety net only.
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  pgm.sql(
    'CREATE INDEX notes_body_text_trgm_idx ON notes USING gin (body_text gin_trgm_ops)',
  );
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS notes_body_text_trgm_idx');
};

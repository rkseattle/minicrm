/**
 * Trigram indexes for global search over email subjects and snippets.
 *
 * Search matches with a leading-wildcard ILIKE, which no B-tree on this table can serve, and
 * the email arm runs on every search. Same shape as the other searched columns' indexes.
 */

'use strict';

exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(
    'CREATE INDEX IF NOT EXISTS email_messages_subject_trgm_idx ON public.email_messages USING gin (subject gin_trgm_ops)',
  );
  pgm.sql(
    'CREATE INDEX IF NOT EXISTS email_messages_snippet_trgm_idx ON public.email_messages USING gin (message_snippet gin_trgm_ops)',
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS public.email_messages_snippet_trgm_idx');
  pgm.sql('DROP INDEX IF EXISTS public.email_messages_subject_trgm_idx');
};

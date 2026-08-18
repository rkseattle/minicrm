/**
 * Migration 041: Enable pg_trgm and add GIN trigram indexes for search performance.
 *
 * searchService.ts runs %pattern% ILIKE queries across contacts.first_name,
 * contacts.last_name, contacts.email, accounts.name, and deals.name on every
 * globalSearch() invocation. Standard B-tree indexes cannot accelerate leading-
 * wildcard ILIKE patterns. GIN trigram indexes (pg_trgm) support them.
 *
 * pg_trgm is a PostgreSQL contrib extension — available in all standard builds
 * including Amazon RDS, Cloud SQL, and Supabase. CREATE EXTENSION IF NOT EXISTS
 * is idempotent, so re-running the migration is safe.
 *
 * varchar columns require the gin_trgm_ops operator class to be named explicitly;
 * raw SQL is used because node-pg-migrate's createIndex helper does not expose
 * the opclass parameter.
 *
 * The down function drops the indexes but does NOT drop the pg_trgm extension;
 * other migrations or queries may depend on it, and extensions are DB-wide.
 *
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  pgm.sql('CREATE INDEX contacts_first_name_trgm_idx ON contacts USING gin (first_name gin_trgm_ops)');
  pgm.sql('CREATE INDEX contacts_last_name_trgm_idx  ON contacts USING gin (last_name  gin_trgm_ops)');
  pgm.sql('CREATE INDEX contacts_email_trgm_idx      ON contacts USING gin (email      gin_trgm_ops)');
  pgm.sql('CREATE INDEX accounts_name_trgm_idx       ON accounts USING gin (name       gin_trgm_ops)');
  pgm.sql('CREATE INDEX deals_name_trgm_idx          ON deals    USING gin (name       gin_trgm_ops)');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS deals_name_trgm_idx');
  pgm.sql('DROP INDEX IF EXISTS accounts_name_trgm_idx');
  pgm.sql('DROP INDEX IF EXISTS contacts_email_trgm_idx');
  pgm.sql('DROP INDEX IF EXISTS contacts_last_name_trgm_idx');
  pgm.sql('DROP INDEX IF EXISTS contacts_first_name_trgm_idx');
  // pg_trgm extension is intentionally not dropped — other DB objects may depend on it.
};

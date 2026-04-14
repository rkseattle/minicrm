/**
 * Migration 022: Add case-insensitive unique index on pipeline_stages.name.
 *
 * The initial migration (021) used a plain unique constraint on `name`, which
 * is case-sensitive in PostgreSQL. This migration replaces it with a functional
 * unique index on `lower(name)` so that stage names like "Discovery" and
 * "DISCOVERY" are correctly treated as duplicates.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Drop the existing case-sensitive unique constraint added by 021
  pgm.dropConstraint('pipeline_stages', 'pipeline_stages_name_key');

  // Add a functional unique index on lower(name)
  pgm.createIndex('pipeline_stages', 'lower(name)', {
    unique: true,
    name: 'pipeline_stages_name_lower_unique',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex('pipeline_stages', 'lower(name)', {
    name: 'pipeline_stages_name_lower_unique',
  });

  pgm.addConstraint('pipeline_stages', 'pipeline_stages_name_key', 'UNIQUE (name)');
};

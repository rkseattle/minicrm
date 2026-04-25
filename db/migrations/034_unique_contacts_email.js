/**
 * Migration 034 — Add UNIQUE constraint to contacts.email (MINCRM-247)
 *
 * Precondition: no duplicate email values may exist in the contacts table.
 * The migration will fail if duplicates are present. Verify before applying:
 *   SELECT email, COUNT(*) FROM contacts GROUP BY email HAVING COUNT(*) > 1;
 *
 * Drops the existing non-unique B-tree index created by migration 002 and
 * replaces it with a unique index. This closes the TOCTOU race in
 * contactService's SELECT-before-INSERT duplicate detection.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Drop the existing non-unique index first to avoid a duplicate index.
  pgm.dropIndex('contacts', 'email');

  // Re-create as a unique index. Enforces uniqueness at the DB level,
  // closing the TOCTOU race in contactService's duplicate detection.
  pgm.createIndex('contacts', 'email', { unique: true });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex('contacts', 'email', { unique: true });
  pgm.createIndex('contacts', 'email');
};

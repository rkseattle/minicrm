/**
 * Migration 047: add 'lead' to attachments record_type CHECK constraint.
 * Notes on leads (MINCRM-352) allow image uploads, which are stored as
 * attachments. The existing constraint only allowed contact, account, and deal.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE attachments
      DROP CONSTRAINT IF EXISTS attachments_record_type_check;

    ALTER TABLE attachments
      ADD CONSTRAINT attachments_record_type_check
      CHECK (record_type IN ('contact', 'account', 'deal', 'lead'));
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE attachments
      DROP CONSTRAINT IF EXISTS attachments_record_type_check;

    ALTER TABLE attachments
      ADD CONSTRAINT attachments_record_type_check
      CHECK (record_type IN ('contact', 'account', 'deal'));
  `);
};

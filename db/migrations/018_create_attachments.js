/**
 * Migration 018: create attachments table.
 * Stores metadata for files attached to contacts, accounts, or deals.
 * The actual file bytes live in S3-compatible object storage; only the
 * storage_key reference is kept here. (MINCRM-167)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('attachments', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    record_type: {
      type: 'text',
      notNull: true,
      check: "record_type IN ('contact', 'account', 'deal')",
    },
    record_id: {
      type: 'uuid',
      notNull: true,
    },
    filename: {
      type: 'text',
      notNull: true,
    },
    file_size: {
      type: 'bigint',
      notNull: true,
    },
    mime_type: {
      type: 'text',
      notNull: true,
    },
    storage_key: {
      type: 'text',
      notNull: true,
      unique: true,
    },
    uploader_id: {
      type: 'uuid',
      notNull: false,
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
    uploaded_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('attachments', ['record_type', 'record_id']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('attachments');
};

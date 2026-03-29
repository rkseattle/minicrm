/**
 * Migration 005: Create deal_contacts join table
 *
 * Links deals to contacts in a many-to-many relationship.
 * Deleting a deal cascades to remove its contact associations.
 * Deleting a contact cascades to remove its deal associations.
 * Neither side deletes the other entity.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('deal_contacts', {
    deal_id: {
      type: 'uuid',
      notNull: true,
      references: '"deals"',
      onDelete: 'CASCADE',
    },
    contact_id: {
      type: 'uuid',
      notNull: true,
      references: '"contacts"',
      onDelete: 'CASCADE',
    },
  });

  // Composite primary key — one row per (deal, contact) pair
  pgm.addConstraint('deal_contacts', 'deal_contacts_pkey', {
    primaryKey: ['deal_id', 'contact_id'],
  });

  // Index contact_id for reverse lookup: "which deals is this contact on?"
  pgm.createIndex('deal_contacts', 'contact_id');
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('deal_contacts');
};

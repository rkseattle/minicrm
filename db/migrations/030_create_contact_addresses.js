/**
 * Migration 030: Add contact_addresses table for multiple addresses per contact.
 * Each contact may have multiple addresses; exactly one may be marked is_default.
 * Existing flat address columns on the contacts table are retained for backward
 * compatibility and will be deprecated in a future migration.
 */

exports.up = async (pgm) => {
  pgm.createTable('contact_addresses', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    contact_id: {
      type: 'uuid',
      notNull: true,
      references: '"contacts"',
      onDelete: 'CASCADE',
    },
    /** Optional label for this address, e.g. "Home", "Work", "Billing" */
    label: { type: 'varchar(50)', notNull: false },
    address_line1: { type: 'varchar(255)', notNull: false },
    address_line2: { type: 'varchar(255)', notNull: false },
    city: { type: 'varchar(100)', notNull: false },
    state_region: { type: 'varchar(100)', notNull: false },
    postal_code: { type: 'varchar(20)', notNull: false },
    country: { type: 'varchar(100)', notNull: false },
    is_default: { type: 'boolean', notNull: true, default: false },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('contact_addresses', 'contact_id');

  // Enforce at most one default address per contact via a partial unique index
  pgm.createIndex('contact_addresses', ['contact_id'], {
    name: 'contact_addresses_one_default_per_contact',
    unique: true,
    where: 'is_default = true',
  });
};

exports.down = async (pgm) => {
  pgm.dropIndex('contact_addresses', ['contact_id'], {
    name: 'contact_addresses_one_default_per_contact',
  });
  pgm.dropTable('contact_addresses');
};

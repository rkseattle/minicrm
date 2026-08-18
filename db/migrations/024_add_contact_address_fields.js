/**
 * Migration 024: Add mailing address fields to contacts table.
 */

exports.up = async (pgm) => {
  pgm.addColumns('contacts', {
    address_line1: { type: 'varchar(255)', notNull: false },
    address_line2: { type: 'varchar(255)', notNull: false },
    city: { type: 'varchar(100)', notNull: false },
    state_region: { type: 'varchar(100)', notNull: false },
    postal_code: { type: 'varchar(20)', notNull: false },
    country: { type: 'varchar(100)', notNull: false },
  });
};

exports.down = async (pgm) => {
  pgm.dropColumns('contacts', [
    'address_line1',
    'address_line2',
    'city',
    'state_region',
    'postal_code',
    'country',
  ]);
};

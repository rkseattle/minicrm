/**
 * Migration 031 — add currency column to deals table.
 * Stores the ISO 4217 currency code for each deal value.
 * Defaults to 'USD' for all existing rows so existing data is not broken.
 */

'use strict';

exports.up = async (pgm) => {
  pgm.addColumn('deals', {
    currency: {
      type: 'varchar(3)',
      notNull: true,
      default: 'USD',
    },
  });
};

exports.down = async (pgm) => {
  pgm.dropColumn('deals', 'currency');
};

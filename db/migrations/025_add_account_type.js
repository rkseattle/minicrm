/**
 * Migration 025: Add account_type column to accounts table.
 * Nullable varchar with a CHECK constraint limiting values to the defined enum.
 * (MINCRM-183)
 */

const VALID_TYPES = ['Prospect', 'Customer', 'Partner', 'Vendor', 'Competitor', 'Other'];

exports.up = async (pgm) => {
  pgm.addColumns('accounts', {
    account_type: {
      type: 'varchar(20)',
      notNull: false,
    },
  });

  pgm.addConstraint(
    'accounts',
    'accounts_account_type_check',
    `CHECK (account_type IS NULL OR account_type IN (${VALID_TYPES.map((t) => `'${t}'`).join(', ')}))`,
  );
};

exports.down = async (pgm) => {
  pgm.dropConstraint('accounts', 'accounts_account_type_check');
  pgm.dropColumns('accounts', ['account_type']);
};

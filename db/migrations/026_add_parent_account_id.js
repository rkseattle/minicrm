/**
 * Migration 026: Add self-referential parent_account_id FK to accounts table.
 * SET NULL on parent delete so subsidiaries are not deleted when a parent is removed.
 * (MINCRM-184)
 */

exports.up = async (pgm) => {
  pgm.addColumns('accounts', {
    parent_account_id: {
      type: 'uuid',
      notNull: false,
      references: '"accounts"',
      onDelete: 'SET NULL',
    },
  });
};

exports.down = async (pgm) => {
  pgm.dropColumns('accounts', ['parent_account_id']);
};

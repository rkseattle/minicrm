/**
 * Migration 029: Add other_url field to contacts table for generic social/web profiles.
 */

exports.up = async (pgm) => {
  pgm.addColumns('contacts', {
    other_url: { type: 'varchar(500)', notNull: false },
  });
};

exports.down = async (pgm) => {
  pgm.dropColumns('contacts', ['other_url']);
};

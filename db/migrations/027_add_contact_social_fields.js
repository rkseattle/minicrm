/**
 * Migration 027: Add LinkedIn and Twitter/X URL fields to contacts table.
 */

exports.up = async (pgm) => {
  pgm.addColumns('contacts', {
    linkedin_url: { type: 'varchar(500)', notNull: false },
    twitter_x_url: { type: 'varchar(500)', notNull: false },
  });
};

exports.down = async (pgm) => {
  pgm.dropColumns('contacts', ['linkedin_url', 'twitter_x_url']);
};

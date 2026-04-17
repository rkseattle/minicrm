/**
 * Migration 032 — create tags system (MINCRM-186).
 * Adds a central tags table and junction tables for contacts, accounts, and deals.
 * Tags are stored lowercased and trimmed; the name column has a unique constraint.
 */

'use strict';

exports.up = async (pgm) => {
  pgm.createTable('tags', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(100)',
      notNull: true,
      unique: true,
    },
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

  pgm.createTable('contact_tags', {
    contact_id: {
      type: 'uuid',
      notNull: true,
      references: 'contacts(id)',
      onDelete: 'CASCADE',
    },
    tag_id: {
      type: 'uuid',
      notNull: true,
      references: 'tags(id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('contact_tags', 'contact_tags_pkey', 'PRIMARY KEY (contact_id, tag_id)');
  pgm.createIndex('contact_tags', 'tag_id');

  pgm.createTable('account_tags', {
    account_id: {
      type: 'uuid',
      notNull: true,
      references: 'accounts(id)',
      onDelete: 'CASCADE',
    },
    tag_id: {
      type: 'uuid',
      notNull: true,
      references: 'tags(id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('account_tags', 'account_tags_pkey', 'PRIMARY KEY (account_id, tag_id)');
  pgm.createIndex('account_tags', 'tag_id');

  pgm.createTable('deal_tags', {
    deal_id: {
      type: 'uuid',
      notNull: true,
      references: 'deals(id)',
      onDelete: 'CASCADE',
    },
    tag_id: {
      type: 'uuid',
      notNull: true,
      references: 'tags(id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('deal_tags', 'deal_tags_pkey', 'PRIMARY KEY (deal_id, tag_id)');
  pgm.createIndex('deal_tags', 'tag_id');
};

exports.down = async (pgm) => {
  pgm.dropTable('deal_tags');
  pgm.dropTable('account_tags');
  pgm.dropTable('contact_tags');
  pgm.dropTable('tags');
};

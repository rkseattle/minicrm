/**
 * Migration 044: create notes table.
 * Adds a rich notes collection to the four core CRM entities.
 */

'use strict';

exports.up = (pgm) => {
  pgm.createTable('notes', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    entity_type: {
      type: 'varchar(16)',
      notNull: true,
    },
    entity_id: {
      type: 'uuid',
      notNull: true,
    },
    title: {
      type: 'varchar(255)',
      notNull: false,
    },
    body: {
      type: 'text',
      notNull: true,
    },
    body_text: {
      type: 'text',
      notNull: false,
    },
    visibility: {
      type: 'varchar(8)',
      notNull: true,
      default: 'team',
    },
    tags: {
      type: 'text[]',
      notNull: true,
      default: '{}',
    },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
    },
    updated_by: {
      type: 'uuid',
      notNull: false,
      references: 'users(id)',
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
    deleted_at: {
      type: 'timestamptz',
      notNull: false,
    },
  });

  pgm.addConstraint('notes', 'notes_entity_type_check', {
    check: "entity_type IN ('contact', 'account', 'deal', 'lead')",
  });

  pgm.addConstraint('notes', 'notes_visibility_check', {
    check: "visibility IN ('private', 'team', 'public')",
  });

  pgm.createIndex('notes', ['entity_type', 'entity_id'], { name: 'notes_entity_idx' });
  pgm.createIndex('notes', ['created_by'], { name: 'notes_created_by_idx' });
};

exports.down = (pgm) => {
  pgm.dropTable('notes');
};

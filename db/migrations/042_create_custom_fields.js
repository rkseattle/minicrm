/**
 * Migration 042: Create custom_field_definitions and custom_field_values tables.
 * Enables per-deployment custom fields for contacts, accounts, and deals. (MINCRM-276)
 *
 * The CASCADE on custom_field_values.definition_id means deleting a definition
 * automatically removes all its values across all records without requiring
 * application-level cleanup.
 */

'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('custom_field_definitions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    entity_type: {
      type: 'varchar(16)',
      notNull: true,
      check: "entity_type IN ('contact', 'account', 'deal')",
    },
    name: {
      type: 'varchar(100)',
      notNull: true,
    },
    field_type: {
      type: 'varchar(16)',
      notNull: true,
      check: "field_type IN ('text', 'number', 'date', 'boolean', 'select')",
    },
    options: {
      type: 'jsonb',
      notNull: false,
    },
    sort_order: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('custom_field_definitions', 'custom_field_definitions_entity_type_name_key', {
    unique: ['entity_type', 'name'],
  });

  pgm.createTable('custom_field_values', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    definition_id: {
      type: 'uuid',
      notNull: true,
      references: '"custom_field_definitions"',
      onDelete: 'CASCADE',
    },
    record_id: {
      type: 'uuid',
      notNull: true,
    },
    value: {
      type: 'text',
      notNull: false,
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

  pgm.addConstraint('custom_field_values', 'custom_field_values_definition_id_record_id_key', {
    unique: ['definition_id', 'record_id'],
  });

  pgm.createIndex('custom_field_values', 'record_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('custom_field_values');
  pgm.dropTable('custom_field_definitions');
};

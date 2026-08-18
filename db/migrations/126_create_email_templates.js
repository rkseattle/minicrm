'use strict';

/**
 * Migration 126: Create email_templates table.
 *
 * Stores reusable email templates for use in sequences and activities.
 * Body is stored as HTML. merge_tags is a jsonb array of {key, label} objects
 * documenting the substitution variables available in the template body.
 *
 * category is a freeform string (e.g. 'sales', 'support', 'onboarding') —
 * stored as varchar with a CHECK so new categories can be added without DDL
 * by updating the constraint in a future migration.
 *
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('email_templates', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(200)',
      notNull: true,
    },
    category: {
      type: 'varchar(50)',
      notNull: true,
    },
    subject: {
      type: 'varchar(500)',
      notNull: true,
    },
    body: {
      type: 'text',
      notNull: true,
    },
    merge_tags: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'[]'::jsonb"),
    },
    enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    created_by: {
      type: 'uuid',
      notNull: false,
      references: '"users"',
      onDelete: 'SET NULL',
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
  }, { ifNotExists: true });

  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE email_templates ADD CONSTRAINT email_templates_name_key UNIQUE (name);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  pgm.createIndex('email_templates', 'category', { ifNotExists: true });
  pgm.createIndex('email_templates', 'enabled', { ifNotExists: true });

  pgm.sql(`
    DO $$ BEGIN
      CREATE TRIGGER email_templates_set_updated_at
        BEFORE UPDATE ON public.email_templates
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('email_templates');
};

'use strict';

/**
 * Migration 123: Create ai_sessions and ai_messages tables for multi-session
 * AI conversation persistence.
 *
 * ai_sessions  — one row per conversation, scoped to a user. The `name` column
 *               is auto-populated server-side from the first user message.
 * ai_messages  — ordered message log for each session (role: user | assistant).
 *
 * Cascade delete: deleting a session removes all its messages. Deleting a user
 * removes all their sessions (and by cascade, their messages).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // ifNotExists: true — 000_baseline.js creates these tables on fresh installs,
  // so migration 123 must be idempotent to avoid "relation already exists" errors.
  pgm.createTable('ai_sessions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
      onDelete: 'CASCADE',
    },
    name: {
      type: 'varchar(255)',
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
  }, { ifNotExists: true });

  pgm.createIndex('ai_sessions', 'user_id', { ifNotExists: true });
  pgm.createIndex('ai_sessions', ['user_id', 'updated_at'], { ifNotExists: true });

  pgm.createTable('ai_messages', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: '"ai_sessions"',
      onDelete: 'CASCADE',
    },
    role: {
      type: 'varchar(20)',
      notNull: true,
    },
    content: {
      type: 'text',
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  }, { ifNotExists: true });

  // Guard the CHECK constraint — 000_baseline defines it inline with CREATE TABLE
  // so on fresh installs the constraint already exists when migration 123 runs.
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE ai_messages ADD CONSTRAINT ai_messages_role_check
        CHECK (role IN ('user', 'assistant'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  pgm.createIndex('ai_messages', 'session_id', { ifNotExists: true });
  pgm.createIndex('ai_messages', ['session_id', 'created_at'], { ifNotExists: true });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('ai_messages');
  pgm.dropTable('ai_sessions');
};

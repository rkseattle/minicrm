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
 * (MINCRM-421)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
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
  });

  pgm.createIndex('ai_sessions', 'user_id');
  pgm.createIndex('ai_sessions', ['user_id', 'updated_at']);

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
  });

  pgm.addConstraint('ai_messages', 'ai_messages_role_check', {
    check: "role IN ('user', 'assistant')",
  });

  pgm.createIndex('ai_messages', 'session_id');
  pgm.createIndex('ai_messages', ['session_id', 'created_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('ai_messages');
  pgm.dropTable('ai_sessions');
};

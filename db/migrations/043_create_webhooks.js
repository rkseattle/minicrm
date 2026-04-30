/**
 * Migration 043: Create webhook_subscriptions and webhook_delivery_logs tables.
 * Enables outbound webhooks — both system-level subscriptions and automation-triggered
 * deliveries. (MINCRM-279)
 *
 * secret_hash stores AES-256-GCM encrypted plaintext (not bcrypt) so the server
 * can recover the signing key for HMAC-SHA256 payload signatures at delivery time.
 * The column name follows the ticket spec but the stored value is encrypted, not hashed.
 */

'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('webhook_subscriptions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    url: {
      type: 'text',
      notNull: true,
    },
    events: {
      type: 'text[]',
      notNull: true,
    },
    secret_hash: {
      type: 'text',
      notNull: true,
    },
    status: {
      type: 'varchar(16)',
      notNull: true,
      default: pgm.func("'active'"),
      check: "status IN ('active', 'failed', 'disabled')",
    },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createTable('webhook_delivery_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    subscription_id: {
      type: 'uuid',
      notNull: false,
      references: '"webhook_subscriptions"',
      onDelete: 'CASCADE',
    },
    event_id: {
      type: 'uuid',
      notNull: true,
    },
    event_type: {
      type: 'varchar(64)',
      notNull: true,
    },
    attempt: {
      type: 'integer',
      notNull: true,
      default: 1,
    },
    status_code: {
      type: 'integer',
      notNull: false,
    },
    response_ms: {
      type: 'integer',
      notNull: false,
    },
    error: {
      type: 'text',
      notNull: false,
    },
    delivered_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('webhook_delivery_logs', 'subscription_id');
  pgm.createIndex('webhook_delivery_logs', 'event_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('webhook_delivery_logs');
  pgm.dropTable('webhook_subscriptions');
};

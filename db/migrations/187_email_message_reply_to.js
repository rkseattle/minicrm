/**
 * Stores where each message's sender asked replies to go (RFC 5322 §3.6.2).
 *
 * Empty, not null, means "reply to the sender": that is both a message with no Reply-To and
 * one whose Reply-To is only its sender. Rows synced earlier take the default and reply to
 * the sender, as they did before; the next sync of a message fills it.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.email_messages
      ADD COLUMN IF NOT EXISTS reply_to_addresses text[] NOT NULL DEFAULT '{}'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_messages.reply_to_addresses IS
      'Addresses the sender named in Reply-To, lowercased. Empty when there is none or it names only the sender; a reply then goes to from_address.'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.email_messages
      DROP COLUMN IF EXISTS reply_to_addresses
  `);
};

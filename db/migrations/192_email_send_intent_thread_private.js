/**
 * Records, on each send intent, whether the conversation it answers or forwards was private
 * when the send was claimed.
 *
 * The sync engine may store a Sent copy under a thread of its own deriving rather than the
 * parent's, so the stored row's thread cannot say whether the reply belongs to a private
 * conversation. The claim is the one moment the parent is known for certain.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.email_send_intents
      ADD COLUMN IF NOT EXISTS thread_private boolean NOT NULL DEFAULT false
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_send_intents.thread_private IS
      'True when the message answered or forwarded was in a private thread at claim time. Its filing then stores the message private and files an activity without a body.'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE public.email_send_intents DROP COLUMN IF EXISTS thread_private`);
};

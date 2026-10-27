/**
 * Re-applies migrations 183 to 188, which a boot of the faulty migration runner may have
 * recorded without running, as 189 did for 181 and 182.
 *
 * Each is idempotent (IF NOT EXISTS throughout, a backfill that only fills NULLs) except
 * 185's unique constraint, which is dropped first so 185 can add it again. The data it
 * covers is already unique wherever 185 ran, and the whole migration runs in one
 * transaction, so no moment exists without the constraint.
 */

'use strict';

const rfcHeaders = require('./183_email_message_rfc_headers.js');
const sendIntents = require('./184_email_send_intents.js');
const sendIdempotency = require('./185_email_send_idempotency.js');
const sendLedger = require('./186_email_send_ledger.js');
const replyTo = require('./187_email_message_reply_to.js');
const searchIndexes = require('./188_index_email_messages_search.js');

exports.shorthands = undefined;

exports.up = (pgm) => {
  rfcHeaders.up(pgm);
  sendIntents.up(pgm);
  pgm.sql(
    'ALTER TABLE public.email_send_intents DROP CONSTRAINT IF EXISTS email_send_intents_idempotency_unique',
  );
  sendIdempotency.up(pgm);
  sendLedger.up(pgm);
  replyTo.up(pgm);
  searchIndexes.up(pgm);
};

// Nothing to undo: down would remove schema 183 to 188 own, which their own downs do.
exports.down = () => {};

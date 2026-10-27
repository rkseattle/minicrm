/**
 * Corrects the catalog comment on gdpr_deletion_log.erased_address_hmac, which said the
 * column is NULL when the erased record had no address. Contact and lead email are both
 * NOT NULL, so an erasure always writes a digest; NULL means a row written before the
 * column existed.
 */

'use strict';

exports.shorthands = undefined;

const PREVIOUS =
  "HMAC-SHA256 hex, under a key derived from NODE_ENCRYPTION_KEY, of the erased record''s lowercased email address; NULL when it had none. A pseudonym, not the address. Mail arriving later at that address is redacted on ingest.";

exports.up = (pgm) => {
  pgm.sql(`
    COMMENT ON COLUMN public.gdpr_deletion_log.erased_address_hmac IS
      'HMAC-SHA256 hex, under a key derived from NODE_ENCRYPTION_KEY, of the erased record''s lowercased email address; NULL only on rows written before the column existed. A pseudonym, not the address. Mail arriving later at that address is redacted on ingest.'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`COMMENT ON COLUMN public.gdpr_deletion_log.erased_address_hmac IS '${PREVIOUS}'`);
};

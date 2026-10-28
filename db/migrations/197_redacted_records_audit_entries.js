/**
 * Lets redacted_records hold audit entries as well as activities. A send in a private thread
 * leaves email_sent / email_send_unconfirmed entries on the mailbox naming its recipients;
 * recording the decision against the entry itself keeps them masked after the message or
 * send intent they describe is deleted (a disconnected mailbox, the intent purge).
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.redacted_records
      DROP CONSTRAINT IF EXISTS redacted_records_record_type_check,
      ADD CONSTRAINT redacted_records_record_type_check
        CHECK (record_type IN ('activity', 'audit_log'))
  `);
  pgm.sql(`COMMENT ON TABLE public.redacted_records IS 'Records whose content reads masked. An activity: subject and text removed (GDPR erasure or a private thread); audit reads mask an erased one''s entries, and a scrubbed one''s written before redacted_at. An audit_log entry: a private thread''s send, whose recipients and linked records read [Private]. Kept after the record is deleted.'`);
};

exports.down = (pgm) => {
  pgm.sql(`COMMENT ON TABLE public.redacted_records IS 'Records whose subject and text were removed (GDPR erasure or a private thread). Audit reads mask an erased record''s entries, and a scrubbed one''s written before redacted_at; kept after the record is deleted.'`);
  pgm.sql(`DELETE FROM public.redacted_records WHERE record_type = 'audit_log'`);
  pgm.sql(`
    ALTER TABLE public.redacted_records
      DROP CONSTRAINT IF EXISTS redacted_records_record_type_check,
      ADD CONSTRAINT redacted_records_record_type_check CHECK (record_type IN ('activity'))
  `);
};

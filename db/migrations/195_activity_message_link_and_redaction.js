/**
 * Two things an activity needs once its text can be withdrawn after filing.
 *
 * Email activities record the message they were filed from as metadata.email_message_id
 * (type-specific, so metadata per schema.md), so marking that thread private can scrub
 * activities already filed from it. No FK: a disconnected mailbox takes its messages, and an
 * id that no longer matches simply stops matching.
 *
 * redacted_records lists records whose text was removed, by GDPR erasure or a private thread.
 * Audit reads mask by reason, since the append-only log still holds what was removed: an
 * erasure masks every entry, a private-thread scrub only those written before redacted_at.
 * It is a log of its own, with no FK and no row security, so masking survives the record's
 * deletion and holds under any role.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.redacted_records (
      record_type text NOT NULL CHECK (record_type IN ('activity')),
      record_id uuid NOT NULL,
      reason text NOT NULL CHECK (reason IN ('gdpr_erasure', 'private_thread')),
      redacted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (record_type, record_id)
    )
  `);
  pgm.sql(`
    COMMENT ON TABLE public.redacted_records IS
      'Records whose subject and text were removed (GDPR erasure or a private thread). Audit reads mask an erased record''s entries, and a scrubbed one''s written before redacted_at; kept after the record is deleted.'
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS activities_email_message_id_idx
      ON public.activities ((metadata->>'email_message_id'))
      WHERE (metadata->>'email_message_id') IS NOT NULL
  `);
  // The send filing writes the activity and stamps the intent in one transaction.
  pgm.sql(`
    UPDATE public.activities a
       SET metadata = COALESCE(a.metadata, '{}'::jsonb)
                      || jsonb_build_object('email_message_id', i.email_message_id::text)
      FROM public.email_send_intents i
     WHERE i.status = 'filed' AND i.email_message_id IS NOT NULL
       AND a.type = 'Email' AND a.owner_id = i.user_id AND a.created_at = i.filed_at
       AND (   (i.record_type = 'contact' AND a.contact_id = i.record_id)
            OR (i.record_type = 'account' AND a.account_id = i.record_id)
            OR (i.record_type = 'deal'    AND a.deal_id    = i.record_id))
  `);
  // Activities an erasure already scrubbed: on the contact, and by association.
  pgm.sql(`
    INSERT INTO public.redacted_records (record_type, record_id, reason, redacted_at)
    SELECT DISTINCT ON (a.id) 'activity', a.id, 'gdpr_erasure', g.completed_at
      FROM public.activities a
      JOIN public.gdpr_deletion_log g
        ON g.completed_at IS NOT NULL
       AND (   (g.record_type = 'contact' AND g.record_id = a.contact_id)
            OR EXISTS (SELECT 1 FROM public.activity_participants p
                        WHERE p.activity_id = a.id
                          AND p.record_type = g.record_type AND p.record_id = g.record_id))
     ORDER BY a.id, g.completed_at
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.activities_email_message_id_idx`);
  pgm.sql(`
    UPDATE public.activities SET metadata = NULLIF(metadata - 'email_message_id', '{}'::jsonb)
     WHERE metadata ? 'email_message_id'
  `);
  pgm.sql(`DROP TABLE IF EXISTS public.redacted_records`);
};

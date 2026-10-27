/**
 * Associates each Email activity with the contacts and leads it concerns.
 *
 * A send from a deal or account files an activity there carrying the message's subject and
 * text. GDPR erasure must reach that text from the erased person's record, as HubSpot's
 * engagement associations and Salesforce's Right to be Forgotten policies do: through an
 * association that lives on the activity, so disconnecting the mailbox cannot break it.
 *
 * record_type/record_id is polymorphic with no FK; deletes, conversions and merges keep it
 * current alongside email_message_links. The backfill reaches activities whose send intent
 * is still retained (30 days) and whose message is still linked; older ones cannot be
 * associated after the fact.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.activity_participants (
      activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
      record_type varchar(16) NOT NULL,
      record_id   uuid NOT NULL,
      CONSTRAINT activity_participants_pkey PRIMARY KEY (activity_id, record_type, record_id),
      CONSTRAINT activity_participants_record_type_check
        CHECK (record_type IN ('contact', 'lead'))
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS activity_participants_record_idx
      ON public.activity_participants (record_type, record_id)
  `);
  pgm.sql(`
    COMMENT ON TABLE public.activity_participants IS
      'The contacts and leads an Email activity concerns, from its message''s links at filing. GDPR erasure redacts every activity associated with the erased record. record_type + record_id is polymorphic with no FK: hard deletes clear their rows, lead conversion and contact merge move them.'
  `);
  pgm.sql(`
    INSERT INTO public.activity_participants (activity_id, record_type, record_id)
    SELECT DISTINCT a.id, l.record_type, l.record_id
      FROM public.email_send_intents i
      JOIN public.activities a
        ON a.type = 'Email'
       AND a.owner_id = i.user_id
       AND a.created_at = i.filed_at
       AND (   (i.record_type = 'contact' AND a.contact_id = i.record_id)
            OR (i.record_type = 'account' AND a.account_id = i.record_id)
            OR (i.record_type = 'deal'    AND a.deal_id    = i.record_id))
      JOIN public.email_message_links l
        ON l.email_message_id = i.email_message_id
       AND l.record_type IN ('contact', 'lead')
     WHERE i.status = 'filed' AND i.email_message_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.activity_participants`);
};

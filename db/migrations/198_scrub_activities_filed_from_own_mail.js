/**
 * The one path by which marking a thread private writes other users' activities.
 *
 * The scrub must reach every activity filed from the thread, including ones since reassigned
 * to a colleague; a row policy granting that would let the mailbox owner change any column of
 * them, since policies cannot restrict columns. This SECURITY DEFINER function instead changes
 * only the subject and text, and only of activities filed from messages in a mailbox of the
 * current app user (app.current_user_id), so it holds under any connecting role. It runs as its
 * owner, the migrating superuser, which row security does not apply to.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.scrub_activities_filed_from_own_mail(
      message_ids uuid[],
      new_subject text
    )
      RETURNS TABLE (activity_id uuid, scrubbed boolean)
      LANGUAGE sql VOLATILE SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        WITH owned AS (
          SELECT m.id::text AS id
            FROM public.email_messages m
            JOIN public.connected_accounts ca ON ca.id = m.connected_account_id
           WHERE m.id = ANY(message_ids) AND ca.user_id = public.app_current_user_id()
        ),
        filed AS (
          SELECT a.id FROM public.activities a
           WHERE (a.metadata->>'email_message_id') IN (SELECT id FROM owned)
        ),
        changed AS (
          UPDATE public.activities a
             SET subject = new_subject, notes = NULL, version = a.version + 1, updated_at = now()
           WHERE a.id IN (SELECT id FROM filed)
             AND (a.subject IS DISTINCT FROM new_subject OR a.notes IS NOT NULL)
          RETURNING a.id
        )
        SELECT f.id, c.id IS NOT NULL FROM filed f LEFT JOIN changed c ON c.id = f.id
      $$
  `);
  pgm.sql(`
    COMMENT ON FUNCTION public.scrub_activities_filed_from_own_mail(uuid[], text) IS
      'Removes the subject and text of activities filed from the current app user''s own messages, whoever owns them; returns each filed activity and whether it changed.'
  `);
  pgm.sql(
    'REVOKE EXECUTE ON FUNCTION public.scrub_activities_filed_from_own_mail(uuid[], text) FROM PUBLIC',
  );
  pgm.sql(
    'GRANT EXECUTE ON FUNCTION public.scrub_activities_filed_from_own_mail(uuid[], text) TO minicrm_app',
  );
};

exports.down = (pgm) => {
  pgm.sql('DROP FUNCTION IF EXISTS public.scrub_activities_filed_from_own_mail(uuid[], text)');
};

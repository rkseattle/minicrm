'use strict';

/**
 * Migration 135: Create ai_gdpr_cascade_log table.
 *
 * Tracks each execution of the GDPR AI data cascade — the asynchronous job that
 * runs after a contact GDPR erasure to redact PII references from ai_messages
 * and remove matching user_ai_context entries.
 *
 * One row per cascade run per contact. A contact may have multiple rows if the
 * admin triggers a manual re-run via the API.
 *
 * triggered_by is nullable — NULL indicates a cascade triggered automatically
 * by the GDPR erasure flow (system-initiated, no interactive actor).
 * When an admin triggers a manual re-run, triggered_by holds their user ID.
 *
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.ai_gdpr_cascade_log (
      id                     uuid DEFAULT gen_random_uuid() NOT NULL,
      contact_id             uuid NOT NULL,
      triggered_at           timestamp with time zone DEFAULT now() NOT NULL,
      triggered_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
      messages_redacted      integer NOT NULL DEFAULT 0,
      context_entries_removed integer NOT NULL DEFAULT 0,
      status                 varchar(20) NOT NULL DEFAULT 'completed'
                               CONSTRAINT ai_gdpr_cascade_log_status_check
                                 CHECK (status IN ('completed', 'failed')),
      error_detail           text,
      CONSTRAINT ai_gdpr_cascade_log_pkey PRIMARY KEY (id)
    )
  `);

  pgm.sql(`COMMENT ON TABLE public.ai_gdpr_cascade_log IS 'Audit log for GDPR AI data cascade runs — redaction of PII in ai_messages and removal of matching user_ai_context entries following contact erasure. (MINCRM-446)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_gdpr_cascade_log.triggered_by IS 'NULL = system-initiated (auto-cascade after GDPR erasure). Non-null = admin who triggered a manual re-run.'`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_gdpr_cascade_log_contact_id_idx ON public.ai_gdpr_cascade_log USING btree (contact_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_gdpr_cascade_log_triggered_at_idx ON public.ai_gdpr_cascade_log USING btree (triggered_at)`);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.ai_gdpr_cascade_log`);
};

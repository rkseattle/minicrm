'use strict';

/**
 * Migration 172 — Create email_messages and email_sync_jobs.
 *
 * body_text, body_html, and snippet are specified for this table but deliberately not
 * created here: retrieving a body means parsing MIME, which needs a dependency added
 * under its own review. They arrive with the parser that fills them, since a column that
 * is always null is worse than one that does not exist. Anything reading this table
 * before then gets addresses, subject, and thread id only.
 *
 * email_sync_jobs mirrors import_jobs' progress-tracking shape but constrains status with
 * a CHECK and gives failures their own column. import_jobs predates that convention and
 * overloads error_csv for both a failed-row export and a bare error message.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.email_messages (
      id                  uuid DEFAULT gen_random_uuid() NOT NULL,
      connected_account_id uuid NOT NULL
                            REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
      provider_message_id text NOT NULL,
      thread_id           text NOT NULL,
      direction           varchar(16) NOT NULL,
      from_address        text NOT NULL,
      to_addresses        text[] NOT NULL DEFAULT '{}',
      cc_addresses        text[] NOT NULL DEFAULT '{}',
      subject             text,
      has_attachments     boolean NOT NULL DEFAULT false,
      sent_at             timestamp with time zone,
      is_private          boolean NOT NULL DEFAULT false,
      created_at          timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT email_messages_pkey PRIMARY KEY (id),
      CONSTRAINT email_messages_account_provider_id_unique
        UNIQUE (connected_account_id, provider_message_id),
      CONSTRAINT email_messages_direction_check
        CHECK (direction IN ('inbound', 'outbound'))
    )
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_messages_thread_id_idx
      ON public.email_messages (thread_id)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_messages_sent_at_idx
      ON public.email_messages (sent_at)
  `);

  // Every read of this table is account-scoped and newest-first; the bare sent_at index
  // above cannot serve that ordering without a sort.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_messages_account_sent_at_idx
      ON public.email_messages (connected_account_id, sent_at DESC)
  `);

  pgm.sql(
    `COMMENT ON TABLE public.email_messages IS 'Messages synced from a connected mailbox. Headers and metadata; bodies are not stored.'`,
  );

  pgm.sql(
    `COMMENT ON COLUMN public.email_messages.provider_message_id IS 'The provider''s own message identifier, opaque here. Unique per connected account, which is what makes a repeated sync idempotent.'`,
  );

  pgm.sql(
    `COMMENT ON COLUMN public.email_messages.thread_id IS 'Normalized across providers: native thread id where one exists, otherwise derived from RFC 5322 References/In-Reply-To/Message-ID.'`,
  );

  pgm.sql(
    `COMMENT ON COLUMN public.email_messages.is_private IS 'Restricts a message to the mailbox owner; enforced at the service layer.'`,
  );

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.email_sync_jobs (
      id                   uuid DEFAULT gen_random_uuid() NOT NULL,
      connected_account_id uuid NOT NULL
                             REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
      status               varchar(16) NOT NULL DEFAULT 'pending',
      messages_synced      integer NOT NULL DEFAULT 0,
      error                text,
      started_at           timestamp with time zone,
      completed_at         timestamp with time zone,
      created_at           timestamp with time zone DEFAULT now() NOT NULL,
      updated_at           timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT email_sync_jobs_pkey PRIMARY KEY (id),
      CONSTRAINT email_sync_jobs_status_check
        CHECK (status IN ('pending', 'running', 'complete', 'failed'))
    )
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_sync_jobs_account_id_idx
      ON public.email_sync_jobs (connected_account_id)
  `);

  pgm.sql(`
    DO $$ BEGIN
      CREATE TRIGGER email_sync_jobs_set_updated_at
        BEFORE UPDATE ON public.email_sync_jobs
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  pgm.sql(
    `COMMENT ON TABLE public.email_sync_jobs IS 'Progress of a bounded mailbox backfill. One row per backfill run; incremental syncs create none.'`,
  );

  pgm.sql(
    `COMMENT ON COLUMN public.email_sync_jobs.messages_synced IS 'Messages stored so far. A backfill spans several scheduler ticks, so this advances while status stays running.'`,
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.email_sync_jobs`);
  pgm.sql(`DROP TABLE IF EXISTS public.email_messages`);
};

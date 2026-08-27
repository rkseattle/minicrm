'use strict';

/**
 * Migration 169 — Create connected_accounts and connected_account_oauth_states.
 *
 * auth_encrypted holds AES-256-GCM ciphertext from cryptoService's encryptVersioned.
 * OAuth token sets and IMAP credentials both serialize to JSON first, so one opaque
 * column serves every provider and no query can read a credential by accident.
 *
 * granted_scopes stores what the provider actually granted, which can be less than was
 * requested — the sync work needs to fail loudly rather than skip mail it cannot read.
 *
 * connected_account_oauth_states holds the OAuth round-trip's state server-side rather
 * than in a cookie: it must carry a PKCE verifier and bind the flow to the user who began
 * it, where a cookie names whoever holds the browser at callback time — which is how a
 * mailbox ends up grafted onto the wrong account.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.connected_accounts (
      id             uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      provider       varchar(16) NOT NULL,
      email_address  text NOT NULL,
      auth_encrypted text NOT NULL,
      granted_scopes text[] NOT NULL DEFAULT '{}',
      status         varchar(16) NOT NULL DEFAULT 'active',
      status_detail  text,
      last_sync_at   timestamp with time zone,
      sync_cursor    text,
      key_version    smallint NOT NULL DEFAULT 1,
      created_at     timestamp with time zone DEFAULT now() NOT NULL,
      updated_at     timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT connected_accounts_pkey PRIMARY KEY (id),
      CONSTRAINT connected_accounts_user_provider_email_unique
        UNIQUE (user_id, provider, email_address),
      CONSTRAINT connected_accounts_provider_check
        CHECK (provider IN ('google', 'microsoft', 'imap')),
      CONSTRAINT connected_accounts_status_check
        CHECK (status IN ('active', 'error', 'disconnected'))
    )
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS connected_accounts_user_id_idx
      ON public.connected_accounts (user_id)
  `);

  pgm.sql(`
    DO $$ BEGIN
      CREATE TRIGGER connected_accounts_set_updated_at
        BEFORE UPDATE ON public.connected_accounts
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  pgm.sql(
    `COMMENT ON TABLE public.connected_accounts IS 'Per-user linked mailboxes. auth_encrypted is AES-256-GCM ciphertext (OAuth tokens or IMAP credentials as JSON); it is never returned by any API.'`,
  );

  pgm.sql(
    `COMMENT ON COLUMN public.connected_accounts.key_version IS 'Key version used to encrypt auth_encrypted. References ENCRYPTION_KEY_V<n> env var.'`,
  );

  pgm.sql(
    `COMMENT ON COLUMN public.connected_accounts.granted_scopes IS 'Scopes the provider actually granted, which may be fewer than were requested.'`,
  );

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.connected_account_oauth_states (
      state          text NOT NULL,
      user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      provider       varchar(16) NOT NULL,
      pkce_verifier  text NOT NULL,
      expires_at     timestamp with time zone NOT NULL,
      created_at     timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT connected_account_oauth_states_pkey PRIMARY KEY (state),
      CONSTRAINT connected_account_oauth_states_provider_check
        CHECK (provider IN ('google', 'microsoft'))
    )
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS connected_account_oauth_states_expires_at_idx
      ON public.connected_account_oauth_states (expires_at)
  `);

  pgm.sql(
    `COMMENT ON TABLE public.connected_account_oauth_states IS 'Single-use OAuth authorization-code state. Binds a flow to the user who started it and holds that flow PKCE verifier until the callback consumes the row.'`,
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.connected_account_oauth_states`);
  pgm.sql(`DROP TABLE IF EXISTS public.connected_accounts`);
};

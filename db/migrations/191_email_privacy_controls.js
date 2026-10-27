/**
 * Adds the columns and settings behind email sync's privacy controls: per-mailbox pause and
 * excluded domains, the org-wide domain list and backfill window, and what GDPR erasure
 * needs to keep a redacted message redacted.
 *
 * erased_address_hmac is a keyed digest rather than the address, so the indefinitely
 * retained erasure log holds only a pseudonym: reversing it needs the server key, not just
 * a list of candidate addresses. It is what lets a mailbox connected after an erasure
 * redact that address's mail as it arrives: a redacted row protects only itself, and
 * disconnecting a mailbox cascades its rows away.
 *
 * Thread-level privacy updates need no new index: email_messages_account_thread_idx
 * already covers (connected_account_id, thread_id).
 */

'use strict';

exports.shorthands = undefined;

// Matches MAX_EXCLUDED_DOMAINS in shared/schemas/emailDomainSchema.ts.
const MAX_EXCLUDED_DOMAINS = 500;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.connected_accounts
      ADD COLUMN IF NOT EXISTS excluded_domains text[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS sync_paused_at timestamptz
  `);
  pgm.sql(`
    ALTER TABLE public.connected_accounts
      ADD CONSTRAINT connected_accounts_excluded_domains_max_check
        CHECK (cardinality(excluded_domains) <= ${MAX_EXCLUDED_DOMAINS})
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.connected_accounts.excluded_domains IS
      'Domains this mailbox''s owner never wants synced, lowercased. A message is skipped at sync time when every counterparty address is on one of these or on the org list.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.connected_accounts.sync_paused_at IS
      'When the owner paused sync, or NULL when it runs. Kept apart from status, which reports connection health and is rewritten by every synced page.'
  `);

  pgm.sql(`
    ALTER TABLE public.email_messages
      ADD COLUMN IF NOT EXISTS gdpr_redacted_at timestamptz
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_messages.gdpr_redacted_at IS
      'When GDPR erasure redacted this message. A re-sync never overwrites a redacted row, so the redaction survives the provider still holding the original.'
  `);

  pgm.sql(`
    ALTER TABLE public.gdpr_deletion_log
      ADD COLUMN IF NOT EXISTS email_messages_redacted integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS email_links_deleted integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS erased_address_hmac text
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS gdpr_deletion_log_erased_address_idx
      ON public.gdpr_deletion_log (erased_address_hmac)
      WHERE erased_address_hmac IS NOT NULL
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.gdpr_deletion_log.email_messages_redacted IS
      'Synced messages the erasure redacted, across every mailbox.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.gdpr_deletion_log.email_links_deleted IS
      'Links from synced messages to the erased record that the erasure deleted.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.gdpr_deletion_log.erased_address_hmac IS
      'HMAC-SHA256 hex, under a key derived from NODE_ENCRYPTION_KEY, of the erased record''s lowercased email address; NULL when it had none. A pseudonym, not the address. Mail arriving later at that address is redacted on ingest.'
  `);

  pgm.sql(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('email_sync_excluded_domains', '[]', now()),
           ('email_sync_backfill_days', '90', now())
    ON CONFLICT (key) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM system_settings
     WHERE key IN ('email_sync_excluded_domains', 'email_sync_backfill_days')
  `);
  pgm.sql(`DROP INDEX IF EXISTS public.gdpr_deletion_log_erased_address_idx`);
  pgm.sql(`
    ALTER TABLE public.gdpr_deletion_log
      DROP COLUMN IF EXISTS erased_address_hmac,
      DROP COLUMN IF EXISTS email_links_deleted,
      DROP COLUMN IF EXISTS email_messages_redacted
  `);
  pgm.sql(`ALTER TABLE public.email_messages DROP COLUMN IF EXISTS gdpr_redacted_at`);
  pgm.sql(`
    ALTER TABLE public.connected_accounts
      DROP CONSTRAINT IF EXISTS connected_accounts_excluded_domains_max_check,
      DROP COLUMN IF EXISTS sync_paused_at,
      DROP COLUMN IF EXISTS excluded_domains
  `);
};

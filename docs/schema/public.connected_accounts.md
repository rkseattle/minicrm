# public.connected_accounts

## Description

Per-user linked mailboxes. auth_encrypted is AES-256-GCM ciphertext (OAuth tokens or IMAP credentials as JSON); it is never returned by any API.

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false | [public.email_messages](public.email_messages.md) [public.email_sync_jobs](public.email_sync_jobs.md) |  |  |
| user_id | uuid |  | false |  | [public.users](public.users.md) |  |
| provider | varchar(16) |  | false |  |  |  |
| email_address | text |  | false |  |  |  |
| auth_encrypted | text |  | false |  |  |  |
| granted_scopes | text[] | '{}'::text[] | false |  |  | Scopes the provider actually granted, which may be fewer than were requested. |
| status | varchar(16) | 'active'::character varying | false |  |  |  |
| status_detail | text |  | true |  |  |  |
| last_sync_at | timestamp with time zone |  | true |  |  |  |
| sync_cursor | text |  | true |  |  |  |
| key_version | smallint | 1 | false |  |  | Key version used to encrypt auth_encrypted. References ENCRYPTION_KEY_V\<n\> env var. |
| created_at | timestamp with time zone | now() | false |  |  |  |
| updated_at | timestamp with time zone | now() | false |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| connected_accounts_provider_check | CHECK | CHECK (((provider)::text = ANY ((ARRAY['google'::character varying, 'microsoft'::character varying, 'imap'::character varying])::text[]))) |
| connected_accounts_status_check | CHECK | CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'error'::character varying, 'disconnected'::character varying])::text[]))) |
| connected_accounts_user_id_fkey | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE |
| connected_accounts_pkey | PRIMARY KEY | PRIMARY KEY (id) |
| connected_accounts_user_provider_email_unique | UNIQUE | UNIQUE (user_id, provider, email_address) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| connected_accounts_pkey | CREATE UNIQUE INDEX connected_accounts_pkey ON public.connected_accounts USING btree (id) |
| connected_accounts_user_provider_email_unique | CREATE UNIQUE INDEX connected_accounts_user_provider_email_unique ON public.connected_accounts USING btree (user_id, provider, email_address) |
| connected_accounts_user_id_idx | CREATE INDEX connected_accounts_user_id_idx ON public.connected_accounts USING btree (user_id) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| connected_accounts_set_updated_at | CREATE TRIGGER connected_accounts_set_updated_at BEFORE UPDATE ON public.connected_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

## Relations

```mermaid
erDiagram

"public.email_messages" }o--|| "public.connected_accounts" : "FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE CASCADE"
"public.email_sync_jobs" }o--|| "public.connected_accounts" : "FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE CASCADE"
"public.connected_accounts" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"

"public.connected_accounts" {
  uuid id ""
  uuid user_id FK ""
  varchar_16_ provider ""
  text email_address ""
  text auth_encrypted ""
  text__ granted_scopes "Scopes the provider actually granted, which may be fewer than were requested."
  varchar_16_ status ""
  text status_detail ""
  timestamp_with_time_zone last_sync_at ""
  text sync_cursor ""
  smallint key_version "Key version used to encrypt auth_encrypted. References ENCRYPTION_KEY_V<n> env var."
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.email_messages" {
  uuid id ""
  uuid connected_account_id FK ""
  text provider_message_id "The provider's own message identifier, opaque here. Unique per connected account, which is what makes a repeated sync idempotent."
  text thread_id "Normalized across providers: native thread id where one exists, otherwise derived from RFC 5322 References/In-Reply-To/Message-ID."
  varchar_16_ direction ""
  text from_address ""
  text__ to_addresses ""
  text__ cc_addresses ""
  text subject ""
  boolean has_attachments ""
  timestamp_with_time_zone sent_at ""
  boolean is_private "Restricts a message to the mailbox owner; enforced at the service layer."
  timestamp_with_time_zone created_at ""
}
"public.email_sync_jobs" {
  uuid id ""
  uuid connected_account_id FK ""
  varchar_16_ status ""
  integer messages_synced "Messages stored so far. A backfill spans several scheduler ticks, so this advances while status stays running."
  text error ""
  timestamp_with_time_zone started_at ""
  timestamp_with_time_zone completed_at ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.users" {
  uuid id ""
  varchar_255_ email ""
  text password_hash ""
  varchar_255_ name ""
  varchar_20_ role ""
  varchar_10_ status ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  boolean must_change_password ""
  varchar_10_ preferred_language ""
  varchar_64_ password_reset_token_hash ""
  timestamp_with_time_zone password_reset_expires_at ""
  timestamp_with_time_zone password_changed_at ""
  boolean notify_overdue_tasks ""
  boolean notify_assignments ""
  boolean notify_deal_stage_changes ""
  boolean mfa_enabled ""
  text mfa_secret ""
  text mfa_pending_secret ""
  text__ mfa_recovery_codes ""
  boolean onboarding_completed ""
  timestamp_with_time_zone onboarding_completed_at ""
  varchar_20_ sso_provider "SSO protocol that provisioned this user: saml | oidc"
  text sso_subject "Stable external identity: SAML nameID or OIDC sub claim"
  text api_token_hash ""
  timestamp_with_time_zone api_token_issued_at ""
  text scim_external_id ""
  varchar_255_ territory "Free-text sales territory a rep is assigned to, matched against leads.territory for routing suggestions (MINCRM-475)."
  varchar_20_ nav_layout "Personal navigation layout. NULL means follow the workspace default in system_settings.nav_layout, so a later admin change still propagates."
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

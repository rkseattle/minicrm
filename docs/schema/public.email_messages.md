# public.email_messages

## Description

Messages synced from a connected mailbox. Headers, metadata, and body text. All three body columns are nullable: a message may store its headers with no body.

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false |  |  |  |
| connected_account_id | uuid |  | false |  | [public.connected_accounts](public.connected_accounts.md) |  |
| provider_message_id | text |  | false |  |  | The provider's own message identifier, opaque here. Unique per connected account, which is what makes a repeated sync idempotent. |
| thread_id | text |  | false |  |  | Normalized across providers: native thread id where one exists, otherwise derived from RFC 5322 References/In-Reply-To/Message-ID. |
| direction | varchar(16) |  | false |  |  |  |
| from_address | text |  | false |  |  |  |
| to_addresses | text[] | '{}'::text[] | false |  |  |  |
| cc_addresses | text[] | '{}'::text[] | false |  |  |  |
| subject | text |  | true |  |  |  |
| has_attachments | boolean | false | false |  |  |  |
| sent_at | timestamp with time zone |  | true |  |  |  |
| is_private | boolean | false | false |  |  | Restricts a message to the mailbox owner; enforced at the service layer. |
| created_at | timestamp with time zone | now() | false |  |  |  |
| message_body_text | text |  | true |  |  | Plain-text body. Taken from the text part where one exists, otherwise converted from the HTML part so a message reads the same either way. Null when neither part exists or the document could not be parsed. |
| message_body_html | text |  | true |  |  | HTML body exactly as the sender wrote it, stored UNSANITIZED. Nothing renders it today; whatever first does must sanitize at render, since sanitizing here would discard markup a renderer needs. |
| message_snippet | text |  | true |  |  | First 200 characters of the plain-text body with whitespace collapsed, for list views that must not load a whole body. Derived from message_body_text, so it is null whenever that is. |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| email_messages_direction_check | CHECK | CHECK (((direction)::text = ANY ((ARRAY['inbound'::character varying, 'outbound'::character varying])::text[]))) |
| email_messages_connected_account_id_fkey | FOREIGN KEY | FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE CASCADE |
| email_messages_pkey | PRIMARY KEY | PRIMARY KEY (id) |
| email_messages_account_provider_id_unique | UNIQUE | UNIQUE (connected_account_id, provider_message_id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| email_messages_pkey | CREATE UNIQUE INDEX email_messages_pkey ON public.email_messages USING btree (id) |
| email_messages_account_provider_id_unique | CREATE UNIQUE INDEX email_messages_account_provider_id_unique ON public.email_messages USING btree (connected_account_id, provider_message_id) |
| email_messages_thread_id_idx | CREATE INDEX email_messages_thread_id_idx ON public.email_messages USING btree (thread_id) |
| email_messages_sent_at_idx | CREATE INDEX email_messages_sent_at_idx ON public.email_messages USING btree (sent_at) |
| email_messages_account_sent_at_idx | CREATE INDEX email_messages_account_sent_at_idx ON public.email_messages USING btree (connected_account_id, sent_at DESC) |

## Relations

```mermaid
erDiagram

"public.email_messages" }o--|| "public.connected_accounts" : "FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE CASCADE"

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
  text message_body_text "Plain-text body. Taken from the text part where one exists, otherwise converted from the HTML part so a message reads the same either way. Null when neither part exists or the document could not be parsed."
  text message_body_html "HTML body exactly as the sender wrote it, stored UNSANITIZED. Nothing renders it today; whatever first does must sanitize at render, since sanitizing here would discard markup a renderer needs."
  text message_snippet "First 200 characters of the plain-text body with whitespace collapsed, for list views that must not load a whole body. Derived from message_body_text, so it is null whenever that is."
}
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
  integer sync_failure_count "Consecutive failed sync attempts. Drives the retry delay and the ceiling past which a mailbox is no longer claimed; reset when a connection test succeeds."
  timestamp_with_time_zone sync_next_attempt_at "Earliest time this mailbox may be synced again. Null means due now while sync_failure_count is below the ceiling, and parked-until-a-user-acts once it reaches it; the two columns gate the claim together."
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

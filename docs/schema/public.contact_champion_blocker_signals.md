# public.contact_champion_blocker_signals

## Description

Per-contact AI champion/blocker classification (MINCRM-466). One row per contact — replaced/updated after each new activity, not appended.

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false |  |  |  |
| contact_id | uuid |  | false |  | [public.contacts](public.contacts.md) |  |
| status | text | 'neutral'::text | false |  |  |  |
| confidence | numeric(3,2) | 0 | false |  |  |  |
| contributing_signals | jsonb | '[]'::jsonb | false |  |  |  |
| last_activity_id | uuid |  | true |  | [public.activities](public.activities.md) |  |
| override_status | text |  | true |  |  |  |
| override_reason | text |  | true |  |  |  |
| overridden_by | uuid |  | true |  | [public.users](public.users.md) |  |
| overridden_at | timestamp with time zone |  | true |  |  |  |
| dismissed_by | uuid |  | true |  | [public.users](public.users.md) |  |
| dismissed_at | timestamp with time zone |  | true |  |  |  |
| created_at | timestamp with time zone | now() | false |  |  |  |
| updated_at | timestamp with time zone | now() | false |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| contact_champion_blocker_signals_override_status_check | CHECK | CHECK (((override_status IS NULL) OR (override_status = ANY (ARRAY['champion'::text, 'likely_champion'::text, 'neutral'::text, 'likely_blocker'::text, 'blocker'::text])))) |
| contact_champion_blocker_signals_status_check | CHECK | CHECK ((status = ANY (ARRAY['champion'::text, 'likely_champion'::text, 'neutral'::text, 'likely_blocker'::text, 'blocker'::text]))) |
| contact_champion_blocker_signals_dismissed_by_fkey | FOREIGN KEY | FOREIGN KEY (dismissed_by) REFERENCES users(id) ON DELETE SET NULL |
| contact_champion_blocker_signals_overridden_by_fkey | FOREIGN KEY | FOREIGN KEY (overridden_by) REFERENCES users(id) ON DELETE SET NULL |
| contact_champion_blocker_signals_contact_id_fkey | FOREIGN KEY | FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE |
| contact_champion_blocker_signals_last_activity_id_fkey | FOREIGN KEY | FOREIGN KEY (last_activity_id) REFERENCES activities(id) ON DELETE SET NULL |
| contact_champion_blocker_signals_pkey | PRIMARY KEY | PRIMARY KEY (id) |
| contact_champion_blocker_signals_contact_id_unique | UNIQUE | UNIQUE (contact_id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| contact_champion_blocker_signals_pkey | CREATE UNIQUE INDEX contact_champion_blocker_signals_pkey ON public.contact_champion_blocker_signals USING btree (id) |
| contact_champion_blocker_signals_contact_id_unique | CREATE UNIQUE INDEX contact_champion_blocker_signals_contact_id_unique ON public.contact_champion_blocker_signals USING btree (contact_id) |
| contact_champion_blocker_signals_status_idx | CREATE INDEX contact_champion_blocker_signals_status_idx ON public.contact_champion_blocker_signals USING btree (status) |

## Relations

```mermaid
erDiagram

"public.contact_champion_blocker_signals" |o--|| "public.contacts" : "FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE"
"public.contact_champion_blocker_signals" }o--o| "public.activities" : "FOREIGN KEY (last_activity_id) REFERENCES activities(id) ON DELETE SET NULL"
"public.contact_champion_blocker_signals" }o--o| "public.users" : "FOREIGN KEY (overridden_by) REFERENCES users(id) ON DELETE SET NULL"
"public.contact_champion_blocker_signals" }o--o| "public.users" : "FOREIGN KEY (dismissed_by) REFERENCES users(id) ON DELETE SET NULL"

"public.contact_champion_blocker_signals" {
  uuid id ""
  uuid contact_id FK ""
  text status ""
  numeric_3_2_ confidence ""
  jsonb contributing_signals ""
  uuid last_activity_id FK ""
  text override_status ""
  text override_reason ""
  uuid overridden_by FK ""
  timestamp_with_time_zone overridden_at ""
  uuid dismissed_by FK ""
  timestamp_with_time_zone dismissed_at ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.contacts" {
  uuid id ""
  varchar_255_ first_name ""
  varchar_255_ last_name ""
  varchar_255_ email ""
  varchar_50_ phone ""
  varchar_255_ title ""
  varchar_255_ department ""
  uuid owner_id FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  uuid account_id FK ""
  boolean is_demo ""
  uuid source_lead_id FK ""
  varchar_255_ address_line1 ""
  varchar_255_ address_line2 ""
  varchar_100_ city ""
  varchar_100_ state_region ""
  varchar_20_ postal_code ""
  varchar_100_ country ""
  varchar_500_ linkedin_url ""
  varchar_500_ twitter_x_url ""
  varchar_500_ other_url ""
  integer version ""
}
"public.activities" {
  uuid id ""
  activity_type type ""
  varchar_255_ subject ""
  text notes ""
  date due_date ""
  activity_status status ""
  uuid contact_id FK ""
  uuid account_id FK ""
  uuid deal_id FK ""
  uuid owner_id FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  activity_direction direction ""
  text outcome ""
  boolean is_demo ""
  integer version ""
  jsonb metadata ""
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
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

# public.sequence_enrollments

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false | [public.sequence_enrollment_logs](public.sequence_enrollment_logs.md) |  |  |
| sequence_id | uuid |  | false |  | [public.sales_sequences](public.sales_sequences.md) |  |
| contact_id | uuid |  | false |  | [public.contacts](public.contacts.md) |  |
| enrolled_by_id | uuid |  | true |  | [public.users](public.users.md) |  |
| enrolled_at | timestamp with time zone | now() | false |  |  |  |
| status | varchar(16) | '''active'''::character varying | false |  |  |  |
| current_step_id | uuid |  | true |  | [public.sales_sequence_steps](public.sales_sequence_steps.md) |  |
| next_action_at | timestamp with time zone |  | true |  |  |  |
| unenrolled_at | timestamp with time zone |  | true |  |  |  |
| created_at | timestamp with time zone | now() | false |  |  |  |
| updated_at | timestamp with time zone | now() | false |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| sequence_enrollments_status_check | CHECK | CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('completed'::character varying)::text, ('unenrolled'::character varying)::text]))) |
| sequence_enrollments_enrolled_by_id_fkey | FOREIGN KEY | FOREIGN KEY (enrolled_by_id) REFERENCES users(id) ON DELETE SET NULL |
| sequence_enrollments_contact_id_fkey | FOREIGN KEY | FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE |
| sequence_enrollments_sequence_id_fkey | FOREIGN KEY | FOREIGN KEY (sequence_id) REFERENCES sales_sequences(id) ON DELETE CASCADE |
| sequence_enrollments_current_step_id_fkey | FOREIGN KEY | FOREIGN KEY (current_step_id) REFERENCES sales_sequence_steps(id) ON DELETE SET NULL |
| sequence_enrollments_pkey | PRIMARY KEY | PRIMARY KEY (id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| sequence_enrollments_pkey | CREATE UNIQUE INDEX sequence_enrollments_pkey ON public.sequence_enrollments USING btree (id) |
| sequence_enrollments_sequence_id_index | CREATE INDEX sequence_enrollments_sequence_id_index ON public.sequence_enrollments USING btree (sequence_id) |
| sequence_enrollments_contact_id_index | CREATE INDEX sequence_enrollments_contact_id_index ON public.sequence_enrollments USING btree (contact_id) |
| sequence_enrollments_next_action_at_index | CREATE INDEX sequence_enrollments_next_action_at_index ON public.sequence_enrollments USING btree (next_action_at) |
| sequence_enrollments_status_next_action_idx | CREATE INDEX sequence_enrollments_status_next_action_idx ON public.sequence_enrollments USING btree (next_action_at) WHERE ((status)::text = 'active'::text) |
| uq_active_enrollment | CREATE UNIQUE INDEX uq_active_enrollment ON public.sequence_enrollments USING btree (sequence_id, contact_id) WHERE ((status)::text = 'active'::text) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| sequence_enrollments_set_updated_at | CREATE TRIGGER sequence_enrollments_set_updated_at BEFORE UPDATE ON public.sequence_enrollments FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

## Relations

```mermaid
erDiagram

"public.sequence_enrollment_logs" }o--|| "public.sequence_enrollments" : "FOREIGN KEY (enrollment_id) REFERENCES sequence_enrollments(id) ON DELETE CASCADE"
"public.sequence_enrollments" }o--|| "public.sales_sequences" : "FOREIGN KEY (sequence_id) REFERENCES sales_sequences(id) ON DELETE CASCADE"
"public.sequence_enrollments" }o--|| "public.contacts" : "FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE"
"public.sequence_enrollments" }o--o| "public.users" : "FOREIGN KEY (enrolled_by_id) REFERENCES users(id) ON DELETE SET NULL"
"public.sequence_enrollments" }o--o| "public.sales_sequence_steps" : "FOREIGN KEY (current_step_id) REFERENCES sales_sequence_steps(id) ON DELETE SET NULL"

"public.sequence_enrollments" {
  uuid id ""
  uuid sequence_id FK ""
  uuid contact_id FK ""
  uuid enrolled_by_id FK ""
  timestamp_with_time_zone enrolled_at ""
  varchar_16_ status ""
  uuid current_step_id FK ""
  timestamp_with_time_zone next_action_at ""
  timestamp_with_time_zone unenrolled_at ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.sequence_enrollment_logs" {
  uuid id ""
  uuid enrollment_id FK ""
  uuid step_id FK ""
  timestamp_with_time_zone executed_at ""
  varchar_32_ action_type ""
  varchar_8_ outcome ""
  text error_message ""
}
"public.sales_sequences" {
  uuid id ""
  varchar_200_ name ""
  text description ""
  boolean enabled ""
  uuid created_by FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  boolean is_demo ""
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
  timestamp_with_time_zone title_updated_at "Timestamp of the most recent change to contacts.title specifically (MINCRM-476) — stamped only by contactService.updateContact when title actually changes, unlike updated_at which bumps on any field edit. NULL means never explicitly changed since this column was added; the hygiene scan treats NULL as #quot;at least as stale as created_at.#quot;"
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
"public.sales_sequence_steps" {
  uuid id ""
  uuid sequence_id FK ""
  integer sort_order ""
  varchar_32_ action_type ""
  jsonb action_config ""
  integer delay_days ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

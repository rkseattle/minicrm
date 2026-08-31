# public.ai_gdpr_cascade_log

## Description

Audit log for GDPR AI data cascade runs — redaction of PII in ai_messages and removal of matching user_ai_context entries following contact erasure. (MINCRM-446)

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false |  |  |  |
| contact_id | uuid |  | true |  |  | Superseded by record_id. Mirrors it when record_type is contact, and is NULL otherwise, so a query on this column matches only contacts. |
| triggered_at | timestamp with time zone | now() | false |  |  |  |
| triggered_by | uuid |  | true |  | [public.users](public.users.md) | NULL = system-initiated (auto-cascade after GDPR erasure). Non-null = admin who triggered a manual re-run. |
| messages_redacted | integer | 0 | false |  |  |  |
| context_entries_removed | integer | 0 | false |  |  |  |
| status | varchar(20) | 'completed'::character varying | false |  |  |  |
| error_detail | text |  | true |  |  |  |
| original_name | text |  | true |  |  |  |
| original_email | text |  | true |  |  |  |
| record_type | varchar(20) | 'contact'::character varying | false |  |  | Which entity was erased. Leads and contacts both cascade to AI data, and their ids share no namespace. |
| record_id | uuid |  | false |  |  | UUID of the erased record, in the table named by record_type. No FK — the row is erased in place, and for leads it is not a contact. |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| ai_gdpr_cascade_log_record_type_check | CHECK | CHECK (((record_type)::text = ANY ((ARRAY['contact'::character varying, 'lead'::character varying])::text[]))) |
| ai_gdpr_cascade_log_status_check | CHECK | CHECK (((status)::text = ANY ((ARRAY['completed'::character varying, 'failed'::character varying])::text[]))) |
| ai_gdpr_cascade_log_triggered_by_fkey | FOREIGN KEY | FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL |
| ai_gdpr_cascade_log_pkey | PRIMARY KEY | PRIMARY KEY (id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| ai_gdpr_cascade_log_pkey | CREATE UNIQUE INDEX ai_gdpr_cascade_log_pkey ON public.ai_gdpr_cascade_log USING btree (id) |
| ai_gdpr_cascade_log_contact_id_idx | CREATE INDEX ai_gdpr_cascade_log_contact_id_idx ON public.ai_gdpr_cascade_log USING btree (contact_id) |
| ai_gdpr_cascade_log_triggered_at_idx | CREATE INDEX ai_gdpr_cascade_log_triggered_at_idx ON public.ai_gdpr_cascade_log USING btree (triggered_at) |
| ai_gdpr_cascade_log_record_idx | CREATE INDEX ai_gdpr_cascade_log_record_idx ON public.ai_gdpr_cascade_log USING btree (record_type, record_id) |

## Relations

```mermaid
erDiagram

"public.ai_gdpr_cascade_log" }o--o| "public.users" : "FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL"

"public.ai_gdpr_cascade_log" {
  uuid id ""
  uuid contact_id "Superseded by record_id. Mirrors it when record_type is contact, and is NULL otherwise, so a query on this column matches only contacts."
  timestamp_with_time_zone triggered_at ""
  uuid triggered_by FK "NULL = system-initiated (auto-cascade after GDPR erasure). Non-null = admin who triggered a manual re-run."
  integer messages_redacted ""
  integer context_entries_removed ""
  varchar_20_ status ""
  text error_detail ""
  text original_name ""
  text original_email ""
  varchar_20_ record_type "Which entity was erased. Leads and contacts both cascade to AI data, and their ids share no namespace."
  uuid record_id "UUID of the erased record, in the table named by record_type. No FK — the row is erased in place, and for leads it is not a contact."
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

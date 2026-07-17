# public.lead_routing_decisions

## Description

One row per lead created after a routing suggestion was shown to the manager (MINCRM-475). Written once, at lead-creation time, in the same transaction as the lead insert — never updated. Doubles as the AC-required routing decision log. Leads created without ever requesting a suggestion have no row here.

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false |  |  |  |
| lead_id | uuid |  | false |  | [public.leads](public.leads.md) |  |
| suggested_rep_id | uuid |  | true |  | [public.users](public.users.md) |  |
| confidence | text |  | false |  |  |  |
| contributing_factors | jsonb | '[]'::jsonb | false |  |  |  |
| decision | text |  | false |  |  |  |
| actual_assignee_id | uuid |  | false |  | [public.users](public.users.md) |  |
| decided_at | timestamp with time zone |  | false |  |  |  |
| created_at | timestamp with time zone | now() | false |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| lead_routing_decisions_confidence_check | CHECK | CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))) |
| lead_routing_decisions_decision_check | CHECK | CHECK ((decision = ANY (ARRAY['accepted'::text, 'overridden'::text]))) |
| lead_routing_decisions_actual_assignee_id_fkey | FOREIGN KEY | FOREIGN KEY (actual_assignee_id) REFERENCES users(id) ON DELETE SET NULL |
| lead_routing_decisions_suggested_rep_id_fkey | FOREIGN KEY | FOREIGN KEY (suggested_rep_id) REFERENCES users(id) ON DELETE SET NULL |
| lead_routing_decisions_lead_id_fkey | FOREIGN KEY | FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE |
| lead_routing_decisions_pkey | PRIMARY KEY | PRIMARY KEY (id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| lead_routing_decisions_pkey | CREATE UNIQUE INDEX lead_routing_decisions_pkey ON public.lead_routing_decisions USING btree (id) |
| lead_routing_decisions_lead_id_idx | CREATE INDEX lead_routing_decisions_lead_id_idx ON public.lead_routing_decisions USING btree (lead_id) |

## Relations

```mermaid
erDiagram

"public.lead_routing_decisions" }o--|| "public.leads" : "FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE"
"public.lead_routing_decisions" }o--o| "public.users" : "FOREIGN KEY (suggested_rep_id) REFERENCES users(id) ON DELETE SET NULL"
"public.lead_routing_decisions" }o--|| "public.users" : "FOREIGN KEY (actual_assignee_id) REFERENCES users(id) ON DELETE SET NULL"

"public.lead_routing_decisions" {
  uuid id ""
  uuid lead_id FK ""
  uuid suggested_rep_id FK ""
  text confidence ""
  jsonb contributing_factors ""
  text decision ""
  uuid actual_assignee_id FK ""
  timestamp_with_time_zone decided_at ""
  timestamp_with_time_zone created_at ""
}
"public.leads" {
  uuid id ""
  text first_name ""
  text last_name ""
  text email ""
  text phone ""
  text company_name ""
  text lead_source ""
  text status ""
  text disqualification_reason ""
  text notes ""
  uuid owner_id FK ""
  timestamp_with_time_zone converted_at ""
  uuid converted_contact_id FK ""
  uuid converted_account_id FK ""
  uuid converted_deal_id FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  boolean is_demo ""
  integer version ""
  varchar_255_ territory "Free-text sales territory, matched against users.territory for routing suggestions (MINCRM-475). No DB-level enum, same convention as accounts.industry/employee_range."
  varchar_255_ industry "Free-text industry/vertical, matched against historical deal outcomes for routing suggestions (MINCRM-475). Independent of accounts.industry — leads have no account until conversion."
  varchar_50_ employee_range "Free-text company-size bucket, same convention as accounts.employee_range (MINCRM-475). Used alongside industry and lead_source to define a #quot;similar lead profile#quot; for historical win-rate comparison."
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
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

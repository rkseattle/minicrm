# public.leads

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false | [public.contacts](public.contacts.md) [public.deals](public.deals.md) [public.lead_status_history](public.lead_status_history.md) |  |  |
| first_name | text |  | false |  |  |  |
| last_name | text |  | true |  |  |  |
| email | text |  | false |  |  |  |
| phone | text |  | true |  |  |  |
| company_name | text |  | true |  |  |  |
| lead_source | text |  | true |  |  |  |
| status | text | 'New'::text | false |  |  |  |
| disqualification_reason | text |  | true |  |  |  |
| notes | text |  | true |  |  |  |
| owner_id | uuid |  | false |  | [public.users](public.users.md) |  |
| converted_at | timestamp with time zone |  | true |  |  |  |
| converted_contact_id | uuid |  | true |  | [public.contacts](public.contacts.md) |  |
| converted_account_id | uuid |  | true |  | [public.accounts](public.accounts.md) |  |
| converted_deal_id | uuid |  | true |  | [public.deals](public.deals.md) |  |
| created_at | timestamp with time zone | now() | false |  |  |  |
| updated_at | timestamp with time zone | now() | false |  |  |  |
| is_demo | boolean | false | false |  |  |  |
| version | integer | 1 | false |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| leads_lead_source_check | CHECK | CHECK ((lead_source = ANY (ARRAY['Web'::text, 'Referral'::text, 'Trade Show'::text, 'Cold Outreach'::text, 'Other'::text]))) |
| leads_status_check | CHECK | CHECK ((status = ANY (ARRAY['New'::text, 'Contacted'::text, 'Qualified'::text, 'Disqualified'::text]))) |
| leads_owner_id_fkey | FOREIGN KEY | FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT |
| leads_pkey | PRIMARY KEY | PRIMARY KEY (id) |
| leads_converted_account_id_fkey | FOREIGN KEY | FOREIGN KEY (converted_account_id) REFERENCES accounts(id) ON DELETE SET NULL |
| leads_converted_contact_id_fkey | FOREIGN KEY | FOREIGN KEY (converted_contact_id) REFERENCES contacts(id) ON DELETE SET NULL |
| leads_converted_deal_id_fkey | FOREIGN KEY | FOREIGN KEY (converted_deal_id) REFERENCES deals(id) ON DELETE SET NULL |

## Indexes

| Name | Definition |
| ---- | ---------- |
| leads_pkey | CREATE UNIQUE INDEX leads_pkey ON public.leads USING btree (id) |
| leads_owner_id_index | CREATE INDEX leads_owner_id_index ON public.leads USING btree (owner_id) |
| leads_email_index | CREATE INDEX leads_email_index ON public.leads USING btree (email) |
| leads_status_index | CREATE INDEX leads_status_index ON public.leads USING btree (status) |
| leads_is_demo_index | CREATE INDEX leads_is_demo_index ON public.leads USING btree (is_demo) |
| leads_created_at_index | CREATE INDEX leads_created_at_index ON public.leads USING btree (created_at) |
| leads_converted_at_idx | CREATE INDEX leads_converted_at_idx ON public.leads USING btree (converted_at) WHERE (converted_at IS NOT NULL) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| leads_set_updated_at | CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

## Relations

```mermaid
erDiagram

"public.contacts" }o--o| "public.leads" : "FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL"
"public.deals" }o--o| "public.leads" : "FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL"
"public.lead_status_history" }o--|| "public.leads" : "FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE"
"public.leads" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT"
"public.leads" }o--o| "public.contacts" : "FOREIGN KEY (converted_contact_id) REFERENCES contacts(id) ON DELETE SET NULL"
"public.leads" }o--o| "public.accounts" : "FOREIGN KEY (converted_account_id) REFERENCES accounts(id) ON DELETE SET NULL"
"public.leads" }o--o| "public.deals" : "FOREIGN KEY (converted_deal_id) REFERENCES deals(id) ON DELETE SET NULL"

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
"public.deals" {
  uuid id ""
  varchar_255_ name ""
  varchar_50_ stage ""
  numeric_15_2_ value ""
  date close_date ""
  text loss_reason ""
  uuid account_id FK ""
  uuid owner_id FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  boolean is_demo ""
  uuid source_lead_id FK ""
  integer probability ""
  varchar_3_ currency ""
  integer version ""
  uuid pipeline_id FK ""
  uuid pipeline_stage_id FK ""
}
"public.lead_status_history" {
  uuid id ""
  uuid lead_id FK ""
  text from_status ""
  text to_status ""
  uuid changed_by_id ""
  text changed_by_name ""
  timestamp_with_time_zone created_at ""
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
"public.accounts" {
  uuid id ""
  varchar_255_ name ""
  varchar_255_ industry ""
  varchar_255_ website ""
  varchar_50_ employee_range ""
  varchar_50_ revenue_range ""
  uuid owner_id FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  boolean is_demo ""
  varchar_20_ account_type ""
  uuid parent_account_id FK ""
  integer version ""
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

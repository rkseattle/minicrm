# public.contacts

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false | [public.leads](public.leads.md) [public.contact_addresses](public.contact_addresses.md) [public.activities](public.activities.md) [public.contact_tags](public.contact_tags.md) [public.deal_contacts](public.deal_contacts.md) [public.sequence_enrollments](public.sequence_enrollments.md) |  |  |
| first_name | varchar(255) |  | false |  |  |  |
| last_name | varchar(255) |  | false |  |  |  |
| email | varchar(255) |  | false |  |  |  |
| phone | varchar(50) |  | true |  |  |  |
| title | varchar(255) |  | true |  |  |  |
| department | varchar(255) |  | true |  |  |  |
| owner_id | uuid |  | false |  | [public.users](public.users.md) |  |
| created_at | timestamp with time zone | now() | false |  |  |  |
| updated_at | timestamp with time zone | now() | false |  |  |  |
| account_id | uuid |  | true |  | [public.accounts](public.accounts.md) |  |
| is_demo | boolean | false | false |  |  |  |
| source_lead_id | uuid |  | true |  | [public.leads](public.leads.md) |  |
| address_line1 | varchar(255) |  | true |  |  |  |
| address_line2 | varchar(255) |  | true |  |  |  |
| city | varchar(100) |  | true |  |  |  |
| state_region | varchar(100) |  | true |  |  |  |
| postal_code | varchar(20) |  | true |  |  |  |
| country | varchar(100) |  | true |  |  |  |
| linkedin_url | varchar(500) |  | true |  |  |  |
| twitter_x_url | varchar(500) |  | true |  |  |  |
| other_url | varchar(500) |  | true |  |  |  |
| version | integer | 1 | false |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| contacts_owner_id_fkey | FOREIGN KEY | FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT |
| contacts_source_lead_id_fkey | FOREIGN KEY | FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL |
| contacts_account_id_fkey | FOREIGN KEY | FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL |
| contacts_pkey | PRIMARY KEY | PRIMARY KEY (id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| contacts_pkey | CREATE UNIQUE INDEX contacts_pkey ON public.contacts USING btree (id) |
| contacts_email_unique_index | CREATE UNIQUE INDEX contacts_email_unique_index ON public.contacts USING btree (email) |
| contacts_owner_id_index | CREATE INDEX contacts_owner_id_index ON public.contacts USING btree (owner_id) |
| contacts_account_id_index | CREATE INDEX contacts_account_id_index ON public.contacts USING btree (account_id) |
| contacts_is_demo_index | CREATE INDEX contacts_is_demo_index ON public.contacts USING btree (is_demo) |
| contacts_first_name_trgm_idx | CREATE INDEX contacts_first_name_trgm_idx ON public.contacts USING gin (first_name gin_trgm_ops) |
| contacts_last_name_trgm_idx | CREATE INDEX contacts_last_name_trgm_idx ON public.contacts USING gin (last_name gin_trgm_ops) |
| contacts_email_trgm_idx | CREATE INDEX contacts_email_trgm_idx ON public.contacts USING gin (email gin_trgm_ops) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| contacts_set_updated_at | CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

## Relations

```mermaid
erDiagram

"public.leads" }o--o| "public.contacts" : "FOREIGN KEY (converted_contact_id) REFERENCES contacts(id) ON DELETE SET NULL"
"public.contact_addresses" }o--|| "public.contacts" : "FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE"
"public.activities" }o--o| "public.contacts" : "FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE"
"public.contact_tags" }o--|| "public.contacts" : "FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE"
"public.deal_contacts" }o--|| "public.contacts" : "FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE"
"public.sequence_enrollments" }o--|| "public.contacts" : "FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE"
"public.contacts" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT"
"public.contacts" }o--o| "public.accounts" : "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL"
"public.contacts" }o--o| "public.leads" : "FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL"

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
"public.contact_addresses" {
  uuid id ""
  uuid contact_id FK ""
  varchar_50_ label ""
  varchar_255_ address_line1 ""
  varchar_255_ address_line2 ""
  varchar_100_ city ""
  varchar_100_ state_region ""
  varchar_20_ postal_code ""
  varchar_100_ country ""
  boolean is_default ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
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
"public.contact_tags" {
  uuid contact_id FK ""
  uuid tag_id FK ""
  timestamp_with_time_zone created_at ""
}
"public.deal_contacts" {
  uuid deal_id FK ""
  uuid contact_id FK ""
  timestamp_with_time_zone created_at ""
}
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

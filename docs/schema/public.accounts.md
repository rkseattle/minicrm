# public.accounts

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false | [public.leads](public.leads.md) [public.accounts](public.accounts.md) [public.contacts](public.contacts.md) [public.deals](public.deals.md) [public.activities](public.activities.md) [public.account_tags](public.account_tags.md) |  |  |
| name | varchar(255) |  | false |  |  |  |
| industry | varchar(255) |  | true |  |  |  |
| website | varchar(255) |  | true |  |  |  |
| employee_range | varchar(50) |  | true |  |  |  |
| revenue_range | varchar(50) |  | true |  |  |  |
| owner_id | uuid |  | false |  | [public.users](public.users.md) |  |
| created_at | timestamp with time zone | now() | false |  |  |  |
| updated_at | timestamp with time zone | now() | false |  |  |  |
| is_demo | boolean | false | false |  |  |  |
| account_type | varchar(20) |  | true |  |  |  |
| parent_account_id | uuid |  | true |  | [public.accounts](public.accounts.md) |  |
| version | integer | 1 | false |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| accounts_account_type_check | CHECK | CHECK (((account_type IS NULL) OR ((account_type)::text = ANY (ARRAY[('Prospect'::character varying)::text, ('Customer'::character varying)::text, ('Partner'::character varying)::text, ('Vendor'::character varying)::text, ('Competitor'::character varying)::text, ('Other'::character varying)::text])))) |
| accounts_owner_id_fkey | FOREIGN KEY | FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT |
| accounts_parent_account_id_fkey | FOREIGN KEY | FOREIGN KEY (parent_account_id) REFERENCES accounts(id) ON DELETE SET NULL |
| accounts_pkey | PRIMARY KEY | PRIMARY KEY (id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| accounts_pkey | CREATE UNIQUE INDEX accounts_pkey ON public.accounts USING btree (id) |
| accounts_owner_id_index | CREATE INDEX accounts_owner_id_index ON public.accounts USING btree (owner_id) |
| accounts_is_demo_index | CREATE INDEX accounts_is_demo_index ON public.accounts USING btree (is_demo) |
| accounts_name_trgm_idx | CREATE INDEX accounts_name_trgm_idx ON public.accounts USING gin (name gin_trgm_ops) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| accounts_set_updated_at | CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

## Relations

```mermaid
erDiagram

"public.leads" }o--o| "public.accounts" : "FOREIGN KEY (converted_account_id) REFERENCES accounts(id) ON DELETE SET NULL"
"public.accounts" }o--o| "public.accounts" : "FOREIGN KEY (parent_account_id) REFERENCES accounts(id) ON DELETE SET NULL"
"public.contacts" }o--o| "public.accounts" : "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL"
"public.deals" }o--o| "public.accounts" : "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL"
"public.activities" }o--o| "public.accounts" : "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE"
"public.account_tags" }o--|| "public.accounts" : "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE"
"public.accounts" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT"

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
"public.account_tags" {
  uuid account_id FK ""
  uuid tag_id FK ""
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
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

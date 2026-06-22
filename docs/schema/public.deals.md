# public.deals

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false | [public.leads](public.leads.md) [public.activities](public.activities.md) [public.deal_tags](public.deal_tags.md) [public.deal_contacts](public.deal_contacts.md) |  |  |
| name | varchar(255) |  | false |  |  |  |
| stage | varchar(50) |  | false |  |  |  |
| value | numeric(15,2) |  | true |  |  |  |
| close_date | date |  | true |  |  |  |
| loss_reason | text |  | true |  |  |  |
| account_id | uuid |  | true |  | [public.accounts](public.accounts.md) |  |
| owner_id | uuid |  | false |  | [public.users](public.users.md) |  |
| created_at | timestamp with time zone | now() | false |  |  |  |
| updated_at | timestamp with time zone | now() | false |  |  |  |
| is_demo | boolean | false | false |  |  |  |
| source_lead_id | uuid |  | true |  | [public.leads](public.leads.md) |  |
| probability | integer |  | true |  |  |  |
| currency | varchar(3) | 'USD'::character varying | false |  |  |  |
| version | integer | 1 | false |  |  |  |
| pipeline_id | uuid |  | false |  | [public.pipelines](public.pipelines.md) |  |
| pipeline_stage_id | uuid |  | false |  | [public.pipeline_stages](public.pipeline_stages.md) |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| deals_probability_check | CHECK | CHECK (((probability IS NULL) OR ((probability >= 0) AND (probability <= 100)))) |
| deals_owner_id_fkey | FOREIGN KEY | FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT |
| deals_pipeline_id_fkey | FOREIGN KEY | FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE RESTRICT |
| deals_pipeline_stage_id_fkey | FOREIGN KEY | FOREIGN KEY (pipeline_stage_id) REFERENCES pipeline_stages(id) ON DELETE RESTRICT |
| deals_source_lead_id_fkey | FOREIGN KEY | FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL |
| deals_account_id_fkey | FOREIGN KEY | FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL |
| deals_pkey | PRIMARY KEY | PRIMARY KEY (id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| deals_pkey | CREATE UNIQUE INDEX deals_pkey ON public.deals USING btree (id) |
| deals_owner_id_index | CREATE INDEX deals_owner_id_index ON public.deals USING btree (owner_id) |
| deals_account_id_index | CREATE INDEX deals_account_id_index ON public.deals USING btree (account_id) |
| deals_is_demo_index | CREATE INDEX deals_is_demo_index ON public.deals USING btree (is_demo) |
| deals_stage_index | CREATE INDEX deals_stage_index ON public.deals USING btree (stage) |
| deals_close_date_index | CREATE INDEX deals_close_date_index ON public.deals USING btree (close_date) |
| deals_stage_close_date_idx | CREATE INDEX deals_stage_close_date_idx ON public.deals USING btree (stage, close_date) |
| deals_name_trgm_idx | CREATE INDEX deals_name_trgm_idx ON public.deals USING gin (name gin_trgm_ops) |
| deals_pipeline_id_idx | CREATE INDEX deals_pipeline_id_idx ON public.deals USING btree (pipeline_id) |
| deals_pipeline_stage_id_idx | CREATE INDEX deals_pipeline_stage_id_idx ON public.deals USING btree (pipeline_stage_id) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| deals_set_updated_at | CREATE TRIGGER deals_set_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

## Relations

```mermaid
erDiagram

"public.leads" }o--o| "public.deals" : "FOREIGN KEY (converted_deal_id) REFERENCES deals(id) ON DELETE SET NULL"
"public.activities" }o--o| "public.deals" : "FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE"
"public.deal_tags" }o--|| "public.deals" : "FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE"
"public.deal_contacts" }o--|| "public.deals" : "FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE"
"public.deals" }o--o| "public.accounts" : "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL"
"public.deals" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT"
"public.deals" }o--o| "public.leads" : "FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL"
"public.deals" }o--|| "public.pipelines" : "FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE RESTRICT"
"public.deals" }o--|| "public.pipeline_stages" : "FOREIGN KEY (pipeline_stage_id) REFERENCES pipeline_stages(id) ON DELETE RESTRICT"

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
"public.deal_tags" {
  uuid deal_id FK ""
  uuid tag_id FK ""
  timestamp_with_time_zone created_at ""
}
"public.deal_contacts" {
  uuid deal_id FK ""
  uuid contact_id FK ""
  timestamp_with_time_zone created_at ""
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
"public.pipelines" {
  uuid id ""
  varchar_100_ name ""
  boolean is_default ""
  uuid created_by FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.pipeline_stages" {
  uuid id ""
  varchar_100_ name ""
  integer sort_order ""
  integer probability ""
  boolean is_terminal ""
  boolean is_fixed ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  uuid pipeline_id FK ""
  jsonb stage_exit_requirements ""
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

# public.activities

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false | [public.overdue_task_notifications](public.overdue_task_notifications.md) |  |  |
| type | activity_type |  | false |  |  |  |
| subject | varchar(255) |  | false |  |  |  |
| notes | text |  | true |  |  |  |
| due_date | date |  | true |  |  |  |
| status | activity_status | 'open'::activity_status | false |  |  |  |
| contact_id | uuid |  | true |  | [public.contacts](public.contacts.md) |  |
| account_id | uuid |  | true |  | [public.accounts](public.accounts.md) |  |
| deal_id | uuid |  | true |  | [public.deals](public.deals.md) |  |
| owner_id | uuid |  | false |  | [public.users](public.users.md) |  |
| created_at | timestamp with time zone | now() | false |  |  |  |
| updated_at | timestamp with time zone | now() | false |  |  |  |
| direction | activity_direction |  | true |  |  |  |
| outcome | text |  | true |  |  |  |
| is_demo | boolean | false | false |  |  |  |
| version | integer | 1 | false |  |  |  |
| metadata | jsonb |  | true |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| activities_has_parent | CHECK | CHECK (((contact_id IS NOT NULL) OR (account_id IS NOT NULL) OR (deal_id IS NOT NULL))) |
| activities_owner_id_fkey | FOREIGN KEY | FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT |
| activities_contact_id_fkey | FOREIGN KEY | FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE |
| activities_account_id_fkey | FOREIGN KEY | FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE |
| activities_deal_id_fkey | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE |
| activities_pkey | PRIMARY KEY | PRIMARY KEY (id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| activities_pkey | CREATE UNIQUE INDEX activities_pkey ON public.activities USING btree (id) |
| activities_contact_id_index | CREATE INDEX activities_contact_id_index ON public.activities USING btree (contact_id) |
| activities_account_id_index | CREATE INDEX activities_account_id_index ON public.activities USING btree (account_id) |
| activities_deal_id_index | CREATE INDEX activities_deal_id_index ON public.activities USING btree (deal_id) |
| activities_owner_id_index | CREATE INDEX activities_owner_id_index ON public.activities USING btree (owner_id) |
| activities_is_demo_index | CREATE INDEX activities_is_demo_index ON public.activities USING btree (is_demo) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| activities_set_updated_at | CREATE TRIGGER activities_set_updated_at BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

## Relations

```mermaid
erDiagram

"public.overdue_task_notifications" |o--|| "public.activities" : "FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE"
"public.activities" }o--o| "public.contacts" : "FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE"
"public.activities" }o--o| "public.accounts" : "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE"
"public.activities" }o--o| "public.deals" : "FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE"
"public.activities" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT"

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
"public.overdue_task_notifications" {
  uuid activity_id FK ""
  timestamp_with_time_zone notified_at ""
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
  varchar_500_ linkedin_url ""
  varchar_500_ twitter_x_url ""
  varchar_500_ other_url ""
  integer version ""
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
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

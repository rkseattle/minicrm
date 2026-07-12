# public.feature_flags

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| flag_key | varchar(100) |  | false | [public.feature_flag_usage](public.feature_flag_usage.md) [public.feature_flag_beta_users](public.feature_flag_beta_users.md) [public.feature_flag_user_overrides](public.feature_flag_user_overrides.md) |  |  |
| label | varchar(100) |  | false |  |  |  |
| description | text |  | false |  |  |  |
| category | varchar(50) |  | false |  |  |  |
| enabled | boolean | true | false |  |  |  |
| role_overrides | jsonb |  | true |  |  | Per-role enable/disable overrides. Keys are arbitrary role name strings (built-in or custom); values are booleans. Role name validity enforced at service layer against custom_roles table. (MINCRM-565) |
| enable_at | timestamp with time zone |  | true |  |  | When set and \<= now(), the flag is treated as enabled regardless of the enabled column. Evaluated lazily at resolution time — no background job required. (MINCRM-488) |
| rollout_percentage | smallint |  | true |  |  | When non-null, gates users via stableHash(userId+flagKey)%100 \< rollout_percentage. null skips rollout gating entirely. 100 means all users are enabled. (MINCRM-490) |
| rollout_stages | jsonb |  | true |  |  | Ordered array of {percentage, scheduled_at} objects. Background scheduler advances rollout_percentage when scheduled_at \<= now(). (MINCRM-490) |
| updated_by | uuid |  | true |  | [public.users](public.users.md) |  |
| updated_at | timestamp with time zone | now() | false |  |  |  |
| system_flag | boolean | true | false |  |  |  |
| group_key | varchar(100) |  | true |  | [public.feature_flag_groups](public.feature_flag_groups.md) |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| feature_flags_role_overrides_valid_shape | CHECK | CHECK (is_valid_role_overrides(role_overrides)) |
| feature_flags_rollout_percentage_range | CHECK | CHECK (((rollout_percentage >= 0) AND (rollout_percentage <= 100))) |
| feature_flags_updated_by_fkey | FOREIGN KEY | FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL |
| feature_flags_pkey | PRIMARY KEY | PRIMARY KEY (flag_key) |
| feature_flags_group_key_fkey | FOREIGN KEY | FOREIGN KEY (group_key) REFERENCES feature_flag_groups(group_key) ON DELETE SET NULL |

## Indexes

| Name | Definition |
| ---- | ---------- |
| feature_flags_pkey | CREATE UNIQUE INDEX feature_flags_pkey ON public.feature_flags USING btree (flag_key) |
| feature_flags_category_index | CREATE INDEX feature_flags_category_index ON public.feature_flags USING btree (category) |
| feature_flags_group_key_index | CREATE INDEX feature_flags_group_key_index ON public.feature_flags USING btree (group_key) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| feature_flags_set_updated_at | CREATE TRIGGER feature_flags_set_updated_at BEFORE UPDATE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

## Relations

```mermaid
erDiagram

"public.feature_flag_usage" }o--|| "public.feature_flags" : "FOREIGN KEY (flag_key) REFERENCES feature_flags(flag_key) ON DELETE CASCADE"
"public.feature_flag_beta_users" }o--|| "public.feature_flags" : "FOREIGN KEY (flag_key) REFERENCES feature_flags(flag_key) ON DELETE CASCADE"
"public.feature_flag_user_overrides" }o--|| "public.feature_flags" : "FOREIGN KEY (flag_key) REFERENCES feature_flags(flag_key) ON DELETE CASCADE"
"public.feature_flags" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.feature_flags" }o--o| "public.feature_flag_groups" : "FOREIGN KEY (group_key) REFERENCES feature_flag_groups(group_key) ON DELETE SET NULL"

"public.feature_flags" {
  varchar_100_ flag_key ""
  varchar_100_ label ""
  text description ""
  varchar_50_ category ""
  boolean enabled ""
  jsonb role_overrides "Per-role enable/disable overrides. Keys are arbitrary role name strings (built-in or custom); values are booleans. Role name validity enforced at service layer against custom_roles table. (MINCRM-565)"
  timestamp_with_time_zone enable_at "When set and <= now(), the flag is treated as enabled regardless of the enabled column. Evaluated lazily at resolution time — no background job required. (MINCRM-488)"
  smallint rollout_percentage "When non-null, gates users via stableHash(userId+flagKey)%100 < rollout_percentage. null skips rollout gating entirely. 100 means all users are enabled. (MINCRM-490)"
  jsonb rollout_stages "Ordered array of {percentage, scheduled_at} objects. Background scheduler advances rollout_percentage when scheduled_at <= now(). (MINCRM-490)"
  uuid updated_by FK ""
  timestamp_with_time_zone updated_at ""
  boolean system_flag ""
  varchar_100_ group_key FK ""
}
"public.feature_flag_usage" {
  varchar_100_ flag_key FK ""
  uuid user_id FK ""
  timestamp_with_time_zone used_at ""
}
"public.feature_flag_beta_users" {
  uuid id ""
  varchar_100_ flag_key FK ""
  uuid user_id FK ""
  uuid added_by FK ""
  timestamp_with_time_zone added_at ""
}
"public.feature_flag_user_overrides" {
  uuid id ""
  varchar_100_ flag_key FK ""
  uuid user_id FK ""
  varchar_20_ override ""
  text reason ""
  uuid added_by FK ""
  timestamp_with_time_zone added_at ""
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
"public.feature_flag_groups" {
  varchar_100_ group_key ""
  varchar_100_ label ""
  text description ""
  boolean enabled ""
  timestamp_with_time_zone enable_at ""
  uuid updated_by FK ""
  timestamp_with_time_zone updated_at ""
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

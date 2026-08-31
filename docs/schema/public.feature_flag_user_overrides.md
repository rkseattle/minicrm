# public.feature_flag_user_overrides

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false |  |  |  |
| flag_key | varchar(100) |  | false |  | [public.feature_flags](public.feature_flags.md) |  |
| user_id | uuid |  | false |  | [public.users](public.users.md) |  |
| override | varchar(20) |  | false |  |  |  |
| reason | text |  | true |  |  |  |
| added_by | uuid |  | true |  | [public.users](public.users.md) |  |
| added_at | timestamp with time zone | now() | false |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| feature_flag_user_overrides_override_check | CHECK | CHECK (((override)::text = ANY ((ARRAY['force_enabled'::character varying, 'force_disabled'::character varying])::text[]))) |
| feature_flag_user_overrides_added_by_fkey | FOREIGN KEY | FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL |
| feature_flag_user_overrides_user_id_fkey | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE |
| feature_flag_user_overrides_flag_key_fkey | FOREIGN KEY | FOREIGN KEY (flag_key) REFERENCES feature_flags(flag_key) ON DELETE CASCADE |
| feature_flag_user_overrides_pkey | PRIMARY KEY | PRIMARY KEY (id) |
| feature_flag_user_overrides_flag_key_user_id_unique | UNIQUE | UNIQUE (flag_key, user_id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| feature_flag_user_overrides_pkey | CREATE UNIQUE INDEX feature_flag_user_overrides_pkey ON public.feature_flag_user_overrides USING btree (id) |
| feature_flag_user_overrides_flag_key_user_id_unique | CREATE UNIQUE INDEX feature_flag_user_overrides_flag_key_user_id_unique ON public.feature_flag_user_overrides USING btree (flag_key, user_id) |
| feature_flag_user_overrides_flag_key_index | CREATE INDEX feature_flag_user_overrides_flag_key_index ON public.feature_flag_user_overrides USING btree (flag_key) |

## Relations

```mermaid
erDiagram

"public.feature_flag_user_overrides" }o--|| "public.feature_flags" : "FOREIGN KEY (flag_key) REFERENCES feature_flags(flag_key) ON DELETE CASCADE"
"public.feature_flag_user_overrides" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.feature_flag_user_overrides" }o--o| "public.users" : "FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL"

"public.feature_flag_user_overrides" {
  uuid id ""
  varchar_100_ flag_key FK ""
  uuid user_id FK ""
  varchar_20_ override ""
  text reason ""
  uuid added_by FK ""
  timestamp_with_time_zone added_at ""
}
"public.feature_flags" {
  varchar_100_ flag_key ""
  varchar_100_ label ""
  text description ""
  varchar_50_ category ""
  boolean enabled ""
  jsonb role_overrides "Per-role enable/disable overrides. Keys are arbitrary role name strings (built-in or custom); values are booleans. Role name validity enforced at service layer against custom_roles table. (MINCRM-565)"
  uuid updated_by FK ""
  timestamp_with_time_zone updated_at ""
  boolean system_flag ""
  timestamp_with_time_zone enable_at "When set and <= now(), the flag is treated as enabled regardless of the enabled column. Evaluated lazily at resolution time — no background job required. (MINCRM-488)"
  smallint rollout_percentage "When non-null, gates users via stableHash(userId+flagKey)%100 < rollout_percentage. null skips rollout gating entirely. 100 means all users are enabled. (MINCRM-490)"
  jsonb rollout_stages "Ordered array of {percentage, scheduled_at} objects. Background scheduler advances rollout_percentage when scheduled_at <= now(). (MINCRM-490)"
  varchar_100_ group_key FK ""
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

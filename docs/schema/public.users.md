# public.users

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | uuid | gen_random_uuid() | false | [public.system_settings](public.system_settings.md) [public.pipelines](public.pipelines.md) [public.leads](public.leads.md) [public.accounts](public.accounts.md) [public.contacts](public.contacts.md) [public.deals](public.deals.md) [public.activities](public.activities.md) [public.automation_rules](public.automation_rules.md) [public.attachments](public.attachments.md) [public.notes](public.notes.md) [public.webhook_subscriptions](public.webhook_subscriptions.md) [public.import_jobs](public.import_jobs.md) [public.gdpr_deletion_log](public.gdpr_deletion_log.md) [public.custom_reports](public.custom_reports.md) [public.sales_sequences](public.sales_sequences.md) [public.sequence_enrollments](public.sequence_enrollments.md) [public.feature_flags](public.feature_flags.md) [public.feature_flag_usage](public.feature_flag_usage.md) [public.ai_configuration](public.ai_configuration.md) [public.ai_token_budgets](public.ai_token_budgets.md) [public.ai_token_usage](public.ai_token_usage.md) [public.teams](public.teams.md) [public.team_memberships](public.team_memberships.md) [public.org_visibility_settings](public.org_visibility_settings.md) [public.user_custom_roles](public.user_custom_roles.md) [public.scim_tokens](public.scim_tokens.md) [public.feature_flag_beta_users](public.feature_flag_beta_users.md) [public.feature_flag_user_overrides](public.feature_flag_user_overrides.md) [public.feature_flag_groups](public.feature_flag_groups.md) [public.feature_flag_group_beta_users](public.feature_flag_group_beta_users.md) [public.ai_sessions](public.ai_sessions.md) [public.email_templates](public.email_templates.md) [public.user_ai_context](public.user_ai_context.md) [public.ai_gdpr_cascade_log](public.ai_gdpr_cascade_log.md) [public.ai_token_usage_daily](public.ai_token_usage_daily.md) [public.contact_champion_blocker_signals](public.contact_champion_blocker_signals.md) [public.notifications](public.notifications.md) [public.activity_meeting_briefs](public.activity_meeting_briefs.md) [public.activity_sentiment_scores](public.activity_sentiment_scores.md) [public.account_health_scoring_config](public.account_health_scoring_config.md) [public.rep_coaching_scoring_config](public.rep_coaching_scoring_config.md) [public.rep_coaching_insights](public.rep_coaching_insights.md) [public.rep_coaching_insight_history](public.rep_coaching_insight_history.md) [public.lead_routing_decisions](public.lead_routing_decisions.md) [public.team_feature_overrides](public.team_feature_overrides.md) [public.lead_routing_scoring_config](public.lead_routing_scoring_config.md) [public.data_hygiene_scoring_config](public.data_hygiene_scoring_config.md) [public.data_hygiene_findings](public.data_hygiene_findings.md) [public.connected_accounts](public.connected_accounts.md) [public.connected_account_oauth_states](public.connected_account_oauth_states.md) |  |  |
| email | varchar(255) |  | false |  |  |  |
| password_hash | text |  | true |  |  |  |
| name | varchar(255) |  | false |  |  |  |
| role | varchar(20) | '''rep'''::character varying | false |  |  |  |
| status | varchar(10) | '''active'''::character varying | false |  |  |  |
| created_at | timestamp with time zone | now() | false |  |  |  |
| updated_at | timestamp with time zone | now() | false |  |  |  |
| must_change_password | boolean | false | false |  |  |  |
| preferred_language | varchar(10) | NULL::character varying | true |  |  |  |
| password_reset_token_hash | varchar(64) | NULL::character varying | true |  |  |  |
| password_reset_expires_at | timestamp with time zone |  | true |  |  |  |
| password_changed_at | timestamp with time zone |  | true |  |  |  |
| notify_overdue_tasks | boolean | true | false |  |  |  |
| notify_assignments | boolean | true | false |  |  |  |
| notify_deal_stage_changes | boolean | true | false |  |  |  |
| mfa_enabled | boolean | false | false |  |  |  |
| mfa_secret | text |  | true |  |  |  |
| mfa_pending_secret | text |  | true |  |  |  |
| mfa_recovery_codes | text[] | '{}'::text[] | false |  |  |  |
| onboarding_completed | boolean | false | false |  |  |  |
| onboarding_completed_at | timestamp with time zone |  | true |  |  |  |
| sso_provider | varchar(20) | NULL::character varying | true |  |  | SSO protocol that provisioned this user: saml \| oidc |
| sso_subject | text |  | true |  |  | Stable external identity: SAML nameID or OIDC sub claim |
| api_token_hash | text |  | true |  |  |  |
| api_token_issued_at | timestamp with time zone |  | true |  |  |  |
| scim_external_id | text |  | true |  |  |  |
| territory | varchar(255) |  | true |  |  | Free-text sales territory a rep is assigned to, matched against leads.territory for routing suggestions (MINCRM-475). |
| nav_layout | varchar(20) | NULL::character varying | true |  |  | Personal navigation layout. NULL means follow the workspace default in system_settings.nav_layout, so a later admin change still propagates. |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| users_nav_layout_check | CHECK | CHECK (((nav_layout IS NULL) OR ((nav_layout)::text = ANY ((ARRAY['top'::character varying, 'left'::character varying, 'hamburger'::character varying])::text[])))) |
| users_role_check | CHECK | CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('rep'::character varying)::text, ('manager'::character varying)::text, ('viewer'::character varying)::text, ('service_account'::character varying)::text]))) |
| users_sso_provider_requires_subject | CHECK | CHECK (((sso_provider IS NULL) OR (sso_subject IS NOT NULL))) |
| users_sso_subject_max_length | CHECK | CHECK (((sso_subject IS NULL) OR (length(sso_subject) <= 1024))) |
| users_status_check | CHECK | CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('invited'::character varying)::text, ('inactive'::character varying)::text]))) |
| users_pkey | PRIMARY KEY | PRIMARY KEY (id) |
| users_email_key | UNIQUE | UNIQUE (email) |
| users_scim_external_id_key | UNIQUE | UNIQUE (scim_external_id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| users_pkey | CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id) |
| users_email_key | CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email) |
| users_scim_external_id_key | CREATE UNIQUE INDEX users_scim_external_id_key ON public.users USING btree (scim_external_id) |
| users_email_index | CREATE INDEX users_email_index ON public.users USING btree (email) |
| users_password_reset_token_hash_idx | CREATE INDEX users_password_reset_token_hash_idx ON public.users USING btree (password_reset_token_hash) WHERE (password_reset_token_hash IS NOT NULL) |
| users_sso_provider_sso_subject_unique | CREATE UNIQUE INDEX users_sso_provider_sso_subject_unique ON public.users USING btree (sso_provider, sso_subject) WHERE (sso_subject IS NOT NULL) |
| users_api_token_hash_unique | CREATE UNIQUE INDEX users_api_token_hash_unique ON public.users USING btree (api_token_hash) WHERE (api_token_hash IS NOT NULL) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| users_set_updated_at | CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

## Relations

```mermaid
erDiagram

"public.system_settings" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.pipelines" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.leads" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT"
"public.accounts" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT"
"public.contacts" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT"
"public.deals" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT"
"public.activities" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT"
"public.automation_rules" }o--|| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT"
"public.attachments" }o--o| "public.users" : "FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE SET NULL"
"public.notes" }o--|| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id)"
"public.notes" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id)"
"public.webhook_subscriptions" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.import_jobs" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.gdpr_deletion_log" }o--|| "public.users" : "FOREIGN KEY (requested_by) REFERENCES users(id)"
"public.custom_reports" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.sales_sequences" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.sequence_enrollments" }o--o| "public.users" : "FOREIGN KEY (enrolled_by_id) REFERENCES users(id) ON DELETE SET NULL"
"public.feature_flags" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.feature_flag_usage" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.ai_configuration" }o--o| "public.users" : "FOREIGN KEY (dpa_acknowledged_by) REFERENCES users(id) ON DELETE SET NULL"
"public.ai_configuration" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.ai_token_budgets" }o--o| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.ai_token_usage" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.teams" }o--o| "public.users" : "FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL"
"public.team_memberships" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.org_visibility_settings" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.user_custom_roles" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.scim_tokens" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.feature_flag_beta_users" }o--o| "public.users" : "FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL"
"public.feature_flag_beta_users" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.feature_flag_user_overrides" }o--o| "public.users" : "FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL"
"public.feature_flag_user_overrides" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.feature_flag_groups" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.feature_flag_group_beta_users" }o--o| "public.users" : "FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL"
"public.feature_flag_group_beta_users" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.ai_sessions" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.email_templates" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.user_ai_context" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.ai_gdpr_cascade_log" }o--o| "public.users" : "FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL"
"public.ai_token_usage_daily" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.contact_champion_blocker_signals" }o--o| "public.users" : "FOREIGN KEY (dismissed_by) REFERENCES users(id) ON DELETE SET NULL"
"public.contact_champion_blocker_signals" }o--o| "public.users" : "FOREIGN KEY (overridden_by) REFERENCES users(id) ON DELETE SET NULL"
"public.notifications" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.activity_meeting_briefs" }o--|| "public.users" : "FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE RESTRICT"
"public.activity_sentiment_scores" }o--o| "public.users" : "FOREIGN KEY (flagged_inaccurate_by) REFERENCES users(id) ON DELETE SET NULL"
"public.account_health_scoring_config" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.rep_coaching_scoring_config" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.rep_coaching_insights" }o--|| "public.users" : "FOREIGN KEY (rep_id) REFERENCES users(id) ON DELETE CASCADE"
"public.rep_coaching_insight_history" }o--|| "public.users" : "FOREIGN KEY (rep_id) REFERENCES users(id) ON DELETE CASCADE"
"public.lead_routing_decisions" }o--|| "public.users" : "FOREIGN KEY (actual_assignee_id) REFERENCES users(id) ON DELETE SET NULL"
"public.lead_routing_decisions" }o--o| "public.users" : "FOREIGN KEY (suggested_rep_id) REFERENCES users(id) ON DELETE SET NULL"
"public.team_feature_overrides" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.lead_routing_scoring_config" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.data_hygiene_scoring_config" }o--o| "public.users" : "FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL"
"public.data_hygiene_findings" }o--|| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE"
"public.connected_accounts" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.connected_account_oauth_states" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"

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
"public.system_settings" {
  text key ""
  text value ""
  timestamp_with_time_zone updated_at ""
  uuid updated_by FK "User who last modified this setting — NULL for system/migration writes (MINCRM-520)"
}
"public.pipelines" {
  uuid id ""
  varchar_100_ name ""
  boolean is_default ""
  uuid created_by FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
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
"public.automation_rules" {
  uuid id ""
  varchar_255_ name ""
  boolean enabled ""
  automation_trigger_type trigger_type ""
  jsonb trigger_config ""
  automation_action_type action_type ""
  jsonb action_config ""
  uuid created_by FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  boolean is_demo ""
}
"public.attachments" {
  uuid id ""
  text record_type ""
  uuid record_id ""
  text filename ""
  bigint file_size ""
  text mime_type ""
  text storage_key ""
  uuid uploader_id FK ""
  timestamp_with_time_zone uploaded_at ""
}
"public.notes" {
  uuid id ""
  varchar_16_ entity_type ""
  uuid entity_id ""
  varchar_255_ title ""
  text body ""
  text body_text ""
  varchar_8_ visibility ""
  text__ tags ""
  uuid created_by FK ""
  uuid updated_by FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  timestamp_with_time_zone deleted_at ""
}
"public.webhook_subscriptions" {
  uuid id ""
  text url ""
  text__ events ""
  text secret_hash ""
  varchar_16_ status ""
  uuid created_by FK ""
  timestamp_with_time_zone created_at ""
}
"public.import_jobs" {
  uuid id ""
  varchar_16_ type ""
  varchar_16_ status ""
  integer total_rows ""
  integer processed_rows ""
  integer created_count ""
  integer skipped_count ""
  integer failed_count ""
  text error_csv ""
  uuid created_by FK ""
  timestamp_with_time_zone started_at ""
  timestamp_with_time_zone completed_at ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.gdpr_deletion_log" {
  uuid id ""
  text record_type ""
  uuid record_id "UUID of the erased record. References the PK of the entity identified by record_type. No FK constraint — the referenced row will have been hard-deleted before or during erasure. UNIQUE constraint assumption: safe only while all record IDs are gen_random_uuid() UUIDs. See migration 084 if deterministic external IDs are introduced."
  uuid requested_by FK ""
  timestamp_with_time_zone requested_at ""
  timestamp_with_time_zone completed_at ""
  text__ erasure_scope ""
  text notes ""
}
"public.custom_reports" {
  uuid id ""
  varchar_200_ name ""
  varchar_16_ entity_type ""
  jsonb config ""
  uuid created_by FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  varchar_16_ visibility ""
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
"public.feature_flag_usage" {
  varchar_100_ flag_key FK ""
  uuid user_id FK ""
  timestamp_with_time_zone used_at ""
}
"public.ai_configuration" {
  boolean singleton ""
  varchar_50_ provider ""
  varchar_100_ model ""
  text api_key_encrypted ""
  varchar_30_ deployment_mode ""
  text base_url ""
  boolean enabled ""
  timestamp_with_time_zone enabled_updated_at ""
  boolean dpa_acknowledged ""
  uuid dpa_acknowledged_by FK ""
  timestamp_with_time_zone dpa_acknowledged_at ""
  varchar_50_ dpa_acknowledged_for_provider ""
  text custom_dpa_url ""
  timestamp_with_time_zone updated_at ""
  uuid updated_by FK ""
  smallint api_key_key_version "Key version used to encrypt api_key_encrypted. References ENCRYPTION_KEY_V<n> env var (MINCRM-519)"
  integer ai_session_retention_days "Days to retain ai_sessions/ai_messages before nightly hard-delete purge. Minimum 30, default 90. user_ai_context is NOT subject to this policy. (MINCRM-447)"
  integer ai_input_cost_per_million_cents "Admin-configured cost rate in cents per 1,000,000 input tokens, used to estimate spend on the AI usage dashboard. (MINCRM-459)"
  integer ai_output_cost_per_million_cents "Admin-configured cost rate in cents per 1,000,000 output tokens, used to estimate spend on the AI usage dashboard. (MINCRM-459)"
  integer win_loss_min_closed_deals "Minimum total closed (won+lost) deals required before win/loss patterns are surfaced. (MINCRM-464)"
  integer win_loss_min_sample_size "Minimum supporting deal count for a pattern to be surfaced (confidence threshold). (MINCRM-464)"
  numeric_15_2_ champion_blocker_deal_value_threshold "Deal value above which the single-threaded-risk warning applies when only one contact is engaged. (MINCRM-466)"
  numeric_3_2_ churn_expansion_confidence_threshold "Minimum confidence for a churn/expansion signal to be surfaced; lower-confidence signals are suppressed. (MINCRM-469)"
  boolean web_search_enabled "Admin toggle for the optional news-hook section of AI meeting briefs. (MINCRM-465)"
}
"public.ai_token_budgets" {
  uuid id ""
  uuid user_id FK ""
  bigint monthly_limit ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.ai_token_usage" {
  uuid user_id FK ""
  character_7_ year_month ""
  bigint input_tokens ""
  bigint output_tokens ""
  timestamp_with_time_zone updated_at ""
}
"public.teams" {
  uuid id ""
  text name ""
  uuid manager_id FK ""
  uuid parent_team_id FK ""
  text scim_group_id ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.team_memberships" {
  uuid team_id FK ""
  uuid user_id FK ""
  text role ""
}
"public.org_visibility_settings" {
  text object_type ""
  text policy ""
  timestamp_with_time_zone updated_at ""
  uuid updated_by FK ""
}
"public.user_custom_roles" {
  uuid user_id FK ""
  uuid role_id FK ""
}
"public.scim_tokens" {
  uuid id ""
  text token_hash ""
  uuid created_by FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone last_used_at ""
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
"public.feature_flag_groups" {
  varchar_100_ group_key ""
  varchar_100_ label ""
  text description ""
  boolean enabled ""
  timestamp_with_time_zone enable_at ""
  uuid updated_by FK ""
  timestamp_with_time_zone updated_at ""
}
"public.feature_flag_group_beta_users" {
  varchar_100_ group_key FK ""
  uuid user_id FK ""
  uuid added_by FK ""
  timestamp_with_time_zone added_at ""
}
"public.ai_sessions" {
  uuid id ""
  uuid user_id FK ""
  varchar_255_ name ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.email_templates" {
  uuid id ""
  varchar_200_ name ""
  varchar_50_ category ""
  varchar_500_ subject ""
  text body ""
  jsonb merge_tags ""
  boolean enabled ""
  uuid created_by FK ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.user_ai_context" {
  uuid id ""
  uuid user_id FK ""
  varchar_100_ key "Short label for this preference (e.g. #quot;a while#quot;, #quot;high-value#quot;). Max 100 chars."
  varchar_500_ value "Plain-text definition of the preference (e.g. #quot;30+ days without activity#quot;). Max 500 chars."
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
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
"public.ai_token_usage_daily" {
  uuid id ""
  uuid user_id FK ""
  date usage_date ""
  text feature ""
  bigint input_tokens ""
  bigint output_tokens ""
  timestamp_with_time_zone updated_at ""
}
"public.contact_champion_blocker_signals" {
  uuid id ""
  uuid contact_id FK ""
  text status ""
  numeric_3_2_ confidence ""
  jsonb contributing_signals ""
  uuid last_activity_id FK ""
  text override_status ""
  text override_reason ""
  uuid overridden_by FK ""
  timestamp_with_time_zone overridden_at ""
  uuid dismissed_by FK ""
  timestamp_with_time_zone dismissed_at ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.notifications" {
  uuid id ""
  uuid user_id FK ""
  text type ""
  text title ""
  text body ""
  text link_path ""
  timestamp_with_time_zone read_at ""
  timestamp_with_time_zone created_at ""
}
"public.activity_meeting_briefs" {
  uuid id ""
  uuid activity_id FK ""
  jsonb brief_json ""
  uuid generated_by FK ""
  timestamp_with_time_zone generated_at ""
}
"public.activity_sentiment_scores" {
  uuid id ""
  uuid activity_id FK ""
  text sentiment ""
  numeric_3_2_ confidence ""
  uuid flagged_inaccurate_by FK ""
  timestamp_with_time_zone flagged_inaccurate_at ""
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
}
"public.account_health_scoring_config" {
  boolean id ""
  numeric_4_3_ frequency_weight ""
  numeric_4_3_ recency_weight ""
  numeric_4_3_ seniority_weight ""
  numeric_4_3_ sentiment_weight ""
  numeric_4_3_ breadth_weight ""
  numeric_5_2_ strong_threshold ""
  numeric_5_2_ healthy_threshold ""
  numeric_5_2_ cooling_threshold ""
  numeric_5_2_ at_risk_threshold ""
  integer min_logged_activities ""
  integer recency_window_days ""
  integer single_threaded_window_days ""
  timestamp_with_time_zone updated_at ""
  uuid updated_by FK ""
}
"public.rep_coaching_scoring_config" {
  boolean id ""
  integer min_closed_deals ""
  numeric_4_2_ stage_time_outlier_ratio ""
  numeric_4_2_ activity_frequency_outlier_ratio ""
  integer response_time_outlier_hours ""
  numeric_4_3_ win_rate_outlier_delta ""
  timestamp_with_time_zone updated_at ""
  uuid updated_by FK ""
}
"public.rep_coaching_insights" {
  uuid id ""
  uuid rep_id FK ""
  text metric_type ""
  text segment ""
  text observation ""
  text recommended_action ""
  numeric_12_4_ rep_value ""
  numeric_12_4_ team_average_value ""
  boolean is_outlier ""
  integer closed_deal_count ""
  timestamp_with_time_zone computed_at ""
}
"public.rep_coaching_insight_history" {
  uuid id ""
  uuid rep_id FK ""
  text metric_type ""
  text segment ""
  numeric_12_4_ rep_value ""
  numeric_12_4_ team_average_value ""
  boolean is_outlier ""
  timestamp_with_time_zone computed_at ""
}
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
"public.team_feature_overrides" {
  uuid id ""
  uuid team_id FK ""
  varchar_100_ flag_key ""
  boolean enabled ""
  timestamp_with_time_zone updated_at ""
  uuid updated_by FK ""
}
"public.lead_routing_scoring_config" {
  boolean id ""
  numeric_4_3_ territory_weight ""
  numeric_4_3_ industry_weight ""
  numeric_4_3_ workload_weight ""
  numeric_4_3_ win_rate_weight ""
  numeric_4_3_ availability_weight ""
  numeric_4_3_ low_confidence_threshold ""
  numeric_4_3_ medium_confidence_threshold ""
  integer min_closed_deals_for_win_rate ""
  timestamp_with_time_zone updated_at ""
  uuid updated_by FK ""
}
"public.data_hygiene_scoring_config" {
  boolean id ""
  integer contact_inactivity_days ""
  integer account_inactivity_days ""
  integer title_staleness_days ""
  integer opportunity_inactivity_days ""
  integer dismiss_suppression_days ""
  boolean weekly_digest_enabled ""
  timestamp_with_time_zone updated_at ""
  uuid updated_by FK ""
}
"public.data_hygiene_findings" {
  uuid id ""
  text entity_type ""
  uuid entity_id ""
  text issue_type ""
  uuid related_entity_id ""
  uuid owner_id FK ""
  timestamp_with_time_zone last_activity_at ""
  text suggested_action ""
  text status ""
  timestamp_with_time_zone dismissed_until ""
  text dismissed_reason ""
  timestamp_with_time_zone detected_at ""
  timestamp_with_time_zone updated_at ""
}
"public.connected_accounts" {
  uuid id ""
  uuid user_id FK ""
  varchar_16_ provider ""
  text email_address ""
  text auth_encrypted ""
  text__ granted_scopes "Scopes the provider actually granted, which may be fewer than were requested."
  varchar_16_ status ""
  text status_detail ""
  timestamp_with_time_zone last_sync_at ""
  text sync_cursor ""
  smallint key_version "Key version used to encrypt auth_encrypted. References ENCRYPTION_KEY_V<n> env var."
  timestamp_with_time_zone created_at ""
  timestamp_with_time_zone updated_at ""
  integer sync_failure_count "Consecutive failed sync attempts. Drives the retry delay and the ceiling past which a mailbox is no longer claimed; reset when a connection test succeeds."
  timestamp_with_time_zone sync_next_attempt_at "Earliest time this mailbox may be synced again. Null means due now. This, not status, is what gates a retry."
}
"public.connected_account_oauth_states" {
  text state ""
  uuid user_id FK ""
  varchar_16_ provider ""
  text pkce_verifier ""
  timestamp_with_time_zone expires_at ""
  timestamp_with_time_zone created_at ""
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)

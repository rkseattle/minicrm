# Database Schema Reference

Non-obvious fields, enums, and constraints only. Standard columns (`id`, `created_at`, `updated_at`) and self-explanatory fields are omitted. For full column listings see `docs/schema/`.

---

## Tables

```
users
  role(admin|rep)  status(active|invited|inactive)
  must_change_password  preferred_language  nav_layout(top|left|hamburger)
  password_changed_at
  notify_overdue_tasks  notify_assignments  notify_deal_stage_changes
  password_reset_token  password_reset_expires

accounts
  account_type(Prospect|Customer|Partner|Vendor|Competitor|Other) nullable
  parent_account_id uuid → accounts nullable   owner_id   is_demo

contacts
  account_id nullable   owner_id   source_lead_id nullable   is_demo
  UNIQUE INDEX on email (migration 034)

contact_addresses                    ← one-to-many; prefer for new address work
  label   is_default bool
  UNIQUE PARTIAL INDEX on (contact_id) WHERE is_default = true

deals
  stage text — validated against pipeline_stages table at runtime; NOT a Zod enum
  value numeric(15,2)   currency varchar(3) NOT NULL DEFAULT 'USD'
  probability integer nullable  (0–100 manual override; NULL = inherit from stage default)
  loss_reason   account_id nullable   owner_id   source_lead_id nullable   is_demo

deal_contacts  deal_id, contact_id    ← composite PK (deal_id, contact_id) REQUIRED

pipeline_stages                       ← admin-configurable; the authoritative stage list
  name varchar(100) UNIQUE (case-insensitive index)   sort_order int UNIQUE
  probability int (0–100)   is_terminal bool   is_fixed bool
  Seed rows: Prospecting(10%), Qualification(25%), Proposal(50%),
             Negotiation(75%), Closed Won(100%), Closed Lost(0%)
  is_fixed=true rows cannot be renamed or deleted

activities
  type(Note|Call|Email|Meeting|Task)   status(open|complete)
  direction(Inbound|Outbound) nullable   outcome text nullable
  contact_id nullable   account_id nullable   deal_id nullable   owner_id   is_demo
  CHECK: at least one of contact_id / account_id / deal_id must be non-null
  metadata jsonb nullable  ← type-specific overflow; see Activity Extension Strategy below

leads
  last_name nullable   company_name nullable
  lead_source(Web|Referral|Trade Show|Cold Outreach|Other) nullable
  status(New|Contacted|Qualified|Disqualified)   disqualification_reason nullable
  owner_id   converted_at nullable
  converted_contact_id nullable   converted_account_id nullable   converted_deal_id nullable
  is_demo

lead_status_history
  lead_id → leads ON DELETE CASCADE
  from_status nullable   to_status   changed_by_id nullable   changed_by_name nullable

attachments
  record_type(contact|account|deal|lead)   record_id
  filename   original_name   mime_type   size_bytes   storage_key   uploaded_by_id

audit_log                              ← append-only; DB-enforced; monthly range-partitioned on created_at
  record_type   record_id nullable   record_name nullable   event_type
  field_name nullable   old_value nullable   new_value nullable
  changed_by_id nullable   changed_by_name nullable
  Partition naming: audit_log_y{YYYY}m{MM} (e.g. audit_log_y2026m06)
  Default partition audit_log_default catches rows outside the managed range
  PK is (id, created_at) — PG16 requires partition key in all unique constraints
  ensureAuditLogPartitions() called at startup + a monthly cron to pre-create 3 months ahead
  Historical rows (pre-partition era) live in audit_log_default; this is intentional
  Triggers (append-only, NOTIFY) are defined on the parent and cloned to child partitions automatically
  event_type also includes: note_created, note_updated, note_deleted, gdpr_erasure
  record_type also includes: lead

audit_log_after_insert trigger (migration 052) → pg_notify('audit_events', row JSON)
  Used by auditEventBus.ts to stream real-time events over gRPC ServerStream

automation_rules
  enabled bool   trigger_type   trigger_config jsonb   action_type   action_config jsonb
  created_by

automation_rule_logs
  rule_id → automation_rules ON DELETE CASCADE   triggered_at
  triggering_record_type   triggering_record_id   outcome(success|error)   error_message nullable
  triggering_record_type valid values: 'deal', 'contact' (no DB CHECK — column comment in migration 083)

system_settings  key (PK), value text, updated_at, updated_by uuid → users ON DELETE SET NULL
  Keys: default_language, nav_layout, email_notifications_enabled,
        default_currency, file_storage_endpoint, file_storage_bucket, file_storage_key_id,
        file_storage_secret (AES-256-GCM encrypted with NODE_ENCRYPTION_KEY)
  ⚠ All writes MUST pass an AuditActor so updated_by is recorded.
    Use SYSTEM_ACTOR (all-zeros UUID) only for seeding/migration writes.

overdue_task_notifications  activity_id, notified_date  ← dedup guard for email digests

notes
  body text (source content)   body_text text (denormalized plain-text for search)
  visibility(private|team|public)   author_id → users
  entity_type varchar(16) NOT NULL   entity_id uuid NOT NULL  ← polymorphic discriminator pair
    entity_type ∈ {contact, account, deal, lead}; no FK constraint
  deleted_at nullable  ← soft-delete; filter WHERE deleted_at IS NULL in application queries
  GIN index on body_text (pg_trgm, partial — excludes soft-deleted rows, migration 079)

custom_fields
  field_type   table_name   column_name   label   required bool

webhooks
  url   secret   event_type   enabled bool   created_by

import_jobs
  source(csv|...)   row_count   status(pending|processing|complete|failed)   error_message nullable

tags
  name   color

gdpr_deletion_log                              ← GDPR Art. 17 erasure tracking
  record_type   record_id   requested_by_id   erasure_scope   completed_at nullable
  UNIQUE on (record_type, record_id)
  ⚠ Unique constraint safe only while all record_ids are gen_random_uuid() UUIDs.
    If deterministic external IDs are introduced this must be revisited. See migration 084.

contacts/accounts/deals/leads: version integer  (optimistic locking, migration 048)

feature_flags.role_overrides (jsonb, nullable)
  ⚠ Transitional column. MINCRM-487 will replace with user-level override tables.
    Never bypass assertValidRoleOverrides() in featureFlagService.ts.

ai_configuration                       ← singleton row (singleton bool CHECK UNIQUE)
  provider varchar(50) DEFAULT 'anthropic'   model varchar(100)
  api_key_encrypted text   api_key_key_version smallint  (AES-256-GCM, NODE_ENCRYPTION_KEY)
  deployment_mode(cloud_api|private_endpoint|self_hosted)   base_url nullable
  enabled bool   dpa_acknowledged bool   dpa_acknowledged_for_provider varchar(50)
  ai_session_retention_days integer NOT NULL DEFAULT 90 CHECK (>= 30)
  ai_input_cost_per_million_cents integer NOT NULL DEFAULT 300   ← MINCRM-459
  ai_output_cost_per_million_cents integer NOT NULL DEFAULT 1500 ← MINCRM-459

ai_sessions / ai_messages
  ai_sessions: user_id → users ON DELETE CASCADE   name nullable (auto-set on first message)
  ai_messages: session_id → ai_sessions ON DELETE CASCADE   role(user|assistant)
    content text   tool_results jsonb nullable   pending_action jsonb nullable
    context_proposal jsonb nullable
  Purged by nightly retentionService job per ai_configuration.ai_session_retention_days

ai_token_usage                         ← per-user, per-month; budget enforcement only
  PK (user_id, year_month char(7) 'YYYY-MM')   input_tokens/output_tokens bigint
  Do NOT widen this table for new dimensions — see ai_token_usage_daily below.

ai_token_usage_daily                   ← per-user, per-day, per-feature; usage dashboard (MINCRM-459)
  UNIQUE (user_id, usage_date, feature)   feature text DEFAULT 'nli_chat' (free text, not enum)
  Additive to ai_token_usage — written independently so a failure here never
  affects monthly budget enforcement.

ai_token_budgets
  user_id nullable (NULL = org default)   monthly_limit bigint (0 = unlimited)
  Unique partial indexes: one row per user_id, and only one row where user_id IS NULL

ai_field_exclusions                    ← admin-configurable standard-field AI exclusions (MINCRM-461)
  UNIQUE (entity_type, field_name)   excluded bool DEFAULT false
  Does NOT store the hardcoded immutable defaults (ALWAYS_EXCLUDED_FIELDS in piiFilter.ts)
    or custom-field exclusions (see custom_field_definitions.pii_excluded below) —
    consulted by piiFilter.ts in addition to, never instead of, the hardcoded set.

custom_field_definitions.pii_excluded (bool, migration 125)
  Value stripped from AI payloads when true; definition metadata (name, field_type) retained.

ai_gdpr_cascade_log                    ← GDPR Art. 17 cascade tracking for AI data (MINCRM-446)
  record_type(contact|lead) + record_id  ← identifies the erased record
  contact_id nullable  ← superseded by record_id; NULL for non-contact rows
  triggered_by nullable (NULL = system-initiated)
  messages_redacted int   context_entries_removed int   status(completed|failed)
  original_name/original_email nullable  ← cleared after successful cascade

user_ai_context
  Per-user AI personalization key/value pairs. Explicitly excluded from the
  session retention purge policy — this is persistent config, not conversation history.
```

---

## Activity Type Extension Strategy

Decision: JSONB `metadata` overflow column (not new nullable typed columns).

**Column boundary:**

- Shared typed columns (all types): `subject`, `due_date`, `status`, `direction`, `outcome`, `owner_id`, `contact_id`, `account_id`, `deal_id`
- `metadata jsonb`: type-specific fields only (e.g. `thread_id`/`connection_degree` for LinkedIn, `phone_number`/`message_sid` for WhatsApp)

**Adding a new activity type:**

1. Add the value to the `varchar + CHECK` constraint (NOT the grandfathered `activity_type` ENUM).
2. Store type-specific fields in `metadata jsonb` — never add nullable typed columns to `activities`.
3. Document the expected `metadata` shape in the migration comment.

---

## Grandfathered ENUM Columns

Do not add new values to these ENUMs — use `varchar + CHECK` for all new constrained-string columns.

| Column                 | ENUM type            | Valid values                               |
| ---------------------- | -------------------- | ------------------------------------------ |
| `activities.type`      | `activity_type`      | `Note`, `Call`, `Email`, `Meeting`, `Task` |
| `activities.status`    | `activity_status`    | `open`, `complete`                         |
| `activities.direction` | `activity_direction` | `Inbound`, `Outbound`                      |

---

## Polymorphic FK Pattern

Six tables use `(type, id)` discriminator pairs instead of typed FK columns. Reference integrity is enforced at the application layer.

| Table                 | Type column                        | Valid type values                    | Orphan cleanup?         |
| --------------------- | ---------------------------------- | ------------------------------------ | ----------------------- |
| `attachments`         | `record_type`                      | `contact`, `account`, `deal`, `lead` | Yes — required          |
| `custom_field_values` | _(via definition's `entity_type`)_ | `contact`, `account`, `deal`         | Yes — required          |
| `notes`               | `entity_type`                      | `contact`, `account`, `deal`, `lead` | Yes — required          |
| `gdpr_deletion_log`   | `record_type`                      | any erasable entity type             | No — retained by design |
| `audit_log`           | `record_type`                      | see migration 076                    | No — retained by design |
| `ai_gdpr_cascade_log` | `record_type`                      | `contact`, `lead`                    | No — retained by design |

When hard-deleting a parent entity, clean up polymorphic dependents in the same transaction:

- `attachments`: delete the object-storage file (by `storage_key`) first, then delete the row
- `custom_field_values`: delete rows before the parent DELETE
- `notes`: soft-delete via `softDeleteNotesByEntity(client, entityType, entityId)` from `noteService.ts` — do NOT hard-delete notes (preserves audit history)

`audit_log` and `gdpr_deletion_log` rows are retained intentionally for compliance traceability.

---

## Known Architectural Constraints

- **Custom fields (EAV)** — type-aware filtering, cross-field queries, and sorting are O(n) at scale. Read ADR-002 before writing any SQL on custom fields.
- **Dual contact address storage** — inline fields on `contacts` (migration 024) and `contact_addresses` (migration 030) coexist. New address work uses `contact_addresses`.
- **`BreakpointContext`** is the single source of responsive state. Use `useBreakpoint()` — never `window.matchMedia` directly.
- **`seed-demo.ts`** is a thin CLI wrapper. All demo fixture data lives in `demoService.ts`.
- **Automation is always fire-and-forget** — `void fireAutomationTrigger(...)`, never `await`.

## ADRs

See [docs/adr/](../adr/) for architectural decisions. Reference ADRs in migration comments and PR descriptions.

| ADR                                                  | Decision                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [ADR-001](../adr/001-single-org-no-multi-tenancy.md) | Single-org; no `org_id`. Multi-tenancy requires schema changes to 37 tables.                            |
| [ADR-002](../adr/002-custom-fields-eav-vs-jsonb.md)  | Custom fields use EAV. Migrate to JSONB when AI filtering is implemented or latency exceeds thresholds. |

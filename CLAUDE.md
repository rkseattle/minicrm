# MiniCRM — Claude Code Context

---

## Stack

- **Client:** React + Vite, TanStack Query v5, React Router, Tailwind CSS, i18next
- **Server:** Node.js + Express + TypeScript, REST, Zod validation
- **DB:** PostgreSQL 16, node-pg-migrate
- **Auth:** JWT in httpOnly cookie (8-hour expiry)
- **Infra:** Docker + Docker Compose, npm workspaces (`/client`, `/server`, `/shared`, `/qa`)
- **Docs:** OpenAPI 3.0 via swagger-jsdoc, served at `/api-docs` (dev/staging only)
- **gRPC:** ConnectRPC (`@connectrpc/connect-express`) mounted on Express; browser uses `@connectrpc/connect-web`

---

## Project Layout

```
server/src/
  routes/        → route definitions + @openapi JSDoc ONLY — no logic
  controllers/   → request/response shaping ONLY — no pool.query() calls
  services/      → ALL business logic + ALL database queries
  middleware/    → auth.ts (JWT verify + status check), requireRole.ts, asyncHandler.ts
  utils/         → shared server utilities
  grpc/          → ConnectRPC service handler + proto/ definitions

client/src/
  api/           → one Axios wrapper file per resource; exports typed fns + QUERY_KEY constants
  pages/         → full page components (one file per route)
  components/    → reusable UI pieces (forms, modals, timeline, etc.)
  hooks/         → custom React hooks (useAuth, etc.)
  test/          → MSW handlers, renderWithProviders, setup.ts

shared/schemas/  → Zod schemas imported by BOTH client and server
  *.ts sources only — compiled .js outputs are gitignored, never commit them
  contactSchema.ts, accountSchema.ts, dealSchema.ts, leadSchema.ts, activitySchema.ts
  settingsSchema.ts  (SUPPORTED_LOCALES, NAV_LAYOUTS, SUPPORTED_CURRENCIES)
  paginationSchema.ts  (paginationParamsSchema, PaginatedResponse<T>)
  pipelineStageSchema.ts  (PipelineStageResponse, etc.)
  auditSchema.ts, automationSchema.ts, brandingSchema.ts, customFieldSchema.ts
  noteSchema.ts, tagSchema.ts, userSchema.ts, webhookSchema.ts

db/migrations/   → sequential node-pg-migrate files
  run `ls db/migrations/ | tail -1` to find the last migration; increment by one for the next

qa/e2e/
  framework/     → HealingLocator, fixtures, REST/gRPC clients (ZERO app domain refs)
  behaviors/minicrm/ → named async behavior fns (compose Page Objects, no assertions)
  pages/minicrm/ → Page Objects (UI interactions only)
  apps/minicrm/  → fixtures.ts, helpers.ts, test-data-manager.ts
  tests/apps/minicrm/functional/<domain>/ → spec files tagged @functional
```

---

## Migration Baseline Squash (MINCRM-528)

`db/migrations/000_baseline.js` captures the full schema after all migrations.
Fresh environments use it to skip replaying all individual migrations.

### Fresh environment setup

Do NOT run `npm run migrate` on a brand-new database — it would try to run
`000_baseline` + 001–101 in sequence and fail (objects already exist).
Use the two-step bootstrap script instead:

```bash
DATABASE_URL=postgres://... npm run migrate:fresh --workspace=minicrm-server
```

This script (`server/src/scripts/migrate-fresh.ts`):

1. Runs **only** `000_baseline` (`count: 1`) — creates the full schema
2. Marks migrations 001–N as applied via node-pg-migrate's `fake` mode
3. Future migrations (N+) run normally via `npm run migrate`

### Existing deployments

`000_baseline` is safe to run on existing databases. Every `CREATE TABLE/INDEX/EXTENSION`
uses `IF NOT EXISTS`. When `npm run migrate` runs on an existing DB that does not yet
have `000_baseline` in `pgmigrations`, it will execute the baseline once and it will be
a no-op for all objects that already exist.

All `CREATE TRIGGER`, `CREATE POLICY`, and `ALTER TABLE ADD CONSTRAINT` statements
are wrapped in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`
blocks, so the baseline is fully idempotent on existing databases.

### When to regenerate the baseline

Regenerate `000_baseline.js` every **~50 migrations** or once per major release, whichever
comes first. The goal is to keep fresh-install time under 10 seconds.

**Regeneration process:**

```bash
# 1. Ensure all migrations are applied
DATABASE_URL=postgres://... npm run migrate --workspace=minicrm-server

# 2. Dump the full schema (run inside the DB container)
docker exec minicrm-db pg_dump \
  --username=minicrm --dbname=minicrm \
  --schema-only --no-owner --no-acl --schema=public \
  > /tmp/minicrm_schema_dump.sql

# 3. Rewrite db/migrations/000_baseline.js from the dump
#    - Wrap every CREATE in IF NOT EXISTS
#    - Maintain dependency order (no forward FK references)
#    - Update the migration list in the JSDoc header comment

# 4. Verify against a clean Docker environment
docker exec minicrm-db psql -U minicrm -c "CREATE DATABASE minicrm_baseline_test"
DATABASE_URL=postgres://minicrm:password@localhost:5432/minicrm_baseline_test \
  npm run migrate:fresh --workspace=minicrm-server
# Compare table/index/constraint counts against the production DB

# 5. Drop the test DB
docker exec minicrm-db psql -U minicrm -c "DROP DATABASE minicrm_baseline_test"
```

---

## ERD — Schema Documentation (MINCRM-529)

`docs/schema/` contains auto-generated Markdown and Mermaid ERD output produced by
[tbls](https://github.com/k1LoW/tbls). The output is committed and must stay in sync
with `db/migrations/`.

### Generating the ERD locally

```bash
# Uses the dev DB by default (postgres://minicrm:password@localhost:5432/minicrm)
npm run db:erd --workspace=minicrm-server

# Override the database
DATABASE_URL=postgres://user:pass@host:5432/db npm run db:erd --workspace=minicrm-server
```

### CI staleness check

There is no automated CI check for ERD freshness — tbls output is non-deterministic
across postgres versions and installed extensions, making a diff-based gate unreliable.

**When you add a migration:** regenerate the ERD locally with `npm run db:erd --workspace=minicrm-server` and commit the updated `docs/schema/` files in the same PR.

### tbls configuration

`.tbls.yml` at the repo root. Audit log partitions and `pgmigrations` are excluded
from the ERD (visual noise). To upgrade tbls: update the pinned version in both
`.tbls.yml` comments and the `check-erd` job's `curl` command.

---

## Database Schema

Non-obvious fields, enums, and constraints only. Standard columns (`id`, `created_at`,
`updated_at`) and self-explanatory fields are omitted.

```
users
  role(admin|rep)  status(active|invited|inactive)
  must_change_password  preferred_language  password_changed_at
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
  metadata jsonb nullable  ← type-specific overflow; see Extension Strategy below

  **Activity Type Extension Strategy (MINCRM-525)**
  Decision: JSONB metadata overflow column. New activity types store type-specific
  fields in `metadata` rather than adding nullable typed columns to the shared table.

  Column boundary:
  - **Shared typed columns** (present for all types): `subject`, `due_date`, `status`,
    `direction`, `outcome`, `owner_id`, `contact_id`, `account_id`, `deal_id`
  - **metadata jsonb** (type-specific extensions): any field that is meaningful only
    for a specific type, e.g. `thread_id`/`connection_degree` for LinkedIn messages,
    `phone_number`/`message_sid` for WhatsApp messages.

  Adding a new activity type:
  1. Add the new value to the `varchar + CHECK` constraint (NOT the grandfathered
     `activity_type` ENUM — see Schema Conventions below).
  2. Store type-specific fields in `metadata jsonb`; never add nullable typed columns
     to `activities` for type-specific data.
  3. Document the expected `metadata` shape in the migration comment.

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
  record_type(contact|account|deal)   record_id
  filename   original_name   mime_type   size_bytes   storage_key   uploaded_by_id

audit_log                              ← append-only; DB-enforced; **monthly range-partitioned on created_at** (MINCRM-521)
  record_type   record_id nullable   record_name nullable   event_type
  field_name nullable   old_value nullable   new_value nullable
  changed_by_id nullable   changed_by_name nullable
  Partition naming: audit_log_y{YYYY}m{MM} (e.g. audit_log_y2026m06)
  Default partition audit_log_default catches rows outside the managed range
  PK is (id, created_at) — PG16 requires partition key in all unique constraints
  ensureAuditLogPartitions() called at startup + monthly cron (0 0 1 * *) to pre-create 3 months ahead
  Historical rows (pre-partition era) live in audit_log_default; this is intentional
  Triggers (append-only, NOTIFY) are defined on the parent and cloned to all child partitions automatically

automation_rules
  enabled bool   trigger_type   trigger_config jsonb   action_type   action_config jsonb
  created_by

automation_rule_logs
  rule_id → automation_rules ON DELETE CASCADE   triggered_at
  triggering_record_type   triggering_record_id   outcome(success|error)   error_message nullable

system_settings  key (PK), value text, updated_at, updated_by uuid → users ON DELETE SET NULL
  Keys: default_language, nav_layout, email_notifications_enabled,
        default_currency, file_storage_endpoint, file_storage_bucket, file_storage_key_id,
        file_storage_secret (AES-256-GCM encrypted with NODE_ENCRYPTION_KEY)
  ⚠ All service functions that write system_settings MUST pass an AuditActor so updated_by is
    recorded. Use SYSTEM_ACTOR (all-zeros UUID) only for seeding/migration writes. (MINCRM-520)

overdue_task_notifications  activity_id, notified_date  ← dedup guard for email digests

notes
  body text (source content)   body_text text (denormalized plain-text for search)
  visibility(private|team|public)   author_id → users
  entity_type varchar(16) NOT NULL   entity_id uuid NOT NULL  ← polymorphic discriminator pair
    entity_type ∈ {contact, account, deal, lead}; no FK constraint (see Polymorphic FK Pattern)
  deleted_at nullable  ← soft-delete; filter WHERE deleted_at IS NULL in application queries
  GIN index on body_text (pg_trgm full-text search, partial — excludes soft-deleted rows, migration 079)

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
  ⚠ Unique constraint: safe only while all record_ids are gen_random_uuid() UUIDs. If
    deterministic external IDs are ever introduced this must be revisited. See migration 084. (MINCRM-517)

audit_log.event_type also includes: note_created, note_updated, note_deleted, gdpr_erasure
audit_log.record_type also includes: lead
attachments.record_type also includes: lead
contacts/accounts/deals/leads also have: version integer  (optimistic locking, migration 048)

audit_log_after_insert trigger (migration 052) → pg_notify('audit_events', row JSON)
  Used by auditEventBus.ts to stream real-time events over gRPC ServerStream

feature_flags.role_overrides (jsonb, nullable)
  ⚠ Transitional column: per-role enable/disable overrides. MINCRM-487 will replace with
    first-class user-level override tables, at which point this column will be dropped.
    assertValidRoleOverrides() in featureFlagService.ts enforces shape; do not bypass. (MINCRM-511)
```

**Migration rules:** Never modify an existing migration — write a new corrective migration instead. Every migration needs both `up` and `down`; `down` must genuinely reverse `up`. Integrity rules go in DB CHECK constraints in addition to Zod.

---

## Security — Required on Every Authenticated Endpoint

### 1. Auth middleware (`authenticate`)

Verifies on every authenticated request: JWT signature + expiry, `user.status === 'active'`,
and `must_change_password` (→ 403 `PASSWORD_CHANGE_REQUIRED` except `/api/auth/change-password`).
`authenticate` is regular middleware — every `await` inside must be in a try/catch that calls
`next(err)`. `asyncHandler` covers route handlers only.

### 2. Startup guards

Both must run before the server binds:

- Reject weak `JWT_SECRET` (empty, `changeme`, `secret`, `password`, or < 32 chars).
- Reject absent/malformed `NODE_ENCRYPTION_KEY` (must be a 64-character hex string).

### Encryption key rotation (MINCRM-519)

`cryptoService.ts` exposes a versioned keyring (`encryptVersioned` / `decryptVersioned`).
`_key_version` columns on `ai_configuration` and `smtp_configuration` record which key encrypted each secret.

**Env vars:** `NODE_ENCRYPTION_KEY` = key version 1; `ENCRYPTION_KEY_V2`/`V3`/… = higher versions (64-char hex each); `CURRENT_ENCRYPTION_KEY_VERSION` controls which version is used for new encryptions (defaults to 1).

**To rotate:** set `ENCRYPTION_KEY_V2` + `CURRENT_ENCRYPTION_KEY_VERSION=2`, redeploy, then run `npm run key-rotate` (see `docs/admin-guide.md`) to re-encrypt existing secrets and update DB `_key_version` columns.

**Limitation:** `sso_idp_certificate_encrypted` in `system_settings` has no `key_version` column and uses the legacy unversioned API — it cannot be re-encrypted by `npm run key-rotate`. Re-configure SSO manually after rotation.

### 3. Ownership on PATCH / DELETE

```ts
// Use req.user.id from middleware — never trust req.body
WHERE id = $1 AND (owner_id = $2 OR $3 = 'admin')
// params: [recordId, req.user.id, req.user.role]
```

### 4. ORDER BY allowlist (SQL injection prevention)

```ts
const ALLOWED_SORT = ['first_name', 'email', 'created_at'] as const;
const col = (ALLOWED_SORT as readonly string[]).includes(req.query.sort as string)
  ? (req.query.sort as string)
  : 'created_at';
const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
```

For UPDATE field names, use `ReadonlySet<keyof UpdateInput>` — see `dealService.ts`.

### 5. Cookie configuration

```ts
res.cookie('token', jwt, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000,
});
```

### 6. Rate limiting

`POST /api/auth/login` and `POST /api/auth/forgot-password` use `express-rate-limit`.
`E2E=true` bypasses the limiter for test runners only.

---

## Architecture Rules

- **Services own all DB access.** `pool.query()` belongs exclusively in `server/src/services/`.
- **Controllers shape requests/responses only.** No business logic. No `pool.query()`.
- **Zod validation in controllers, before every service call.** Use `.safeParse()`; return 400: `{ error: { code: 'VALIDATION_ERROR', message: errors[0].message } }`.
- **All async route handlers** wrapped in `asyncHandler` or explicit try/catch.
- **Error shape always:** `{ error: { code: string, message: string } }` — `code` is SCREAMING_SNAKE_CASE (e.g. `CONTACT_EMAIL_DUPLICATE`), never freeform.
- **HTTP status codes:** 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict.
- **Map PostgreSQL error codes explicitly:** `23505` → 409 with domain code; `23503` → 400/409; others → 500.
- **No N+1 queries.** List endpoints must join or batch-load — never per-row queries in a loop.
- **`async/await` only.** Never `.then()` chains.
- **`no-explicit-any` enforced.** Fix the type; never suppress with `any` or `@ts-ignore`.
- **Non-null assertion (`!`) and type assertions (`as`)** require an inline comment explaining why the narrowing is safe.
- **Service functions must declare explicit return types.**
- **No `console.log` in `server/src/`** outside test files. Use `logger.info/warn/error`.
- **No magic numbers or magic strings.** Use named constants.

---

## Required Patterns for Write Operations

### Transactions with audit logging

Every CREATE / UPDATE / DELETE **must** write an audit entry in the **same transaction**.

```ts
const client: PoolClient = await pool.connect();
try {
  await client.query('BEGIN');
  const result = await client.query<Row>(`INSERT INTO contacts (...) VALUES (...) RETURNING ...`, [...values]);
  const record = result.rows[0];
  await writeAuditEntry(client, {    // ← SAME client, SAME transaction
    recordType: 'contact', recordId: record.id,
    recordName: `${record.first_name} ${record.last_name}`,
    eventType: 'created', changedById: actor.id, changedByName: actor.name,
  });
  await client.query('COMMIT');
  void fireAutomationTrigger('contact_created', { ... }); // fire-and-forget AFTER commit
  return record;
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

For UPDATE: `diffFields(before, after, auditBase)` generates per-field entries; `writeAuditEntries(client, entries)` writes them in batch. See `dealService.ts`.

### AuditActor pattern (required on all write service functions)

```ts
export interface AuditActor { id: string; name: string; }
const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

export async function createContact(
  params: CreateContactInput & { owner_id: string },
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<ContactRow> { ... }
```

Controller extracts the actor from `req.user`: `const actor = { id: req.user.id, name: req.user.name };`

### Assignment notifications (after commit, fire-and-forget)

When `owner_id` changes, call `queueAssignmentNotification(...)` AFTER commit. Do NOT `await` it. Do NOT call it inside the transaction. `queueAssignmentNotification` is synchronous (returns `void`).

### Automation triggers (always `void`, never `await`)

```ts
void fireAutomationTrigger('deal_stage_changed', {
  recordId: deal.id,
  recordType: 'deal',
  ownerId: deal.owner_id,
  newStage: deal.stage,
});
```

`fireAutomationTrigger` swallows all internal errors. Each rule runs in its own isolated try/catch.

---

## New Endpoint Checklist

- [ ] Route file: `@openapi` JSDoc + `asyncHandler` only — zero logic, zero service imports
- [ ] Controller: Zod `.safeParse()` before service call; no `pool.query()`
- [ ] Pagination: use `paginationParamsSchema` from `shared/schemas/paginationSchema.ts`
- [ ] Sort params: allowlist-validated before SQL interpolation
- [ ] Admin-only routes: `requireRole('admin')` on the route
- [ ] Feature flag gate: add `requireFeatureEnabled('flag_key')` + entry in migration 066, or document why always-on
- [ ] PATCH/DELETE: ownership enforced in the WHERE clause
- [ ] Write operations: audit entry in same transaction as data change
- [ ] Assignment notification fired if `owner_id` changed (after commit, not awaited)
- [ ] DB errors mapped: 23505 → 409 with domain code; 23503 → 400/409; others → 500
- [ ] Standard error shape `{ error: { code, message } }` on all failure paths
- [ ] Service-layer unit test covering the new function, including ownership enforcement
- [ ] Functional E2E spec updated or added for the new behaviour
- [ ] OpenAPI spec passes `npm run lint:api --workspace=minicrm-server`
- [ ] Capabilities & Roles enforcement

---

## Pipeline Stages — Dynamic, Not Hardcoded

Stages live in `pipeline_stages` and are admin-configurable (MINCRM-180).
`PIPELINE_STAGES` from `dealSchema.ts` is a **bootstrap fallback only**.

**Client:** fetch via `GET /api/settings/pipeline-stages` at app startup, cache with `PIPELINE_STAGES_QUERY_KEY`. Stage selectors must use the live list.

**Server:** validate `stage` as a non-empty string at Zod level, then verify against the `pipeline_stages` table in the service. Do not re-introduce a Zod `.enum()` on a fixed list.

---

## Multi-Currency

`deals.currency` is `varchar(3) NOT NULL DEFAULT 'USD'`. Valid values: `SUPPORTED_CURRENCIES` from `shared/schemas/settingsSchema.ts`. Resolve default via `await getDefaultCurrency()` from `settingsService`. Format with `Intl.NumberFormat` using the deal's own `currency` field — never hardcode `'USD'`.

---

## Internationalization

- All user-facing strings use `t('key')` — **no hardcoded English in JSX**
- Locales: `en`, `zh-Hans`, `es`, `fr`, `de`; `eslint-plugin-i18next` enforces this in CI
- Pipeline stage display names: use `PIPELINE_STAGE_I18N_KEY` util then `t()`
- **RTL — logical CSS properties required for ALL new layout classes:**
  - `ps-` / `pe-` not `pl-` / `pr-`; `ms-` / `me-` not `ml-` / `mr-`
  - `start-` / `end-` not `left-` / `right-`; `text-start` / `text-end` not `text-left` / `text-right`

---

## Testing

### Server (`server/src/__tests__/`)

- **Framework:** Vitest against real PostgreSQL `minicrm_test` DB — no mocking of `pool`
- **Run:** `npm test --workspace=minicrm-server`
- **Isolation:** `beforeEach` truncates relevant tables; fixtures in `beforeAll`/`afterAll`
- **Coverage threshold:** 80% on `server/src/services/` (CI-enforced)
- **Controller tests:** `supertest` against `app` with `makeAuthCookie()`

Required test files beyond core CRUD: `auth-boundaries.test.ts` (rep → admin endpoints → 403; rep A → rep B's records → 403/404), `auditService.test.ts`, `notificationService.test.ts`.

### Client (`client/src/`)

- **Framework:** Vitest + React Testing Library + MSW
- **Run:** `npm test --workspace=minicrm-client`
- **MSW setup:** `onUnhandledRequest: 'error'` — any unhandled API call throws. Add a handler first.
- **Test helper:** `renderWithProviders()` from `src/test/renderWithProviders.tsx`
- **File location:** `Component.test.tsx` co-located with `Component.tsx`
- **Coverage thresholds:** 70% lines; 80% branches (CI-enforced)
- **Every component with async data must test all three states:** loading, error, and empty.
- Every conditional render branch needs a dedicated test case.

### ⛔ Definition of Done — Required Before ANY `git commit`

> **"Before pushing" means "before committing."** No scope exceptions.

```bash
# Step 1 — typecheck (all workspaces)
npm run typecheck --workspace=minicrm-client
npm run typecheck --workspace=minicrm-server
npm run typecheck --workspace=minicrm-qa
cd qa && npx tsc --noEmit   # qa/ is excluded from root typecheck

# Step 2 — lint
npm run lint

# Step 3 - audit
npm audit

# Step 4 — unit tests (changed workspaces only)
npm test --workspace=minicrm-server   # if server/ changed
npm test --workspace=minicrm-client   # if client/ changed

# Step 5 — QA static checks (when qa/ files changed)
bash qa/scripts/check-framework-purity.sh   # if qa/e2e/framework/ changed
bash qa/scripts/check-behavior-layer.sh     # if qa/e2e/tests/ changed
bash qa/scripts/check-settings-mutations.sh # if any spec mutates system settings

# Step 6 — E2E functional suite (ALWAYS — no scope exceptions)
date
rm -rf qa/e2e/test-results/
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) npm run test -- --grep @functional
```

**All steps green → `git commit` → `git push`. Any step red → fix, then restart from Step 1.**

The E2E suite requires: Vite dev server (port 5173), E2E app server (port 3002), MinIO, Mailhog.

#### E2E session setup (once per session)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile e2e up -d
npm run e2e:setup
API_URL=http://localhost:3002 npm run dev --workspace=minicrm-client  # separate terminal
```

`E2E_API_URL=http://localhost:3002`, `E2E_BASE_URL=http://localhost:5173` in `qa/e2e/.env`. (MINCRM-317, MINCRM-318, MINCRM-330)

### E2E Functional Suite — Execution Rules

> **THIS DIRECTIVE EXISTS BECAUSE IT HAS BEEN VIOLATED REPEATEDLY.**

**RULE 1 — One run per code change, no re-runs to paper over failures.** Fix the code; that fix is a new code change. Never re-run on the same code to see if a failure goes away.

**RULE 2 — Read report files, not console output:**

- `qa/e2e/test-results/results.xml` — JUnit XML; check `tests`, `failures`, `errors`
- `qa/e2e/test-results/healing-report.json` — heal event counts

**RULE 3 — Delete stale results before each run** (`rm -rf qa/e2e/test-results/`).

### E2E Locator Authoring Requirements

**Rule 1 — Primary strategy is always `testId`.** Never CSS class or positional selectors.

**Rule 2 — Every page object `locate()` requires at least two strategies.** testId is primary; add role/label/text fallback. Spec-layer inline locates for dynamic IDs may use single testId with a comment.

**Rule 3 — Every `locate()` requires an `intent` string** (5–10 words). Omitting it prevents AI healing recovery.

```ts
// CORRECT
const button = await this.page
  .locate(
    [
      { type: 'testId', value: 'new-contact-button' },
      { type: 'role', value: 'button', options: { name: /new contact/i } },
    ],
    { intent: 'button to open the new contact form' },
  )
  .resolve();
```

**Rule 4 — Never `page.waitForTimeout()` in page objects.** Use DOM-state waits: `locator.waitFor({ state })`, `page.waitForLoadState()`, or `page.waitForFunction()`.

### E2E Conventions

- **Config:** `qa/e2e/playwright.config.ts`
- **Tags:** every test must be tagged `@functional`; smoke-level tests also `@smoke`
- **Spec location:** `qa/e2e/tests/apps/minicrm/functional/<domain>/<domain>.spec.ts`
- **Framework layer must have zero app-domain strings** — enforced by `check-framework-purity.sh`
- **Specs must only import from `@behaviors/*`, `@apps/*`, `@framework/*`** — never `@pages/*`
- **Tests that mutate system settings** must call `ensureSystemDefaults()` for cleanup
- **No `loginAsAdmin` in `test.beforeAll`** — call `loginAsAdmin(restClient)` at test body start
- **Feature flag state via `withFlags()` only** (`qa/e2e/apps/minicrm/helpers.ts`). Call before `page.goto()`. Never toggle via API or DB mutation. (MINCRM-477)
- **Every story must include or update a functional E2E spec.**

---

## React & Frontend Conventions

### `data-testid` Conventions

- Static: `data-testid="new-contact-button"`, `data-testid="pipeline-board"`
- Row-scoped: `data-testid={\`contact-card-${contact.id}\`}`
- Action+entity: `data-testid="contacts-export-csv-button"`

### React Query Conventions

Every API module exports a typed query key constant: `export const CONTACTS_QUERY_KEY = ['contacts'] as const;`
Use constants everywhere — never inline strings in `queryKey`.

`staleTime` rules: `GET /api/users/active` → `staleTime: 5 * 60 * 1000`; dashboard summary → `staleTime: 0`. No global `staleTime` on the QueryClient.

### Intrinsic Responsive Design (MINCRM-208)

For variable-length/numeric content: fluid font sizes (`clamp(1.25rem,3vw,2rem)`), `min-w-0` on flex children with text, `break-words` on freetext fields. Test at 600px, 900px, 1100px. Comment non-obvious `min-w-0` or `clamp()`.

---

## gRPC / ConnectRPC Layer

`server/src/grpc/` — ConnectRPC service on the same port as REST via `expressConnectMiddleware` (MINCRM-377).

- **Proto:** `server/src/grpc/proto/audit.proto` — `ListAuditEvents` (unary) + `StreamAuditEvents` (server-streaming)
- **Generated:** `shared/generated/audit_pb.ts` + `audit_connect.ts` — committed. Regenerate with `npm run generate:proto`.
- **Server:** `server/src/grpc/auditConnectService.ts`. Auth reads JWT from httpOnly cookie or `Authorization: Bearer`.
- **Client:** `client/src/grpc/auditClient.ts` — `@connectrpc/connect-web`. Cookie auth forwarded automatically on same-origin.
- **Mounting:** `expressConnectMiddleware({ routes: registerAuditService, requestPathPrefix: '/api' })` in `app.ts`, before REST routes.
- **Audit event bus:** `services/auditEventBus.ts` subscribes to `audit_events` pg channel. `auditEventBus.start(pool)` called in `server.ts` before HTTP bind; shuts down on SIGTERM.
- **E2E:** `qa/e2e/apps/minicrm/grpc/auditGrpcClient.ts` — Connect JSON POST to `E2E_API_URL` with `Authorization: Bearer <jwt>`.

---

## Log Table Retention Policies (MINCRM-522)

Purged daily at 02:00 by `runRetentionPurge()` in `retentionService.ts` (scheduled via `node-cron`).

| Table                   | Retention | Timestamp column | Condition                               |
| ----------------------- | --------- | ---------------- | --------------------------------------- |
| `automation_rule_logs`  | 90 days   | `triggered_at`   | all rows                                |
| `webhook_delivery_logs` | 30 days   | `delivered_at`   | all rows                                |
| `import_jobs`           | 180 days  | `created_at`     | `status IN ('complete', 'failed')` only |

In-progress import jobs are never purged. `sequence_enrollment_logs` is retained indefinitely.

### Autovacuum tuning (migration 082)

`automation_rule_logs` and `webhook_delivery_logs` use `autovacuum_vacuum_scale_factor = 0.05` (vs. PG default 0.2) to handle burst writes.

### `automation_rule_logs.triggering_record_type` valid values (MINCRM-516)

`'deal'` and `'contact'`. Enforced via `AutomationTriggerContext` type and `z.enum(['deal', 'contact'])`. No DB CHECK — valid values evolve; a column comment (migration 083) documents them for DBA inspection.

---

## Known Architectural Constraints

- **Automation is fire-and-forget:** always `void fireAutomationTrigger(...)`, never `await`.
- **Dual contact address storage:** inline fields on `contacts` (migration 024) and `contact_addresses` (migration 030) coexist. New address work uses `contact_addresses`.
- **`seed-demo.ts` is a thin CLI wrapper only.** All demo fixture data lives in `demoService.ts`.
- **`BreakpointContext` is the single source of responsive state (MINCRM-238).** Use `useBreakpoint()` — never `window.matchMedia` directly in a component.
- **Custom fields (EAV) have a documented query ceiling (ADR-002, MINCRM-524).** Type-aware filtering, cross-field queries, and sorting are O(n) at scale. Read ADR-002 before any SQL on custom fields.

---

## Architectural Decisions (MINCRM-530)

ADRs in `docs/adr/`. Reference them in migration comments and PR descriptions.

| ADR                                                    | Decision summary                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-001](docs/adr/001-single-org-no-multi-tenancy.md) | Single-org CRM; no `org_id`. Multi-tenancy would require schema changes to 37 tables.                                                                               |
| [ADR-002](docs/adr/002-custom-fields-eav-vs-jsonb.md)  | Custom fields use EAV. Type-aware filtering and sorting cannot use B-tree indexes. Migrate to JSONB when AI filtering is implemented or latency exceeds thresholds. |

---

## Schema Conventions (MINCRM-512)

### Lead conversion — `last_name` required at conversion boundary (MINCRM-507)

`leads.last_name` is nullable; `contacts.last_name` is NOT NULL. The `convertLeadSchema` enforces
`last_name` as required at the conversion boundary so the mismatch is caught with a clean 400 error
before reaching the `contacts` INSERT. Do not add a `?? ''` fallback — an empty string would pass
the DB constraint but is semantically wrong data.

### `varchar + CHECK` over PostgreSQL ENUMs

Use `varchar(N) + CHECK` for all new constrained-string columns. Do **not** introduce new PostgreSQL ENUM types — they cannot be rolled back within a transaction and require `ALTER TYPE ... ADD VALUE` to extend.

**Grandfathered ENUM columns** (activities table, migrations 006/010 — do not add new values):

| Column                 | ENUM type            | Valid values                               |
| ---------------------- | -------------------- | ------------------------------------------ |
| `activities.type`      | `activity_type`      | `Note`, `Call`, `Email`, `Meeting`, `Task` |
| `activities.status`    | `activity_status`    | `open`, `complete`                         |
| `activities.direction` | `activity_direction` | `Inbound`, `Outbound`                      |

---

## Polymorphic FK Pattern (MINCRM-510)

Five tables use `(type, id)` discriminator pairs instead of typed FK columns. Reference integrity is enforced at the application layer.

| Table                 | Type column                        | Valid type values                    | Orphan cleanup?         |
| --------------------- | ---------------------------------- | ------------------------------------ | ----------------------- |
| `attachments`         | `record_type`                      | `contact`, `account`, `deal`, `lead` | Yes — required          |
| `custom_field_values` | _(via definition's `entity_type`)_ | `contact`, `account`, `deal`         | Yes — required          |
| `notes`               | `entity_type`                      | `contact`, `account`, `deal`, `lead` | Yes — required          |
| `gdpr_deletion_log`   | `record_type`                      | any erasable entity type             | No — retained by design |
| `audit_log`           | `record_type`                      | see migration 076                    | No — retained by design |

When hard-deleting a parent entity, clean up polymorphic dependents inside the same transaction:

- `attachments`: delete the object-storage file (by `storage_key`) first, then delete the row
- `custom_field_values`: delete rows before the parent DELETE
- `notes`: soft-delete (set `deleted_at = now()`) via `softDeleteNotesByEntity(client, entityType, entityId)` from `noteService.ts` — do NOT hard-delete notes, to preserve audit history (MINCRM-523)

`audit_log` and `gdpr_deletion_log` rows are **retained intentionally** for compliance traceability.

Orphan detection SQL for DBA diagnostics: see `docs/adr/` or run targeted `NOT EXISTS` queries joining each type column to its parent table.

---

## Pre-PR Self-Review Checklist

- [ ] **Sibling consistency** — i18n keys in all 5 locale files; fix applied to all sibling pages; `data-testid` on all counterparts
- [ ] **Dead code removed** — unused i18n keys, imports, declared-but-never-read vars
- [ ] **Audit entries present** — every CREATE/UPDATE/DELETE has `writeAuditEntry` in the same transaction
- [ ] **Assignment notification fired** — if `owner_id` changed, `queueAssignmentNotification` called after commit (not awaited)
- [ ] **DB errors mapped** — 23505 → 409 with domain code; 23503 → 400/409; others → 500
- [ ] **Pure updater functions** — `setState(updater)` has no side effects (fire twice in StrictMode)
- [ ] **No-op guard** — active-state control re-click is a no-op
- [ ] **Focus management** — modals/drawers move focus in on open, restore on close
- [ ] **RTL-safe classes** — logical properties used, not physical directional classes
- [ ] **Loading / error / empty states** — all three handled explicitly for every async component
- [ ] **Feature flag considered** — gated or documented as always-on
- [ ] **User docs updated** — `docs/user-guide/`, `docs/admin-guide.md`, `index.md` entry, feature-flag callout
- [ ] **Screenshots updated** — `docs/screenshots/` via `scripts/screenshot.ts`; README checked
- [ ] **E2E spec present** — story AC covered by at least one `@functional` test
- [ ] **Visual regression** — `checkScreenshot()` added/updated for complex visual surfaces
- [ ] **OpenAPI spec** — `npm run lint:api` passes after any endpoint change
- [ ] **Framework coverage** — `npm run test:framework:coverage --workspace=minicrm-qa` ≥ 80% if `qa/e2e/framework/` touched
- [ ] **Framework purity** — `bash qa/scripts/check-framework-purity.sh` if `qa/e2e/framework/` touched
- [ ] **Behavior layer** — `bash qa/scripts/check-behavior-layer.sh` if `qa/e2e/tests/` touched
- [ ] **Settings mutations** — `bash qa/scripts/check-settings-mutations.sh` if any spec mutates settings
- [ ] **Roles & Capabilities** - CRUD operations are scoped appropriately for least priveledge

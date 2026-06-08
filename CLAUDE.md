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

audit_log                              ← append-only; DB-enforced
  record_type   record_id nullable   record_name nullable   event_type
  field_name nullable   old_value nullable   new_value nullable
  changed_by_id nullable   changed_by_name nullable

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
  ⚠ Unique constraint assumption: safe only while all record_ids are gen_random_uuid() UUIDs.
    Re-imports always receive a new UUID, so an erased record can never reappear with the same
    record_id. If deterministic external IDs are ever introduced this constraint must be
    revisited — a re-import of a previously erased record followed by a second erasure would
    fail with a 23505 unique violation. See migration 084. (MINCRM-517)

audit_log.event_type also includes: note_created, note_updated, note_deleted, gdpr_erasure
audit_log.record_type also includes: lead
attachments.record_type also includes: lead
contacts/accounts/deals/leads also have: version integer  (optimistic locking, migration 048)

audit_log_after_insert trigger (migration 052) → pg_notify('audit_events', row JSON)
  Used by auditEventBus.ts to stream real-time events over gRPC ServerStream

feature_flags.role_overrides (jsonb, nullable)
  ⚠ Transitional column: stores per-role enable/disable overrides with keys constrained to
    valid role names ('admin', 'rep') and boolean values. MINCRM-487 will introduce first-class
    user-level override and rollout-rule tables that will supersede this column. Once that
    epic ships, role_overrides will be dropped. See migration 089 and featureFlagSchema.ts.
    The service-layer guard in featureFlagService.ts (assertValidRoleOverrides) enforces the
    shape independently of Zod; do not bypass it. (MINCRM-511)
```

**Migration rules:** Never modify an existing migration once it has been applied to any
environment — write a new corrective migration instead. Every migration needs both `up`
and `down`; the `down` must genuinely reverse the `up`, not a stub placeholder. Integrity
rules go in DB CHECK constraints in addition to Zod.

---

## Security — Required on Every Authenticated Endpoint

### 1. Auth middleware (`authenticate`)

Verifies on every authenticated request: JWT signature + expiry, `user.status === 'active'`,
and `must_change_password` (→ 403 `PASSWORD_CHANGE_REQUIRED` for all routes except
`/api/auth/change-password`). `authenticate` is regular middleware — every `await` inside
must be in a try/catch that calls `next(err)`. `asyncHandler` covers route handlers only.

### 2. Startup guards

Both guards must run before the server binds to its port:

- Reject weak `JWT_SECRET` (empty string, `changeme`, `secret`, `password`, or < 32 chars).
- Reject absent or malformed `NODE_ENCRYPTION_KEY` (must be a 64-character hex string).
  Required for file storage, SMTP password, and AI API key encryption at rest.

### Encryption key rotation (MINCRM-519)

`cryptoService.ts` exposes a versioned keyring API (`encryptVersioned` / `decryptVersioned`).
`ai_configuration.api_key_key_version` and `smtp_configuration.pass_key_version` record
which key version encrypted each secret so the correct key is used on decrypt.

**Keyring environment variables:**

- `NODE_ENCRYPTION_KEY` — always key version 1 (backward-compatible name)
- `ENCRYPTION_KEY_V2`, `ENCRYPTION_KEY_V3`, … — higher key versions (each 64-char hex)
- `CURRENT_ENCRYPTION_KEY_VERSION` — controls which version is used for **new** encryptions; defaults to 1

**To rotate keys:**

1. Set `ENCRYPTION_KEY_V2` to a new 64-char hex key and `CURRENT_ENCRYPTION_KEY_VERSION=2`; redeploy.
2. Run `npm run key-rotate` (see `docs/admin-guide.md`) to re-encrypt all existing secrets with V2
   and update the `_key_version` columns in DB.
3. Once all rows are on V2, the V1 key variable can be removed.

The unversioned `encrypt` / `decrypt` functions in `cryptoService.ts` are kept for backward
compatibility with `system_settings.file_storage_secret` (MINCRM-169); new secrets must use
the versioned API.

### 3. Ownership on PATCH / DELETE

```ts
// CORRECT — use req.user.id from middleware, never trust req.body
WHERE id = $1 AND (owner_id = $2 OR $3 = 'admin')
// params: [recordId, req.user.id, req.user.role]
```

Never accept `owner_id` from the request body.

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
The `E2E=true` env var bypasses the limiter for test runners only.

---

## Architecture Rules

- **Services own all DB access.** `pool.query()` belongs exclusively in `server/src/services/`.
- **Controllers shape requests/responses only.** No business logic. No `pool.query()`.
- **Zod validation in controllers, before every service call.** Use `.safeParse()`; return
  400 on failure: `{ error: { code: 'VALIDATION_ERROR', message: errors[0].message } }`.
- **All async route handlers** wrapped in `asyncHandler` or explicit try/catch.
- **Error shape always:** `{ error: { code: string, message: string } }` — where `code` is a
  SCREAMING_SNAKE_CASE domain constant (e.g. `CONTACT_EMAIL_DUPLICATE`, `DEAL_STAGE_NOT_FOUND`),
  never a generic freeform string.
- **HTTP status codes:** 400 validation, 401 unauthenticated, 403 forbidden, 404 not found,
  409 conflict.
- **Map PostgreSQL error codes explicitly.** Catch `pg` errors by `err.code` in services:
  - `23505` (unique violation) → throw with a domain-specific code; controller returns 409
  - `23503` (FK violation) → 400 or 409 depending on context
  - All other DB errors propagate as 500
- **No N+1 queries.** List endpoints must join or batch-load associated data — never issue a
  per-row query inside a loop.
- **`async/await` only.** Never `.then()` chains.
- **`no-explicit-any` enforced.** Fix the type; never suppress with `any` or `@ts-ignore`.
- **Non-null assertion (`!`) and type assertions (`as`)** require an inline comment explaining
  why the narrowing is safe. Never use them to silence a compiler error.
- **Service functions must declare explicit return types** — do not rely solely on inference
  for public service function signatures.
- **No `console.log` in `server/src/`** outside test files. Use `logger.info/warn/error`.
- **No magic numbers or magic strings.** Use named constants.

---

## Required Patterns for Write Operations

### Transactions with audit logging

Every CREATE / UPDATE / DELETE on user data **must** write an audit entry in the **same
transaction**. A failed audit write rolls back the data change and vice versa.

```ts
const client: PoolClient = await pool.connect();
try {
  await client.query('BEGIN');

  const result = await client.query<Row>(
    `INSERT INTO contacts (...) VALUES (...) RETURNING ...`,
    [...values],
  );
  const record = result.rows[0];

  await writeAuditEntry(client, {    // ← SAME client, SAME transaction
    recordType: 'contact',
    recordId: record.id,
    recordName: `${record.first_name} ${record.last_name}`,
    eventType: 'created',
    changedById: actor.id,
    changedByName: actor.name,
  });

  await client.query('COMMIT');

  // Fire-and-forget AFTER commit — never inside the transaction
  void fireAutomationTrigger('contact_created', { ... });
  return record;
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

For UPDATE: `diffFields(before, after, auditBase)` generates per-field entries;
`writeAuditEntries(client, entries)` writes them all in one batch. See `dealService.ts`.

### AuditActor pattern (required on all write service functions)

```ts
export interface AuditActor { id: string; name: string; }
const SYSTEM_ACTOR: AuditActor = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'System',
};

export async function createContact(
  params: CreateContactInput & { owner_id: string },
  actor: AuditActor = SYSTEM_ACTOR,  // default for tests / seeding
): Promise<ContactRow> { ... }
```

Controller extracts the actor from `req.user`:

```ts
const actor = { id: req.user.id, name: req.user.name };
```

### Assignment notifications (after commit, fire-and-forget)

When `owner_id` changes on any record, notify the new owner AFTER the commit.
Do NOT `await` it. Do NOT call it inside the transaction.

```ts
if (params.owner_id && params.owner_id !== before.owner_id) {
  const newOwner = await findUserById(params.owner_id);
  if (newOwner) {
    queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
      recordType: 'contact',
      recordId: record.id,
      recordName: `${record.first_name} ${record.last_name}`,
      assignedByName: actor.name,
    });
  }
}
```

`queueAssignmentNotification` is synchronous (returns `void`). Do NOT `await` it.

### Automation triggers (always `void`, never `await`)

```ts
void fireAutomationTrigger('deal_stage_changed', {
  recordId: deal.id,
  recordType: 'deal',
  ownerId: deal.owner_id,
  newStage: deal.stage,
});
```

`fireAutomationTrigger` swallows all internal errors and logs them. Each rule runs in its
own isolated try/catch so a failing rule never aborts the triggering operation.

---

## New Endpoint Checklist

- [ ] Route file: `@openapi` JSDoc + `asyncHandler` only — zero logic, zero service imports
- [ ] Controller: Zod `.safeParse()` before service call; no `pool.query()`
- [ ] Pagination: use `paginationParamsSchema` from `shared/schemas/paginationSchema.ts`
- [ ] Sort params: allowlist-validated before SQL interpolation
- [ ] Admin-only routes: `requireRole('admin')` on the route
- [ ] Feature flag gate: does this endpoint expose a feature that should be toggleable?
      If yes, add `requireFeatureEnabled('flag_key')` and add/update the flag in migration 066. If no, document why not (always-on core auth/infra routes are exempt).
- [ ] PATCH/DELETE: ownership enforced in the WHERE clause
- [ ] Write operations: audit entry in same transaction as data change
- [ ] Assignment notification fired if `owner_id` changed (after commit, not awaited)
- [ ] DB errors mapped: 23505 → 409 with domain code; 23503 → 400/409; others → 500
- [ ] Standard error shape `{ error: { code, message } }` on all failure paths
- [ ] Service-layer unit test covering the new function, including ownership enforcement
- [ ] Functional E2E spec updated or added for the new behaviour
- [ ] OpenAPI spec passes `npm run lint:api --workspace=minicrm-server`

---

## Pipeline Stages — Dynamic, Not Hardcoded

Stages live in `pipeline_stages` and are admin-configurable (MINCRM-180).
`PIPELINE_STAGES` from `dealSchema.ts` is a **bootstrap fallback only**.

**Client:** fetch via `GET /api/settings/pipeline-stages` at app startup, cache with
`PIPELINE_STAGES_QUERY_KEY`. Stage selectors must use the live list.

**Server:** validate `stage` as a non-empty string at Zod level, then verify against the
`pipeline_stages` table in the service. Do not re-introduce a Zod `.enum()` on a fixed list.

---

## Multi-Currency

`deals.currency` is `varchar(3) NOT NULL DEFAULT 'USD'`. Valid values are defined in
`SUPPORTED_CURRENCIES` from `shared/schemas/settingsSchema.ts`. When creating a deal without
an explicit currency, resolve the default via `await getDefaultCurrency()` from
`settingsService`. Format currency with `Intl.NumberFormat` using the deal's own `currency`
field and the active i18n locale — never hardcode `'USD'` in formatting logic.

---

## Internationalization

- All user-facing strings use `t('key')` — **no hardcoded English in JSX**
- Locales: `en`, `zh-Hans`, `es`, `fr`, `de`; `eslint-plugin-i18next` enforces this in CI
- Pipeline stage display names: use `PIPELINE_STAGE_I18N_KEY` util then `t()`
- **RTL — logical CSS properties required for ALL new layout classes:**
  - `ps-` / `pe-` not `pl-` / `pr-`
  - `ms-` / `me-` not `ml-` / `mr-`
  - `start-` / `end-` not `left-` / `right-`
  - `text-start` / `text-end` not `text-left` / `text-right`

---

## Testing

### Server (`server/src/__tests__/`)

- **Framework:** Vitest against real PostgreSQL `minicrm_test` DB — no mocking of `pool`
- **Run:** `npm test --workspace=minicrm-server`
- **Isolation:** `beforeEach` truncates relevant tables; fixtures in `beforeAll`/`afterAll`
- **Coverage threshold:** 80% on `server/src/services/` (CI-enforced)
- **Controller tests:** `supertest` against `app` with `makeAuthCookie()`

Required test files beyond core CRUD: `auth-boundaries.test.ts` (rep → admin endpoints → 403;
rep A → rep B's records → 403/404), `auditService.test.ts` (entries written in transaction;
append-only enforced), `notificationService.test.ts` (overdue digest dedup; assignment batch).

### Client (`client/src/`)

- **Framework:** Vitest + React Testing Library + MSW
- **Run:** `npm test --workspace=minicrm-client`
- **MSW setup:** `onUnhandledRequest: 'error'` — any unhandled API call in a test throws.
  Add a handler before calling the API, or the test fails.
- **Test helper:** `renderWithProviders()` from `src/test/renderWithProviders.tsx`
- **File location:** `Component.test.tsx` co-located with `Component.tsx`
- **Coverage thresholds:** 70% lines; 80% branches (CI-enforced)
- **Every component with async data must test all three states explicitly:**
  loading (skeleton or spinner visible), error (error message visible), and empty
  (intentional empty-state UI, not just nothing rendering). A missing state is an
  incomplete test, not a judgement call.
- Every conditional render branch needs a dedicated test case.

### ⛔ Definition of Done — Required Before ANY `git commit`

> **"Before pushing" means "before committing." Do not commit until all four steps are green.**
> There are no scope exceptions. "Only QA files changed" is not an exception — it makes E2E _more_ critical, not less.

Complete these steps in order. Stop at the first failure and fix it before continuing.

```bash
# Step 1 — typecheck (all workspaces)
npm run typecheck --workspace=minicrm-client
npm run typecheck --workspace=minicrm-server
npm run typecheck --workspace=minicrm-qa
cd qa && npx tsc --noEmit   # qa/ is excluded from root typecheck

# Step 2 — lint
npm run lint

# Step 3 — unit tests (changed workspaces only)
npm test --workspace=minicrm-server   # if server/ changed
npm test --workspace=minicrm-client   # if client/ changed

# Step 4 — QA static checks (when qa/ files changed)
bash qa/scripts/check-framework-purity.sh   # if qa/e2e/framework/ changed
bash qa/scripts/check-behavior-layer.sh     # if qa/e2e/tests/ changed
bash qa/scripts/check-settings-mutations.sh # if any spec mutates system settings

# Step 5 — E2E functional suite (ALWAYS — no scope exceptions)
# Delete stale results first, then run once, then read results.xml.
rm -rf qa/e2e/test-results/
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) npm run test -- --grep @functional
```

**All steps green → `git commit` → `git push`.  
Any step red → fix the code, then restart from Step 1.**

The E2E suite requires the application to be running locally. The Vite dev server (port 5173),
the dedicated E2E app server (port 3002), and the supporting services (MinIO, Mailhog) must
all be up before invoking the command. Start the e2e Compose profile, start the Vite dev
server with the E2E API target, and run `npm run e2e:setup` if you have not done so this
session.

#### E2E session setup (once per session, not before every push)

The e2e Compose profile starts the dedicated E2E app server (port 3002, `DB_NAME=minicrm_e2e`),
MinIO, and Mailhog. `E2E_API_URL` in `qa/e2e/.env` must be `http://localhost:3002` so that
Playwright targets this server and never touches the main `minicrm` database.
`E2E_BASE_URL` must be `http://localhost:5173` (the Vite dev server, which proxies to port 3002).
(MINCRM-317, MINCRM-318, MINCRM-330)

```bash
# Start server-e2e, MinIO + Mailhog via the e2e Compose profile (once per session)
docker compose -f docker-compose.dev.yml --profile e2e up -d

# Create minicrm_e2e DB, run migrations, seed admin user, create MinIO bucket,
# and seed storage config into system_settings (once per session)
npm run e2e:setup

# Start the Vite dev server proxying to the E2E app server (once per session,
# in a separate terminal). The E2E_BASE_URL=http://localhost:5173 in qa/e2e/.env
# requires this; using http://localhost:80 (nginx) routes API calls to the main
# server and minicrm DB, not the E2E server and minicrm_e2e DB.
API_URL=http://localhost:3002 npm run dev --workspace=minicrm-client
```

`npm run e2e:setup` is idempotent — re-running it in the same session is safe. You only
need to run it again if you restart the Docker services or wipe your database.

### E2E Functional Suite — Execution Rules

> **THIS DIRECTIVE EXISTS BECAUSE IT HAS BEEN VIOLATED REPEATEDLY.** Read it in full.

**RULE 1 — One run per code change, no re-runs to paper over failures.**
If it fails, fix the code — that fix is a new code change, so running again after the fix is correct. Never re-run the suite on the same code to see if a failure goes away. If a run fails and you have not made a code change, read the report files and diagnose — do not re-run.

**RULE 2 — Read report files, not console output, for results.**

- `qa/e2e/test-results/results.xml` — JUnit XML; check `tests`, `failures`, `errors`
- `qa/e2e/test-results/healing-report.json` — heal event counts and detail

**RULE 3 — Delete stale results before each run.**
Delete `qa/e2e/test-results/` before starting so stale output cannot influence pass/fail.

### E2E Locator Authoring Requirements

Every page object locator must follow all four of these rules without exception.

**Rule 1 — Primary strategy is always `testId`.** Never use CSS class selectors
(`.btn-primary`) or positional selectors (`nth-child`) as any strategy.

**Rule 2 — Every page object `locate()` call requires at least two strategies.** The
testId is primary; add a role, label, text, or css-attribute fallback so the healing
framework has a recovery path when the testId is absent or renamed. Spec-layer inline
locates for dynamically-scoped IDs (e.g. `deal-card-${id}`) may use a single testId
strategy only when no stable role-based alternative exists, with a comment explaining why.

**Rule 3 — Every page object `locate()` call requires an `intent` string.** The `intent`
is a 5–10 word natural-language description of what the locator is finding. It activates
the AI healing tier when all static strategies are exhausted. Omitting it leaves the
framework unable to recover from `StrategyExhaustedError`.

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

// WRONG — single strategy, no intent
const button = await this.page.locate([{ type: 'testId', value: 'new-contact-button' }]).resolve();
```

**Rule 4 — Never `page.waitForTimeout()` in page objects.** Fixed delays are fragile
under CI resource contention. Use DOM-state waits instead: `locator.waitFor({ state })`,
`page.waitForLoadState()`, or `page.waitForFunction()`. The only acceptable use of
`waitForTimeout` is in a spec file to simulate a deliberate user-perceived pause.

### E2E Conventions

- **Config:** `qa/e2e/playwright.config.ts`
- **Dedicated `minicrm_e2e` DB**, managed per-test via TestDataManager
- **Tags:** every test must be tagged `@functional`; smoke-level tests also `@smoke`
- **Spec location:** `qa/e2e/tests/apps/minicrm/functional/<domain>/<domain>.spec.ts`
- **New spec files under `functional/` are picked up by CI automatically** — no CI changes needed
- **Framework layer must have zero app-domain strings** — enforced by `check-framework-purity.sh`
- **Specs must only import from `@behaviors/*`, `@apps/*`, `@framework/*`** — never directly
  from `@pages/*`. Enforced by `check-behavior-layer.sh`.
- **Tests that mutate system settings** must call `ensureSystemDefaults()` for cleanup.
  Enforced by `check-settings-mutations.sh`.
- **No `loginAsAdmin` in `test.beforeAll`** — pre-auth is handled by global `storageState` in
  `playwright.config.ts`. Call `loginAsAdmin(restClient)` at the start of the test body instead.
- **Feature flag state is controlled exclusively via `withFlags()` route interception**
  (`qa/e2e/apps/minicrm/helpers.ts`). Never toggle flag state via `PATCH /api/admin/feature-flags/:key`
  or direct DB mutation in tests. Call `withFlags(page, overrides)` before `page.goto()` so the
  handler is registered before the first flag fetch. Flag state is scoped to the browser context
  and is parallel-safe. (MINCRM-477)
- **Every story must include or update a functional E2E spec.** Do not mark a ticket done
  without E2E coverage for the new behaviour.

---

## React & Frontend Conventions

### `data-testid` Conventions

Every interactable element needs a `data-testid`. Patterns:

- Static: `data-testid="new-contact-button"`, `data-testid="pipeline-board"`
- Row-scoped: `data-testid={\`contact-card-${contact.id}\`}`
- Action+entity: `data-testid="contacts-export-csv-button"`

### React Query Conventions

Every API module exports a typed query key constant:

```ts
export const CONTACTS_QUERY_KEY = ['contacts'] as const;
```

Use these constants everywhere — never inline strings in `queryKey`.

`staleTime` rules: `GET /api/users/active` → `staleTime: 5 * 60 * 1000` (called frequently);
dashboard summary → `staleTime: 0` (always fresh). No global `staleTime` on the QueryClient.

### Intrinsic Responsive Design (MINCRM-208)

For any UI displaying variable-length or numeric content: fluid font sizes on large values
(`clamp(1.25rem,3vw,2rem)`), `min-w-0` on flex children that contain text, `break-words`
on all freetext fields. Test at 600px, 900px, and 1100px — not just mobile and full desktop.
Leave a comment on any non-obvious `min-w-0` or `clamp()` for future maintainers.

---

## gRPC / ConnectRPC Layer

`server/src/grpc/` contains the ConnectRPC service mounted directly on the Express app (MINCRM-377).
No separate gRPC port — the AuditService is served on the same port as REST via `expressConnectMiddleware`.

- **Proto:** `server/src/grpc/proto/audit.proto` — defines `AuditService` with two RPCs:
  - `ListAuditEvents` (unary) — paginated query of the `audit_log` table
  - `StreamAuditEvents` (server-streaming) — live stream via PostgreSQL LISTEN/NOTIFY
- **Generated:** `shared/generated/audit_pb.ts` and `audit_connect.ts` — committed to the repo.
  Regenerate with `npm run generate:proto` (requires `@bufbuild/buf`).
- **Server implementation:** `server/src/grpc/auditConnectService.ts` — ConnectRPC handler.
  Auth reads JWT from the httpOnly cookie (same as REST) or `Authorization: Bearer` header.
- **Client:** `client/src/grpc/auditClient.ts` — `@connectrpc/connect-web` gRPC-Web transport.
  Cookie auth is forwarded automatically on same-origin requests — no JS token access needed.
- **Mounting:** `expressConnectMiddleware({ routes: registerAuditService, requestPathPrefix: '/api' })`
  in `app.ts`. Mounted before REST routes so Connect/gRPC-Web requests are intercepted first.
- **Audit event bus:** `services/auditEventBus.ts` subscribes to the `audit_events` pg channel
  (fired by `audit_log_after_insert` trigger). Exposes `asyncIterator(signal)` for `for-await` use.
- **Lifecycle:** `auditEventBus.start(pool)` is called in `server.ts` before the HTTP server binds.
  Shut down gracefully on SIGTERM.
- **E2E:** `qa/e2e/apps/minicrm/grpc/auditGrpcClient.ts` — calls ListAuditEvents via the Connect
  protocol (JSON POST over HTTP/1.1) to `E2E_API_URL`. Uses `Authorization: Bearer <jwt>` header.
  The framework `grpcClient` fixture is still available but not used by the audit E2E tests.

---

## Log Table Retention Policies (MINCRM-522)

Append-only log tables are purged daily at 02:00 by `runRetentionPurge()` in
`server/src/services/retentionService.ts`, scheduled via `node-cron` in `server.ts`.

| Table                   | Retention window | Timestamp column | Condition                               |
| ----------------------- | ---------------- | ---------------- | --------------------------------------- |
| `automation_rule_logs`  | 90 days          | `triggered_at`   | all rows                                |
| `webhook_delivery_logs` | 30 days          | `delivered_at`   | all rows                                |
| `import_jobs`           | 180 days         | `created_at`     | `status IN ('complete', 'failed')` only |

In-progress import jobs (`status = 'pending'` or `'running'`) are never purged regardless of age.

`sequence_enrollment_logs` receives a time-range index in migration 082 (`executed_at`) but has no
retention purge — enrollment logs are retained indefinitely as they are sparse and bounded by
enrollment lifetime. Revisit if table growth becomes a concern.

### Autovacuum tuning for burst-write tables

Tables that receive bursts of writes during automation runs use a tighter autovacuum
scale factor to prevent dead-tuple bloat building up between vacuum cycles.
Applied in migration 082:

| Table                   | `autovacuum_vacuum_scale_factor` | Reason                                        |
| ----------------------- | -------------------------------- | --------------------------------------------- |
| `automation_rule_logs`  | 0.05                             | Burst writes during automation rule execution |
| `webhook_delivery_logs` | 0.05                             | Burst writes during webhook delivery attempts |

All other tables use the PostgreSQL default of 0.2.

### `automation_rule_logs.triggering_record_type` valid values (MINCRM-516)

Valid values are `'deal'` and `'contact'`. Enforced at the service layer via the
`AutomationTriggerContext` type in `server/src/services/automationService.ts` and the
`z.enum(['deal', 'contact'])` in `shared/schemas/automationSchema.ts`.

No DB CHECK constraint is used — following the same rationale as `audit_log.record_type`
(migration 076): valid values evolve with new trigger entity types, and per-addition
migrations solely to amend a CHECK constraint create unnecessary churn.
A column comment (migration 083) documents the valid values for DBA inspection.

---

## Known Architectural Constraints

- **Automation is fire-and-forget:** always `void fireAutomationTrigger(...)`, never `await`.
- **Dual contact address storage:** inline fields on `contacts` (migration 024) and the
  `contact_addresses` table (migration 030) coexist. New address work uses `contact_addresses`.
- **`seed-demo.ts` is a thin CLI wrapper only.** All demo fixture data lives in
  `demoService.ts`. The CLI must contain no fixture data or SQL.
- **`BreakpointContext` is the single source of responsive state (MINCRM-238).** All
  components read breakpoints via `useBreakpoint()` — never call `window.matchMedia`
  directly in a component (creates duplicate subscriptions that break in jsdom).
- **Custom fields (EAV) have a documented query ceiling (ADR-002, MINCRM-524).** Type-aware
  filtering (`CAST(value AS numeric)`), cross-field queries (self-joins on
  `custom_field_values`), and custom-field sorting cannot use B-tree indexes and are O(n)
  at scale. Any code generating SQL on custom fields — especially the AI query layer
  (MINCRM-419) — must read ADR-002 before implementation.

---

## Architectural Decisions (MINCRM-530)

Significant, cross-cutting decisions are recorded as Architecture Decision Records (ADRs)
in `docs/adr/`. Each ADR captures the context, the decision, and the accepted tradeoffs.
Reference the relevant ADR in migration comments and PR descriptions when a decision
directly influences the code being written.

| ADR                                                    | Decision summary                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-001](docs/adr/001-single-org-no-multi-tenancy.md) | MiniCRM is a single-org CRM. No `org_id` in the schema. `owner_id` provides intra-org isolation; `is_demo` flag handles demo data. Adding multi-tenancy would require schema changes to all 37 entity tables — estimated 1–2 sprint weeks. Revisit only if organizational data isolation is required. |
| [ADR-002](docs/adr/002-custom-fields-eav-vs-jsonb.md)  | Custom fields use EAV (`custom_field_definitions` / `custom_field_values`). Type-aware filtering, cross-field queries, and custom-field sorting cannot use B-tree indexes. Migrate to JSONB when AI filtering on custom fields is actively implemented or query latency exceeds defined thresholds.   |

---

## Schema Conventions (MINCRM-512)

### Constrained-string columns: `varchar + CHECK` over PostgreSQL ENUMs

**Standard:** Use `varchar(N) + CHECK` for all new constrained-string columns going
forward. Do **not** introduce new PostgreSQL ENUM types.

**Rationale:**

- `varchar + CHECK` is easier to evolve: adding a new valid value requires only a new
  migration with an `ALTER TABLE ... DROP CONSTRAINT` / `ADD CONSTRAINT` pair. PostgreSQL
  ENUMs require `ALTER TYPE ... ADD VALUE`, which cannot be rolled back within a
  transaction and cannot be used inside a transaction on older PostgreSQL versions.
- The vast majority of constrained-string columns in MiniCRM already use `varchar + CHECK`
  (e.g. `leads.status`, `sequence_enrollments.status`, `custom_reports.visibility`,
  `pipeline_stages.name`). Consistency reduces cognitive friction for migration authors.
- CHECK constraints are visible inline on the column definition and in `\d+ <table>` output
  without needing to query `pg_type`.

**Grandfathered ENUM columns:** The three PostgreSQL ENUM types from the activities table
(migrations 006 and 010) are left in place — converting them would require a non-trivial
multi-step migration with no functional benefit:

| Column                 | ENUM type            | Valid values                               |
| ---------------------- | -------------------- | ------------------------------------------ |
| `activities.type`      | `activity_type`      | `Note`, `Call`, `Email`, `Meeting`, `Task` |
| `activities.status`    | `activity_status`    | `open`, `complete`                         |
| `activities.direction` | `activity_direction` | `Inbound`, `Outbound`                      |

Do not add new values to these ENUM types; handle any extension by adding a separate
`varchar + CHECK` column instead.

---

## Polymorphic FK Pattern (MINCRM-510)

Five tables store references to parent CRM entities using a `(type, id)` discriminator
pair instead of a typed FK column. PostgreSQL FK constraints can only reference a single
parent table, so this pattern intentionally omits FK constraints. Reference integrity is
enforced at the application layer.

### Affected tables

| Table                 | Type column                        | Valid type values                       | Orphan cleanup?         |
| --------------------- | ---------------------------------- | --------------------------------------- | ----------------------- |
| `attachments`         | `record_type`                      | `contact`, `account`, `deal`, `lead`    | Yes — required          |
| `custom_field_values` | _(via definition's `entity_type`)_ | `contact`, `account`, `deal`            | Yes — required          |
| `notes`               | `entity_type`                      | `contact`, `account`, `deal`, `lead`    | Yes — required          |
| `gdpr_deletion_log`   | `record_type`                      | any erasable entity type                | No — retained by design |
| `audit_log`           | `record_type`                      | see migration 076 comment for full list | No — retained by design |

### Orphan accumulation

When a parent entity (contact, account, deal, lead) is hard-deleted, rows in the
polymorphic tables pointing at it are **not** automatically removed. The application
**must** delete dependent rows before or alongside the parent delete for the three
cleanup-candidate tables (`attachments`, `custom_field_values`, `notes`).

`audit_log` and `gdpr_deletion_log` rows for deleted records are **retained intentionally**
— they provide compliance and change-history traceability after the entity no longer exists.

### Orphan detection queries (for DBA maintenance / diagnostics)

```sql
-- Orphaned attachments (parent entity no longer exists)
SELECT a.id, a.record_type, a.record_id
FROM attachments a
WHERE a.record_type = 'contact' AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = a.record_id)
UNION ALL
SELECT a.id, a.record_type, a.record_id
FROM attachments a
WHERE a.record_type = 'account' AND NOT EXISTS (SELECT 1 FROM accounts ac WHERE ac.id = a.record_id)
UNION ALL
SELECT a.id, a.record_type, a.record_id
FROM attachments a
WHERE a.record_type = 'deal' AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.id = a.record_id)
UNION ALL
SELECT a.id, a.record_type, a.record_id
FROM attachments a
WHERE a.record_type = 'lead' AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = a.record_id);

-- Orphaned custom_field_values (entity row no longer exists)
-- Join to definition to resolve entity_type, then check the appropriate entity table.
SELECT cfv.id, cfd.entity_type, cfv.record_id
FROM custom_field_values cfv
JOIN custom_field_definitions cfd ON cfd.id = cfv.definition_id
WHERE cfd.entity_type = 'contact' AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = cfv.record_id)
UNION ALL
SELECT cfv.id, cfd.entity_type, cfv.record_id
FROM custom_field_values cfv
JOIN custom_field_definitions cfd ON cfd.id = cfv.definition_id
WHERE cfd.entity_type = 'account' AND NOT EXISTS (SELECT 1 FROM accounts ac WHERE ac.id = cfv.record_id)
UNION ALL
SELECT cfv.id, cfd.entity_type, cfv.record_id
FROM custom_field_values cfv
JOIN custom_field_definitions cfd ON cfd.id = cfv.definition_id
WHERE cfd.entity_type = 'deal' AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.id = cfv.record_id);

-- Orphaned notes (hard orphans — entity_id references a deleted parent)
-- Soft-deleted notes (deleted_at IS NOT NULL) are harmless but included here.
SELECT n.id, n.entity_type, n.entity_id
FROM notes n
WHERE n.entity_type = 'contact' AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = n.entity_id)
UNION ALL
SELECT n.id, n.entity_type, n.entity_id
FROM notes n
WHERE n.entity_type = 'account' AND NOT EXISTS (SELECT 1 FROM accounts ac WHERE ac.id = n.entity_id)
UNION ALL
SELECT n.id, n.entity_type, n.entity_id
FROM notes n
WHERE n.entity_type = 'deal' AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.id = n.entity_id)
UNION ALL
SELECT n.id, n.entity_type, n.entity_id
FROM notes n
WHERE n.entity_type = 'lead' AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = n.entity_id);
```

These queries are diagnostic only — no automated purge job exists for these tables.
For `attachments`, the physical object-storage file (identified by `storage_key`) must
be deleted from the object store before deleting the row.

---

## Pre-PR Self-Review Checklist

Real patterns from past findings on this repo:

- [ ] **Sibling consistency** — pattern applied to one instance applied to all siblings:
      i18n key added to `en.json` but not all five locale files; fix on ContactsPage but not
      AccountsPage or DealsPage; `data-testid` on one button but missing on its counterpart.
- [ ] **Dead code removed** — unused i18n keys, unused imports, declared-but-never-read vars.
- [ ] **Audit entries present** — every CREATE/UPDATE/DELETE has `writeAuditEntry` on the
      same client in the same transaction.
- [ ] **Assignment notification fired** — if `owner_id` changed, `queueAssignmentNotification`
      called after commit (not awaited, not inside the transaction).
- [ ] **DB errors mapped** — unique violations (23505) return 409 with a domain code; FK
      violations (23503) return 400/409; all other DB errors propagate as 500.
- [ ] **Pure updater functions** — `setState(updater)` functions have no side effects.
      Side effects in updaters fire twice in StrictMode.
- [ ] **No-op guard on interactive controls** — active-state control re-click is a no-op.
- [ ] **Focus management** — modals, inline forms, drawers move focus in on open and restore
      focus to the trigger on close.
- [ ] **RTL-safe classes** — logical properties used, not physical directional classes.
- [ ] **Loading / error / empty states** — every component with async data handles all three
      states explicitly; none are left implicit or missing.
- [ ] **Feature flag considered** — every new user-facing feature should either be gated by
      a `requireFeatureEnabled` middleware call (and have an entry in `feature_flags`) or have
      a documented reason why it is always-on (core auth, infra, admin-only config).
- [ ] **User docs updated** — if the change adds or modifies a user-facing feature, update
      or create the relevant page(s) in `docs/user-guide/` and `docs/admin-guide.md`.
      New navigable sections need an entry in `docs/user-guide/index.md`. Feature-flagged
      features need a callout naming the flag. New i18n `errors.*` codes need a plain-English
      explanation in the user guide where that error can surface.
- [ ] **Screenshots updated** — if the change modifies any user-visible UI, update
      `docs/screenshots/` via `scripts/screenshot.ts` and check `README.md` for stale
      descriptions.
- [ ] **E2E spec present** — story AC covered by at least one `@functional` test.
- [ ] **Visual regression** — if the change adds or modifies a visually complex surface
      (multi-column layout, data-dense table or chart, responsive breakpoint, admin tab),
      add or update a `checkScreenshot()` assertion in `visual-regression.spec.ts`.
- [ ] **OpenAPI spec** — `npm run lint:api` passes after any endpoint change.
- [ ] **Framework coverage** — if `qa/e2e/framework/` was touched, run
      `npm run test:framework:coverage --workspace=minicrm-qa` and confirm 80% threshold.
- [ ] **Framework purity** — if `qa/e2e/framework/` was touched, run
      `bash qa/scripts/check-framework-purity.sh` (CI gate; zero app-domain strings allowed).
- [ ] **Behavior layer** — if `qa/e2e/tests/` was touched, run
      `bash qa/scripts/check-behavior-layer.sh` (specs must not import directly from `@pages/*`).
- [ ] **Settings mutations** — if any spec calls `restClient.patch/put(.*settings`, run
      `bash qa/scripts/check-settings-mutations.sh` (mutation must pair with `ensureSystemDefaults()`).

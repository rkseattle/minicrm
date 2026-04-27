# MiniCRM — Claude Code Context

Minimal CRM validating the core sales loop: contact → deal → activity → pipeline.

---

## Stack

- **Client:** React + Vite, TanStack Query v5, React Router, Tailwind CSS, i18next
- **Server:** Node.js + Express + TypeScript, REST, Zod validation
- **DB:** PostgreSQL 16, node-pg-migrate
- **Auth:** JWT in httpOnly cookie (8-hour expiry)
- **Infra:** Docker + Docker Compose, npm workspaces (`/client`, `/server`, `/shared`, `/qa`)
- **Docs:** OpenAPI 3.0 via swagger-jsdoc, served at `/api-docs` (dev/staging only)

---

## Project Layout

```
server/src/
  routes/        → route definitions + @openapi JSDoc ONLY — no logic
  controllers/   → request/response shaping ONLY — no pool.query() calls
  services/      → ALL business logic + ALL database queries
  middleware/    → auth.ts (JWT verify + status check), requireRole.ts, asyncHandler.ts
  utils/         → csvUtils.ts, userUtils.ts

client/src/
  api/           → one Axios wrapper file per resource; exports typed fns + QUERY_KEY constants
  pages/         → full page components (one file per route)
  components/    → reusable UI pieces (forms, modals, timeline, etc.)
  hooks/         → custom React hooks (useAuth, etc.)
  test/          → MSW handlers, renderWithProviders, setup.ts

shared/schemas/  → Zod schemas imported by BOTH client and server
  contactSchema.ts, accountSchema.ts, dealSchema.ts, leadSchema.ts
  settingsSchema.ts  (SUPPORTED_LOCALES, NAV_LAYOUTS, SUPPORTED_CURRENCIES)
  paginationSchema.ts  (paginationParamsSchema, PaginatedResponse<T>)
  pipelineStageSchema.ts  (PipelineStageResponse, etc.)

db/migrations/   → sequential node-pg-migrate files; run `ls db/migrations/ | tail -1` to find the last migration and increment by one for the next file number

qa/e2e/
  framework/     → HealingLocator, fixtures, REST/gRPC clients (ZERO app domain refs)
  behaviors/minicrm/ → named async behavior fns (compose Page Objects, no assertions)
  pages/minicrm/ → Page Objects (UI interactions only)
  apps/minicrm/  → fixtures.ts, helpers.ts, test-data-manager.ts
  tests/apps/minicrm/functional/<domain>/ → spec files tagged @functional
```

---

## Database Schema

```
users
  id, email, password_hash, name, role(admin|rep), status(active|invited|inactive),
  must_change_password, preferred_language,
  notify_overdue_tasks, notify_assignments, notify_deal_stage_changes,
  password_reset_token, password_reset_expires

accounts
  id, name, industry, website, employee_range, revenue_range,
  account_type(Prospect|Customer|Partner|Vendor|Competitor|Other) nullable,
  parent_account_id uuid → accounts nullable,
  owner_id, is_demo, created_at, updated_at

contacts
  id, first_name, last_name, email, phone, title, department,
  address_line1, address_line2, city, state_region, postal_code, country,
  linkedin_url, twitter_x_url, other_url,
  account_id nullable, owner_id, source_lead_id nullable,
  is_demo, created_at, updated_at

contact_addresses                      ← one-to-many; prefer for new address work
  id, contact_id → contacts ON DELETE CASCADE,
  label, address_line1, address_line2, city, state_region, postal_code, country,
  is_default bool, created_at, updated_at
  UNIQUE PARTIAL INDEX on (contact_id) WHERE is_default = true

deals
  id, name, stage text (validated against pipeline_stages table at runtime),
  value numeric(15,2), currency varchar(3) NOT NULL DEFAULT 'USD',
  probability integer nullable (0–100 override; NULL = inherit from stage default),
  close_date, loss_reason, account_id nullable, owner_id,
  source_lead_id nullable, is_demo, created_at, updated_at

deal_contacts  deal_id, contact_id   ← composite PK (deal_id, contact_id) REQUIRED

pipeline_stages                        ← authoritative stage list; admin-configurable
  id, name varchar(100) UNIQUE (case-insensitive index), sort_order int UNIQUE,
  probability int (0–100), is_terminal bool, is_fixed bool, created_at, updated_at
  Seed rows: Prospecting(10%), Qualification(25%), Proposal(50%),
             Negotiation(75%), Closed Won(100%), Closed Lost(0%)
  is_fixed=true rows cannot be renamed or deleted.

activities
  id, type(Note|Call|Email|Meeting|Task), subject, notes, due_date,
  status(open|complete), direction(Inbound|Outbound) nullable, outcome text nullable,
  contact_id nullable, account_id nullable, deal_id nullable, owner_id, is_demo
  CHECK: contact_id IS NOT NULL OR account_id IS NOT NULL OR deal_id IS NOT NULL

leads
  id, first_name, last_name nullable, email, phone nullable, company_name nullable,
  lead_source(Web|Referral|Trade Show|Cold Outreach|Other) nullable,
  status(New|Contacted|Qualified|Disqualified), disqualification_reason nullable,
  notes nullable, owner_id,
  converted_at nullable, converted_contact_id nullable,
  converted_account_id nullable, converted_deal_id nullable,
  is_demo, created_at, updated_at

lead_status_history
  id, lead_id → leads ON DELETE CASCADE, from_status nullable, to_status,
  changed_by_id nullable, changed_by_name nullable, created_at

attachments
  id, record_type(contact|account|deal), record_id, filename, original_name,
  mime_type, size_bytes, storage_key, uploaded_by_id, created_at

audit_log                              ← append-only; DB-enforced
  id, record_type, record_id nullable, record_name nullable, event_type,
  field_name nullable, old_value nullable, new_value nullable,
  changed_by_id nullable, changed_by_name nullable, created_at

automation_rules
  id, name, enabled bool, trigger_type, trigger_config jsonb,
  action_type, action_config jsonb, created_by, created_at, updated_at

automation_rule_logs
  id, rule_id → automation_rules ON DELETE CASCADE, triggered_at,
  triggering_record_type, triggering_record_id, outcome(success|error), error_message nullable

system_settings  key (PK), value text, updated_at
  Keys: default_language, nav_layout, email_notifications_enabled,
        default_currency, file_storage_endpoint, file_storage_bucket, file_storage_key_id,
        file_storage_secret (encrypted)

overdue_task_notifications  activity_id, notified_date  ← dedup for email digests
```

**Migration rule:** Every schema change requires a migration file. Derive the next number
by running `ls db/migrations/ | tail -1` and incrementing — never hardcode a number here.
Every migration needs both `up` and `down`. Integrity rules go in DB CHECK constraints
in addition to Zod.

---

## Security — Required on Every Authenticated Endpoint

### 1. Auth middleware (`authenticate`)

Verify on every authenticated request:

1. JWT signature + expiry
2. `user.status === 'active'` — deactivated users must not pass
3. If `user.must_change_password` → 403 `{ error: { code: 'PASSWORD_CHANGE_REQUIRED' } }`
   for all routes except `/api/auth/change-password`

`authenticate` is regular middleware, not a route handler. Every `await` inside it must be
in a try/catch that calls `next(err)`. `asyncHandler` covers route handlers only.

### 2. Ownership on PATCH / DELETE

```ts
// CORRECT — use req.user.id from middleware, never trust req.body
WHERE id = $1 AND (owner_id = $2 OR $3 = 'admin')
// params: [recordId, req.user.id, req.user.role]
```

Never accept `owner_id` from the request body.

### 3. ORDER BY allowlist (SQL injection prevention)

```ts
const ALLOWED_SORT = ['first_name', 'email', 'created_at'] as const;
const col = (ALLOWED_SORT as readonly string[]).includes(req.query.sort as string)
  ? (req.query.sort as string)
  : 'created_at';
const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
```

For UPDATE field names, use `ReadonlySet<keyof UpdateInput>` — see `dealService.ts`.

### 4. Cookie configuration

```ts
res.cookie('token', jwt, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000,
});
```

### 5. Rate limiting

`POST /api/auth/login` and `POST /api/auth/forgot-password` use `express-rate-limit`.
The `E2E=true` env var bypasses the limiter for test runners only.

### 6. Startup guard

Reject weak `JWT_SECRET` (`''`, `'changeme'`, `'secret'`, `'password'`) at process start.

---

## Architecture Rules

- **Services own all DB access.** `pool.query()` belongs exclusively in `server/src/services/`.
- **Controllers shape requests/responses only.** No business logic. No `pool.query()`.
- **Zod validation in controllers, before every service call.** Use `.safeParse()`; return 400
  on failure: `{ error: { code: 'VALIDATION_ERROR', message: errors[0].message } }`.
- **All async route handlers** wrapped in `asyncHandler` or explicit try/catch.
- **Error shape always:** `{ error: { code: string, message: string } }`.
- **HTTP status codes:** 400 validation, 401 unauthenticated, 403 forbidden, 404 not found,
  409 conflict.
- **No magic numbers or magic strings.** Use named constants.
- **`async/await` only.** Never `.then()` chains.
- **`no-explicit-any` enforced.** Fix the type; never suppress with `any` or `@ts-ignore`.

---

## Required Patterns for All Write Operations

### Transactions with audit logging

Every CREATE / UPDATE / DELETE on user data **must** write an audit entry in the **same
transaction**. A failed audit write rolls back the data change and vice versa.

```ts
// contactService.ts / dealService.ts pattern — follow exactly
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
const contact = await createContact(parsed.data, actor);
```

### Assignment notifications (after commit, never awaited)

When `owner_id` changes on any record, notify the new owner AFTER the commit:

```ts
// In the controller, after the service call returns the updated record:
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

### Automation triggers (fire-and-forget, always `void`)

```ts
// ALWAYS void — never await. This is deliberate.
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

- [ ] Route file: `@openapi` JSDoc + `asyncHandler` only — zero logic, zero imports from services
- [ ] Controller: Zod `.safeParse()` before service call; no `pool.query()`
- [ ] Pagination: use `paginationParamsSchema` from `shared/schemas/paginationSchema.ts`
- [ ] Sort params: allowlist-validated before SQL interpolation
- [ ] Admin-only routes: `requireRole('admin')` on the route
- [ ] PATCH/DELETE: ownership enforced in the WHERE clause
- [ ] Write operations: audit entry in same transaction as data change
- [ ] Assignment notification fired if owner changed (after commit, not awaited)
- [ ] Standard error shape on all failure paths
- [ ] Service-layer unit test for the new function
- [ ] Functional E2E spec updated or added for the new behaviour
- [ ] OpenAPI spec passes `npm run lint:api --workspace=minicrm-server`

---

## Pipeline Stages — Dynamic, Not Hardcoded

Stages live in `pipeline_stages` and are admin-configurable (MINCRM-180).
`PIPELINE_STAGES` from `dealSchema.ts` is a **bootstrap fallback only**.

Client: fetch via `GET /api/settings/pipeline-stages` at app startup, cache with
`PIPELINE_STAGES_QUERY_KEY`. Stage selectors must use the live list.

Server: validate `stage` as a non-empty string at Zod level, then verify against the
`pipeline_stages` table in the service. Do not re-introduce a Zod `.enum()` on a fixed list.

---

## Multi-Currency

`deals.currency` is `varchar(3) NOT NULL DEFAULT 'USD'`. Valid values in `SUPPORTED_CURRENCIES`
from `shared/schemas/settingsSchema.ts`: `['USD','EUR','GBP','CAD','AUD','JPY','CHF']`.

When creating a deal without an explicit currency:

```ts
import { getDefaultCurrency } from './settingsService.js';
const resolvedCurrency = currency ?? (await getDefaultCurrency());
```

Format currency with `Intl.NumberFormat` using the deal's own `currency` field and the active
i18n locale. Never hardcode `'USD'` in formatting.

---

## Internationalization

- All user-facing strings use `t('key')` — **no hardcoded English in JSX**
- Locales: `en`, `zh-Hans`, `es`, `fr`, `de`; `eslint-plugin-i18next` enforces this in CI
- Pipeline stage display names: use `PIPELINE_STAGE_I18N_KEY` util then `t()`
- Currency: `Intl.NumberFormat` with active locale + deal's `currency` field
- **RTL — logical properties required for ALL new layout classes:**
  - `ps-` / `pe-` not `pl-` / `pr-`
  - `ms-` / `me-` not `ml-` / `mr-`
  - `start-` / `end-` not `left-` / `right-`
  - `text-start` / `text-end` not `text-left` / `text-right`

---

## Testing

### Server (`server/src/__tests__/`)

- **Framework:** Vitest (not Jest) against real PostgreSQL `minicrm_test` DB
- **Run:** `npm test --workspace=minicrm-server` → `vitest run`
- **File naming:** `[domain]Service.test.ts`, `[domain]Controller.test.ts`
- **Isolation:** `beforeEach` truncates relevant tables; `beforeAll`/`afterAll` manage fixtures
- **Coverage threshold:** 80% on `server/src/services/` (CI-enforced)
- **No mocking of `pool` in service tests** — use the real DB
- **Controller tests:** use `supertest` against `app` with `makeAuthCookie()`

Required test files beyond core CRUD:

- `auth-boundaries.test.ts` — rep → admin endpoints → 403; rep A → rep B's records → 403/404
- `auditService.test.ts` — entries written in transaction; append-only enforced
- `notificationService.test.ts` — overdue digest dedup; assignment batch window

### Client (`client/src/`)

- **Framework:** Vitest + React Testing Library + MSW
- **Run:** `npm test --workspace=minicrm-client`
- **MSW setup:** `onUnhandledRequest: 'error'` — any unhandled API call in a test **throws**.
  Add a handler before calling the API, or the test fails.
- **Test helper:** `renderWithProviders()` from `src/test/renderWithProviders.tsx`
- **File location:** `Component.test.tsx` co-located with `Component.tsx`
- **Coverage:** 70% threshold; `all: true` in config so untouched files appear in the report
- Every conditional render branch needs a dedicated test

### `data-testid` Conventions

Every interactable element needs a `data-testid`. Patterns in use:

- Static: `data-testid="new-contact-button"`, `data-testid="pipeline-board"`
- Row-scoped: `data-testid={\`contact-card-${contact.id}\`}`
- Action+entity: `data-testid="contacts-export-csv-button"`

### React Query Conventions

Every API module exports a typed query key constant:

```ts
export const CONTACTS_QUERY_KEY = ['contacts'] as const;
```

Use these constants everywhere — never inline strings in `queryKey`.

`staleTime` rules:

- `GET /api/users/active` → `staleTime: 5 * 60 * 1000` (called frequently; set on the query)
- Dashboard summary → `staleTime: 0` (intentional — always fresh)
- No global `staleTime` on the QueryClient

### ⛔ E2E Functional Test Suite — ONE RUN PER SESSION, NO EXCEPTIONS

> **THIS DIRECTIVE EXISTS BECAUSE IT HAS BEEN VIOLATED.** Read it in full before
> touching the E2E suite. Violating it wastes significant time and can pollute the
> `minicrm_e2e` database.

**RULE 1 — Run the functional suite at most once per Claude Code session.**
Never invoke `npx playwright test`, `npm run test`, `cd qa && ... npm run test`,
or any other form of the E2E test runner more than one time per session. If the
first run fails or you later make a fix, do **not** re-run to verify. Move on.

**RULE 2 — Read report files, not console output, for results.**
After a run completes, determine pass/fail counts by reading the generated report
files — never from scrolling back through terminal output:

- `qa/e2e/test-results/results.xml` — JUnit XML; `tests`, `failures`, `errors` attributes
- `qa/e2e/test-results/healing-report.json` — heal event counts and detail

**RULE 3 — Re-running to "verify a fix" is prohibited.**
If you make a code change after the first run, you cannot confirm it with a second
run in the same session. Make the fix, then note in your response that CI will
confirm correctness. The fix either holds up in CI or it doesn't — a second local
run does not add safety and costs time.

**RULE 4 — Delete stale results before the one permitted run.**
Per the general testing directive: delete `qa/e2e/test-results/` before starting
the single permitted run so stale output cannot influence pass/fail determination.

### E2E — Conventions

- **Config:** `qa/e2e/playwright.config.ts`
- **`data-testid` selectors only** — no CSS class or positional selectors
- **Dedicated `minicrm_e2e` DB**, reset between runs via TestDataManager
- **Tags:** every test must be tagged `@functional`; smoke-level tests also `@smoke`
- **Spec location:** `qa/e2e/tests/apps/minicrm/functional/<domain>/<domain>.spec.ts`
- **New spec files under `functional/` are picked up by CI automatically** — no CI changes needed
- **Framework layer must have zero app-domain strings** — enforced by `check-framework-purity.sh`
- **Every story must include or update a functional E2E spec.** Do not mark a ticket done without
  E2E coverage for the new behaviour.

CI phases:

```
Phase 1 (parallel): lint-and-typecheck | security-audit | e2e-framework-purity
Phase 2 (needs Phase 1): server-tests | client-tests
Phase 3 (needs Phase 2): e2e-functional [desktop × mobile-web] --grep @functional
```

---

## Intrinsic Responsive Design (MINCRM-208)

For any UI displaying variable-length or numeric content:

- Fluid font sizes on large values: `text-[clamp(1.25rem,3vw,2rem)]`
- `min-w-0` on flex children that contain text (overrides browser `min-width: auto`)
- `break-words` on all freetext fields (notes, loss reason, address fields, etc.)
- Test at 600px, 900px, and 1100px — not just mobile and full desktop
- Leave a comment on any non-obvious `min-w-0` or `clamp()` for future maintainers

---

## Known Architectural Constraints (do not worsen)

- **Automation is fire-and-forget:** always `void fireAutomationTrigger(...)`, never `await`.
- **Dual contact address storage:** Inline fields on `contacts` (migration 024) and the
  `contact_addresses` table (migration 030) coexist. New address work uses `contact_addresses`.
- **`seed-demo.ts` is a thin CLI wrapper only.** All demo fixture data lives in
  `server/src/services/demoService.ts`. The CLI script must not contain any fixture data or SQL.
- **`BreakpointContext` is the single source of responsive state (MINCRM-238).** All
  components read breakpoints via `useBreakpoint()` — never call `window.matchMedia` directly
  in a component. `BreakpointContext` owns the one `matchMedia` subscription and distributes it
  to the tree. Direct `matchMedia` calls create duplicate subscriptions and will not work in
  tests (jsdom stubs matchMedia).

---

## Git

- Conventional commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`
- Branch name: `feat/MINCRM-{n}-short-description`
- Never commit to `main` — always a feature branch
- One logical change per commit
- Pre-commit hooks (husky + lint-staged) run ESLint + Prettier — must pass
- Never commit `.env` or `.env.test`

---

## Jira Workflow

- Set ticket to **In Progress** when starting work
- Set ticket to **In Review** once the PR is posted
- When a PR covers multiple tickets, include all Jira IDs in the PR title
- Read the full ticket description before writing any code

---

## Pre-PR Self-Review Checklist

Real patterns from past findings on this repo:

- [ ] **Sibling consistency** — pattern applied to one instance applied to all siblings.
      i18n key added to `en.json` but not all five locale files; fix on ContactsPage but not
      AccountsPage or DealsPage; `data-testid` on one button but missing on its counterpart.
- [ ] **Dead code removed** — unused i18n keys, unused imports, declared-but-never-read vars.
- [ ] **Audit entries present** — every CREATE/UPDATE/DELETE has `writeAuditEntry` on the same
      client in the same transaction.
- [ ] **Assignment notification fired** — if `owner_id` changed, `queueAssignmentNotification`
      called after commit (not awaited, not inside the transaction).
- [ ] **Pure updater functions** — `setState(updater)` functions have no side effects.
      Side effects in updaters fire twice in StrictMode.
- [ ] **No-op guard on interactive controls** — active-state control re-click is a no-op.
- [ ] **Focus management** — modals, inline forms, drawers move focus in on open and restore
      focus to the trigger on close.
- [ ] **RTL-safe classes** — logical properties used, not physical directional classes.
- [ ] **E2E spec present** — story AC covered by at least one `@functional` test.
- [ ] **OpenAPI spec** — `npm run lint:api` passes after any endpoint change.
- [ ] **Framework coverage** — if `qa/e2e/framework/` was touched, run `npm run test:framework:coverage --workspace=minicrm-qa` and confirm it exits 0 (80% threshold enforced).

---

## General Behaviour

- Read the full Jira ticket before writing any code
- Ask before deleting or overwriting files
- No placeholder / "coming soon" code — implement it fully or leave it out
- Tasks producing >200 lines of new code: pause and confirm approach first
- Prefer extending existing files over creating new parallel ones
- Do not install npm packages without confirming first
- All list endpoints use `paginationParamsSchema` — do not add new unbounded queries

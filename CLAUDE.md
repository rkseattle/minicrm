# MiniCRM — Claude Code Context

## External Project References

- **Jira project:** `MINCRM` (MiniCRM) on `edwardaspendesigns.atlassian.net`. Use this project key for all ticket search/lookup/creation unless a task explicitly names a different project (e.g. `LAR`, `MININT`).
- **GitHub repository:** `rkseattle/minicrm` (`https://github.com/rkseattle/minicrm`).

### Finding Jira issues by a label you were only given a prefix or partial name for

JQL's `~` operator does fuzzy/contains text matching against a text index — it is
**not** glob/wildcard matching, so `labels ~ "foo*"` will not match `foo-bar-baz` the
way a shell glob would. If an exact `labels = "<prefix>"` match returns nothing:

1. Don't assume the label doesn't exist — assume the prefix is incomplete or the
   real label is a compound slug (e.g. `pr-tia-3` might actually be
   `pr-tia-3-coverage-pipeline`).
2. Drop the project/label filter and do a broad, unscoped search instead —
   `labels ~ "<fragment>"` and/or a plain `project = X ORDER BY created DESC` listing
   — to see real label strings in use.
3. Once you find the actual full label string from real results, re-run an exact
   `labels = "<full-label>"` match and filter/read the subset you need client-side.

## Stack

- **Client:** React + Vite, TanStack Query v5, React Router, Tailwind CSS, i18next
- **Server:** Node.js + Express + TypeScript, REST, Zod validation
- **DB:** PostgreSQL 16, node-pg-migrate
- **Auth:** JWT in httpOnly cookie (8-hour expiry)
- **Infra:** Docker + Docker Compose, npm workspaces (`/client`, `/server`, `/shared`, `/qa`)
- **gRPC:** ConnectRPC (`@connectrpc/connect-express`) + `@connectrpc/connect-web`

## Project Layout

```
server/src/
  routes/        → @openapi JSDoc + asyncHandler ONLY — no logic
  controllers/   → request/response shaping ONLY — no pool.query()
  services/      → ALL business logic + ALL DB queries
  middleware/    → auth.ts, requireRole.ts, asyncHandler.ts
  grpc/          → ConnectRPC handler + proto/

client/src/
  api/           → one Axios wrapper per resource; exports typed fns + QUERY_KEY constants
  pages/         → full page components
  components/    → reusable UI
  hooks/         → custom React hooks

shared/schemas/  → Zod schemas used by both client and server (.ts only — .js outputs gitignored)

db/migrations/   → sequential node-pg-migrate files (ls db/migrations/ | tail -1 to find last)

qa/e2e/
  framework/     → ZERO app-domain refs — healing locator, fixtures, reporters, REST/gRPC clients
  behaviors/minicrm/ → named async behavior fns
  pages/minicrm/ → Page Objects
  apps/minicrm/  → fixtures.ts, helpers.ts, test-data-manager.ts
  tests/apps/minicrm/functional/<domain>/ → spec files tagged @functional
```

Reference docs: [schema](docs/dev/schema.md) · [migrations](docs/dev/migrations.md) · [grpc](docs/dev/grpc.md) · [retention](docs/dev/retention.md) · [ai-chat](docs/dev/ai-chat.md) · [coverage](docs/dev/coverage.md) · [ADRs](docs/adr/)

---

## Architecture Rules

- **Services own all DB access.** No `pool.query()` outside `server/src/services/`.
- **Controllers shape requests/responses only.** No business logic.
- **Zod `.safeParse()` in controllers before every service call.** Return `400: { error: { code, message } }`.
- **Error shape always:** `{ error: { code: string, message: string } }` — code is SCREAMING_SNAKE_CASE.
- **HTTP status codes:** 400 validation · 401 unauthed · 403 forbidden · 404 not found · 409 conflict.
- **Map PG errors explicitly:** `23505` → 409 with domain code; `23503` → 400/409; others → 500.
- **No N+1 queries.** List endpoints must join or batch-load.
- **`async/await` only.** No `.then()` chains.
- **`no-explicit-any` enforced.** Fix the type; never suppress.
- **Non-null `!` and `as` casts** require an inline comment explaining why it's safe.
- **Service functions must declare explicit return types.**
- **No `console.log` in `server/src/`** outside tests. Use `logger.info/warn/error`.
- **No magic numbers or strings.** Use named constants.
- **All async route handlers** wrapped in `asyncHandler` or explicit try/catch.

---

## Security — Required on Every Authenticated Endpoint

1. **`authenticate` middleware** on every route — verifies JWT, `status === 'active'`, `must_change_password`.
2. **Ownership on PATCH/DELETE:** `WHERE id = $1 AND (owner_id = $2 OR $3 = 'admin')` — never trust `req.body` for actor identity.
3. **ORDER BY allowlist** — validate sort column against an explicit `as const` array before SQL interpolation.
4. **Cookie:** `httpOnly: true, secure: prod-only, sameSite: 'lax', maxAge: 8h`.
5. **Rate limiting** on `POST /api/auth/login` and `POST /api/auth/forgot-password` (`E2E=true` bypasses).
6. **Startup guards:** reject weak `JWT_SECRET` (< 32 chars or known weak values) and malformed `NODE_ENCRYPTION_KEY` (must be 64-char hex).

---

## Required Patterns for Write Operations

### Transactions + audit logging (every CREATE/UPDATE/DELETE)

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const result = await client.query<Row>('INSERT INTO ... RETURNING ...', values);
  await writeAuditEntry(client, { ... });   // SAME client, SAME tx
  await client.query('COMMIT');
  void fireAutomationTrigger('contact_created', { ... }); // after commit, never await
  return result.rows[0];
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

For UPDATE: use `diffFields(before, after, auditBase)` + `writeAuditEntries(client, entries)`. See `dealService.ts`.

### AuditActor (all write service functions)

```ts
export interface AuditActor {
  id: string;
  name: string;
}
const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };
// Controllers: const actor = { id: req.user.id, name: req.user.name };
```

### Assignment notifications

Call `queueAssignmentNotification(...)` after commit — never inside the tx, never `await`.

### Automation triggers

Always `void fireAutomationTrigger(...)` — never `await`. It swallows all internal errors.

---

## Key Domain Rules

- **Pipeline stages are dynamic** — fetch via `GET /api/settings/pipeline-stages`; never hardcode. Validate as non-empty string at Zod level, then verify against `pipeline_stages` table in service.
- **Currency** — `deals.currency varchar(3) DEFAULT 'USD'`. Use `SUPPORTED_CURRENCIES` from settingsSchema; resolve default via `getDefaultCurrency()`. Format with `Intl.NumberFormat` using the deal's own currency.
- **i18n** — all user-facing strings via `t('key')`; no hardcoded English in JSX. RTL: use logical CSS (`ps-`/`pe-`, `ms-`/`me-`, `start-`/`end-`) not physical directional classes.
- **Migrations** — never modify existing; write corrective migrations. Every migration needs `up` + `down`. Add migration → regenerate ERD in same PR. See [docs/dev/migrations.md](docs/dev/migrations.md).
- **lead.last_name** — nullable on leads, NOT NULL on contacts. `convertLeadSchema` enforces it at conversion boundary. No `?? ''` fallback.
- **varchar + CHECK** for new constrained-string columns — never new PG ENUMs.
- **Polymorphic FK cleanup** — when hard-deleting a parent, clean up attachments/custom_field_values (hard-delete) and notes (soft-delete via `softDeleteNotesByEntity`) in same tx. See [docs/dev/schema.md](docs/dev/schema.md).
- **system_settings writes** — always pass AuditActor; use SYSTEM_ACTOR only for seeding/migration.
- **feature_flags.role_overrides** — transitional; never bypass `assertValidRoleOverrides()`.
- **Custom fields (EAV)** — type-aware filtering/sorting is O(n) at scale. Read ADR-002 before writing SQL on custom fields.

---

## New Endpoint Checklist

- [ ] Route: `@openapi` JSDoc + `asyncHandler` only
- [ ] Controller: Zod `.safeParse()` before service call; no `pool.query()`
- [ ] Pagination: `paginationParamsSchema` from `shared/schemas/paginationSchema.ts`
- [ ] Sort params: allowlist-validated before SQL interpolation
- [ ] Admin-only: `requireRole('admin')` on route
- [ ] Feature flag: `requireFeatureEnabled('flag_key')` + migration 066 entry, or documented as always-on
- [ ] PATCH/DELETE: ownership in WHERE clause
- [ ] Write ops: audit entry in same tx
- [ ] Assignment notification after commit if `owner_id` changed (not awaited)
- [ ] DB errors mapped: 23505 → 409; 23503 → 400/409; others → 500
- [ ] Error shape `{ error: { code, message } }` on all failure paths
- [ ] Service-layer unit test including ownership enforcement
- [ ] Functional E2E spec added/updated
- [ ] `npm run lint:api --workspace=minicrm-server` passes
- [ ] Roles & Capabilities enforced

---

## Frontend Conventions

- **`data-testid`:** static → `"new-contact-button"`; row-scoped → `` `contact-card-${id}` ``; action+entity → `"contacts-export-csv-button"`.
- **React Query:** every API module exports `FOO_QUERY_KEY = ['foo'] as const`; never inline strings in `queryKey`. `staleTime: 5*60*1000` on `/api/users/active`; `staleTime: 0` on dashboard summary. No global `staleTime`.
- **Responsive:** `min-w-0` on flex children with text; `break-words` on freetext; `clamp()` for fluid font sizes. Test at 600/900/1100px.

---

## Testing

**Server** (`server/src/__tests__/`) — Vitest against real `minicrm_test` DB. 80% coverage on `services/` (CI). `beforeEach` truncates tables. Required: `auth-boundaries.test.ts`, `auditService.test.ts`, `notificationService.test.ts`.

**Client** (`client/src/`) — Vitest + RTL + MSW (`onUnhandledRequest: 'error'`). 70% lines / 80% branches (CI). Co-locate `Component.test.tsx`. Every async component tests loading + error + empty. Every conditional branch gets a test.

Run both suites sequentially with `npm run unit_test` — never run the two workspaces in parallel (CPU contention causes random 5s timeouts in jsdom).

### Failing tests — no "known flake" exception

Never label a test failure a "known flake," "flaky," or "pre-existing" as a reason to stop investigating or to rerun past it. Whether a test has failed before is irrelevant — every failure gets root-caused and fixed, every time, no exceptions carved out for tests with a history of intermittent failures. A rerun that happens to pass is not a resolution; if root cause isn't found, say so explicitly and ask how to proceed rather than dismissing it.

---

## ⛔ Definition of Done — required before every `git commit`, no exceptions

```bash

# 1. Typecheck
npm run typecheck

# 2. Lint
npm run lint

# 3. Audit
npm audit

# 4. Unit tests (sequential — never run these workspaces in parallel)
npm run unit_test

# 5. QA static checks
bash qa/scripts/check-framework-purity.sh
bash qa/scripts/check-behavior-layer.sh
bash qa/scripts/check-settings-mutations.sh
bash qa/scripts/check-networkidle.sh
```

Steps 1–5 run before every commit. **E2E does not gate individual commits** — for a
multi-commit/multi-phase branch, run the E2E suite once at the end, immediately
before pushing to the remote (see below), not after each commit.

**Editing `.github/workflows/*.yml`:** the pre-commit hook runs `actionlint` on any
staged workflow file and hard-fails the commit if it isn't installed —
`brew install actionlint` once per machine. A CI job in
`.github/workflows/lint-workflows.yml` re-validates on push/PR as a backstop, since a
malformed `ci.yml` can't reliably self-report failures from a job defined inside it.

### E2E — required once before every push, no exceptions

```bash
# tag the start time
date

# Rebuild the E2E server's Docker image (picks up new server code — my new routes weren't in the running container because it was a 2-day-old build):
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile e2e build server-e2e

# Recreate the container from that new image:
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile e2e up -d server-e2e

# Re-run E2E setup (re-seeds admin user, MinIO storage config, Mailhog SMTP config
env $(cat qa/e2e/.env | grep -v '^#' | grep -v '^$' | xargs) npm run e2e:setup

# clear out old test results
rm -rf qa/e2e/test-results/

# Non-serial: --workers=1 matches CI's LPT file-per-shard isolation (no cross-file races)
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) npm run test -- --grep "@functional" --grep-invert "serial" --workers=1

# Serial: always single-worker (matches e2e-serial CI job)
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) npm run test -- --grep "@functional.*@serial|@serial.*@functional" --workers=1
```

Read `qa/e2e/test-results/results.xml` for pass/fail — never rely on console output or exit code.
One run per push. Fix failures on the branch; never re-run to paper over them. Never compare to main to dismiss a failure.

**AI tool schema check:** If any changes touch `server/src/services/` or `server/src/ai/`, review `server/src/ai/tools/` and verify the tool schemas still match the service signatures — correct input field names, enums, and required arrays. Update affected tool files in the same commit.

**AI eval check:** If any changes add or modify NLI behavior in `server/src/ai/` (new tools, changed tool schemas, new RBAC rules, changes to PII filtering), add or update the corresponding eval test cases in `qa/evals/` in the same commit — intent changes go in `nli-intent.yaml`, semantic behavior in `nli-semantic.yaml`, RBAC in `nli-rbac.yaml`, PII in `nli-pii.yaml`. Never route PII assertions through an LLM judge.

**E2E infrastructure setup (once per dev machine boot):**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile e2e up -d
npm run e2e:client  # separate terminal — hardcodes API_URL=http://localhost:3002 (MINCRM-556)
```

`E2E_API_URL=http://localhost:3002`, `E2E_BASE_URL=http://localhost:5173` in `qa/e2e/.env`.

**Worker isolation (MINCRM-557):** Run non-serial and serial tests separately with `--workers=1` each. CI uses LPT file partitioning (one file per shard) so each spec file runs in complete isolation — no cross-file global-state races. `--workers=1` locally replicates that isolation. Running with multiple workers causes cascade failures where a long-running test (concurrency, deals) blocks a worker and starves queued tests of time.

---

## E2E Authoring Rules

See [docs/dev/e2e-authoring.md](docs/dev/e2e-authoring.md) for the full reference. Key rules inline:

- **Locators:** primary strategy always `testId`; every `locate()` in a page object needs at least two strategies and an `intent` string (5–10 words). Spec-layer single-testId locates for dynamic IDs are allowed with a comment.
- **No `page.waitForTimeout()`** in page objects. Use `locator.waitFor({ state })`, `expect(locator).toBeVisible()`, or `page.waitForFunction()`.
- **No `page.waitForLoadState('networkidle')`** anywhere in spec files — enforced by `check-networkidle.sh`. Replace with a specific wait targeting the exact DOM condition the test needs.
- **Tags:** every test `@functional`; smoke tests also `@smoke`.
- **`@serial` tag:** any test that mutates a shared `system_settings` row (nav layout, visibility policy, default language, MFA policy, branding, SSO, email notifications, currencies, pipeline stage sort order) **must** be tagged `@functional @serial`. The `e2e-serial` CI job runs `@serial` tests with `--workers=1`; the `e2e-functional` sharded job excludes them via `--grep-invert serial`. Enforced by `check-settings-mutations.sh`.
- **Spec location:** `qa/e2e/tests/apps/minicrm/functional/<domain>/<domain>.spec.ts`.
- **framework/ must have zero app-domain strings** — enforced by `check-framework-purity.sh`. This includes JSDoc comments: `MINCRM-*` ticket refs and words like `pipeline` match the check.
- **Specs import only from `@behaviors/*`, `@apps/*`, `@framework/*`** — never `@pages/*`.
- **Settings mutations** must call `ensureSystemDefaults()` for cleanup.
- **No `loginAsAdmin` in `test.beforeAll`** — call at test body start.
- **Feature flags via `withFlags()` only** — never toggle via API or DB mutation.
- **Every story must include or update a functional E2E spec.**
- **Intra-file parallelism:** New spec files covering shared system resources (any
  `system_settings` row, feature flag state, shared admin account) must default to
  `test.describe.serial`. Files that create all their own data via UUID-scoped
  `TestDataManager` may be candidates for `test.describe.configure({ mode: 'parallel' })` —
  apply the safety checklist in [`qa/e2e/PARALLELISM-NOTES.md`](qa/e2e/PARALLELISM-NOTES.md)
  before enabling parallel mode. See also `npm run e2e:timing:hotspots` to identify
  which files are worth auditing.

---

## Pre-PR Self-Review

- [ ] i18n keys in all 5 locale files; sibling pages fixed together; `data-testid` on all counterparts
- [ ] Dead code removed (unused keys, imports, vars)
- [ ] Audit entries present in every write tx
- [ ] Assignment notification fired after commit if `owner_id` changed (not awaited)
- [ ] DB errors mapped correctly
- [ ] `setState(updater)` has no side effects (fires twice in StrictMode)
- [ ] Re-click on active control is a no-op
- [ ] Modals/drawers manage focus on open/close
- [ ] RTL logical CSS classes used throughout
- [ ] Loading/error/empty states all handled for every async component
- [ ] Feature flag gated or documented as always-on
- [ ] User docs updated (`docs/user-guide/`, `docs/admin-guide.md`, `index.md` entry)
- [ ] Screenshots updated (`docs/screenshots/` via `scripts/screenshot.ts`)
- [ ] E2E spec present for story AC
- [ ] `checkScreenshot()` added/updated for complex visual surfaces
- [ ] Definition Of Done - all checks and tests pass
- [ ] Framework coverage ≥ 80% (`npm run test:framework:coverage --workspace=minicrm-qa`) if `qa/e2e/framework/` touched
- [ ] Roles & Capabilities scoped for least privilege
- [ ] Greptile review — code changes would pass a Greptile review
- [ ] AI tool schemas reviewed if `server/src/services/` or `server/src/ai/` changed — field names, enums, and required arrays still match service signatures
- [ ] Eval tests added/updated in `qa/evals/` if NLI behavior changed — new tools, RBAC rules, PII fields, or semantic response expectations

## PR Review Feedback

**"Review PR feedback"** means, in this order:

1. Fetch existing reviewer comments from the open PR (both inline diff comments and top-level summary comments).
2. Fix every issue found in the code.
3. Reply to each inline comment explaining what changed and why.
4. Post a top-level summary comment covering all changes made.

Never reply to comments before fixing the code. Never run a fresh `/code-review` when asked to address existing feedback.
When replying to a comment left by Greptile, prefix the reply body with `@greptile:` followed by a space.

## Jira Workflow

- Project: `MINCRM` (see External Project References above).
- Transition to **In Progress** when starting implementation.
- Transition to **In Review** when opening a PR.
- Reference ticket number in commit messages.
- Use `jira_get_transitions` to get transition IDs before transitioning — never guess.
- Always include Acceptance Criteria in the description when creating a ticket.

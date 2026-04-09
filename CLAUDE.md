# MiniCRM — Claude Code Context

Minimal CRM validating the core sales loop: contact → deal → activity → pipeline.
Jira: MINCRM · edwardaspendesigns.atlassian.net · Cloud ID: b292d89b-f5d6-45b9-b1c1-bb44dd14b067

## Stack

- Client: React + Vite, TanStack Query, React Router, Tailwind CSS, i18next
- Server: Node.js + Express + TypeScript, REST, Zod validation
- DB: PostgreSQL 16, node-pg-migrate
- Auth: JWT in httpOnly cookie
- Infra: Docker + Docker Compose, npm workspaces (/client, /server, /shared)
- Docs: OpenAPI 3.0 via swagger-jsdoc, served at /api-docs (dev/staging only)

## Project Layout

```
server/src/routes/       → route definitions + @openapi JSDoc only
server/src/controllers/  → request/response shaping only
server/src/services/     → all business logic + DB queries
server/src/middleware/   → auth.ts (JWT verify + status check), requireRole.ts
client/src/api/          → one Axios wrapper file per resource
client/src/pages/        → full page components
client/src/components/   → reusable UI pieces
shared/schemas/          → Zod schemas (imported by both client and server)
db/migrations/           → sequential node-pg-migrate files (001–013+)
e2e/                     → Playwright tests (MINCRM-42)
```

## Core Tables

```
users          id, email, password_hash, name, role(admin|rep), status, must_change_password, preferred_language
accounts       id, name, industry, website, employee_range, revenue_range, owner_id
contacts       id, first_name, last_name, email, phone, title, department, account_id, owner_id
deals          id, name, stage, value, close_date, loss_reason, account_id, owner_id
deal_contacts  deal_id, contact_id  ← composite PK required
activities     id, type, subject, notes, due_date, status, direction, outcome, contact_id, account_id, deal_id, owner_id
               CHECK: contact_id IS NOT NULL OR account_id IS NOT NULL OR deal_id IS NOT NULL
automation_rules  id, name, trigger, action, enabled
automation_rule_logs  id, rule_id, triggered_at, outcome, error_message
system_settings  key, value
```

Pipeline stages (fixed): Prospecting → Qualification → Proposal → Negotiation → Closed Won / Closed Lost

## Current State

Alpha (MINCRM-1–4) and all post-alpha work (MINCRM-24–33) are fully implemented.
Active work phases (see Jira for full ticket descriptions):

| Phase | Focus                  | Key tickets                   |
| ----- | ---------------------- | ----------------------------- |
| A     | Security hygiene       | MINCRM-64, 72, 84, 85, 86     |
| B     | Security verification  | MINCRM-73, 74, 76, 78, 87, 88 |
| C     | CI + test infra        | MINCRM-65, 66, 67, 90         |
| D     | Security test coverage | MINCRM-80, 81, 83             |
| E     | E2E foundation         | MINCRM-63, 71, 77             |
| F     | Playwright E2E suite   | MINCRM-42                     |
| G     | UX + accessibility     | MINCRM-53–63, 82              |
| H     | Tooling + scalability  | MINCRM-55, 56, 68, 69, 70     |

Work outside these phases requires explicit authorization.
MINCRM-5 (comms), MINCRM-6 (reporting epics beyond implemented), MINCRM-7 (automation epics beyond implemented) remain out of scope.

## Security Patterns — Required

### Auth middleware must verify on every authenticated request:

1. JWT signature + expiry
2. `user.status === 'active'` (deactivated users must not pass)
3. If `user.must_change_password`, return 403 `{ error: { code: 'PASSWORD_CHANGE_REQUIRED' } }` for all routes except `/api/auth/change-password`

### Ownership on PATCH/DELETE:

All PATCH and DELETE on contacts, accounts, deals, activities must enforce:
`WHERE id = $1 AND (owner_id = $2 OR $3 = 'admin')`
Never trust `owner_id` from the request body — use `req.user.id` from middleware.

### SQL injection (ORDER BY):

Column names from client query params cannot be parameterized. Validate against an explicit allowlist:

````ts
const ALLOWED_SORT = ['first_name', 'created_at'] as const;
const sortParam = typeof req.query.sort === 'string' ? req.query.sort : '';
const col = (ALLOWED_SORT as readonly string[]).includes(sortParam) ? sortParam : 'created_at';
const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';

### Cookie config (auth):

```ts
res.cookie('token', jwt, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000,
});
````

### Startup guard:

Reject weak JWT_SECRET values ('changeme', 'secret', 'password', '') at process start.

### Rate limiting:

`POST /api/auth/login` must use `express-rate-limit` (10 attempts / 15 min / IP).

## Architecture Rules

- Business logic in services only — never in routes or controllers
- Controllers: request/response shaping only, no `pool.query()` calls
- All Zod validation in controllers before calling services
- ORDER BY column names: allowlist-validate before SQL interpolation (see Security above)
- Async route handlers: wrap in `try/catch` or `asyncHandler` — no unhandled rejections
- Async middleware (e.g. `authenticate`): must also wrap every `await` in `try/catch` and call `next(err)` on failure — `asyncHandler` only covers route handlers, not middleware
- Error shape: `{ error: { code: string, message: string } }` on all failures
- HTTP status codes: 400 validation, 401 unauth, 403 forbidden, 404 not found, 409 conflict
- Automation rule execution: wrap each rule in isolated try/catch — a failing rule must not abort the triggering operation; log failure to `automation_rule_logs` and continue
- Do not add new unbounded list queries — pagination is tracked in MINCRM-68

## New Endpoint Checklist

Before marking any endpoint complete:

- [ ] Route file: definition + @openapi JSDoc only
- [ ] Zod schema validates all inputs before service call
- [ ] Sort/filter params allowlist-validated
- [ ] Admin-only routes have `requireRole('admin')`
- [ ] PATCH/DELETE verify ownership or admin role
- [ ] Handler wrapped in try/catch or asyncHandler
- [ ] Error response uses standard shape
- [ ] At least one service test covers the new function
- [ ] README.md updated

## Testing

### Server (server/src/tests/)

- Framework: Vitest against real Postgres (`minicrm_test` DB)
- DB reset + seed helpers must run before each test — no cross-test state
- Coverage threshold: 80% on `server/src/services/` (enforced in CI)
- File naming: `[domain].service.test.js`
- Required test files beyond core CRUD:
  - `auth-boundaries.test.js` — rep → admin endpoints → 403; rep A → rep B's records → 403/404
  - `automation.service.test.js` — rule fires, disabled rule no-ops, failing rule does not abort triggering operation

### Client (client/src/)

- Framework: Vitest + React Testing Library + MSW (Mock Service Worker) for API mocking
- Co-locate tests: `Component.test.jsx` alongside `Component.jsx`
- Coverage threshold: 70% on `components/` and `pages/` (enforced in CI)
- All conditional render branches require dedicated tests (e.g., ActivityForm direction field: visible for Call/Email, absent for Note/Task/Meeting)

### data-testid

Every interactable element requires a unique `data-testid`. Row-scoped format: `data-testid="[action]-[entity]-[id]"`. This is required for MINCRM-42 (Playwright). Missing attributes will cause E2E failures.

### E2E (e2e/, MINCRM-42)

- Playwright, `playwright.config.ts` at repo root
- `data-testid` selectors only — no CSS class or positional selectors
- Dedicated `minicrm_e2e` DB, reset between runs
- Five required journeys: auth, contact CRUD, deal pipeline (2+ stage moves → close Won), task flow, user management
- BVT specs live under `qa/e2e/tests/apps/minicrm/bvt/`, tagged `@bvt`
- Functional specs live under `qa/e2e/tests/apps/minicrm/functional/<domain>/`, tagged `@functional`
- CI runs BVTs in Phase 4; functional tests run in Phase 5 (`needs: e2e-bvt`)
- **Any new `@functional` spec file placed under `functional/` is picked up automatically — no CI changes required**

## Internationalization

- All user-facing strings use `t('key')` — no hardcoded English in JSX
- Locales: `en`, `zh-Hans`, `es`, `fr`, `de`
- Pipeline stage keys: camelCase (e.g., `pipeline.stages.closedWon`)
- Currency: `Intl.NumberFormat` with active locale
- `eslint-plugin-i18next` enforces the above (MINCRM-70)
- RTL: `document.dir` is set on locale change but Tailwind directional classes (`pl-`, `pr-`, `ml-`, `mr-`, `text-left`, `text-right`, etc.) do NOT auto-mirror. Use logical property utilities (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`) for all new UI work. Existing classes are being audited in MINCRM-69.

## Database

- All schema changes require a migration file — no DDL in application code
- Next migration: 013
- Every migration has both `up` and `down`
- Business integrity rules must be enforced at DB level (CHECK constraints) in addition to Zod (e.g., activities linked-record constraint — MINCRM-65)
- `deal_contacts` requires composite PK: `PRIMARY KEY (deal_id, contact_id)`

## Known Architectural Debt (do not worsen)

- No pagination on list endpoints (MINCRM-68) — do not add new unbounded queries
- Automation rule execution is **fire-and-forget** (MINCRM-122): `fireAutomationTrigger` is called with `void` — no `await`. It swallows all internal errors and logs them. Unhandled rejections surface via the global `unhandledRejection` handler in `server.ts`. Do not revert to `await`. Full async offloading tracked in MINCRM-67.
- `GET /api/users/active` called frequently — set `staleTime: 5 * 60 * 1000` on this query
- `staleTime: 0` on dashboard is intentional — do not apply globally

## Code Style

- `async/await` only — no `.then()` chains
- JSDoc on all functions (params + return type)
- Named constants — no magic numbers
- `no-explicit-any` enforced by ESLint — fix the type, don't suppress
- Never use `// @ts-ignore`

## Git

- Conventional commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`
- Branch name: `feat/MINCRM-{n}-short-description`
- Never commit to main — always use a feature branch
- One logical change per commit
- Pre-commit linters must pass (husky + lint-staged)
- Never commit `.env` or `.env.test` — both are in `.gitignore`

## Jira Workflow

- Set ticket status to **In Progress** when starting work on it
- Set ticket status to **In Review** once the PR is posted
- When a PR covers multiple tickets, include all full Jira IDs in the PR title (e.g. `MINCRM-74, MINCRM-76` — not just one)

## Starting a Phase Ticket

1. Read the full Jira ticket description before writing any code
2. If the ticket says "verify" or "requires code inspection" — inspect and report first; only implement if the problem is confirmed
3. After fixing, add or update a test that would have caught the bug
4. Phase B/C/D tickets often have security implications — implement the correct pattern, not a workaround

## Pre-PR Self-Review

Before opening a PR, review the full `git diff main` with these checks. Each bullet targets a pattern that has appeared in past review findings on this repo.

- **Consistency across siblings** — if a pattern is applied to one instance, apply it to all. Check: i18n keys added to one locale file but not all five; a fix applied to ContactsPage but not AccountsPage/DealsPage; a new `data-testid` on one button but missing on its sibling.

- **Dead code and dead keys** — when replacing a UI element, remove what it consumed. Check: old i18n keys no longer referenced by any component; unused imports left after a refactor; variables declared but never read.

- **Pure updater functions** — React `setState(updater)` functions must be pure (no side effects). A side effect inside an updater will fire twice in StrictMode. If you need to call `setA` and `setB` together, do both at the call site, not inside one's updater.

- **No-op guard on interactive controls** — a toggle/tab/button that is already in the active state should not re-fire its handler. Add an early-return or inline guard (`value !== x && onChange(x)`) to prevent redundant state updates and history entries.

- **Existing patterns first** — before adding a new hook, helper, or component, read the surrounding files to check if the pattern already exists. Prefer extending what is there over introducing a parallel approach.

- **Test branch completeness** — for any conditional render or behavior, check that every branch has a dedicated test. If CLAUDE.md names specific branches (e.g., ActivityForm direction field for Call/Email/Note/Task/Meeting), all of them are required, not just the ones touched in the current diff.

- **Accessibility and focus** — any element that is shown/hidden (inline forms, modals, drawers) must manage focus correctly: move focus in on open, restore focus to the trigger on close. Verify the trigger ref is mounted when focus restoration fires.

- **RTL safety** — new Tailwind layout classes must use logical properties (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`) not physical ones (`pl-`, `pr-`, `ml-`, `mr-`, `left-`, `right-`).

- **Dependency audit** — run `npm audit --audit-level=high` from the repo root before pushing. Zero high/critical vulnerabilities is required. If a vulnerability is found, fix it (upgrade the package) before opening the PR — do not open with a known audit failure.

## General Behavior

- Ask before deleting or overwriting files
- No placeholder / "coming soon" code — implement it or leave it out
- Tasks >200 lines of new code: pause and confirm approach first
- Prefer editing existing files over creating new ones
- Do not install npm packages without confirming first

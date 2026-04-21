# MiniCRM

A minimal viable CRM (alpha / proof of concept) built to validate the core sales workflow loop: create a contact → attach them to a deal → log activity → move the deal through a pipeline.

[![Build Status](https://github.com/rkseattle/minicrm/actions/workflows/ci.yml/badge.svg)](https://github.com/rkseattle/minicrm/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

## Tech Stack

- **Frontend:** React (Vite), TanStack Query, React Router, Tailwind CSS
- **Backend:** Node.js + Express, REST API, TypeScript
- **Database:** PostgreSQL 16
- **Validation:** Zod (shared schemas used on both client and server)
- **Auth:** JWT stored in httpOnly cookies
- **Infrastructure:** Docker + Docker Compose
- **Monorepo:** npm workspaces (`/client`, `/server`, `/shared`)

## Quick Start

```bash
git clone https://github.com/rkseattle/minicrm.git
cd minicrm
cp .env.example .env
# Edit .env: set ADMIN_PASSWORD and generate JWT_SECRET (see .env.example for instructions)
docker compose up -d
```

Open http://localhost:5173 — the admin account is created automatically on first boot.

To populate realistic demo data:

```bash
npm run seed:demo
```

## Screenshots

### Dashboard

![MiniCRM dashboard showing pipeline value, deal counts, and recent activity](docs/screenshots/01-dashboard.png)

### Pipeline Board

![Deals pipeline board with Kanban columns for each stage](docs/screenshots/05-deals-board.png)

### Contacts

![Contacts list with search and filter controls](docs/screenshots/02-contacts.png)

### Leads

![Leads list with status badges and conversion workflow](docs/screenshots/07-leads.png)

## Local Development

To run with source mounts and hot-reload instead of built images:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

The application will be available at:

- Client: http://localhost:5173
- Server API: http://localhost:3001

To develop without Docker:

```bash
npm install
```

**Server:**

```bash
cp server/.env.example server/.env
# Edit server/.env with your local Postgres credentials
npm run dev --workspace=minicrm-server
```

**Client:**

```bash
npm run dev --workspace=minicrm-client
```

## Running Tests

**Server tests** (requires a running Postgres instance):

```bash
cp .env.test.example .env.test
# Fill in DB_PASSWORD and JWT_SECRET — see comments in .env.test.example for generation instructions.
# Never commit .env.test — it is excluded by .gitignore.
npm test --workspace=minicrm-server
```

**Client tests:**

```bash
npm test --workspace=minicrm-client
# With coverage:
npm run test:coverage --workspace=minicrm-client
```

**E2E tests** (requires the app running and a `minicrm_e2e` database):

```bash
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) npm run test -- --grep @functional
# Smoke tests only:
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) npm run test -- --grep @smoke
```

Copy `qa/e2e/.env.example` to `qa/e2e/.env` and fill in `E2E_BASE_URL`, `E2E_ADMIN_EMAIL`, and `E2E_ADMIN_PASSWORD` before running.

## E2E Test Framework (`qa/e2e/`)

The E2E suite is built on Playwright with a custom framework layer designed for long-term resilience and maintainability. All specs are tagged `@functional`; a subset is additionally tagged `@smoke`.

### Architecture

Tests are organized in four layers:

```
Tests (qa/e2e/tests/apps/minicrm/functional/<domain>/)
    ↓  import behaviors, never raw locators
Behaviors (qa/e2e/behaviors/minicrm/)
    ↓  named async fns; compose Page Objects; return typed results; no assertions
Page Objects (qa/e2e/pages/minicrm/)
    ↓  encapsulate all UI interactions; use HealingLocators
HealingLocators (qa/e2e/framework/healing/)
    ↓  multi-strategy resilient element finders
```

Tests import from `@apps/minicrm/fixtures.js` rather than `@playwright/test` directly, which provides the custom fixtures alongside the standard ones.

### Self-Healing Locators

`HealingLocator` resolves elements using a priority-ordered list of strategies. When the primary strategy fails, it automatically falls back through the list and records the event. This keeps tests green through routine UI refactors without requiring immediate selector updates.

Strategy priority order (highest to lowest):

1. `testId` — `data-testid` attribute (most resilient)
2. `role` — ARIA role + name
3. `label` — form label text
4. `text` — visible text
5. `css` — CSS selector
6. `xpath` — XPath expression (least resilient)

When all static strategies are exhausted and an `intent` string is provided, the locator optionally falls back to an AI-powered recovery step that generates a candidate selector from a scoped DOM snapshot (requires `ANTHROPIC_API_KEY`; disabled if not set).

### Healing Reports

Every heal event (primary strategy failed; fallback used) is recorded in memory per worker and flushed to per-shard JSON files at the end of a run. A post-CI merge step produces a single `healing-report.json` summarizing total heals, AI vs. static heals, and per-event detail. In CI this report is posted as a sticky PR comment so teams can spot selectors that are consistently brittle.

### Test Data Management

The `TestDataManager` fixture tracks every entity created during a test and deletes them in reverse order during teardown. Tests create entities via the REST API using helpers from `qa/e2e/apps/minicrm/helpers.ts` (e.g. `createTestContact`, `createTestDeal`) which automatically register the entity for cleanup. Pre-existing data is never touched.

### REST and gRPC Clients

Both are available as Playwright fixtures:

- `restClient` — typed HTTP client wrapping Playwright's `APIRequestContext`; throws `RestClientError` on 4xx/5xx; supports Bearer, API Key, and Basic Auth strategies.
- `grpcClient` — wraps `@grpc/grpc-js` with JSON serialization; supports unary calls and async-iterable server-streaming calls.

### Global Auth Setup

`globalSetup.ts` runs once before all workers. It logs in via the REST API and writes session state (cookies) to `.auth/admin.json`. All tests reuse this cached state, eliminating per-test browser login overhead. Tests that intentionally exercise unauthenticated flows opt out with `test.use({ storageState: undefined })`.

### Framework Purity

The `qa/e2e/framework/` directory must contain zero application-domain references (no MiniCRM-specific strings, route paths, or domain terms). A CI step (`check-framework-purity.sh`) enforces this — the framework is designed to be dropped into any project unchanged.

### CI Integration

E2E tests run in Phase 3 of the CI pipeline (after server and client unit tests pass). Each push triggers two parallel matrix dimensions:

| Dimension | Values                  |
| --------- | ----------------------- |
| Project   | `desktop`, `mobile-web` |
| Shard     | `1`, `2`, `3`, `4`      |

That produces 8 concurrent runners, each with 4 Playwright workers — 32 parallel test slots per push. Per-shard artifacts (JUnit XML, blob reports, healing files) are collected and merged by an aggregation job. The merged JUnit results are posted to the GitHub Checks tab via `dorny/test-reporter`; the test summary and healing report are posted as sticky PR comments.

## Automated PR Code Review

All pull requests are automatically reviewed by Claude Code via `.github/workflows/claude-review.yml`. The review runs on `pull_request` events (opened, synchronize, reopened) and posts inline comments and a summary review.

### What it checks

- **Architecture violations** — business logic in controllers or routes; `pool.query()` calls outside `server/src/services/`
- **Validation** — missing Zod validation on request bodies; ORDER BY params not allowlist-validated before SQL interpolation
- **Frontend** — missing `data-testid` attributes on interactable elements; hardcoded user-facing strings not wrapped in `t('key')`; physical Tailwind directional classes instead of logical property utilities (RTL safety)
- **Security** — missing `authenticate` middleware; missing `requireRole('admin')` on admin routes; PATCH/DELETE ownership not enforced; `owner_id` from request body instead of `req.user.id`
- **Documentation** — new service functions missing JSDoc; async handlers not wrapped in `try/catch` or `asyncHandler`; non-standard error response shape
- **Scope** — any implementation touching out-of-scope features
- **PR title** — conventional commit prefix (`feat:`, `fix:`, `chore:`, `test:`, `docs:`)

### What it does NOT flag

Style issues enforced by ESLint/Prettier, naming preferences, and correct-but-stylistically-different patterns.

### How to interpret comments

Comments quote the specific code that violated a rule and explain the correct pattern. If the diff is clean, the review will say so briefly.

### Triggering a re-review

Push a new commit to the branch. The `synchronize` event re-triggers the review automatically.

### Auto-fix loop

`.github/workflows/claude-review-autofix.yml` listens for review comments from `github-actions[bot]` (the actor used by the review workflow) and runs Claude Code on the branch to address the feedback automatically, then pushes a fix commit.

## Project Structure

```
/client        React + Vite frontend
/server        Express API server
/shared        Zod schemas shared between client and server
/db            PostgreSQL migration files (node-pg-migrate)
```

### Server conventions

| Directory                 | Purpose                             |
| ------------------------- | ----------------------------------- |
| `server/src/routes/`      | Route definitions only (no logic)   |
| `server/src/controllers/` | Request/response shaping            |
| `server/src/services/`    | Business logic and database queries |
| `server/src/middleware/`  | JWT auth, role gating               |

### Client conventions

| Directory                | Purpose                               |
| ------------------------ | ------------------------------------- |
| `client/src/api/`        | Axios wrappers, one file per resource |
| `client/src/pages/`      | Full page components                  |
| `client/src/components/` | Reusable UI components                |

## Database Migrations

Migrations run automatically on server startup. To run manually:

```bash
npm run migrate --workspace=minicrm-server
```

## Demo Data

Seed realistic demo data into any MiniCRM environment for local development or live demos:

```bash
# Insert demo data (idempotent — safe to check before running)
npm run seed:demo

# Preview what would be inserted without writing to the DB
npm run seed:demo -- --dry-run

# Remove all demo data (leaves real data untouched)
npm run remove:demo
```

Both scripts read database connection from `.env` (`DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST`, `DB_PORT`).

Demo data volume:

- 2 accounts (Acme Corporation, Globex Industries)
- 20 contacts (10 per account)
- 10 deals across Prospecting, Qualification, Proposal, Negotiation, Closed Won, and Closed Lost stages
- 15 activities (calls, emails, notes, meetings, tasks) linked to deals and contacts

All demo records have `is_demo = true`. The remove script deletes **only** rows where `is_demo = true`, so real data is never affected. Running the seed script twice is a no-op if demo data already exists.

## Implemented Features

### Auth

- Email/password login and logout
- Admin can invite users (generates a set-password link)
- Admin can set a user's password directly from the Users page (no email invite required); the user is prompted to change it on their next login
- Users prompted to change their password are redirected to `/change-password` immediately after login
- Admin can assign roles (admin / rep) and deactivate / reactivate users
- JWT stored in httpOnly cookie; sessions expire after 8 hours
- Password requirements: at least 8 characters, at least one letter, and at least one number (validated on both client and server via shared Zod schema)
- Database migration: `007_add_must_change_password.js` adds `must_change_password` boolean column to `users`

### Leads

- Full CRUD for lead records with required fields (`first_name`, `email`) and optional fields (`last_name`, `phone`, `company_name`, `lead_source`, `notes`)
- Lead status lifecycle: `New → Contacted → Qualified → Disqualified`; inline status update from list view with color-coded badges
- Optional disqualification reason stored when status is set to `Disqualified`; disqualified leads hidden by default with a "Show disqualified" toggle
- Status change history recorded in `lead_status_history` and displayed on the lead detail page
- Atomic lead conversion: "Convert Lead" button creates a contact, account, and deal in a single transaction; converted leads hidden by default with a "Show converted" toggle
- Conversion modal prefills contact and deal fields from the lead; supports creating a new account or linking an existing one via typeahead search
- "Converted from lead" back-reference banner shown on the created contact and deal detail pages
- Duplicate email warning on create (matching contact behavior); rep can dismiss or create anyway
- Full CRUD REST API at `/api/leads`; conversion endpoint at `POST /api/leads/:id/convert`; status history at `GET /api/leads/:id/status-history`
- Database migrations: `020_create_leads.js` adds `leads` and `lead_status_history` tables; adds `source_lead_id` FK column to `contacts` and `deals`

### Contacts

- List all contacts in a sortable table with owner column
- Create, edit, and delete contacts via inline forms
- Contact detail page with full field display including resolved owner name
- Search contacts by name or email via the search input (passes `?search=<text>` to the API; case-insensitive substring match across `first_name`, `last_name`, and `email`)
- Search contacts by linked account name via the account search input (`?accountSearch=<text>`)
- Filter contacts by owner (all vs. mine) via `?owner=me` query parameter
- Owner defaults to the creating user; can be reassigned to any active user from the edit form
- Duplicate email detection on create: returns a persistent inline warning banner with a link to the existing contact; rep can still proceed by clicking "Create anyway"
- Address fields: `address_line1`, `address_line2`, `city`, `state_region`, `postal_code`, `country` — collapsible section in the form, displayed on detail page when populated
- Social profile URLs: `linkedin_url`, `twitter_x_url` — collapsible section in the form, displayed as clickable links on detail page when populated
- Contact merge: merge two contact records into one via `POST /api/contacts/:id/merge`; winner survives, loser is deleted; per-field value choices; activities and deal links re-routed to winner; merged audit entry written
- Full CRUD REST API at `/api/contacts`; merge endpoint: `POST /api/contacts/:id/merge`

### Accounts

- List all accounts in a sortable table with owner column
- Create, edit, and delete accounts via inline forms
- Account detail page with full field display including resolved owner name
- Search accounts by company name via the search input (passes `?search=<text>` to the API; case-insensitive substring match on `name`)
- Filter accounts by industry via `?industry=<text>`
- Filter accounts by account type via `?accountType=<type>`
- Filter accounts by owner (all vs. mine) via `?owner=me` query parameter
- Owner defaults to the creating user; can be reassigned to any active user from the edit form
- Account type field: `Prospect`, `Customer`, `Partner`, `Vendor`, `Competitor`, `Other` — displayed as badge on list and detail pages
- Parent account relationship: accounts may have a parent account; circular chain detection prevents invalid hierarchies; subsidiary accounts listed on parent detail page
- Type-ahead parent account search in the edit form
- Linked contacts listed on the account detail page
- Full CRUD REST API at `/api/accounts`; additional endpoints: `GET /api/accounts/search`, `GET /api/accounts/:id/children`

### Deals

- List all deals in a table with stage, value, close date, linked account, and owner columns
- Create, edit, and delete deals via inline forms
- Deal detail page with full field display including resolved owner name and linked account
- Filter deals by owner (all vs. mine) via `?owner=me` query parameter
- Owner defaults to the creating user; can be reassigned to any active user from the edit form
- Linked contacts listed on the deal detail page (populated via `deal_contacts` join table)
- Pipeline stages (fixed): Prospecting → Qualification → Proposal → Negotiation → Closed Won / Closed Lost
- Full CRUD REST API at `/api/deals`
- Database migrations: `004_create_deals.js`, `005_create_deal_contacts.js`

### Activities & Tasks

- Unified activity model with types: Note, Call, Email, Meeting, Task
- Activities can be attached to a contact, account, or deal (at least one required)
- Activity type auto-defaults to "Task" when a due date is provided; "Note" otherwise
- Task completion — mark a task as complete from the timeline; completed tasks are visually distinguished (strikethrough subject, "Complete" badge)
- Edit and delete activities from the timeline (owners and admins only)
- `ActivityTimeline` is a shared component embedded in Contact, Account, and Deal detail pages
- Full CRUD REST API at `/api/activities` with `?contact`, `?account`, `?deal`, and `?owner=me` filter support
- Database migration: `006_create_activities.js`

#### Structured communication logging

- Call and Email activities support two additional fields: **direction** (Inbound / Outbound, required) and **outcome** (free text, optional)
- The `ActivityForm` conditionally shows direction and outcome fields when the selected type is Call or Email; direction is required before the form can be submitted
- The `ActivityTimeline` displays the direction label below the type badge and the outcome text in the card body
- Database migration: `010_add_communication_fields_to_activities.js` (adds `direction activity_direction` and `outcome text` columns, both nullable)

#### My Tasks view

- Dedicated `/tasks` page (linked in the nav bar as **My Tasks**) listing all Task-type activities owned by the current user
- Tasks sorted by due date ascending (no due date appears last)
- Overdue tasks (past due date, still open) show the due date in red with an "Overdue" badge
- Each row shows subject, type badge, due date, and the name of the linked record (contact, account, or deal) as a clickable link
- User can mark any open task complete directly from the list — no navigation to the parent record needed
- Completed tasks are hidden by default; a **Show completed** toggle reveals them
- API endpoint: `GET /api/activities/my-tasks` — returns Task-type activities for the authenticated user, with `linked_record_name` and `linked_record_type` fields joined from the parent record

### Admin Settings

- New `/admin/settings` route and **Admin Settings** nav link (visible to admins only)
- Admin can set a system-wide default language from a dropdown populated with all supported locales
- Selected default persists across restarts via the `system_settings` table (key/value store)
- API endpoints:
  - `GET /api/settings/default-language` — public, returns `{ language }` (used on app load)
  - `PATCH /api/settings/default-language` — admin only, body `{ language }`, returns `{ language }`
- Shared Zod schema `settingsSchema.ts` in `/shared/schemas/` defines `SUPPORTED_LOCALES` and the request/response schemas; locale display names are stored in the i18n translation files under `settings.languages.*`
- Database migration: `008_create_system_settings.js` creates the `system_settings` table and seeds the default row (`default_language = 'en'`)

### Navigation Layout

- Admin can choose between three navigation layouts from the **Admin Settings** page: **Top Nav** (tab bar, default), **Left Nav** (collapsible sidebar), and **Hamburger Menu** (icon-triggered overlay)
- The selected layout is stored in the `system_settings` table (`nav_layout` key) and applies immediately to all users without a page reload
- API endpoints:
  - `GET /api/settings/nav-layout` — public, returns `{ layout }` (used on app load)
  - `PATCH /api/settings/nav-layout` — admin only, body `{ layout }`, returns `{ layout }`
- The active layout is distributed via `NavLayoutContext` / `NavLayoutProvider`; page components use `<NavBar />` without knowing which layout is active
- Each layout is a self-contained React component (`NavTop`, `NavLeft`, `NavHamburger`) with `data-testid` attributes following the `nav-{layout}-{destination}` convention (e.g. `nav-top-contacts`, `nav-left-deals`, `nav-hamburger-tasks`)
- Database migration: `014_add_nav_layout_setting.js` seeds the `nav_layout = 'top'` default row

### Email Notifications

- **Overdue task digest**: A daily cron job runs at 08:00 server time. For each active user who has opted in to overdue task notifications, it sends one HTML email listing all open Tasks past their due date that have not previously been notified. Deduplication is tracked in the `overdue_task_notifications` table — each task is notified at most once.
- **Assignment notifications**: When a contact, account, or deal is reassigned, the new owner receives an email if they have assignments notifications enabled. Multiple assignment events within a 2-minute window are batched into a single email per recipient.
- **User notification preferences**: Every authenticated user can configure three per-category toggles on the `/profile` page: overdue task digests, assignment notifications, and deal stage change notifications. Admins additionally have a global kill switch on the **Admin Settings** page that suppresses all notification emails regardless of individual preferences.
- API endpoints:
  - `GET /api/users/me/notification-preferences` — auth required, returns `{ preferences: { notify_overdue_tasks, notify_assignments, notify_deal_stage_changes } }`
  - `PATCH /api/users/me/notification-preferences` — auth required, body with any subset of the three boolean fields
  - `GET /api/users/notification-recipient-count` — admin only, returns `{ count }` (active users with any notification pref enabled)
  - `GET /api/settings/email-notifications` — auth required, returns `{ enabled: boolean }`
  - `PATCH /api/settings/email-notifications` — admin only, body `{ enabled: boolean }`
- Database migrations: `016_add_notification_prefs_to_users.js` adds three boolean columns to `users`; `017_create_overdue_task_notifications.js` creates the dedup table and seeds the `email_notifications_enabled` system setting
- Email transport uses nodemailer with SMTP env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`); in development and test environments emails are stubbed (logged to console rather than sent)

### Custom Pipeline Stages

- Admin Settings includes a **Pipeline Stages** section where admins can add, rename, reorder (up/down buttons), and delete custom pipeline stages with per-stage default probability percentages
- **Closed Won** and **Closed Lost** are always present, always last, and cannot be renamed or deleted (marked `is_fixed = true` in the DB)
- Deleting a stage is blocked if any open (non-terminal) deals are currently in that stage — the admin sees the deal count and must move those deals first
- Stage names must be unique (case-insensitive); blank names are rejected
- Renaming a stage atomically updates all deals in the old stage name in the same DB transaction — no deal records are orphaned
- Pipeline stage definitions are stored in the new `pipeline_stages` table (migration `021_create_pipeline_stages.js`); the `deals_stage_check` constraint is removed in the same migration
- The client fetches the live stage list on app startup via `GET /api/settings/pipeline-stages` (public endpoint) and caches it for 5 minutes via React Query (`PIPELINE_STAGES_QUERY_KEY`)
- All stage selectors (`DealForm`, `DealCard`, `AutomationRulesPage`) and board columns (`DealsPage`, `StageColumn`) now consume the live stage list via the `usePipelineStages` hook instead of the hardcoded constant
- Custom stage names are displayed using their raw name; built-in stage names still use i18n translation keys
- API endpoints:
  - `GET /api/settings/pipeline-stages` — public, returns `{ stages: PipelineStageResponse[] }` in sort order
  - `POST /api/settings/pipeline-stages` — admin only, body `{ name, sort_order, probability? }`, returns the new stage
  - `PATCH /api/settings/pipeline-stages/:id` — admin only, body `{ name?, sort_order?, probability? }`, returns updated stage; fixed stages reject name changes with 403
  - `DELETE /api/settings/pipeline-stages/:id` — admin only, returns `{ id }` on success; 409 if open deals exist
- Database migration: `021_create_pipeline_stages.js` creates the `pipeline_stages` table, seeds the six default stages, and drops the hardcoded `deals_stage_check` constraint

### Multi-Currency Deal Values

- Each deal now stores an ISO 4217 currency code (`USD`, `EUR`, `GBP`, `CAD`, `AUD`, `JPY`, `CHF`) alongside its value
- The **Deal Form** includes a currency selector; new deals default to the system-wide default currency (see below)
- **Deal cards** and **deal detail pages** format the value with the correct currency symbol and locale-appropriate number format via `Intl.NumberFormat`
- **Pipeline board stage columns** and **dashboard summary cards** detect mixed currencies in a stage: when deals with different currencies are present, totals are replaced with "Multiple currencies — values not summed" to avoid misleading cross-currency arithmetic
- **Win/loss report** similarly shows the mixed-currency note when the filtered deals span multiple currencies
- Admin can set a system-wide **default currency** on the **Admin Settings** page; new deals without an explicit currency pick up the system default at creation time
- **CSV export** includes a `Currency` column alongside `Value`
- API endpoints:
  - `GET /api/settings/default-currency` — public, returns `{ currency }` (used at deal creation time); cached client-side for 5 minutes via `DEFAULT_CURRENCY_QUERY_KEY`
  - `PATCH /api/settings/default-currency` — admin only, body `{ currency }`, returns `{ currency }`
- Database migration: `031_add_currency_to_deals.js` adds `currency VARCHAR(3) NOT NULL DEFAULT 'USD'` to the `deals` table

### Tags / Labels

- **Tags** are freeform labels that can be attached to any contact, account, or deal
- **Tag input** on detail pages (`ContactDetailPage`, `AccountDetailPage`, `DealDetailPage`): type to create or search existing tags, press Enter or comma to confirm, × to remove; matching existing tags appear as a suggestion dropdown (combobox pattern, keyboard-accessible)
- **Tag badges** on list views (`ContactsPage`, `AccountsPage`, and `DealsPage` list view): compact `#tag-name` badges rendered alongside each row; mobile card views also show badges
- **Tag filter** on list views: a dropdown lets users filter to records tagged with one or more tags (any-match); active filters appear as removable badge chips; resets to page 1 on change
- **Admin Tags page** at `/admin/tags`: admins can rename or delete tags globally; accessible from admin nav
- Tag names are stored lowercase; creating a tag that already exists (case-insensitive) returns the existing tag (idempotent upsert)
- Filter uses `EXISTS` subquery in SQL — does not break existing queries when no tags are selected
- List responses embed tags via `JSON_AGG` lateral subquery to avoid N+1 queries
- Database migration: `032_create_tags.js` creates `tags`, `contact_tags`, `account_tags`, and `deal_tags` tables; junction tables have composite PKs and `ON DELETE CASCADE`
- API endpoints:
  - `GET /api/tags` — list all tags
  - `POST /api/tags` — create a tag (name required)
  - `GET /api/tags/:id` — get a tag by ID
  - `PATCH /api/tags/:id` — rename a tag (admin only)
  - `DELETE /api/tags/:id` — delete a tag and all its junction rows (admin only)
  - `GET /api/contacts/:id/tags` — list tags attached to a contact
  - `POST /api/contacts/:id/tags` — attach a tag by name (creates tag if new)
  - `DELETE /api/contacts/:id/tags/:tagId` — detach a tag from a contact
  - Same pattern applies to `/api/accounts/:id/tags` and `/api/deals/:id/tags`

### User Language Preference

- Any authenticated user can set a personal preferred language from the **Profile** page (`/profile`) or by using the language dropdown in the nav bar
- Personal preference overrides the system-wide default at all times; setting it to "Use system default" clears the preference and falls back to the admin-configured default
- The language dropdown in the nav bar now persists the selection to the server (previously session-only)
- On login, the user's stored preference is returned with the `/api/auth/me` response and applied immediately — no language flash
- API endpoints:
  - `GET /api/users/me/language` — auth required, returns `{ language: SupportedLocale | null }`
  - `PATCH /api/users/me/language` — auth required, body `{ language: SupportedLocale | null }`, returns `{ language }`
- Database migration: `009_add_user_preferred_language.js` adds the nullable `preferred_language` column to the `users` table

### Home Dashboard

- Stat cards on the dashboard home page: overdue tasks, tasks due today, open deal count, and total open pipeline value
- Overdue task count is clickable and navigates to **My Tasks** pre-filtered to show only overdue tasks (`/my-tasks?filter=overdue`)
- Per-stage breakdown table showing open deal count and total value for each active pipeline stage (Closed Won / Closed Lost excluded)
- Admins see team-wide metrics; reps see their own data only — enforced server-side
- Data is always fresh on page load (React Query `staleTime: 0`)
- API endpoint: `GET /api/dashboard/summary` — returns `{ overdueTasks, tasksDueToday, openDealCount, openPipelineValue, stageBreakdown }` (auth required)

### Automation Rules

- Admin-only page at `/admin/automation`, accessible from the **Automation** nav link (visible to admins only)
- Admins can create automation rules that pair a **trigger** with an **action**
- **Triggers:** Deal stage changes to a specific stage, Deal is created, Contact is created
- **Actions:** Create task (with configurable subject, type, assignee, and due date offset in days), Send notification (logs message to the server)
- Rules have a name and an enable/disable toggle; disabled rules do not fire
- Rule execution is synchronous — fires inline after the triggering database operation
- For `create_task` actions, the assignee can be the record owner or a specific user
- A **logs drawer** shows the 20 most recent executions per rule: timestamp, triggering record, and outcome (Success / Error with error message on failure)
- API endpoints (admin-only):
  - `GET /api/automation/rules` — list all rules
  - `POST /api/automation/rules` — create a rule
  - `GET /api/automation/rules/:id` — get a rule
  - `PATCH /api/automation/rules/:id` — update a rule (supports partial updates including toggling `enabled`)
  - `DELETE /api/automation/rules/:id` — delete a rule and its logs (CASCADE)
  - `GET /api/automation/rules/:id/logs` — 20 most recent execution logs
- Database migrations: `011_create_automation_rules.js`, `012_create_automation_rule_logs.js`
- Shared Zod schemas in `shared/schemas/automationSchema.ts`

### Win/Loss Report

- Admin-only report page at `/reports/win-loss`, accessible from the navigation bar
- Displays Closed Won count and total value, Closed Lost count and total value, and win rate (Won / Total Closed) for a selected date range
- Date range defaults to the current month; presets for "this quarter" and a custom date range are also available
- Admins can filter the report by owner (rep); reps always see only their own deals
- Loss reason breakdown table shows top loss reasons by count when loss reasons were captured
- Report data is filtered by `close_date` (not `created_at`)
- API endpoint: `GET /api/reports/win-loss?start=YYYY-MM-DD&end=YYYY-MM-DD[&owner_id=UUID]` — returns `{ wonCount, wonValue, lostCount, lostValue, winRate, lossReasonBreakdown }` (auth required)

### Activity Volume Report

- Admin-only report page at `/reports/activity-volume`, accessible from the navigation bar
- Displays activity counts broken down by type (Note, Call, Email, Meeting, Task) and by rep for a selected date range
- Date range defaults to the current month; presets for "this week", "this quarter", and a custom date range are also available
- Admins can filter by owner (rep); reps always see only their own activity
- CSV export available for the full report dataset
- API endpoint: `GET /api/reports/activity-volume?start=YYYY-MM-DD&end=YYYY-MM-DD[&owner_id=UUID]` — returns activity counts grouped by type and owner (auth required)

### Global Search

- Unified search bar available in the nav bar searches across contacts, accounts, deals, and leads simultaneously
- Case-insensitive partial-word matching; returns up to 10 results per entity type
- Ownership-aware: admins see results from all records; reps see only records they own
- Results panel shows entity type label and key fields (e.g. name, email, stage); clicking a result navigates to the detail page
- Results panel is capped in height with long text truncated to keep the UI compact
- API endpoint: `GET /api/search?q=<term>` — returns `{ contacts, accounts, deals, leads }` arrays (auth required)

### Ownership

- Every contact and account has a single `owner_id` that defaults to the creating user
- Owner is displayed as a resolved name (not UUID) in list and detail views
- Active users are fetched from `GET /api/users/active` (auth required, no admin role needed)
- Owner can be changed from the record's edit form; change is reflected immediately without page reload

## API Documentation

The REST API is documented using [OpenAPI 3.0](https://swagger.io/specification/) annotations in the Express route files, generated by [swagger-jsdoc](https://github.com/Surnet/swagger-jsdoc), and served via [Swagger UI](https://swagger.io/tools/swagger-ui/).

### Accessing the docs

Swagger UI is available **only in development and staging** (disabled in production):

```
http://localhost:3001/api-docs
```

The raw OpenAPI JSON spec is available at:

```
http://localhost:3001/api-docs.json
```

### Schema source of truth

All request/response schemas are defined in `server/src/swagger.ts` as `componentSchemas`, derived directly from the shared Zod schemas in `/shared/schemas/`. This means schemas are maintained in one place — the Zod definitions — and referenced via `$ref` in the OpenAPI annotations.

### Keeping docs in sync

A CI step validates that the generated spec is well-formed on every pull request:

```bash
# Runs locally as:
npm run lint:api --workspace=minicrm-server
```

This generates `server/openapi.json` from the annotations and runs `@redocly/cli lint` against it. The lint fails if annotations are malformed or reference undefined schemas.

`eslint-plugin-jsdoc` is also configured to require JSDoc on all route handlers in `server/src/routes/`, ensuring every endpoint has a documentation block.

### Generating the spec manually

```bash
npm run generate-spec --workspace=minicrm-server
# Writes: server/openapi.json
```

## Auth

- Two roles: `admin` and `rep`
- Sessions expire after 8 hours of inactivity
- JWT stored in httpOnly cookie

## Pipeline Stages

Prospecting → Qualification → Proposal → Negotiation → Closed Won / Closed Lost

## Internationalization

All user-facing text supports English, Mandarin Chinese Simplified (`zh-Hans`), Spanish, French, and German via `i18next`.

Supported locale codes (BCP 47): `en`, `zh-Hans`, `es`, `fr`, `de`

The active language is resolved in this order (highest precedence first):

1. User's stored personal preference (set via Profile Settings or the nav bar language dropdown)
2. System-wide default set by an admin via Admin Settings
3. English (hard-coded fallback)

The document `dir` attribute is updated automatically when the language changes. All layout classes in the client use Tailwind logical property utilities (`ps-`/`pe-`, `ms-`/`me-`, `text-start`/`text-end`, `rounded-s-`/`rounded-e-`, etc.) so layout mirrors correctly under `dir="rtl"`. To add an RTL locale (e.g. `ar`), add the locale to `SUPPORTED_LOCALES` in `shared/schemas/settingsSchema.ts` and to the `RTL_LOCALES` set in `client/src/i18n.ts`. Any new UI work must use logical property utilities — physical directional classes (`pl-`, `pr-`, `ml-`, `mr-`, `text-left`, `text-right`, etc.) are not permitted.

Pipeline stage names and currency values are formatted using the active locale (`Intl.NumberFormat` with `style: 'currency'`). i18n keys for pipeline stages use camelCase (e.g. `pipeline.stages.closedWon`) to remain compatible with TMS static-extraction tooling.

## Contributing

Contributions are welcome. For small fixes, open a pull request directly. For larger
changes — new features, architectural changes, or anything that touches the E2E
framework — please open a discussion first so the approach can be agreed on before
work begins.

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Pull requests are automatically reviewed
by Claude Code and must pass CI before merging.

## License

MIT — see [LICENSE](LICENSE).

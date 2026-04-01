# MiniCRM

A minimal viable CRM (alpha / proof of concept) built to validate the core sales workflow loop: create a contact → attach them to a deal → log activity → move the deal through a pipeline.

## Tech Stack

- **Frontend:** React (Vite), TanStack Query, React Router, Tailwind CSS
- **Backend:** Node.js + Express, REST API, TypeScript
- **Database:** PostgreSQL 16
- **Validation:** Zod (shared schemas used on both client and server)
- **Auth:** JWT stored in httpOnly cookies
- **Infrastructure:** Docker + Docker Compose
- **Monorepo:** npm workspaces (`/client`, `/server`, `/shared`)

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development outside Docker)

### 1. Configure environment variables

```bash
cp .env.example .env
# Edit .env and fill in real values
```

### 2. Run with Docker

**Development** (source mounts + hot-reload):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

**Production-like** (built images, no source mounts):

```bash
docker compose up
```

The application will be available at:

- Client: http://localhost:5173
- Server API: http://localhost:3001

## Local Development (without Docker)

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
# Edit .env.test with your test database credentials
npm test --workspace=minicrm-server
```

**Client tests:**

```bash
npm test --workspace=minicrm-client
# With coverage:
npm run test:coverage --workspace=minicrm-client
```

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

## Implemented Features

### Auth (MINCRM-21–23, MINCRM-29)

- Email/password login and logout
- Admin can invite users (generates a set-password link)
- Admin can set a user's password directly from the Users page (no email invite required); the user is prompted to change it on their next login
- Users prompted to change their password are redirected to `/change-password` immediately after login
- Admin can assign roles (admin / rep) and deactivate / reactivate users
- JWT stored in httpOnly cookie; sessions expire after 8 hours
- Password requirements: at least 8 characters, at least one letter, and at least one number (validated on both client and server via shared Zod schema)
- Database migration: `007_add_must_change_password.js` adds `must_change_password` boolean column to `users`

### Contacts (MINCRM-8, MINCRM-14)

- List all contacts in a sortable table with owner column
- Create, edit, and delete contacts via inline forms
- Contact detail page with full field display including resolved owner name
- Filter contacts by owner (all vs. mine) via `?owner=me` query parameter
- Owner defaults to the creating user; can be reassigned to any active user from the edit form
- Full CRUD REST API at `/api/contacts`

### Accounts (MINCRM-9, MINCRM-10, MINCRM-14)

- List all accounts in a sortable table with owner column
- Create, edit, and delete accounts via inline forms
- Account detail page with full field display including resolved owner name
- Filter accounts by owner (all vs. mine) via `?owner=me` query parameter
- Owner defaults to the creating user; can be reassigned to any active user from the edit form
- Linked contacts listed on the account detail page
- Full CRUD REST API at `/api/accounts`

### Deals (MINCRM-15)

- List all deals in a table with stage, value, close date, linked account, and owner columns
- Create, edit, and delete deals via inline forms
- Deal detail page with full field display including resolved owner name and linked account
- Filter deals by owner (all vs. mine) via `?owner=me` query parameter
- Owner defaults to the creating user; can be reassigned to any active user from the edit form
- Linked contacts listed on the deal detail page (populated via `deal_contacts` join table)
- Pipeline stages (fixed): Prospecting → Qualification → Proposal → Negotiation → Closed Won / Closed Lost
- Full CRUD REST API at `/api/deals`
- Database migrations: `004_create_deals.js`, `005_create_deal_contacts.js`

### Activities & Tasks (MINCRM-19, MINCRM-20)

- Unified activity model with types: Note, Call, Email, Meeting, Task
- Activities can be attached to a contact, account, or deal (at least one required)
- Activity type auto-defaults to "Task" when a due date is provided; "Note" otherwise
- Task completion — mark a task as complete from the timeline; completed tasks are visually distinguished (strikethrough subject, "Complete" badge)
- Edit and delete activities from the timeline (owners and admins only)
- `ActivityTimeline` is a shared component embedded in Contact, Account, and Deal detail pages
- Full CRUD REST API at `/api/activities` with `?contact`, `?account`, `?deal`, and `?owner=me` filter support
- Database migration: `006_create_activities.js`

#### Structured communication logging (MINCRM-24)

- Call and Email activities support two additional fields: **direction** (Inbound / Outbound, required) and **outcome** (free text, optional)
- The `ActivityForm` conditionally shows direction and outcome fields when the selected type is Call or Email; direction is required before the form can be submitted
- The `ActivityTimeline` displays the direction label below the type badge and the outcome text in the card body
- Database migration: `010_add_communication_fields_to_activities.js` (adds `direction activity_direction` and `outcome text` columns, both nullable)

#### My Tasks view (MINCRM-20)

- Dedicated `/tasks` page (linked in the nav bar as **My Tasks**) listing all Task-type activities owned by the current user
- Tasks sorted by due date ascending (no due date appears last)
- Overdue tasks (past due date, still open) show the due date in red with an "Overdue" badge
- Each row shows subject, type badge, due date, and the name of the linked record (contact, account, or deal) as a clickable link
- User can mark any open task complete directly from the list — no navigation to the parent record needed
- Completed tasks are hidden by default; a **Show completed** toggle reveals them
- API endpoint: `GET /api/activities/my-tasks` — returns Task-type activities for the authenticated user, with `linked_record_name` and `linked_record_type` fields joined from the parent record

### Admin Settings (MINCRM-30)

- New `/admin/settings` route and **Admin Settings** nav link (visible to admins only)
- Admin can set a system-wide default language from a dropdown populated with all supported locales
- Selected default persists across restarts via the `system_settings` table (key/value store)
- API endpoints:
  - `GET /api/settings/default-language` — public, returns `{ language }` (used on app load)
  - `PATCH /api/settings/default-language` — admin only, body `{ language }`, returns `{ language }`
- Shared Zod schema `settingsSchema.ts` in `/shared/schemas/` defines `SUPPORTED_LOCALES` and the request/response schemas; locale display names are stored in the i18n translation files under `settings.languages.*`
- Database migration: `008_create_system_settings.js` creates the `system_settings` table and seeds the default row (`default_language = 'en'`)

### User Language Preference (MINCRM-31)

- Any authenticated user can set a personal preferred language from the **Profile Settings** page (`/settings/profile`) or by using the language dropdown in the nav bar
- Personal preference overrides the system-wide default at all times; setting it to "Use system default" clears the preference and falls back to the admin-configured default
- The language dropdown in the nav bar now persists the selection to the server (previously session-only)
- On login, the user's stored preference is returned with the `/api/auth/me` response and applied immediately — no language flash
- API endpoints:
  - `GET /api/users/me/language` — auth required, returns `{ language: SupportedLocale | null }`
  - `PATCH /api/users/me/language` — auth required, body `{ language: SupportedLocale | null }`, returns `{ language }`
- Database migration: `009_add_user_preferred_language.js` adds the nullable `preferred_language` column to the `users` table

### Home Dashboard (MINCRM-25)

- Stat cards on the dashboard home page: overdue tasks, tasks due today, open deal count, and total open pipeline value
- Overdue task count is clickable and navigates to **My Tasks** pre-filtered to show only overdue tasks (`/my-tasks?filter=overdue`)
- Per-stage breakdown table showing open deal count and total value for each active pipeline stage (Closed Won / Closed Lost excluded)
- Admins see team-wide metrics; reps see their own data only — enforced server-side
- Data is always fresh on page load (React Query `staleTime: 0`)
- API endpoint: `GET /api/dashboard/summary` — returns `{ overdueTasks, tasksDueToday, openDealCount, openPipelineValue, stageBreakdown }` (auth required)

### Win/Loss Report (MINCRM-26)

- Admin-only report page at `/reports/win-loss`, accessible from the navigation bar
- Displays Closed Won count and total value, Closed Lost count and total value, and win rate (Won / Total Closed) for a selected date range
- Date range defaults to the current month; presets for "this quarter" and a custom date range are also available
- Admins can filter the report by owner (rep); reps always see only their own deals
- Loss reason breakdown table shows top loss reasons by count when loss reasons were captured
- Report data is filtered by `close_date` (not `created_at`)
- API endpoint: `GET /api/reports/win-loss?start=YYYY-MM-DD&end=YYYY-MM-DD[&owner_id=UUID]` — returns `{ wonCount, wonValue, lostCount, lostValue, winRate, lossReasonBreakdown }` (auth required)

### Ownership (MINCRM-14)

- Every contact and account has a single `owner_id` that defaults to the creating user
- Owner is displayed as a resolved name (not UUID) in list and detail views
- Active users are fetched from `GET /api/users/active` (auth required, no admin role needed)
- Owner can be changed from the record's edit form; change is reflected immediately without page reload

## API Documentation (MINCRM-33)

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

The document `dir` attribute is updated automatically when the language changes to support RTL layouts. Adding an RTL locale (e.g. `ar`) to `SUPPORTED_LOCALES` and the `RTL_LOCALES` set in `i18n.ts` is all that is required to enable full RTL support.

Pipeline stage names and currency values are formatted using the active locale (`Intl.NumberFormat` with `style: 'currency'`). i18n keys for pipeline stages use camelCase (e.g. `pipeline.stages.closedWon`) to remain compatible with TMS static-extraction tooling.

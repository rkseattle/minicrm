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

### Auth (MINCRM-21–23)

- Email/password login and logout
- Admin can invite users (generates a set-password link)
- Admin can assign roles (admin / rep) and deactivate / reactivate users
- JWT stored in httpOnly cookie; sessions expire after 8 hours

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

#### My Tasks view (MINCRM-20)

- Dedicated `/tasks` page (linked in the nav bar as **My Tasks**) listing all Task-type activities owned by the current user
- Tasks sorted by due date ascending (no due date appears last)
- Overdue tasks (past due date, still open) show the due date in red with an "Overdue" badge
- Each row shows subject, type badge, due date, and the name of the linked record (contact, account, or deal) as a clickable link
- User can mark any open task complete directly from the list — no navigation to the parent record needed
- Completed tasks are hidden by default; a **Show completed** toggle reveals them
- API endpoint: `GET /api/activities/my-tasks` — returns Task-type activities for the authenticated user, with `linked_record_name` and `linked_record_type` fields joined from the parent record

### Ownership (MINCRM-14)

- Every contact and account has a single `owner_id` that defaults to the creating user
- Owner is displayed as a resolved name (not UUID) in list and detail views
- Active users are fetched from `GET /api/users/active` (auth required, no admin role needed)
- Owner can be changed from the record's edit form; change is reflected immediately without page reload

## Auth

- Two roles: `admin` and `rep`
- Sessions expire after 8 hours of inactivity
- JWT stored in httpOnly cookie

## Pipeline Stages

Prospecting → Qualification → Proposal → Negotiation → Closed Won / Closed Lost

## Internationalization

All user-facing text supports English, Mandarin Chinese, Spanish, French, and German via `i18next`.

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

### Contacts (MINCRM-8)

- List all contacts in a sortable table
- Create, edit, and delete contacts via inline forms
- Contact detail page with full field display
- Contacts are scoped to the authenticated user (`?owner=me` filter supported)
- Full CRUD REST API at `/api/contacts`

## Auth

- Two roles: `admin` and `rep`
- Sessions expire after 8 hours of inactivity
- JWT stored in httpOnly cookie

## Pipeline Stages

Prospecting → Qualification → Proposal → Negotiation → Closed Won / Closed Lost

## Internationalization

All user-facing text supports English, Mandarin Chinese, Spanish, French, and German via `i18next`.

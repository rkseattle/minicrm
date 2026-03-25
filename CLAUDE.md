# MiniCRM — Project Context for Claude Code

## What This Is
A minimal viable CRM (alpha / proof of concept). The goal is to validate the core
sales workflow loop: create a contact → attach them to a deal → log activity → move
the deal through a pipeline. Nothing beyond that loop is in scope for alpha.

## Tech Stack
- **Frontend:** React (Vite), React Query (TanStack) for server state, React Router
- **Backend:** Node.js + Express, REST API
- **Database:** PostgreSQL 16
- **Validation:** Zod (shared schemas used on both client and server)
- **Auth:** JWT stored in httpOnly cookies
- **Infrastructure:** Docker + Docker Compose (one container each for db, server, client)
- **Monorepo layout:** /client, /server, /db — all in one repo

## Project Structure
See the repo layout. Key conventions:
- server/src/routes/      → route definitions only (no logic)
- server/src/controllers/ → request/response handling
- server/src/services/    → business logic (db queries live here)
- server/src/middleware/  → auth.js (JWT verify), requireRole.js (admin gating)
- client/src/api/         → one file per resource (axios wrappers)
- client/src/pages/       → full page components
- client/src/components/  → reusable UI pieces
- db/migrations/          → sequential SQL files (001_, 002_, etc.)

## Database Schema (Core Tables)
- users          → id, email, password_hash, name, role (admin|rep), status
- accounts       → id, name, industry, website, employee_range, revenue_range, owner_id
- contacts       → id, first_name, last_name, email, phone, title, department, account_id, owner_id
- deals          → id, name, stage, value, close_date, loss_reason, account_id, owner_id
- deal_contacts  → deal_id, contact_id  (join table)
- activities     → id, type, subject, notes, due_date, status, contact_id, account_id, deal_id, owner_id

## Auth Rules
- Two roles only: admin and rep
- Reps can create/edit their own records and view all records
- Admins can do everything including user management
- Role gating is enforced at the API layer (not just hidden in the UI)
- Sessions expire after 8 hours of inactivity

## Pipeline Stages (fixed for alpha)
Prospecting → Qualification → Proposal → Negotiation → Closed Won / Closed Lost

## Must-Have Epics (Alpha Scope)
These four epics are in scope. Everything else is post-alpha.

### EPIC 1: Contact & Account Management (MINCRM-1)
Stories: MINCRM-8 through MINCRM-14
- Full CRUD for contacts and accounts
- Contact ↔ Account linking (one account per contact)
- Search by name, filter by owner
- Activity timeline on each record
- Duplicate detection on contact create (email match → warn, don't block)
- Owner assignment (defaults to creator)

### EPIC 2: Lead & Opportunity Tracking (MINCRM-2)
Stories: MINCRM-15 through MINCRM-18
- Full CRUD for deals
- Kanban pipeline board (deals as cards, stages as columns)
- Each stage column shows deal count + total value
- Link contacts to deals (many-to-many)
- Close Won / Close Lost with optional loss reason
- Closed deals filterable from active pipeline view

### EPIC 3: Activity & Task Management (MINCRM-3)
Stories: MINCRM-19 through MINCRM-20
- Unified activity model: type field = Note | Call | Email | Meeting | Task
- Activities can be attached to a contact, account, or deal
- Due date + status (open/complete) for tasks
- "My Tasks" view: all open tasks for current user, sorted by due date, overdue highlighted
- Mark complete directly from the list
- Activity timeline is a shared component reused across Contact, Account, Deal detail pages

### EPIC 4: User Roles & Permissions (MINCRM-4)
Stories: MINCRM-21 through MINCRM-23
- Login/logout with email + password
- Admin can invite users (email invite → set password flow)
- Admin can assign/change roles
- Admin can deactivate/reactivate users
- Deactivated users' records remain intact

## Scope Guard
The alpha scope is defined by epics MINCRM-1 through MINCRM-4 only.
Do not implement, scaffold, or plan anything from MINCRM-5, MINCRM-6, or MINCRM-7
unless explicitly instructed. If a feature request seems out of scope, say so.

## Post-Alpha Epics (DO NOT BUILD FOR NOW)
- MINCRM-5: Communication Tools (email/call integration)
- MINCRM-6: Reporting & Dashboards
- MINCRM-7: Workflow Automation

## Recommended Build Order
1. **Phase 1 — Auth foundation** (users table, login/logout, JWT middleware, role gating)
2. **Phase 2 — Contact & Account** (CRUD, linking, search, timeline stub)
3. **Phase 3 — Deals & Pipeline** (CRUD, Kanban board, close flow)
4. **Phase 4 — Activities & Tasks** (activities table, timeline component, My Tasks page)
5. **Phase 5 — Polish** (duplicate detection, validation, error/empty states)

## Key Implementation Decisions
- Use `node-pg-migrate` for migrations — do NOT rely on docker-entrypoint-initdb.d
- React Query for all server state on the frontend — no raw useEffect for data fetching
- Zod schemas live in a shared location and are imported by both client and server
- httpOnly cookie for JWT — not localStorage
- API always returns consistent error shape: { error: { code, message } }
- All list endpoints support ?owner=me filter for scoping to current user

## Jira Project
Project key: MINCRM
Instance: edwardaspendesigns.atlassian.net
All user stories have acceptance criteria in their descriptions.
Reference story keys when implementing features (e.g., "implements MINCRM-8").


## Rules for Claude Code

### General Behavior
- Always ask before deleting or overwriting existing files
- Never scaffold placeholder / "coming soon" code — implement it or leave it out
- If a task would take more than ~200 lines of new code, pause and confirm the approach first
- Prefer editing existing files over creating new ones when both options are valid

### Code Style
- Use async/await — never raw .then() chains
- All functions must have JSDoc comments for parameters and return type
- No magic numbers — use named constants
- Never use `any` in TypeScript or skip Zod validation
- Coding must pass all relevant linters

### Architecture Rules
- Business logic belongs in /server/src/services — never in routes or controllers
- Controllers only handle request/response shaping — no db calls directly
- All db access goes through the service layer
- New API endpoints must follow the existing REST conventions in CLAUDE.md
- All user-facing text must support internationalization and localization for: English, Mandarin Chinese, Spanish, French, and German
- All functionality must be accurately documented in the project

### Testing
- Write at least one test for every new service function
- Do not modify existing passing tests to make new code pass
- Do not commit with failing tests

### Git
- Commit messages must follow conventional commits: feat:, fix:, chore:, etc.
- Never commit directly to main — always use a feature branch
- Branch names must include the related Jira work item ID as a prefix after the type (e.g. `feat/MINCRM-8-contact-crud`, `fix/MINCRM-15-deal-stage`)
- One logical change per commit — do not bundle unrelated changes
- All pre commit linters must pass

### What NOT to Do
- Do not install new npm packages without confirming first
- Do not modify the database schema without creating a migration file
- Do not build anything from the post-alpha epics (MINCRM-5, 6, 7)
- Do not hardcode credentials or secrets — always use environment variables
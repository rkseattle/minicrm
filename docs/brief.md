# MiniCRM — Project Brief

## What it is

A self-hosted, single-organization CRM for small sales teams. It began as an alpha to
validate the core sales loop — **create a contact → attach a deal → log activity → move
the deal through a pipeline** — and has since grown into a broad CRM with AI assistance,
email sync, and enterprise identity.

It doubles as a **proving ground for engineering rigor**: test-impact analysis,
self-healing E2E tests, and adversarial review gates are first-class goals, not side work.

## Who it serves

- **Sales reps** — contacts, accounts, leads, deals, activities, tasks, notes, sequences.
- **Managers** — dashboards, win/loss, stage trends, coaching and churn insights.
- **Admins** — users, roles and teams, pipeline stages, custom fields, branding,
  automation rules, feature flags, SSO/SCIM, AI governance, GDPR and retention.
- **Integrators** — versioned REST API, gRPC (ConnectRPC), outbound webhooks.

## Product principles

- **One org per deployment** (ADR-001). Data isolation is by `owner_id` and role, never by
  tenant.
- **Configurable, not hardcoded** — pipeline stages, currencies and exchange rates, custom
  fields, and feature flags are all admin data.
- **Every write is audited** in the same transaction; automations and notifications fire
  after commit.
- **Secure by default** — httpOnly JWT with idle and absolute caps, MFA, lockout, rate
  limits, encrypted secrets, startup guards.
- **Global-ready** — i18n everywhere, RTL-safe layout, multi-currency, localized errors.

## What's built (epics MINCRM-1 through 532, Done)

Core CRM records and pipeline · activity and task management · roles, permissions, teams,
SSO and SCIM · reporting and dashboards · workflow automation · CSV import and export ·
attachments · audit log · email notifications · multi-currency · feature-flag targeting ·
AI natural-language assistant with admin controls and token budgets · data hygiene and
duplicate merging · mobile browser support · v1.0 release prep.

Engineering track: the self-healing Playwright framework (MINCRM-106), sharded E2E
(MINCRM-215), and the Coverage/TIA platform (MINCRM-603 through 632) — per-test coverage
collection, code-to-test mapping, change-impact test selection, gap reporting, and CI
integration.

## Where it's heading

**Active:** the Coverage Explorer (MINCRM-669). In the standalone `coverage-dashboard`,
an engineer opens a file at a commit SHA and sees which tests cover the selected lines,
what a chosen set of tests covers, and why the selector picked its tests for a commit
range.

**Queued:**

- Integration testing layer (MINCRM-643) — OpenAPI contract tests, async pipeline tests,
  TestContainers DB isolation, webhook contracts.
- Sending mail through a connected IMAP mailbox (MINCRM-748).
- Dependency security cleanup (MINCRM-746, 747).

**Drafted roadmap (not started):** two-way email and inbox sync (570), calendar sync and
scheduling links (571), telephony (572), integration platform with scoped API keys,
inbound webhooks and Zapier (573), forecasting, quotas and territories (574), native
mobile app (575), and ML-based predictive test selection (638).

## Shape of the system

React/Vite client · Express/TypeScript server (routes → controllers → services) ·
PostgreSQL 16 · Zod schemas shared across workspaces · Docker Compose deploy · npm
workspaces: `client`, `server`, `shared`, `qa`, `coverage-dashboard`.

The rules for working in the code live in `CLAUDE.md`. User-facing behavior lives in
`docs/user-guide/` and `docs/admin-guide.md`.

# ADR-001: Single-org deployment — no multi-tenancy

**Status:** Accepted
**Date:** 2026-06-08
**Ticket:** MINCRM-530

---

## Context

MiniCRM is deployed as a single-organization CRM. Every user account belongs to the same
organization, and all CRM data (contacts, deals, accounts, leads, activities, notes) is
shared across that single namespace. There is no `org_id`, `tenant_id`, or any other
organization-scoping column anywhere in the schema.

Data isolation within the organization is achieved exclusively through `owner_id` — a
foreign key to `users` that identifies which rep or admin created or was assigned a record.
Role-based access control (admin vs. rep) governs what each user can see and mutate, but
it does not create data silos between organizations.

Demo data isolation uses a different mechanism: an `is_demo` boolean column on the five
core entity tables (`contacts`, `accounts`, `deals`, `leads`, `activities`). This allows
demo seed data to coexist with production data in the same database while being
independently identifiable and purgeable.

This is a conscious, appropriate design for a self-hosted or single-customer SaaS CRM.
It simplifies every query (no `WHERE org_id = $1` clause), every index (no org_id prefix
needed for selectivity), and every access-control policy.

---

## Decision

MiniCRM will remain a single-org CRM. No `org_id` or `tenant_id` column will be added to
any table without a formal decision to adopt multi-tenancy that supersedes this ADR.

The `is_demo` flag pattern is the approved mechanism for data isolation within a single
deployment. It is not a substitute for multi-tenancy and must not be extended to serve
distinct organizational data namespaces.

---

## Consequences

### What this makes easy

- Queries are simpler: no mandatory `WHERE org_id = $1` filter on every table scan.
- Indexes are smaller: no need to include `org_id` as a leading column on every index.
- Schema is smaller: 37 entity tables × no `org_id` column = less migration surface area.
- Row-Level Security policies (if added in future) only need to model user/role, not org.
- Onboarding new developers is faster: no multi-tenant query discipline to learn.

### What this forecloses (accepted tradeoffs)

- MiniCRM cannot serve multiple isolated organizations from a single database instance.
  Each organization requires its own deployment (separate database, separate server).
- Isolated demo environments within a shared deployment are limited to the `is_demo` flag
  pattern, which is a soft separation (not enforced by FK constraints or RLS policies).
- If a customer of MiniCRM wants sub-organizations, teams, or workspaces with independent
  data namespaces, this cannot be delivered without the migration described below.

### Migration path if multi-tenancy is ever required

This is a near-complete schema rewrite. Estimated scope: **1–2 sprint weeks** of pure
migration work, plus proportional application-layer changes. The steps are:

1. Create an `organizations` table (id, name, created_at, settings).
2. Add `org_id uuid NOT NULL REFERENCES organizations(id)` to all 37 entity tables via a
   multi-step migration: add nullable, backfill a default org, apply NOT NULL.
3. Update every index that needs org-level selectivity to include `org_id` as a leading
   column (most covering indexes on `owner_id`, `status`, `stage`, `created_at`).
4. Add `org_id` to `users` and update the JWT payload to carry the user's org.
5. Update every service-layer query to include `AND org_id = $n` in WHERE and JOIN
   clauses — approximately 200+ query sites across `server/src/services/`.
6. Update all Zod schemas that accept or return entity references to carry `org_id`.
7. Update or add Row-Level Security policies to enforce org isolation at the DB level.
8. Update all E2E fixtures (TestDataManager) to scope created data to a test org.
9. Update the seeding scripts (`seed-demo.ts`, `e2e:setup`) to operate within an org.

The `is_demo` flag pattern would be superseded by org-level isolation; demo data would
live in a dedicated demo org rather than sharing the production org's namespace.

### Trigger for reconsidering this decision

Reconsider and supersede this ADR when any of the following requirements arises:

- A requirement to isolate data between two or more distinct organizations that **cannot**
  be satisfied by the existing `owner_id` / role model (e.g. a SaaS offering where
  customer A must never see customer B's records, even as an admin).
- A compliance requirement (SOC 2, GDPR controller separation) that mandates logical or
  physical data separation between tenants at the database layer.
- A product decision to offer a "workspaces" or "sub-org" feature that requires independent
  pipelines, custom fields, or user namespaces per workspace.

Demo-data isolation or test-environment isolation are **not** valid triggers — the `is_demo`
flag and the separate `minicrm_e2e` test database already address those cases.

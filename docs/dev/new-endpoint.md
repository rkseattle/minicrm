# New Endpoint Checklist

Read before adding any route under `server/src/routes/`. Each item reflects an
architecture rule in CLAUDE.md; the checklist is the operational form of those rules.

## Layering

- [ ] **Route:** `@openapi` JSDoc plus `asyncHandler` only — no logic
- [ ] **Controller:** Zod `.safeParse()` before the service call; no `pool.query()`
- [ ] **Service:** all business logic and all database access, with an explicit return type

## Input

- [ ] Pagination uses `paginationParamsSchema` from `shared/schemas/paginationSchema.ts`
- [ ] Sort parameters validated against an allowlist before any SQL interpolation

## Authorization

- [ ] `authenticate` middleware on the route
- [ ] `requireRole('admin')` on admin-only routes
- [ ] Feature flag via `requireFeatureEnabled('flag_key')`, with a new sequential
      migration seeding the flag row — never edit the original flags migration — or
      documented as always-on
- [ ] PATCH/DELETE carry ownership in the WHERE clause — never trust the body for actor
      identity
- [ ] Roles and capabilities scoped to least privilege

## Writes

- [ ] Audit entry inside the same transaction, on the same client
- [ ] Assignment notification queued after commit if `owner_id` changed, and not awaited
- [ ] Automation triggers fired with `void`, never awaited

## Errors

- [ ] PG errors mapped explicitly: `23505` → 409, `23503` → 400/409, everything else → 500
- [ ] Error shape `{ error: { code, message } }` on every failure path, with
      SCREAMING_SNAKE_CASE codes

## Verification

- [ ] Service-layer unit test covering ownership enforcement
- [ ] Functional E2E spec added or updated
- [ ] `npm run lint:api --workspace=minicrm-server` passes

---

The transaction, audit, and notification patterns are written out in full in CLAUDE.md
under "Required Patterns for Write Operations". `dealService.ts` is the reference
implementation for an update path with field-level diffing.

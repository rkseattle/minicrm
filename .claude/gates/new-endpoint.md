# New endpoint checklist

Read before adding any route under `server/src/routes/`.

- [ ] Route: `@openapi` JSDoc + `asyncHandler` only — no logic
- [ ] Controller: Zod `.safeParse()` before the service call; no `pool.query()`
- [ ] Pagination: `paginationParamsSchema` from `shared/schemas/paginationSchema.ts`
- [ ] Sort params: allowlist-validated before SQL interpolation
- [ ] Admin-only: `requireRole('admin')` on the route
- [ ] Feature flag: `requireFeatureEnabled('flag_key')` + migration 066 entry, or
      documented as always-on
- [ ] PATCH/DELETE: ownership in the WHERE clause
- [ ] Write ops: audit entry in the same transaction, on the same client
- [ ] Assignment notification after commit if `owner_id` changed — not awaited
- [ ] DB errors mapped: `23505` → 409; `23503` → 400/409; others → 500
- [ ] Error shape `{ error: { code, message } }` on all failure paths
- [ ] Service-layer unit test including ownership enforcement
- [ ] Functional E2E spec added or updated
- [ ] `npm run lint:api --workspace=minicrm-server` passes
- [ ] Roles and capabilities enforced, scoped to least privilege

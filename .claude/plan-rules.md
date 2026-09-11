# Plan rules — MiniCRM

Architecture rules a plan must respect. These restate `CLAUDE.md` in the form a plan is
checked against; `CLAUDE.md` remains authoritative.

- Services own all DB access; no `pool.query()` outside `server/src/services/`
- Controllers shape requests and responses only — no business logic
- Zod `.safeParse()` at the boundary, before every service call
- An audit entry in the same transaction, on the same client, for every write
- Automation triggers and assignment notifications fired after commit, never awaited
- Ownership in the WHERE clause on PATCH/DELETE
- ORDER BY validated against an explicit allowlist before interpolation
- Explicit PG error mapping: `23505` → 409, `23503` → 400/409, others → 500
- Error shape always `{ error: { code, message } }`, code SCREAMING_SNAKE_CASE
- `varchar` + CHECK over new PG enums
- Corrective migrations only — never modify an existing one — each with a real `down`
- Explicit return types on service functions; no `any`; `!` and `as` carry a one-line reason
- No N+1: list endpoints join or batch-load
- `async/await` only, no `.then()` chains
- All async route handlers wrapped in `asyncHandler`

## Where the domain lives

Routes → controllers → services, with `shared/schemas` holding the Zod contracts both sides
use. Client API modules wrap Axios per resource and export `FOO_QUERY_KEY` constants. E2E
splits framework (zero app-domain refs) from behaviors, pages, and specs.

## Explore before planning

- Where the affected domain currently lives — routes, controllers, services, client API
  modules, page objects, behaviors, specs
- The established in-repo pattern for the thing being built
- Blast radius: every caller, import, config key, script, Dockerfile line, and CI step
- Existing test coverage and where new coverage lands
- Relevant ADRs under `docs/adr/` and dev docs under `docs/dev/`

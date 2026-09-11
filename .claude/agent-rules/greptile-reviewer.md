# greptile-reviewer — MiniCRM rules

Read `CLAUDE.md` and the referenced docs under `docs/dev/` and `docs/adr/` for the rules
and prior decisions that apply.

## Per-dimension specifics

**Correctness** — transaction boundaries, partial-failure states, unhandled rejections,
and race conditions, especially React Query cache races and cross-request state.

**Security and data** — authn/authz on every new endpoint, ownership enforcement, SQL
built from unvalidated input, secrets, cookie flags, rate limiting, RBAC and capability
scoping for least privilege; migration reversibility, index coverage for new query paths,
N+1s, polymorphic FK cleanup, constraint choices.

**Architecture** — layering violations, business logic in the wrong layer, cross-module
coupling that bypasses documented internal service interfaces.

**Tests** — coverage of branches, error paths, and ownership enforcement. An E2E spec is
present per story and correctly tagged. A `@serial` spec absent from
`resource-registry.ts` and the regenerated conflict groups is never scheduled — it
silently does not run.

**Consistency** — `data-testid` conventions, query key constants, i18n key placement
across all five locales, RTL logical CSS, no work-item IDs in source comments (`-ok`
markers and `@openapi` blocks are exempt).

**Completeness** — user docs and screenshots, AI tool schemas, evals, ERD regeneration
when a migration is added.

## What the local suite cannot tell you

Nothing structural. Both tiers — unit and E2E — run locally and in CI, so a green run
does support the AC claims, provided the evidence names a test that fails if the behavior
regresses. Where an AC has no such test, say so; do not treat a passing suite as evidence
for a behavior nothing asserts.

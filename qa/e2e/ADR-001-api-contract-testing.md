# ADR-001: API Contract Testing Strategy

**Status:** Accepted  
**Ticket:** MINCRM-370  
**Date:** 2026-05-18

---

## Context

The `RestClient` supports opt-in Zod schema validation (`schema` option on every HTTP
method), but in practice most `restClient` calls in setup helpers used bare type casts
(`body as T`). Three approaches were evaluated for systematic contract coverage:

1. **Mandatory Zod schema validation in helpers** — require every helper to pass the
   appropriate shared Zod schema from `@minicrm/shared/schemas/` to its `restClient`
   call. The infrastructure already exists; the gap is coverage.

2. **Consumer-driven contract testing with Pact** — declare what shape each endpoint must
   return from the consumer's perspective; verify provider compliance on every server
   build via a Pact broker.

3. **OpenAPI drift detection** — generate TypeScript types from the OpenAPI spec
   (`swagger-jsdoc`) using `openapi-ts` and assert the generated types match the
   hand-written shared schemas.

## Decision

**Adopt approach 1 (mandatory Zod schema validation in helpers) as the standard.**  
Approaches 2 and 3 are not adopted at this time.

### Why not Pact?

Pact is designed for microservice environments where consumer and provider are maintained
by separate teams with independent deploy pipelines. It requires:

- A running Pact Broker (infra cost)
- Provider-side verification tests wired into the server build
- Pact DSL to express matchers (duplicates the shared Zod schemas we already have)

In MiniCRM the consumer (E2E layer) and provider (server) live in the same monorepo and
are deployed together. The shared Zod schemas already encode the contract in a
single source of truth. Adding Pact would duplicate that contract in a second DSL
and introduce broker infra for a problem the shared schemas solve structurally.

### Why not OpenAPI drift detection?

The OpenAPI spec is generated from JSDoc annotations on route files — it is derived from
the code, not the ground truth. Comparing generated types to hand-written schemas would
detect drift between JSDoc and schemas, but not between the actual server behaviour and
the schemas. Runtime Zod validation catches the latter directly and is therefore a
strictly stronger signal.

### Why Zod in helpers?

- **Zero new dependencies** — the validation path already exists in `RestClient`.
- **Single source of truth** — `shared/schemas/` are already maintained and imported by
  both server (request validation) and client (form validation). Reusing them in E2E
  helpers means contract drift anywhere in the stack is detected.
- **Early failure** — a shape mismatch throws a `RestClientError` with Zod details before
  any domain assertion runs. The failure message includes the HTTP method, path, and
  field-level error, making regressions immediately diagnosable.
- **Low maintenance cost** — adding a new helper requires wiring one `schema:` option;
  the schema itself is already maintained as part of normal feature work.

## What changed

### `shared/schemas/`

Added response envelope schemas for the previously unvalidated entities:

| Schema                             | Exported from       |
| ---------------------------------- | ------------------- |
| `tagResponseEnvelopeSchema`        | `tagSchema.ts`      |
| `activityResponseEnvelopeSchema`   | `activitySchema.ts` |
| `authMeResponseEnvelopeSchema`     | `userSchema.ts`     |
| `inviteUserResponseEnvelopeSchema` | `userSchema.ts`     |

These follow the same `z.object({ <entity>: <entityResponseSchema> })` pattern as the
existing `contactResponseEnvelopeSchema`, `accountResponseEnvelopeSchema`, and
`dealResponseEnvelopeSchema`.

### `qa/e2e/apps/minicrm/helpers.ts`

All 6 previously unvalidated `restClient` calls now pass the appropriate schema:

| Helper               | Endpoint                    | Schema                             |
| -------------------- | --------------------------- | ---------------------------------- |
| `createTestTag`      | `POST /api/v1/tags`         | `tagResponseEnvelopeSchema`        |
| `createTestActivity` | `POST /api/v1/activities`   | `activityResponseEnvelopeSchema`   |
| `createTestUser`     | `POST /api/v1/users/invite` | `inviteUserResponseEnvelopeSchema` |
| `loginAndVerify`     | `GET /api/v1/auth/me`       | `authMeResponseEnvelopeSchema`     |

### PoC spec

`qa/e2e/tests/apps/minicrm/functional/framework/api-contract.spec.ts` contains five
tests demonstrating the contract coverage:

- **CT-1 to CT-4** — positive tests: create real entities through the newly-validated
  helpers; schema validation fires on every call.
- **CT-5** — negative test: calls `restClient.post` with an intentionally impossible
  schema (`missing_field: z.string()`) and asserts that a `RestClientError` with a
  populated `validationError` is thrown. This proves the machinery catches regressions
  independently of whether a test happens to assert on the changed field.

## Consequences

- Any server-side field rename, type change, or envelope restructure on the covered
  endpoints will be caught at the first E2E run that exercises that endpoint.
- New helpers must follow the same pattern: import the relevant envelope schema from
  `shared/schemas/` and pass it as `schema:` to the `restClient` call.
- The `loginAndVerify` helper in `helpers.ts` now validates `/auth/me`. The `loginAsAdmin`
  behavior in `auth.behaviors.ts` does not (it only calls `login`, not `/auth/me`) — this
  is acceptable because every functional test that calls `loginAsAdmin` will exercise at
  least one validated helper in the same test body.

## Follow-on work

See MINCRM-378 (follow-on implementation story) for:

- Extending schema validation to `restClient` calls in `behaviors/` files
- A TypeScript type-level enforcement mechanism (making the `schema:` option required for
  any call that returns a typed `T`) so omitting it is a compile error

# MiniCRM — Claude Code Context

## Procedures live outside this file

This file holds **facts** — architecture, security, domain rules, conventions. Anything
that is a repeatable procedure lives in a gate file or a skill and loads on demand.

| Need                                      | Where                                                  |
| ----------------------------------------- | ------------------------------------------------------ |
| Definition of Done, before every commit   | `.claude/gates/definition-of-done.md`                  |
| Status report at every phase boundary     | `.claude/gates/status-report.md`                       |
| Pre-push checklist and pre-PR self-review | `.claude/gates/pre-push.md`                            |
| E2E run procedure and cadence policy      | `.claude/gates/e2e-run.md`                             |
| New endpoint checklist                    | `docs/dev/new-endpoint.md`                             |
| E2E authoring rules                       | `e2e-authoring` skill — auto-loads on `qa/**`          |
| Full delivery workflow, plan → PR → green | `/deliver`, or the stage skills                        |
| Jira transitions, PR feedback handling    | `plan-work`, `implement-phases`, `ship-pr`, `ci-green` |
| Turn blocked with phases unfinished       | `.claude/hooks/block-false-stop.sh`                    |

---

## External Project References

- **Jira project:** `MINCRM` (MiniCRM) on `edwardaspendesigns.atlassian.net`. Use this
  project key for all ticket search, lookup, and creation unless a task explicitly
  names a different project (e.g. `LAR`, `MININT`).
- **GitHub repository:** `rkseattle/minicrm` (`https://github.com/rkseattle/minicrm`).

**JQL label search gotcha:** `~` is fuzzy text matching against a text index, not glob
— `labels ~ "foo*"` will not match `foo-bar-baz`. When an exact `labels = "<prefix>"`
returns nothing, assume the prefix is incomplete rather than that the label is absent.
Drop the filter, search broadly (`labels ~ "<fragment>"`, or a plain
`project = X ORDER BY created DESC` listing) to see the real label strings in use, then
re-run an exact match on the full slug.

---

## Stack

- **Client:** React + Vite, TanStack Query v5, React Router, Tailwind CSS, i18next
- **Server:** Node.js + Express + TypeScript, REST, Zod validation
- **DB:** PostgreSQL 16, node-pg-migrate
- **Auth:** JWT in httpOnly cookie — 30-minute sliding idle window, 8-hour absolute cap
- **Infra:** Docker + Docker Compose, npm workspaces (`/client`, `/server`, `/shared`, `/qa`)
- **gRPC:** ConnectRPC (`@connectrpc/connect-express`) + `@connectrpc/connect-web`

## Project Layout

```
server/src/
  routes/        → @openapi JSDoc + asyncHandler ONLY — no logic
  controllers/   → request/response shaping ONLY — no pool.query()
  services/      → ALL business logic + ALL DB queries
  middleware/    → auth.ts, requireRole.ts, asyncHandler.ts
  grpc/          → ConnectRPC handler + proto/

client/src/
  api/           → one Axios wrapper per resource; exports typed fns + QUERY_KEY constants
  pages/         → full page components
  components/    → reusable UI
  hooks/         → custom React hooks

shared/schemas/  → Zod schemas used by both client and server (.ts only — .js outputs gitignored)
                   (documented exception: coverageHarnessAdapterSchema.ts is a plain TS
                   interface, no Zod, consumed only by qa/ — it lives here anyway because
                   it imports coverageSessionSchema.ts's Zod types and qa/e2e/framework/
                   must stay free of any @minicrm/shared/schemas import; there is no
                   qa-local home that avoids the same import. See that file's own docblock.)

shared/types/    → shared TypeScript contracts that are neither Zod schemas nor guard
                   parity rules. The bar is: both client and server need the same
                   definition, and expressing it as a runtime schema would be dishonest
                   because nothing is validated. Created rather than widening the
                   schemas/ exception, per coverageHarnessAdapterSchema.ts's own
                   instruction. Today that is recordPath.ts, the record-type →
                   client-route mapping (MINCRM-726), pinned to App.tsx's route table by
                   server/src/__tests__/recordPath.test.ts. Keep these dependency-free so
                   every workspace can import them.

shared/testing/  → pure rules that a SERVER-BUILT file and a qa/ file must run identically.
                   Not Zod, not client-facing — a documented exception to the line above,
                   and deliberately narrow. The bar is: two guards need the same rule,
                   neither can import the other, and drift between them is dangerous
                   rather than merely untidy. Today that is testStackDbPort.ts, the
                   dev-port refusal fronting `TRUNCATE ... CASCADE` and `CREATE DATABASE`
                   (MINCRM-699) — hand-synced copies had already drifted into a bypass
                   where `05432` reached the dev database. server/src/scripts/ cannot
                   import from qa/: server/Dockerfile copies only server/ and shared/, and
                   an input outside those shifts tsc's inferred rootDir out from under the
                   Dockerfile's hardcoded COPY/CMD paths — and CI never builds that image,
                   so it would not be caught there. Keep these files dependency-free (no
                   zod, no Node built-ins, no I/O) so every workspace can import them.

db/migrations/   → sequential node-pg-migrate files (ls db/migrations/ | tail -1 to find last)

qa/e2e/
  framework/     → ZERO app-domain refs — healing locator, fixtures, reporters, REST/gRPC clients
  behaviors/minicrm/ → named async behavior fns
  pages/minicrm/ → Page Objects
  apps/minicrm/  → fixtures.ts, helpers.ts, test-data-manager.ts
  tests/apps/minicrm/functional/<domain>/ → spec files tagged @functional
  tests/framework/ → unit specs for framework/ and qa/scripts/ helpers
```

**Documented exception — the qa→server source imports (allowlist of two).**
Both exist for the same reason: a rule that deliberately lives in BOTH workspaces
(because `qa/` must not import server's DB-bound modules at runtime) needs
something to pin the two copies together, and a test can only do that by
importing the real definition rather than a copy of it. A copied constant in the
test would go on passing while the implementations drifted — which is the exact
failure the test exists to catch.

1. `qa/e2e/tests/framework/merge-junit-results.spec.ts` → `server/src/scripts/junitXml.ts`
   — pins the Playwright JUnit CDATA-redaction rule against `qa/scripts/junit-xml.ts`.
   `junitXml.ts` was split out of `verify-test-attestation.ts` specifically to make
   this import free of a `pg.Pool` and `dotenv/config`. (MINCRM-689)
2. `qa/e2e/tests/framework/coverage-session-control-client.spec.ts` →
   `server/src/coverageAgent/coverageConfig.ts` — runs the QA session resolver
   over a corpus and asserts it accepts/rejects what `SAFE_PATH_SEGMENT_PATTERN`
   does. One tags coverage SESSIONS, the other coverage DUMPS; a split is
   invisible until a gate reports `no-session-attribution` or a generated map is
   unusable. `coverageConfig.ts` reaches only `pino` via `logger.ts` — no pool,
   no dotenv. Note this covers RESOLVER BEHAVIOUR, not regex text: source-level
   equality of the three copies is enforced separately by
   `qa/scripts/check-sha-pattern-parity.sh`, whose detection is not bounded by a
   hand-written corpus. Keep both — one catches a resolver that stops consulting
   its pattern, the other catches a character change no corpus distinguishes.
   (MINCRM-688)

**Adding a third requires all of the same:** import-safety (no `pg.Pool`, no
`dotenv/config` pulled in at module load), an in-file comment carrying this
justification within the comment budget above, and an entry in `ci.yml`'s `qa`
paths filter for the server file — without that filter entry the parity test is silent
on exactly the server-side edit it guards.

**The paths-filter rule generalizes beyond those two.** Any test that pins a file
outside its own workspace — a parity assertion, a docs-completeness check, a
shared fixture — must ensure that file triggers the job running the test, or the
guard is silent on precisely the edit it exists to catch. The invariant is usually
**bidirectional**: it breaks by editing either side.

**Scope the trigger to the job, not the workspace.** Check what the natural
workspace filter actually gates before adding to it — counting
`needs.changes.outputs.<name> ==` occurrences inside `if:` expressions, `qa` appears in
eight job conditions and `server` in seven, both including the full `e2e-functional`
matrix. The two `qa` entries above predate this guidance and are grandfathered: a server-only
edit to `junitXml.ts` does boot the whole E2E suite, which is over-broad but
harmless enough that churning `ci.yml` to fix it is not worth it. Don't copy that
shape for new guards.

**But reach an existing filter before adding one.** Editing `.github/workflows/**` forces
the full functional E2E suite — the TIA selector's `ci-workflow` rule is `alwaysWiden`, by
design, because a workflow edit changes whether tests run at all. So a single-purpose
output is the **last** resort, not the default: name the guard `scripts/check-*.{sh,mjs,ts}`
(already globbed by `guard-invocation`) or place it where a filter already matches both
sides, and the wiring costs nothing. Only when no existing filter can cover both sides is
a new output correct — then OR it into the specific jobs that run the test. The full list
and the measured cost are in `.claude/gates/definition-of-done.md`.

**A guard's file location is part of its trigger scope.** A single-purpose output narrows
nothing if a broad filter already matches the directory you put the file in — the job
runs on the union, so the narrow output never gets to be the deciding trigger. Before
adding a guard, check which filters already match its intended directory.

Concretely: `qa/scripts/**` is matched by the `qa` filter, which gates the whole
`e2e-functional` matrix, so a guard placed there boots four sharded jobs plus the serial
run to check a script no Playwright spec imports. Put repo-wide guards in `scripts/`,
which no broad filter matches. `scripts/check-ci-filter-globs.mjs` enforces the half of
this that is a literal path check.

**`always()` is mandatory on the job you gate.** GitHub auto-skips a job when
anything in its `needs` was skipped, _before_ evaluating `if:` — so a
single-purpose filter alone is not enough if an upstream job doesn't match the
new path. Use the repo's established form (see `e2e-functional`, MINCRM-271):
`always() && (needs.<upstream>.result == 'success' || needs.<upstream>.result ==
'skipped') && <your changes gate>`. The explicit result check is what preserves
the upstream gate so a real failure still blocks.

The worked example is `attestation-docs` (MINCRM-691):
`verifyTestAttestation.test.ts` asserts every `AttestationFailureReason` is
documented in `docs/dev/coverage.md`'s "Reading a failed run" list, so that file
gets its own filter output, OR'd into `server-tests` alone, with `always()` and a
`lint-and-typecheck` result check. All three parts are load-bearing: with no
entry a docs-only PR deleting a reason runs markdownlint and skips the guard;
folded into `server` it runs the entire E2E suite; without `always()` it is
skipped anyway, because `lint-and-typecheck` doesn't match `.md` paths either.

Reference docs: [schema](docs/dev/schema.md) · [migrations](docs/dev/migrations.md) ·
[grpc](docs/dev/grpc.md) · [retention](docs/dev/retention.md) ·
[ai-chat](docs/dev/ai-chat.md) · [coverage](docs/dev/coverage.md) ·
[email-sync](docs/dev/email-sync.md) ·
[dates-and-timezones](docs/dev/dates-and-timezones.md) ·
[e2e-performance](docs/dev/e2e-performance.md) · [e2e-authoring](docs/dev/e2e-authoring.md) ·
[eslint-plugins](docs/dev/eslint-plugins.md) · [local-sso](docs/dev/local-sso.md) ·
[ADRs](docs/adr/) · [dev index](docs/dev/index.md)

---

## Architecture Rules

- **Services own all DB access.** No `pool.query()` outside `server/src/services/`.
- **Controllers shape requests/responses only.** No business logic.
- **Zod `.safeParse()` in controllers before every service call.** Return
  `400: { error: { code, message } }`.
- **Error shape always:** `{ error: { code: string, message: string } }` — code is
  SCREAMING_SNAKE_CASE.
- **HTTP status codes:** 400 validation · 401 unauthed · 403 forbidden · 404 not found ·
  409 conflict.
- **Map PG errors explicitly:** `23505` → 409 with domain code; `23503` → 400/409;
  others → 500.
- **No N+1 queries.** List endpoints must join or batch-load.
- **`async/await` only.** No `.then()` chains.
- **`no-explicit-any` enforced.** Fix the type; never suppress.
- **Comments explain why, never what.** Use the fewest words that carry the reason; no
  comment beats one that restates the line above it. A comment's subject is the **code** —
  never the ticket, the review round, or an earlier revision of itself; that history goes
  in the commit message, which never goes stale. **Budget:** an inline justification is one
  line, 15 words. A block comment is for a genuinely non-obvious constraint — an invariant,
  a footgun, a why-not — and earns its length by naming one. Exempt as contract or machine
  input: `@openapi` blocks, the `-ok` suppression markers, directive comments
  (`eslint-disable*`, `@ts-expect-error`, `v8 ignore`, `/// <reference>`,
  `prettier-ignore`), JSDoc tag lines (`@param`, `@returns`, `@throws`) on exported
  members, and `require-locator-intent`'s `intent` strings.
- **Non-null `!` and `as` casts** require an inline comment explaining why it's safe, in
  one line.
- **No work-item IDs in source comments.** `MINCRM-N`, `LAR-N`, `MININT-N` belong in
  commit messages, PR titles, and branch names — never in a comment. State the _reason_
  inline without the ID; `git blame` → commit → PR is the authoritative provenance and
  never goes stale. Enforced by `local-comments/no-work-item-id-in-comment`. Two
  exemptions: the `-ok` suppression markers (`MINCRM-686-ok`, `MINCRM-368-ok`), whose
  spelling is matched by `qa/scripts/check-e2e-cleanup.sh` and
  `check-e2e-beforeall.sh`, and `@openapi` blocks, which are served API contract text.
  Prose in Markdown — this file, gates, ADRs, dev docs — may cite a ticket as a decision
  record; that is a different use than annotating a line of code.
- **The same rule applies to catalog comments** — `COMMENT ON` strings and the `comment:`
  option in migrations. They are not source comments (they become live database metadata,
  surfaced by `psql \d+` and any DB tooling), so ESLint never sees them and
  `strip-work-item-ids.ts --verify` cannot either: a `COMMENT ON` string is a string token,
  not a comment token. But a reader meets them with no more ability to resolve a Jira key,
  so the reason belongs inline and the ID in the commit. Fix them with a **corrective
  migration** — never by editing a migration that may already have run — preserving the
  description verbatim and restoring it exactly in `down`. `qa/migrations/007` is the
  worked example. `db/migrations/`'s remaining catalog IDs are MINCRM-728's.
- **Service functions must declare explicit return types.**
- **No `console.log` in `server/src/`** outside tests. Use `logger.info/warn/error`.
- **No magic numbers or strings.** Use named constants.
- **All async route handlers** wrapped in `asyncHandler` or explicit try/catch.

Adding a route? Read [docs/dev/new-endpoint.md](docs/dev/new-endpoint.md) first.

---

## Security — Required on Every Authenticated Endpoint

1. **`authenticate` middleware** on every route — verifies JWT, `status === 'active'`,
   `must_change_password`.
2. **Ownership on PATCH/DELETE:** `WHERE id = $1 AND (owner_id = $2 OR $3 = 'admin')` —
   never trust `req.body` for actor identity.
3. **ORDER BY allowlist** — validate sort column against an explicit `as const` array
   before SQL interpolation.
4. **Cookie:** write the session cookie only through `setSessionCookie`
   (`server/src/auth/sessionCookie.ts`), which applies
   `httpOnly: true, secure: prod-only, sameSite: 'lax', maxAge: 30m`. The 8-hour absolute
   cap is enforced separately via the `login_at` claim, not the cookie. Any other auth
   cookie spreads `AUTH_COOKIE_ATTRIBUTES` rather than restating the flags.
5. **Rate limiting** on `POST /api/v1/auth/login` and `POST /api/v1/auth/forgot-password`
   (`E2E=true` bypasses).
6. **Startup guards:** reject weak `JWT_SECRET` (< 32 chars or known weak values) and
   malformed `NODE_ENCRYPTION_KEY` (must be 64-char hex).

---

## Required Patterns for Write Operations

### Transactions + audit logging (every CREATE/UPDATE/DELETE)

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const result = await client.query<Row>('INSERT INTO ... RETURNING ...', values);
  await writeAuditEntry(client, { ... });   // SAME client, SAME tx
  await client.query('COMMIT');
  void fireAutomationTrigger('contact_created', { ... }); // after commit, never await
  return result.rows[0];
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

For UPDATE: use `diffFields(before, after, auditBase)` + `writeAuditEntries(client, entries)`.
See `dealService.ts`.

### AuditActor (all write service functions)

```ts
export interface AuditActor {
  id: string;
  name: string;
}
const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };
// Controllers: const actor = { id: req.user.id, name: req.user.name };
```

### Assignment notifications

Call `queueAssignmentNotification(...)` after commit — never inside the tx, never `await`.

### Automation triggers

Always `void fireAutomationTrigger(...)` — never `await`. It swallows all internal errors.

---

## Key Domain Rules

- **Pipeline stages are dynamic** — fetch via `GET /api/v1/settings/pipeline-stages`;
  never hardcode. Validate as non-empty string at Zod level, then verify against the
  `pipeline_stages` table in the service.
- **Currency** — `deals.currency varchar(3) DEFAULT 'USD'`. Use `SUPPORTED_CURRENCIES`
  from settingsSchema; resolve default via `getDefaultCurrency()`. Format with
  `Intl.NumberFormat` using the deal's own currency.
- **i18n** — all user-facing strings via `t('key')`; no hardcoded English in JSX. RTL:
  use logical CSS (`ps-`/`pe-`, `ms-`/`me-`, `start-`/`end-`) not physical directional
  classes.
- **Migrations** — never modify existing; write corrective migrations. Every migration
  needs `up` + `down`. Add migration → regenerate ERD in same PR. See
  [docs/dev/migrations.md](docs/dev/migrations.md).
- **lead.last_name** — nullable on leads, NOT NULL on contacts. `convertLeadSchema`
  enforces it at the conversion boundary. No `?? ''` fallback.
- **varchar + CHECK** for new constrained-string columns — never new PG ENUMs.
- **Polymorphic FK cleanup** — when hard-deleting a parent, clean up
  attachments/custom_field_values (hard-delete) and notes (soft-delete via
  `softDeleteNotesByEntity`) in the same tx. See [docs/dev/schema.md](docs/dev/schema.md).
- **system_settings writes** — always pass AuditActor; use SYSTEM_ACTOR only for
  seeding/migration.
- **feature_flags.role_overrides** — transitional; never bypass
  `assertValidRoleOverrides()`.
- **Custom fields (EAV)** — type-aware filtering/sorting is O(n) at scale. Read ADR-002
  before writing SQL on custom fields.

---

## Frontend Conventions

- **`data-testid`:** static → `"new-contact-button"`; row-scoped →
  `` `contact-card-${id}` ``; action+entity → `"contacts-export-csv-button"`.
- **React Query:** every API module exports `FOO_QUERY_KEY = ['foo'] as const`; never
  inline strings in `queryKey`. `staleTime: 5*60*1000` on `/api/v1/users/active`;
  `staleTime: 0` on dashboard summary. No global `staleTime`.
- **Responsive:** `min-w-0` on flex children with text; `break-words` on freetext;
  `clamp()` for fluid font sizes. Test at 600/900/1100px.

---

## Testing

**Server** (`server/src/__tests__/`) — Vitest against real `minicrm_test` DB. 70%
lines/functions/branches/statements (CI). `beforeEach` truncates tables. Required:
`auth-boundaries.test.ts`, `auditService.test.ts`, `notificationService.test.ts`.

**Client** (`client/src/`) — Vitest + RTL + MSW (`onUnhandledRequest: 'error'`). 70%
lines/functions/branches/statements (CI). Co-locate `Component.test.tsx`. Every async
component tests loading + error + empty. Every conditional branch gets a test.

All three workspaces enforce 70/70/70/70 — `server/vitest.config.ts`,
`client/vite.config.ts`, `coverage-dashboard/vite.config.ts`. The configs are
authoritative; `qa/`'s framework suite is the separate 80% bar (`qa/package.json`).

Run the suites sequentially with `npm run unit_test` — it runs three workspaces (server,
client, coverage-dashboard) in series. Never run them in parallel, and **run nothing else
heavy alongside them** (a Playwright run, a second test run in another terminal). They are
CPU-bound, so competition for cores does not slow them gracefully — it fails them, as
timeouts in files unrelated to your change. Measured: server 153s idle vs 2924s with
failures when oversubscribed; client 133s idle vs 1055s. Worker counts and both timeouts
(`testTimeout` and `hookTimeout` — Vitest resolves them independently, so setting only one
leaves the other at its default) are capped in all three workspaces' vitest configs, with
the measurements in the comments there. Re-measure on an idle machine before changing them.

Never load `.env` into a unit test run. `env $(cat .env | ...) npm test` breaks
`NODE_ENV=test`-gated code paths such as the rate limiter — that pattern is correct for
E2E only.

**No failure is ever a known flake.** Not flaky, not pre-existing, not unrelated.
Whether a test has failed before is irrelevant; every failure gets root-caused and
fixed. A rerun that passes is not a resolution. If root cause isn't found, say so
explicitly and ask how to proceed. Full policy: `.claude/gates/e2e-run.md`.

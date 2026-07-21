# Coverage/TIA Instrumentation

Runtime code coverage collection from the live MiniCRM stack — backend and frontend — for functional/E2E and manual-exploratory testing. Foundation for the broader Coverage/TIA (Test Impact Analysis) initiative (MINCRM-603). Phase 1 covers instrumentation and collection (MINCRM-604, MINCRM-605, MINCRM-606, MINCRM-607). Phase 2 (this document's [Session Management](#session-management-mincrm-609612) section) adds session grouping, correlation-ID attribution, and a manual-testing recorder (MINCRM-609, MINCRM-610, MINCRM-611, MINCRM-612). See [Deferred to later phases](#deferred-to-later-phases) for what remains intentionally out of scope.

## Files

| Path                                                             | Purpose                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `server/src/coverageAgent/CoverageAgent.ts`                      | `CoverageAgent` interface + `CoverageDump` type                            |
| `server/src/coverageAgent/NodeV8CoverageAgent.ts`                | Backend agent — Node inspector API, `reset`/`snapshot`/`dump`              |
| `server/src/coverageAgent/coverageConfig.ts`                     | Env-var resolution: enabled, granularity, commit SHA, dumps root           |
| `server/src/coverageAgent/coverageAgentRegistry.ts`              | Module-level singleton holding the process's agent instance                |
| `server/src/coverageAgent/dumpIndex.ts`                          | Append-only `dumpId` → metadata-path lookup index                          |
| `server/src/services/coverageDumpService.ts`                     | Wraps the agent + dumpIndex; handles browser-dump ingestion                |
| `server/src/controllers/coverageController.ts`                   | Request/response shaping for the control API                               |
| `server/src/routes/coverage.ts`                                  | `@openapi` routes, mounted at `/api/v1/admin/coverage`                     |
| `shared/schemas/coverageSchema.ts`                               | Zod request/response schemas, shared server+client+qa                      |
| `db/migrations/156_add_coverage_instrumentation_flag.js`         | Seeds the `coverage_instrumentation` feature flag, off by default          |
| `client/vite.config.ts`                                          | `vite-plugin-istanbul`, added to `plugins` only when `COVERAGE=true`       |
| `qa/e2e/framework/coverageAgent/browser-coverage-agent.ts`       | Client-side: pulls `window.__coverage__`, submits to the dump endpoint     |
| `qa/e2e/framework/coverageAgent/coverage-control-client.ts`      | Reference client for the backend verbs (reset/snapshot/dump)               |
| `qa/e2e/framework/reporting/coverage-reporter.ts`                | Triggers one final dump at run end when `E2E_COVERAGE_GRANULARITY=per-run` |
| `qa/e2e/globalTeardown.ts`                                       | Reset safety-net after each E2E run                                        |
| `qa/e2e/apps/minicrm/fixtures.ts`                                | Per-test coverage pull+submit wired into the `page` fixture                |
| `qa/e2e/tests/apps/minicrm/functional/coverage-instrumentation/` | Functional spec exercising the control API end to end                      |

Note: framework-layer coverage files live under `coverageAgent/`, not `coverage/` — the repo's `.gitignore` has an unanchored `coverage/` pattern (for Vitest's test-coverage output) that would otherwise silently ignore a literal `coverage/` directory anywhere in the tree, including this one.

### Phase 2 — Session management files

| Path                                                                | Purpose                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `server/src/middleware/correlationId.ts`                            | Reads `x-coverage-correlation-id` into `req.coverageCorrelationId`  |
| `server/src/services/coverageSessionService.ts`                     | `CoverageSession` CRUD + dump attribution, transactional + audited  |
| `server/src/controllers/coverageSessionController.ts`               | Request/response shaping for the session control API                |
| `server/src/routes/coverageSessions.ts`                             | `@openapi` routes, mounted at `/api/v1/admin/coverage/sessions`     |
| `shared/schemas/coverageSessionSchema.ts`                           | Zod schemas for sessions + the `CORRELATION_ID_HEADER` constant     |
| `db/migrations/157_add_coverage_sessions.js`                        | `coverage_sessions` + `coverage_session_dumps` tables, feature flag |
| `qa/e2e/framework/coverageAgent/coverage-session-control-client.ts` | Reference client for the session verbs (start/end/record-dump)      |
| `client/src/api/coverageSessions.ts`                                | Axios wrapper + `COVERAGE_SESSIONS_QUERY_KEY` for the recorder UI   |
| `client/src/pages/admin/CoverageSessionRecorderPage.tsx`            | Manual-testing session recorder control panel (MINCRM-611)          |

## Mounting

In `app.ts`, alongside the other admin routers:

```ts
app.use(`${API_V1}/admin/coverage`, coverageRoutes);
```

All routes: `authenticate → requireRole('admin') → requireFeatureEnabled('coverage_instrumentation') → asyncHandler(handler)`.

## Backend Agent (MINCRM-604)

Uses the stable `node:inspector` module's `Profiler.startPreciseCoverage` / `Profiler.takePreciseCoverage`, not `node:inspector/promises` (still experimental on the Node versions this repo targets) and not the `NODE_V8_COVERAGE` env var. `NODE_V8_COVERAGE` writes raw per-process coverage files automatically on process exit — that conflicts directly with MINCRM-604's "on-demand reset/dump while process stays up" requirement, since it offers no in-process control surface. The inspector API gives real on-demand control instead, at the cost of needing to drive it from application code (`server.ts` constructs and starts the agent at boot).

**V8 constraint — reset-on-read:** `Profiler.takePreciseCoverage()` resets accumulated call counts as a side effect of reading them. There is no CDP-level non-destructive read. This means `snapshot()` is **not** a true non-destructive read despite the name — calling it clears counters just like `dump()` does, it just doesn't persist an artifact to disk. A `snapshot()` call between two `dump()` calls will make the second dump's coverage look artificially low. Treat `snapshot()` as "peek and clear," not "peek."

Enabled only when `COVERAGE_INSTRUMENTATION=true` at boot — checked once, not per-request. Coverage is at branch/block granularity by default (`COVERAGE_GRANULARITY=block`), function-level only with `COVERAGE_GRANULARITY=function`.

## Frontend Agent (MINCRM-605)

`vite-plugin-istanbul`, added to `client/vite.config.ts`'s `plugins` array only when `COVERAGE=true` at Vite config-eval time. An unset env var means the plugin is never in the array — a normal `vite build`/`vite dev` is byte-identical to an unmodified checkout.

Sourcemapping to original `.tsx` needs no extra configuration: Vite's dev/build pipeline never strips sourcemaps from its own chain, and Istanbul's injected counters ride along inside the same instrumented module output the sourcemap already describes.

Coverage is exposed on `window.__coverage__` once the served bundle is instrumented. There is no server-side "browser agent" — the server cannot reach into a browser tab it did not render. Instead, `browser-coverage-agent.ts` pulls the coverage map via `page.evaluate()` and POSTs it to `POST /api/v1/admin/coverage/dump` with `source: 'browser'`, where it's tagged and stored identically to a backend dump.

Works headless (CI, Playwright-driven) and headed (local manual exploratory) identically, since instrumentation is baked into the served bundle rather than driven by the test runner.

## Control API (MINCRM-606)

| Method | Path                                   | Purpose                                                                                                           |
| ------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/admin/coverage/reset`         | Reset the backend agent's counters. `204`.                                                                        |
| `POST` | `/api/v1/admin/coverage/snapshot`      | Read current counters without persisting an artifact (still resets — see above). Returns dump metadata only.      |
| `POST` | `/api/v1/admin/coverage/dump`          | Persist a tagged dump. No body → backend agent. `{ source: 'browser', payload, label }` → ingest a frontend dump. |
| `GET`  | `/api/v1/admin/coverage/dumps/:dumpId` | Look up metadata for a previously produced dump.                                                                  |

`dumpId` is a `crypto.randomUUID()` generated at persist time — commit SHA is a tag _on_ the dump, not the identifier, since many dumps share a SHA across a run.

**Two distinct gates, easy to conflate:** the `coverage_instrumentation` feature flag controls _who may call this API_; the `COVERAGE_INSTRUMENTATION` env var controls _whether the backend agent actually started at boot_. A flag-on, agent-off server returns `409 COVERAGE_NOT_ENABLED` on `reset`/`snapshot`/`dump` — the flag check passes, the request reaches the handler, and the handler discovers there's no agent to operate on.

**Auth:** the existing Bearer service-account token path (`authenticate` middleware) — no new auth mechanism. This is what CI and the E2E reference client use.

**Persistence:** file-based, not a DB table. Each dump writes `<dumpsRoot>/<commitSha>/<dumpId>.json` (raw payload) + `<dumpId>.meta.json` (sidecar metadata), plus an append-only `index.jsonl` for `GET /dumps/:dumpId` lookups. `dumpsRoot` defaults to `<process.cwd()>/coverage-dumps` (gitignored). Phase 1 has no per-owner semantics and no downstream consumer of a queryable dump table — a later mapping-engine phase adds one only if it actually needs to join against dump metadata.

### Reference client

```ts
import { resetCoverage, dumpCoverage } from '@framework/coverageAgent/coverage-control-client.js';

await resetCoverage(restClient);
const dump = await dumpCoverage(restClient, 'my-test-label');
```

`restClient` needs an authenticated session (e.g. `loginAsAdmin(restClient)`) and the `coverage_instrumentation` flag enabled. Equivalent curl:

```bash
curl -X POST http://localhost:3001/api/v1/admin/coverage/dump \
  -H "Content-Type: application/json" \
  --cookie "minicrm_token=<jwt>" \
  -d '{"label": "my-test-label"}'
```

## Low-Overhead Mode (MINCRM-607)

Three independent, off-by-default toggles so an unmodified run pays zero overhead:

| Env var                    | Values                 | Effect                                                                                                                      | Default     |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `COVERAGE_INSTRUMENTATION` | `true` / unset         | Whether the backend V8 agent starts at all, checked once at server boot                                                     | unset (off) |
| `COVERAGE_GRANULARITY`     | `block` / `function`   | V8's `detailed` flag — block/branch-level vs. function-level-only coverage                                                  | `block`     |
| `E2E_COVERAGE_GRANULARITY` | `per-test` / `per-run` | Whether the E2E fixture layer pulls+submits frontend coverage after every test, or only once at end-of-run via the reporter | `per-test`  |

"No behavioral differences (timeouts, race conditions) attributable to instrumentation" is satisfied structurally: every coverage-related call lives in a `try/finally` around the `page` fixture, in the reporter's `onEnd()`, or in `globalTeardown` — never inside a locator/action wait path, which the E2E authoring rules already forbid (`page.waitForTimeout()` and `networkidle` waits are banned outright).

### Measured overhead

Measured 2026-07-20 against a live `server-e2e` container, functional suite subset (`webhooks/` + `deals/`, 43 tests, desktop project, 2 local workers):

| Mode                                                                | Total test duration | Overhead |
| ------------------------------------------------------------------- | ------------------- | -------- |
| Off (baseline)                                                      | 108.8s              | —        |
| On, `E2E_COVERAGE_GRANULARITY=per-run`                              | 110.9s              | ~1.9%    |
| On, `E2E_COVERAGE_GRANULARITY=per-test` (backend-only — see caveat) | 111.3s              | ~2.3%    |

All 43 tests passed in every configuration — no failures or timeouts attributable to instrumentation.

**Caveat on the per-test number:** this measurement's client bundle was not rebuilt with `COVERAGE=true`, so the per-test frontend pull/submit hit its no-op early-return path (`window.__coverage__` absent) rather than actually pulling and POSTing a real Istanbul payload per test. The number above reflects backend-only overhead in per-test mode, not the true worst case with a fully-instrumented frontend. Re-measure with a `COVERAGE=true` client build before treating per-test mode's overhead as final. Both measured numbers are well under a proposed acceptance bar of ≤10% (per-run) / ≤25% (per-test) — re-validate the per-test bar once measured against a real instrumented frontend.

This was measured manually, not via an automated CI gate — wiring an automated regression assertion against these numbers is a reasonable follow-up once they're re-validated with a real instrumented client build, not a day-one requirement.

## Session Management (MINCRM-609..612)

A `CoverageSession` is a logical grouping of one or more coverage dumps attributed to a single automated test run or manual-exploratory-testing session. It does **not** provide physically isolated V8 counters — `NodeV8CoverageAgent` remains a single process-wide counter set (see the Shared test environment note above). Instead, attribution works by tagging dumps produced during a session with that session's `correlationId`, so overlapping sessions on the same server instance can be told apart in the _stored data_ even though the underlying counters are shared.

### Data model

- `coverage_sessions` — one row per session. `status` transitions `active` → `ended` (never reopened). `version` supports optimistic locking so two concurrent end-session requests can't both succeed. `correlation_id` (unique) is minted at start time.
- `coverage_session_dumps` — join table attributing a `dumpId` (still file-based, per Phase 1 — not FK'd, only referenced by UUID) to a session, plus optional `testId`/`testName`/`attempt` for retry attribution. `attempt` distinguishes a Playwright retry re-running the same `testId`: the first (possibly failed) attempt and the retry are two distinct rows, never overwritten or merged.

### Correlation-ID propagation

`x-coverage-correlation-id` (see `CORRELATION_ID_HEADER` in `coverageSessionSchema.ts`) is read by `correlationId` middleware — mounted globally in `app.ts`, before the route table — into `req.coverageCorrelationId`. It's a no-op for the overwhelming majority of requests, which carry no such header. The E2E harness and the manual-testing recorder are the only senders today.

**What actually consumes it:** `POST /api/v1/admin/coverage/dump` (`coverageController.ts`'s `attributeDumpToSessionIfCorrelated`) checks `req.coverageCorrelationId` after persisting a dump — if it matches a currently-_active_ session, the dump is auto-attributed to that session, exactly as if `POST /coverage/sessions/:sessionId/dumps` had been called with that `dumpId` and `correlationId`. This is best-effort and never fails the dump response itself; a stale/unknown/missing correlation ID just means no attribution happens. Callers that already propagate the header (the manual recorder) get attribution for free and must NOT also call `POST /coverage/sessions/:sessionId/dumps` explicitly — the `dumpId` unique constraint would reject the second attempt as a duplicate. The E2E harness fixture takes the opposite path: it explicitly calls the record-dump endpoint instead, because its dump POST (via the per-test `restClient`, over `pullAndSubmitBrowserCoverage`) never actually carries the header — only the browser page context and the fixture's separate `sessionClient` do.

### Session control API

| Method | Path                                               | Purpose                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/admin/coverage/sessions`                  | Start a session; mints and returns a `correlationId`.                                                                                                                                                                                                                                                                                                                               |
| `GET`  | `/api/v1/admin/coverage/sessions`                  | List currently-active sessions, paginated (`page`/`limit`, same convention as every other list endpoint — `paginationParamsSchema`). Returns `{ data, total, page, limit }`.                                                                                                                                                                                                        |
| `GET`  | `/api/v1/admin/coverage/sessions/:sessionId`       | Look up a single session. `400` for a non-UUID `sessionId`.                                                                                                                                                                                                                                                                                                                         |
| `POST` | `/api/v1/admin/coverage/sessions/:sessionId/end`   | End a session (optimistic-locked on `version`). `409` on conflict (already ended or stale version).                                                                                                                                                                                                                                                                                 |
| `POST` | `/api/v1/admin/coverage/sessions/:sessionId/dumps` | Record a `dumpId`'s attribution to a session (after `POST /coverage/dump`). `409` if the session has already ended, or if `dumpId` was already recorded (anywhere — including via auto-attribution above). `400` if `correlationId` doesn't match this session's own — a caller cannot attribute a dump to `sessionId` while stamping it with a different session's correlation ID. |

Gated by `authenticate → requireRole('admin') → requireFeatureEnabled('coverage_session_management')`, mirroring `coverage.ts`. The `coverage_session_management` flag is independent of `coverage_instrumentation` (migration 156) — a session can exist even when the backend V8 agent itself never started, e.g. a browser-only manual session. Mounted in `app.ts` **before** the general `coverage.ts` router, so a future top-level route added there can never shadow `/admin/coverage/sessions`.

A dump can only ever attribute to an **active** session whose `correlation_id` matches the caller-supplied value — `recordCoverageSessionDump`'s INSERT is scoped to `WHERE EXISTS (... status = 'active' AND correlation_id = ...)` atomically in a single statement, so there's no check-then-insert race and no way to attribute a dump to one session while stamping it with another's correlation ID.

`coverage_sessions.started_by` is nullable with `ON DELETE SET NULL` (not `CASCADE`) — deleting a user must not silently destroy their coverage/testing session history, mirroring migration 074's fix for the same anti-pattern on `import_jobs.created_by`/`webhook_subscriptions.created_by`.

### E2E harness hooks (MINCRM-609)

Wired into `qa/e2e/apps/minicrm/fixtures.ts`'s `page` fixture — the same `try/finally` block that already handles per-test coverage pull+submit. No per-spec-file edits are required. On test start the fixture starts (or joins) a session tagged with the test ID/name and build SHA and injects the correlation-ID header into the browser context; the existing `finally` block explicitly records the dump's attribution (see the correlation-ID note above for why this path can't rely on auto-attribution) and ends the session.

### Manual-testing session recorder (MINCRM-611)

An in-app admin control panel (`client/src/pages/admin/CoverageSessionRecorderPage.tsx`) to check in (name the session, optionally a MiniCRM issue key), record (sets the correlation-ID header as a default header on the shared client-side axios instance for the duration), and check out (triggers a dump — auto-attributed server-side via the correlation ID — and ends the session). Ties to the current build SHA automatically. The correlation header is cleared on check-out regardless of whether the dump/end calls succeed (`onSettled`, not `onSuccess`), since leaving it set on the shared axios instance would otherwise tag every subsequent request from that browser tab — not just this page's — until a full reload. Check-out treats a failed dump as non-fatal and still ends the session: `coverage_instrumentation` (migration 156) can be off independently of this page's own `coverage_session_management` gate, and a hard failure there must not permanently strand a recording session.

## Local / CI / Shared-env setup

**Local — backend only:**

```bash
COVERAGE_INSTRUMENTATION=true npx tsx server/src/server.ts
```

**Local — frontend only:**

```bash
COVERAGE=true npm run dev --workspace=minicrm-client
```

**Local — E2E against a coverage-enabled server-e2e:**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile e2e up -d server-e2e \
  -e COVERAGE_INSTRUMENTATION=true  # or set in docker-compose.override.yml
```

Then enable the `coverage_instrumentation` feature flag (via the admin UI, or directly: `UPDATE feature_flags SET enabled = true WHERE flag_key = 'coverage_instrumentation'`) before calling the control API.

**CI:** set `COVERAGE_INSTRUMENTATION=true` in the server start step's env block for a job that opts in; the coverage flag still needs to be enabled separately (it's data, not env-gated). Dump artifacts land under `server/coverage-dumps/` and can be uploaded the same way `server/coverage/lcov.info` already is in `ci.yml`'s `server-tests` job.

**Shared test environment:** enabling this is a legitimate use case (the story explicitly calls it out), but there is no per-session isolation — the backend agent is a single process-wide counter set with no multi-tenant separation. Every concurrent request on that server instance contributes to the same counters. This is fine for a dedicated CI/E2E instance; it would produce meaningless aggregate data if naively left on for a real multi-user shared staging environment with concurrent human traffic. Turn it off when not actively collecting.

## Deferred to later phases

Not built here — later `pr-tia-*` phases:

- Test-to-code mapping (which test exercised which line) — mapping engine phase
- Physically isolated per-session V8 counters — sessions group and attribute dumps; the backend agent's counters remain process-wide (see Session Management above)
- ML-based test selection
- Historical coverage trend storage or dashboards
- Coverage-driven CI gating (failing a build on coverage drop)
- Cross-shard dump merging/aggregation — CI currently uploads per-shard dump directories as-is
- An automated overhead-regression CI gate (the measurement above is manual)

# E2E gate — required once before every push

## Cadence policy

These four rules stack; none relaxes another.

1. **Once per push, not per commit.** On a multi-phase branch, E2E runs exactly once,
   immediately before pushing. Typecheck / lint / audit / unit tests / QA static checks
   still gate every commit. For a single-commit change that isn't part of an explicit
   phased plan, E2E still runs before the change is considered done.
2. **Scope the run to the branch's affected domains.** Target the spec files covering
   domains the branch actually touched with `--grep` — not the whole `@functional`
   suite. If you are not confident the blast radius is contained, ask before narrowing.
3. **Never rerun, for any reason.** Run once, accept the result. Load-induced timeouts
   are not a reason to rerun. If it fails, root-cause and fix, then run **once** after
   the fix.
4. **Validate a fix narrowly.** The post-fix run targets only the specific failing
   spec(s) with `--grep`. The scoped suite gets its one run at the actual push gate.

## Infrastructure — once per dev machine boot

```bash
docker compose -f docker-compose.test.yml up -d
npm run e2e:client   # separate terminal — serves the test UI on :5175, API :3002
```

> **Before a run that records coverage, use the export + build/up sequence in
> [The run](#the-run) instead of the bare `up` above.** The server reads
> `GIT_COMMIT_SHA` once, at start, so it must be exported first — and a stack started
> here on one commit keeps tagging dumps with that SHA after you switch branches.
> Bringing the stack up this way is fine for everything else.

The test stack is its own Compose project (`minicrm-test`), fully isolated from the dev
stack: Postgres on **5433**, server on 3002, MinIO on 9002/9003 (MINCRM-684). Never
point an E2E run at the dev stack's 5432/3001. `E2E_API_URL=http://localhost:3002` and
`E2E_BASE_URL=http://localhost:5175` live in `qa/e2e/.env`.

> **`e2e:client`, not `dev:client`.** They serve different ports —
> `e2e:client` on **5175** proxying to the test server (3002), `dev:client` on **5173**
> proxying to the dev server (3001) — so both can run at once and the two UIs are
> independent. Each prints its target on startup. Playwright refuses to run when
> `E2E_BASE_URL` is unset outside CI rather than defaulting to 5173, so pointing a run
> at the dev frontend now fails loudly instead of silently mutating the dev database.

Regenerating `qa/coverage-map.json` locally requires frontend coverage
instrumentation, which is off by default: start the client with
`COVERAGE=true npm run e2e:client` instead. Without it, `window.__coverage__`
never exists in the browser and every per-test frontend coverage
pull/submit in `fixtures.ts` silently no-ops (see docs/dev/coverage.md's
Low-Overhead Mode section). Leave `E2E_COVERAGE_GRANULARITY` unset — its
default is `per-test`, which is what actually produces `coverage_test_links`
rows; `per-run` routes every dump through `coverage-reporter.ts`'s single
end-of-run dump with no test attribution at all.

## The run

`date` goes in its own Bash call. Never chain it with `&&`.

```bash
date
```

```bash
# GIT_COMMIT_SHA lets the test server tag coverage dumps with the real branch SHA
# instead of falling back to "unknown" — that container has no .git mounted, so
# `git rev-parse HEAD` always fails inside the container otherwise. Export
# before build/up so the value is available when the container starts.
#
# The export and the build/up below are ONE unit: the container reads this value
# only at start, so re-exporting without recreating the server changes nothing,
# and a stack started on an earlier commit keeps tagging dumps with that stale
# SHA. Skipping the export no longer fails silently — the Playwright harness
# warns when a session would be tagged "unknown", and the pre-push hook warns
# when the running stack's SHA is not HEAD (MINCRM-688). Recreating the server
# WIPES /app/coverage-dumps, so copy out anything you still need first (see
# "Ingesting" below).
export GIT_COMMIT_SHA=$(git rev-parse HEAD)

# Rebuild the E2E server image so new server code is actually in the container
docker compose -f docker-compose.test.yml build server
docker compose -f docker-compose.test.yml up -d server

# Re-seed admin user, MinIO storage config, Mailhog SMTP config
env $(cat qa/e2e/.env | grep -v '^#' | grep -v '^$' | xargs) npm run e2e:setup

# Clear stale results so they cannot influence pass/fail
rm -rf qa/e2e/test-results/

# Non-serial — --workers=1 matches CI's LPT file-per-shard isolation
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
  npm run test -- --grep "@functional" --grep-invert "serial" --workers=1

# Serial — always single-worker, matches the e2e-serial CI job
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
  npm run test -- --grep "@functional.*@serial|@serial.*@functional" --workers=1
```

Add domain scoping to the `--grep` per rule 2.

## Regenerating the local coverage map (optional, TIA-focused work only)

Producing dumps is not enough — `coverage_test_links` only gets populated by
explicitly ingesting them, then exporting. CI's `tia-record-mode.yml` does
this after its own suite run; the routine pre-push gate above does not need
it and can stop at "Reading results" below.

```bash
# Dumps live inside the container's own filesystem (server's cwd is /app,
# not the bind-mounted /app/server), never on the host — copy them out
# before ingesting. Rebuilding/recreating the test server wipes them, so do this
# immediately after the run, against the same container instance that
# produced them.
docker cp minicrm-test-server:/app/coverage-dumps <scratchpad-path>/coverage-dumps

env $(cat qa/e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
  COVERAGE_DUMPS_ROOT=<scratchpad-path>/coverage-dumps \
  npm run ingest:coverage-dumps --workspace=minicrm-qa

DB_USER=minicrm DB_PASSWORD=password DB_NAME=minicrm_e2e DB_HOST=localhost \
  DB_PORT=5433 COVERAGE_DB_NAME=minicrm_coverage_e2e \
  npm run dump:coverage-map --workspace=minicrm-server
```

Verify `qa/coverage-map.json` has substantially more than a handful of
entries and covers real application files, not just one self-testing spec,
before committing it.

**Known local limitation:** the E2E harness runs Vite directly on the host
while the test server runs the backend in a container — every frontend
Istanbul dump's absolute path is therefore a host path the container can
never see under any `sourceRoot`. Frontend units generated by a purely
local run land as `resolved: false` (raw, unportable absolute `filePath`,
excluded from `coverage_test_links`) — this is expected here, not a bug to
chase further. Backend (V8) units resolve correctly, since the container's
own cwd already is the repo root. Do NOT commit a locally-generated
`qa/coverage-map.json` as the authoritative map — `tia-record-mode.yml`'s
CI run is the only environment where both agents share one filesystem
namespace and produce a fully portable map; that workflow commits it back
to `main` on its own. Local generation here is for diagnosing/validating
the pipeline, not for producing the file that ships.

## Reading results

Read `qa/e2e/test-results/results.xml` for pass/fail/skip counts. Never the console
output, never the exit code. If output is truncated, read the file — do not re-run.

## Failure handling

Every failure gets root-caused. Never label one a known flake, flaky, pre-existing, or
unrelated as grounds to stop investigating. Whether the test has failed before is
irrelevant. Never compare against `main` to dismiss a failure. If root cause isn't
found, say so explicitly and ask how to proceed.

For a healed-locator failure, download the run's `healing-report.json` artifact —
`gh api .../artifacts/<id>/zip` — which shows the exact original → healed strategy per
event. The local `heal-trends.json` is from a different run and is misleading.

For a suspected React Query race, after a second failed fix attempt stop guessing at
API options and add console tracing of cache state at each callback.

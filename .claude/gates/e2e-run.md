# E2E gate — required once before every push

## Cadence policy

These four rules stack; none relaxes another.

1. **Once per push, not per commit.** On a multi-phase branch, E2E runs exactly once,
   immediately before pushing. Typecheck / lint / audit / unit tests / QA static checks
   still gate every commit. For a single-commit change that isn't part of an explicit
   phased plan, E2E still runs before the change is considered done.
2. **Let TIA choose the scope; never hand-pick it.** The push gate is `git push` — the
   `pre-push` hook resolves the diff to affected specs via `select-tests.ts`, the same
   script CI's select-mode job calls, and widens to the full `@functional` suite by
   itself when the diff is unmapped, low-confidence, or the map is stale. A `--grep` you
   compose is a third selection implementation nobody reviewed, built from filenames
   rather than from `coverage_test_links`. It also discards the hook's attestation, which
   is what proves the selected specs _ran against this HEAD_ rather than were merely
   attempted.
3. **Never rerun, for any reason.** Run once, accept the result. Load-induced timeouts
   are not a reason to rerun. If it fails, root-cause and fix, then run **once** after
   the fix.

   **A killed run is not a result.** If the run was interrupted before it wrote
   `results.xml` — a tool timeout, a stopped background task, a closed session — there is
   no verdict to accept and nothing was learned. Confirm HEAD is unchanged and start it
   again, detached. That is not a rerun: this rule governs runs that finished and told
   you something, and its purpose is to stop you re-rolling a failure you dislike.

4. **Validate a fix narrowly.** The post-fix run targets only the specific failing
   spec(s) with `--grep`. That is the one place a hand-written `--grep` is right: the
   target is a spec you watched fail, not a guess about blast radius. The selected suite
   gets its one run at the actual push gate.

Rules 2, 3, and 4, and the failure-handling section below, apply to anyone running this
suite. They are documented for humans in
[docs/operations.md](../../docs/operations.md#reading-results); this file is the agent
copy. Rule 1 is agent pacing and has no human equivalent.

## Infrastructure — once per dev machine boot

```bash
docker compose -f docker-compose.test.yml up -d
npm run e2e:client   # separate terminal — serves the test UI on :5175, API :3002
```

> **Before a run that records coverage, use the export + build/up sequence in
> [The run, by hand](#the-run-by-hand) instead of the bare `up` above.** The server reads
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

Regenerating `qa/coverage-map.jsonl` locally requires frontend coverage
instrumentation, which is off by default: start the client with
`COVERAGE=true npm run e2e:client` instead. Without it, `window.__coverage__`
never exists in the browser and every per-test frontend coverage
pull/submit in `fixtures.ts` silently no-ops (see docs/dev/coverage.md's
Low-Overhead Mode section). Leave `E2E_COVERAGE_GRANULARITY` unset — its
default is `per-test`, which is what actually produces `coverage_test_links`
rows; `per-run` routes every dump through `coverage-reporter.ts`'s single
end-of-run dump with no test attribution at all.

## The run, by hand

**The push gate is `git push`** — the hook runs the selected suite and attests it. This
section is the manual procedure for the cases that sit outside it: the hook's own
full-suite fallback runs exactly this, and it is what you run when a bypass is warranted
per `.claude/gates/pre-push.md`, or when validating a fix against a spec you watched fail.

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

# Non-serial — both projects, matching e2e-functional's [desktop, mobile-web]
# matrix. --workers=1 is NOT parity with CI (which runs 4 workers per shard) —
# a local run is unsharded, so every spec is visible to every worker, and the
# single-threaded test server caps throughput anyway (~6% between 1 and 2).
# PW_GLOBAL_TIMEOUT_MS is REQUIRED — see "The 20-minute globalTimeout" below.
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
  PW_GLOBAL_TIMEOUT_MS=3600000 \
  npm run test -- --grep "@functional" --grep-invert "visual-regression|serial" --workers=1

# Serial — DESKTOP ONLY, and single-worker. Both halves match the e2e-serial
# CI job, which pins --project=desktop (ci.yml) and never runs mobile-web.
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
  PW_GLOBAL_TIMEOUT_MS=1500000 \
  npm run test -- --project=desktop \
  --grep "@functional.*@serial|@serial.*@functional" --workers=1
```

### The 20-minute globalTimeout, and why these commands override it

`playwright.config.ts` caps a run at 20 minutes. That figure is calibrated for **CI's
sharded multi-project matrix** — shard and worker counts come from the capacity probe,
so they track runner size (2 shards × 4 workers × 2 projects today) — where each shard
runs a slice. A local run is unsharded against a single test-server Node process, so it
is not the same workload and cannot meet that budget.

Measured (recorded in `scripts/pre-push-tia.ts` and the config's own comment): of ~1030
non-serial tests, only **~420–445 complete in 20 minutes** at 1 _or_ 2 workers — a ~6%
difference, not the ~2× more workers would predict, because the single-process test
server is the bottleneck. `pre-push-tia.ts` therefore sets 60 minutes for its non-serial
fallback and 25 for serial; these commands match it.

**Without the override the run is silently truncated, and it does not look like a
failure.** Playwright marks every test it never reached as `skipped`, so `results.xml`
reports `failures="0"` and looks green. The tells:

- `<testsuites time="1200.00…">` — pin-exact 1200s is the timeout, not a coincidence.
- A large `skipped` count (~569 of 1002) with no per-test output in the log.
- Playwright exits non-zero while the XML shows zero failures.

**Check executed count, not just failure count.** Zero failures out of 433 executed is
not a pass of a 1002-test suite:

```bash
python3 -c "
import xml.etree.ElementTree as ET, collections
r = ET.parse('qa/e2e/test-results/results.xml').getroot()
c = [tc for ts in r.iter('testsuite') for tc in ts.iter('testcase')]
print(collections.Counter('failed' if tc.find('failure') is not None else
  'skipped' if tc.find('skipped') is not None else 'passed' for tc in c))
"
```

Some skips are legitimate — this suite runs two projects and guards viewport-specific
tests in both directions, so desktop-only tests skip under mobile-web and vice versa.
A truncated run is distinguished by the exact-1200s `time` and by executed count
collapsing to the ~420–445 band.

**`--project` is not optional on the serial run, and the two commands differ on
purpose.** `npm run test` runs every configured project, so omitting it there
executes the `@serial` specs against mobile-web as well — which CI never does.
Several of them (the AI conversation panel, the deal health-check button) are
desktop-only surfaces, so they fail with "HealingLocator: all strategies
exhausted" against a viewport they were never written for. That reads exactly
like a real regression and costs a full investigation to dismiss. The non-serial
command deliberately has no `--project`, because `e2e-functional` genuinely runs
both projects as a matrix.

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

Verify `qa/coverage-map.jsonl` has substantially more than a handful of
entries and covers real application files, not just one self-testing spec,
before committing it.

The file is line-delimited JSON, normalized: a `generatedAt` header, then
interned `{"t":…}` test and `{"u":…}` unit lines, then `{"l":[test,unit,hits]}`
link lines, then an `{"entryCount":N}` trailer where N counts the LINKS.
Sanity-check it with

```bash
head -1 qa/coverage-map.jsonl                  # header, must carry "format":2
tail -1 qa/coverage-map.jsonl                  # trailer
grep -c '^{"l":' qa/coverage-map.jsonl         # link count — must equal the trailer's N
```

**A missing trailer means the export was interrupted**, and the loader will
reject the file rather than load a truncated map. That is distinct from the
partial-coverage limitation below: a locally-generated map is legitimately
_incomplete_ (frontend units unresolved) but must still be structurally
_complete_. Incomplete is expected here; truncated is a real failure.

**Known local limitation:** the E2E harness runs Vite directly on the host
while the test server runs the backend in a container — every frontend
Istanbul dump's absolute path is therefore a host path the container can
never see under any `sourceRoot`. Frontend units generated by a purely
local run land as `resolved: false` (raw, unportable absolute `filePath`,
excluded from `coverage_test_links`) — this is expected here, not a bug to
chase further. Backend (V8) units resolve correctly, since the container's
own cwd already is the repo root. Do NOT commit a locally-generated
`qa/coverage-map.jsonl` as the authoritative map — `tia-record-mode.yml`'s
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

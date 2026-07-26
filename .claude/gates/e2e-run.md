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
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile e2e up -d
npm run e2e:client   # separate terminal — hardcodes API_URL=http://localhost:3002
```

Both compose files are required. `E2E_API_URL=http://localhost:3002` and
`E2E_BASE_URL=http://localhost:5173` live in `qa/e2e/.env`.

## The run

`date` goes in its own Bash call. Never chain it with `&&`.

```bash
date
```

```bash
# Rebuild the E2E server image so new server code is actually in the container
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile e2e build server-e2e
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile e2e up -d server-e2e

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

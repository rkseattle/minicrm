# Troubleshooting

Local failures, what causes them, and the exact command that fixes each. Entries are
grouped by where you hit them.

Procedures that live elsewhere are linked rather than repeated — a second copy is a
second thing to go stale.

---

## Which stack am I on?

Most confusing local failures come from pointing a tool at the wrong stack. The dev and
test stacks run side by side on offset ports, and they have separate databases.

| Service         | Dev  | Test                        |
| --------------- | ---- | --------------------------- |
| Postgres        | 5432 | 5433                        |
| API             | 3001 | 3002                        |
| Vite            | 5173 | 5175 (`npm run e2e:client`) |
| Client (Docker) | 80   | 8080                        |
| MinIO           | —    | 9002 (API), 9003 (console)  |
| Mailhog         | —    | 1025 (SMTP), 8025 (HTTP)    |

The test stack's own service table, including its container names, is in the
[Operations Guide](../operations.md#local-test-environment-developer-workflow).

**Symptom:** the page loads, but every login fails.
**Cause:** the UI is proxying to one stack while you seeded the other. Both Vite servers
print their target API on startup.
**Fix:** confirm which you meant. `npm run dev:client` serves dev; `npm run e2e:client`
serves the test stack.

**Symptom:** a script wipes data you expected to keep.
**Cause:** a `DB_PORT` pointing at 5432 while running test tooling. `TRUNCATE`-bearing
scripts refuse to run against the dev port for this reason — see
`shared/testing/testStackDbPort.ts`.
**Fix:** export `DB_PORT=5433`, or let `qa/e2e/.env` supply it.

---

## Database

**Symptom:** `ECONNREFUSED 127.0.0.1:5432` or `:5433`.
**Cause:** the stack is not running.
**Fix:**

```bash
# dev — add --profile web only if you want the containerized client on :80;
# for development use `npm run dev:client` on 5173 instead
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# test — Compose starts the services; e2e:setup creates the databases
docker compose -f docker-compose.test.yml up -d
npm run e2e:setup
```

**Symptom:** `database "minicrm_e2e" does not exist`.
**Cause:** Compose starts Postgres but creates no databases. `npm run e2e:setup` is the
step that creates and migrates them, seeds the admin user, and provisions the MinIO
bucket.
**Fix:** `npm run e2e:setup`.

**Symptom:** `database "minicrm_test" does not exist`.
**Cause:** different database, different owner. `minicrm_test` is the **server unit-test**
database, created automatically by the suite's own global setup from `DB_NAME` in
`.env.test` — `create:e2e-db` does not touch it.
**Fix:** run `npm test --workspace=minicrm-server`; it provisions the database on first
use. If it still fails, `.env.test` is missing or `DOTENV_CONFIG_PATH` is not set.

**Symptom:** a migration fails, leaving the schema between versions.
**Cause:** the migration threw partway. Note the server also migrates on startup from
`DB_*` env vars, so a crash-looping container needs its own env checked — the commands
below are for host-side runs.
**Fix:** roll back one step, fix the migration, then re-apply. Carry `DATABASE_URL`
explicitly — these commands default to the **dev** database on 5432 otherwise. The URL
below targets the **test** stack; swap host, port, and database name for a dev-stack
recovery:

```bash
DATABASE_URL=postgres://minicrm:password@localhost:5433/minicrm_e2e \
  npm run migrate:down --workspace=minicrm-server
DATABASE_URL=postgres://minicrm:password@localhost:5433/minicrm_e2e \
  npm run migrate --workspace=minicrm-server
```

`migrate:fresh` is **not** a recovery path. It applies the baseline, fake-marks the
migrations that baseline covers, then runs whatever remains pending — so on a database
whose migration failed partway it will not repair anything. To start over, drop and
recreate the database first.

Never edit a migration that has already run anywhere — write a corrective one. See
[migrations.md](migrations.md).

---

## Server will not start

**Symptom:** `JWT_SECRET is not set or is using a known-weak value.`
**Cause:** the startup guard rejects secrets under 32 characters, known-weak values, and
the `REPLACE_WITH_` placeholders that ship in `.env.example`.
**Fix:** the error message prints the generator command; see
[Required Secrets](../operations.md#required-secrets) for what each key protects.

**Symptom:** `NODE_ENCRYPTION_KEY is not set or is not a valid 64-character hex string.`
**Cause:** a second, separate guard. This one tests only the hex format — exactly 64
hex characters — so a placeholder fails it on shape rather than by name.
**Fix:** generate one the same way. Note this key can never be retired once secrets are
stored under it — see [migrations.md](migrations.md#encryption-key-rotation) before
changing an existing one.

Both guards run before the server binds a port, so a failure here means nothing started.

---

## E2E

The run procedure and cadence policy are in the
[Operations Guide](../operations.md#running-the-e2e-suite). Failures:

**Symptom:** every spec fails immediately, usually on navigation.
**Cause:** the test stack is down, or `npm run e2e:client` is not running.
**Fix:** start both. The suite needs Postgres, MinIO, and Mailhog from
`docker-compose.test.yml`, plus the Vite server on 5175.

**Symptom:** the run reports `failures="0"` but far fewer tests than expected.
**Cause:** `globalTimeout` truncated it — the local budget is 20 minutes, overridable
with `PW_GLOBAL_TIMEOUT_MS`.
**Fix:** how to spot a truncated run, and what to do about a healed locator, are in
[Reading results](../operations.md#reading-results).

---

## SSO

**Symptom:** Dex rejects the login with a redirect-URI mismatch.
**Cause:** the URI MiniCRM sends comes from `SSO_CALLBACK_BASE_URL`, and the two stacks
default it differently — `http://localhost` in `docker-compose.yml`, `http://localhost:3002`
in `docker-compose.test.yml`. Dex's static client accepts only
`http://localhost:3001/api/v1/auth/sso/callback`.
**Fix:** set `SSO_CALLBACK_BASE_URL=http://localhost:3001` in your `.env`, as
`.env.example` already does. See [Local SSO Testing](local-sso.md).

---

## Coverage and attestation gates

Three separate gates enforce three different thresholds, and conflating them wastes time:

| Gate                                 | Threshold       | Where the result is                          |
| ------------------------------------ | --------------- | -------------------------------------------- |
| server / client / coverage-dashboard | 70% all metrics | `<workspace>/coverage/coverage-summary.json` |
| `qa/` framework suite                | 80% all metrics | `qa/coverage/coverage-summary.json`          |
| Test attestation                     | pass/fail       | `qa/e2e/test-results/results.xml`            |

**Symptom:** a coverage gate fails but the console scrolled past the number.
**Fix:** read the JSON summary rather than rerunning. The threshold that failed is named
in `coverage-summary.json`.

**Symptom:** attestation fails with a reason you have not seen.
**Fix:** every `AttestationFailureReason` is documented under "Reading a failed run" in
[coverage.md](coverage.md). `zero-tests-executed` and `no-session-attribution` are the
two that most often mean infrastructure rather than a real test failure.

---

## The pre-push hook

`.husky/pre-push` runs `scripts/pre-push-tia.ts`, which typechecks, runs the audit gate,
then runs a TIA-selected subset of the E2E suite and attests that it really ran.

**Symptom:** your first push on a fresh clone takes far longer than expected.
**Cause:** with no local coverage map, test selection cannot resolve and falls back to
the full suite.
**Fix:** `SKIP_TIA_PREPUSH=1 git push`. This skips **only** the E2E leg — typecheck and
the audit gate run first and are not bypassed. Every use is appended to
`.git/tia-prepush-bypass.log`, which is local and never uploaded.

**Symptom:** the hook fails on an advisory you did not introduce.
**Cause:** the audit gate is unconditional by design; advisories land against versions
already in the lockfile.
**Fix:** `scripts/npm-audit-gate.sh` prints the remedy when it fails; follow that output.
The full rationale is in [.claude/gates/pre-push.md](../../.claude/gates/pre-push.md).

---

## Docs and lint

**Symptom:** `lint-docs` fails on a link you did not touch.
**Cause:** the link's target moved or was renamed.
**Fix:** `node scripts/check-doc-links.mjs` names every unresolved link and the path
it resolved to.

**Symptom:** `lint-and-typecheck` fails naming an `/api/...` path in a comment or a test
title.
**Cause:** resource routes mount under `/api/v1`; the unversioned form either 404s or
rides a redirect that is documented for removal.
**Fix:** add the prefix. If the path is genuinely correct unversioned — an infra endpoint,
or a third-party API — add the file to `EXEMPT_FILES` in
`scripts/check-api-path-versioning.mjs` with the reason.

**Symptom:** `lint-and-typecheck` says a `ci.yml` filter names a path that does not exist.
**Cause:** a file moved and its paths-filter entry did not, so the job that runs its guard
has silently stopped triggering.
**Fix:** update the glob. A newly added file is untracked until `git add`, so stage it
before trusting the failure.

**Symptom:** a lint rule fires that you cannot find in any config.
**Fix:** it is probably one of the repo's own — see
[Custom ESLint Rules](eslint-plugins.md). After editing a rule, run
`npx eslint . --no-cache`; the cached run will not re-lint unchanged files.

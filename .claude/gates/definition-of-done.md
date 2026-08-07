# Definition of Done — required before every `git commit`, no exceptions

Run in order. All must be green. Read this file before the first commit of a session;
it does not need re-reading between commits.

```bash
# 1. Typecheck (repo root — covers server, client, and qa)
npm run typecheck

# 2. Lint (all workspaces)
npm run lint

# 3. Audit — unconditional. Advisories land against versions already in the lockfile,
#    so "no dependencies changed" is not a reason to skip it; that is precisely when
#    drift goes unnoticed until CI is red. Compare what it reports against ci.yml's
#    ALLOWED_ADVISORIES: anything outside that list has to be fixed or justified.
npm audit

# 4. Unit tests — sequential; never run the two workspaces in parallel
npm run unit_test

# 5. QA static checks
bash qa/scripts/check-framework-purity.sh
bash qa/scripts/check-behavior-layer.sh
bash qa/scripts/check-settings-mutations.sh
bash qa/scripts/check-networkidle.sh
bash qa/scripts/check-sha-pattern-parity.sh
bash qa/scripts/check-e2e-cleanup.sh
```

Steps 1–5 run before every commit. **E2E does not gate individual commits** — see
`.claude/gates/e2e-run.md` for the pre-push E2E gate.

## Conditional gates

**Any file under `qa/e2e/` in the diff** — every QA static check in step 5 above is
mandatory for that commit, not deferred to push time.

**Files under `qa/e2e/framework/` in the diff** — additionally:

```bash
npm run test:framework:coverage --workspace=minicrm-qa
```

c8 enforces 80% on lines, functions, branches, and statements. Known false positives
in `check-framework-purity.sh`: `MINCRM-*` ticket refs match the `mini?crm` pattern,
and the word `pipeline` matches the CRM i18n namespace check — including inside JSDoc
`@example` and `@param` blocks. Rephrase rather than suppress.

**Any `.env*.example` in the diff** — `bash qa/scripts/check-env-example-parity.sh`.
Asserts each template declares the same variable names as the local file it is copied
to. `.env.test.example` had silently lost `COVERAGE_DB_NAME` and `NODE_ENCRYPTION_KEY`,
so a fresh clone got a test suite that failed with no hint the template was incomplete
(MINCRM-684).

**Any `docker-compose*.yml` in the diff** — `bash qa/scripts/check-compose-isolation.sh`
is mandatory for that commit. It asserts the dev and test stacks share no
`container_name`, no published host port, and no named volume, and that the test stack
never names a dev database. Isolation by `DB_NAME` alone is what let a test run truncate
the dev database (MINCRM-684).

**Changed `.md` files** — run `markdownlint-cli2` on them. CI `lint-docs` catches what
the pre-commit hook misses.

**Staged `.github/workflows/*.yml`** — the pre-commit hook runs `actionlint` and hard-
fails if it isn't installed (`brew install actionlint`, once per machine).

**Changes touching `server/src/services/` or `server/src/ai/`** — review
`server/src/ai/tools/` and verify tool schemas still match service signatures: input
field names, enums, required arrays. Update affected tool files in the same commit.

**Changes adding or modifying NLI behavior in `server/src/ai/`** — add or update eval
cases in `qa/evals/` in the same commit. Intent → `nli-intent.yaml`, semantic →
`nli-semantic.yaml`, RBAC → `nli-rbac.yaml`, PII → `nli-pii.yaml`. Never route PII
assertions through an LLM judge.

## Before `git add`

Read the diff and ask: does any block of logic appear more than once — within a file,
across files in this diff, or once here and once already in the repo? If yes, extract
the helper first, then stage. This applies to private methods, shared utilities, and
framework helpers alike.

## Reading results

Never rely on exit codes or console summaries for test outcomes. Delete stale result
files before a run, then read the generated results file.

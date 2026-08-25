# Definition of Done — required before every `git commit`, no exceptions

The human account of these gates is [docs/dev/contributing.md](../../docs/dev/contributing.md).
This file is the agent copy: it adds session pacing and the conditional-gate reasoning,
which have no human equivalent.

Run in order. All must be green. Read this file before the first commit of a session;
it does not need re-reading between commits.

```bash
# 1. Typecheck (repo root — covers server, client, and qa)
npm run typecheck

# 2. Lint (all workspaces)
npm run lint

# 3. Audit — unconditional. Advisories land against versions already in the lockfile,
#    so "no dependencies changed" is not a reason to skip it; that is precisely when
#    drift goes unnoticed until CI is red. The bar is ZERO high/critical — there is no
#    allowlist. To fix: pin the patched version in the root package.json "overrides",
#    then re-resolve with `rm -rf node_modules package-lock.json && npm install` and
#    COMMIT the regenerated lockfile. An incremental install will not reconsider
#    overrides for transitive deps and makes a fixable advisory look unfixable. The
#    re-resolve is only for changing overrides — `npm ci` installs a committed
#    lockfile verbatim — see .claude/gates/pre-push.md (MINCRM-703).
bash scripts/npm-audit-gate.sh

# 4. Unit tests — sequential; never run the three workspaces in parallel
npm run unit_test

# 5. QA static checks
bash qa/scripts/check-framework-purity.sh
bash qa/scripts/check-behavior-layer.sh
node qa/scripts/check-settings-mutations.mjs
bash qa/scripts/check-networkidle.sh
bash qa/scripts/check-sha-pattern-parity.sh
bash qa/scripts/check-grep-invert-parity.sh
bash qa/scripts/check-framework-spec-titles.sh
bash qa/scripts/check-e2e-cleanup.sh
bash qa/scripts/check-e2e-beforeall.sh
bash qa/scripts/check-token-refresh-parity.sh
bash qa/scripts/check-coverage-map-exit-code-parity.sh
node qa/scripts/check-locator-timeout-forwarding.mjs

# 6. Repo-wide guards — these live in scripts/, not qa/, and are not QA-scoped
bash scripts/check-audit-gate-parity.sh
bash scripts/check-gate-pointer-parity.sh
node scripts/check-ci-filter-globs.mjs
node scripts/check-guard-invocation.mjs
node scripts/check-api-path-versioning.mjs
```

Steps 1–6 run before every commit. **E2E does not gate individual commits** — see
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

**Any source comment added or changed in the diff** — it must carry no work-item ID
(`MINCRM-N`, `LAR-N`, `MININT-N`). `npm run lint` enforces this via
`local-comments/no-work-item-id-in-comment`, so step 2 already covers `.ts`/`.tsx`/`.mjs`/
`.cjs`/`.js`. `db/migrations/**` is ESLint-ignored, so it is covered instead by
`npx tsx scripts/strip-work-item-ids.ts --verify`, which runs in CI on every
`lint-and-typecheck`. Put the reason in the comment — one line, about the code — and the
ID in the commit message. Exempt: the `-ok` suppression markers and `@openapi` blocks.

**A comments-only commit** (a comment refactor, an ID strip, a concision pass) —
`npx tsx scripts/check-comments-only-diff.ts <base-ref>` must pass. It parses both sides
of every changed source file and compares the token streams with comments removed, so a
catalog `COMMENT ON` string edited inside a `pgm.sql` template literal is caught even
though it looks like a comment in the diff. Any non-comment hunk is a bug in the pass,
fixed at its source rather than hand-patched.

**Changed `.md` files** — run `markdownlint-cli2` on them, plus
`node scripts/check-doc-links.mjs` when a link or a link target moved. CI `lint-docs`
catches what the pre-commit hook misses, but only after the push.

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

Then read every comment the diff adds or changes. Cut any that restates the code, runs
past CLAUDE.md's budget (one line, 15 words for an inline justification), or narrates a
review round rather than describing the code — the commit message is where history goes.

## Reading results

Never rely on exit codes or console summaries for test outcomes. Delete stale result
files before a run, then read the generated results file.

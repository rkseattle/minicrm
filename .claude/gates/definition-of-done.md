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
#    drift goes unnoticed until CI is red. The bar is ZERO high/critical, no allowlist.
#    Fixing one means changing "overrides" and re-resolving from scratch — the
#    procedure and why an incremental install defeats it are in pre-push.md step 5.
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

## Cross-cutting obligations — when you touch X, also touch Y

The gates above are commands. These are couplings: things that do not fail any command
until much later, or fail silently forever. Walk this table against the diff before
staging. A row whose left side appears in your diff and whose right side does not is
either a gap or a decision you must be able to state.

| You changed                                                | You must also                                                                                                                                                                                                                                   | Why it fails silently otherwise                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A test that reads a file **outside its own workspace**     | Make an **existing** filter cover both sides — see "Do not edit `ci.yml`" below. Only if none can, add a single-purpose output naming both sides, OR it into the job that runs the test, and keep that job's `always()` + upstream result check | `server` is `server/src/**` and `client` is `client/src/**` — a guard pinning the other workspace never runs on the edit it exists to catch. `check-ci-filter-globs.mjs` only verifies listed paths _exist_; it cannot see a missing one                                   |
| A new filter output in `ci.yml`                            | Declare it in the `changes` job's `outputs:` block too                                                                                                                                                                                          | `actionlint` catches this one — run it, since the pre-commit hook only fires on staged workflow files                                                                                                                                                                      |
| A route with no `authenticate`                             | Update the public-endpoint count in `swagger.ts`'s `info.description`                                                                                                                                                                           | `swagger.test.ts` asserts the prose count matches `security: []` operations                                                                                                                                                                                                |
| Any new route                                              | A real `@openapi` block, plus a `tags:` entry if the tag is new                                                                                                                                                                                 | `swagger.test.ts` asserts `registrations - operations` stays at its expected shortfall; redocly `lint:api` rejects an undeclared tag                                                                                                                                       |
| A `t()` key in `client/src/locales/` that `qa/` references | Add it to `qa/e2e/apps/minicrm/locale.ts` in all five maps                                                                                                                                                                                      | `t()` throws `RangeError` on an unknown key and locator strategy arrays are eagerly evaluated, so the page object throws before resolving anything — every spec reaching that control, not just new ones. Typecheck, lint and all twelve QA checks pass on the broken code |
| A new dependency                                           | Check its license and transitive tree, then run the audit gate; re-resolve (`rm -rf node_modules package-lock.json && npm install`) if you added an override                                                                                    | An incremental install silently ignores overrides for transitive deps                                                                                                                                                                                                      |
| A pattern a hook should enforce                            | Update the hook **and** its self-test in `.claude/hooks/`                                                                                                                                                                                       | A hook that does not know about a new pattern reports success. Self-tests assert finding _counts_, not exit status                                                                                                                                                         |
| A new `@serial` E2E spec                                   | Add a `qa/e2e/apps/minicrm/resource-registry.ts` entry, then `npx tsx qa/e2e/scripts/gen-conflict-group-configs.ts`                                                                                                                             | A spec in no conflict group is never scheduled — it silently does not run                                                                                                                                                                                                  |
| A new table                                                | Add it to `reset-e2e-data.ts`                                                                                                                                                                                                                   | That script enumerates tables one by one; an omitted table accumulates rows across every E2E run                                                                                                                                                                           |
| A migration                                                | Regenerate the ERD (`npm run db:erd --workspace=minicrm-server`) in the same commit                                                                                                                                                             | Nothing in CI checks ERD staleness                                                                                                                                                                                                                                         |
| Behavior a user can see                                    | Update `docs/user-guide/`; new pages need an `index.md` row, and a changed page's screenshot and alt text                                                                                                                                       | Route parity checks that a page _exists_, never that it is accurate                                                                                                                                                                                                        |

The table is not exhaustive, and a row is not a substitute for thinking about the
particular change. When you add a coupling this table does not name, add the row.

### Do not edit `ci.yml` — it costs the full E2E suite

**Every edit to `.github/workflows/**` forces the entire functional E2E suite** — the TIA
selector's `ci-workflow` rule is `alwaysWiden: true`
(`server/src/coverageAgent/testSelection/dependencyGraphService.ts`), by design, since a
workflow edit changes whether tests run at all. There is no cheap touch of this file.

That price has been paid 93 times, leaving `ci.yml` at 3,499 lines with 16 single-purpose
filter outputs and 63 `needs.changes.outputs.X == 'true'` clauses, mostly one guard at a
time. This gate's own table asked for it, which is why the row above now points here.

**Work down this list and stop at the first that applies:**

1. **Name the guard so an existing glob matches it.** `scripts/**/check-*.{sh,mjs,ts}` is
   already the `guard-invocation` output, and `qa` already matches `qa/scripts/**`. A new
   `scripts/check-<thing>.mjs` invoked from a job that already runs needs **no `ci.yml`
   edit** — the trigger and the invocation both exist. This fits nearly every new guard.
2. **Check whether a filter already covers both sides.** `config` matches `.github/**`,
   root-level `*.json`/`*.yml` and `Dockerfile*`; `docs/**` and `docs/user-guide/**` are
   globbed too. Read the `changes` job before concluding a path is uncovered.
3. **Put the assertion where the trigger already is.** Test the rule from the workspace
   whose filter already matches both files, rather than adding a trigger to reach where
   you first thought to put the test. Moving a test is free; widening CI is not.
4. **Only then edit `ci.yml`**, saying in the commit message which of 1–3 you ruled out.
   An edit that skipped this list is the defect even when the YAML is correct.

Weigh any remaining edit against a full E2E run now plus one on every future PR touching
the workflow; if 1–3 all fail, the guard may not be worth its trigger. Two edits stay
legitimate: declaring a genuinely new filter output in `outputs:` (the row above), and
changing what a job actually does — a step, a runner, a matrix. Neither is guard wiring.

### Domain subsystems — ask these of every feature, not just the obvious one

Each of these is cross-cutting: it applies to work that is not "about" it, which is why
it gets missed. Answer each with a change or a reason it does not apply.

- **i18n** — every user-facing string via `t()`, added to all five locales at matching
  positions, then `npm run pseudoloc`. `locale-completeness.test.ts` is bidirectional, so
  an orphaned key fails as loudly as a missing one. RTL needs logical CSS (`ps-`/`pe-`,
  `ms-`/`me-`, `start-`/`end-`), never physical directions.
- **GDPR and retention** — does this store personal data? Then erasure must reach it.
  `gdprService` erases contacts and leads specifically; a new table holding contact or
  lead data needs a cascade or an explicit note in `docs/dev/retention.md` saying why not.
  User-owned data usually rides `ON DELETE CASCADE`, but confirm rather than assume.
- **Feature flags** — a new user-facing surface is gated or explicitly always-on. Admin
  panels disable-not-hide; end-user surfaces hide. `useFeatureFlag` fails closed by
  design, so an unknown key silently renders nothing.
- **RBAC and visibility** — a capability guard at the route, and ownership in the WHERE
  clause for anything per-user. Adding a capability strands existing **custom roles**
  unless the migration grants it to `is_builtin = false` rows too.
- **Audit** — every create/update/delete writes an entry on the same client inside the
  same transaction. Never log the secret itself; log that it changed.
- **AI exposure** — a new column holding anything sensitive belongs in
  `ALWAYS_EXCLUDED_FIELDS`. If a service signature changed, the matching tool schema in
  `server/src/ai/tools/` changes with it, and NLI behavior changes need `qa/evals/` cases.
- **Test infrastructure** — new tables reach `reset-e2e-data.ts`; `@serial` specs reach
  `resource-registry.ts` and the regenerated conflict groups; fixtures clean up by a
  file-unique prefix so parallel files cannot collide.
- **TIA/coverage** — a new file class that no coverage unit can represent (a migration, a
  config, a locale) belongs in `dependencyGraphService`'s rule table, or selection is
  silently blind to it.
- **Reporting and gRPC** — a new audit event type reaching the audit Connect service, or
  a new metric surface, changes `server/src/grpc/proto/` and its handler together.

### Engineering practice — the questions no command asks

- **Deploy compatibility.** Old code runs against the new schema during any rolling
  deploy, and `down` runs against new code. A column that goes `NOT NULL` in one step
  breaks inserts from the still-running old version — add nullable, backfill, then
  constrain, as `167_add_record_type_to_ai_cascade_log.js` does. Renames and drops are two
  releases, never one.
- **Idempotency.** Anything retried must be safe to run twice. Webhook delivery retries up
  to five times, automation triggers fire post-commit unawaited, and notification queueing
  is fire-and-forget — a handler that is not idempotent turns each of those into duplicate
  side effects rather than a recovered failure.
- **Failure modes of a new outbound call.** Every third-party call needs a timeout, a
  decision about retry, and a statement of what happens when it fails — the request fails,
  or it degrades. Never inside a transaction holding row locks. `undici` reports every
  transport failure as the same `TypeError: fetch failed`, so classify on `cause.code`
  rather than the error name.
- **Query cost.** A new list endpoint joins or batch-loads rather than issuing N+1, and a
  new predicate over a large table has an index that covers it. `EXPLAIN` the query rather
  than assuming the planner cooperates; a partial index needs its `WHERE` to match the
  query's exactly.
- **Secrets.** Encrypted at rest via the versioned crypto API, never returned by an
  endpoint, never written to an audit entry or a log line, and named in
  `ALWAYS_EXCLUDED_FIELDS`. A new env var is documented in `.env.example` and reaches
  every compose file that enumerates env keys.
- **Observability.** A new failure path a user can hit reaches `logger.warn`/`error` with
  enough context to diagnose it, and anything unexpected reaches Sentry through the global
  handler rather than being swallowed. Never log a credential, a token, or a full request
  body.
- **Rate limiting.** A new unauthenticated endpoint, or one doing meaningful work per
  call, states whether it is rate-limited and why. `E2E=true` bypasses the limiter.
- **Accessibility.** Interactive elements are reachable by keyboard, carry an accessible
  name, and use `role="status"`/`role="alert"` for async outcomes. Color alone never
  carries meaning — the status-badge variants pair color with text.
- **Time.** Store `timestamptz`, compare in UTC, format in the viewer's zone. See
  `docs/dev/dates-and-timezones.md` before writing date arithmetic.

## Before `git add`

Read the diff and ask: does any block of logic appear more than once — within a file,
across files in this diff, or once here and once already in the repo? If yes, extract
the helper first, then stage. This applies to private methods, shared utilities, and
framework helpers alike.

Then read every comment the diff adds or changes. Cut any that restates the code, runs
past CLAUDE.md's budget (one line, 15 words for an inline justification), or narrates a
review round rather than describing the code — the commit message is where history goes.

## After the commit — status report

A phase is not done at the commit. Report status before starting the next one; the format
and the rules for reading `files`, duration, and AC evidence back from disk rather than
from memory are `.claude/gates/status-report.md`.

## Reading results

Never rely on exit codes or console summaries for test outcomes. Delete stale result
files before a run, then read the generated results file.

Running one server suite on its own needs the workspace's own env:
`DOTENV_CONFIG_PATH=../.env.test npx vitest run <name>` from `server/`. A bare
`npx vitest run` there aborts in globalSetup — `DB_PORT` is unset, and it refuses to
guess rather than risk the dev database — but reports `no tests`, which reads as a
filter that matched nothing rather than a suite that never started.

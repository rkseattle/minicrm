# Definition of Done — MiniCRM mechanics

The policy is `${CLAUDE_PLUGIN_ROOT}/gates/definition-of-done.md`. This file is what to
run. The human account of these gates is
[docs/dev/contributing.md](../../docs/dev/contributing.md).

```bash
# 1. Typecheck (repo root — covers server, client, and qa)
npm run typecheck

# 2. Lint — ESLint across the repo, then Prettier --check.
#    `npm run format` fixes what it reports; run it BEFORE staging, never mid-gate.
npm run lint

# 3. Audit — unconditional. Advisories land against versions already in the lockfile,
#    so "no dependencies changed" is not a reason to skip it. Zero high/critical, no
#    allowlist. Fixing one means changing "overrides" and re-resolving from scratch —
#    the procedure is in pre-push-mechanics.md step 5.
bash scripts/npm-audit-gate.sh

# 4. Unit tests — sequential; never run the three workspaces in parallel.
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

**E2E does not gate individual commits** — see `.claude/gates/e2e-run.md`.

## Conditional gates

**Any file under `qa/e2e/`** — every QA static check in step 5 is mandatory for that
commit, not deferred to push time.

**Files under `qa/e2e/framework/`** — additionally
`npm run test:framework:coverage --workspace=minicrm-qa`. c8 enforces 80% on lines,
functions, branches, and statements. Known false positives in
`check-framework-purity.sh`: `MINCRM-*` ticket refs match the `mini?crm` pattern, and the
word `pipeline` matches the CRM i18n namespace check — including inside JSDoc `@example`
and `@param` blocks. Rephrase rather than suppress.

**Any `.env*.example`** — `bash qa/scripts/check-env-example-parity.sh`. Asserts each
template declares the same variable names as the local file it is copied to.

**Any `docker-compose*.yml`** — `bash qa/scripts/check-compose-isolation.sh`. Asserts the
dev and test stacks share no `container_name`, no published host port, and no named
volume. Isolation by `DB_NAME` alone once let a test run truncate the dev database.

**A source comment added or changed** — no work-item ID. `npm run lint` enforces this via
`local-comments/no-work-item-id-in-comment` for `.ts`/`.tsx`/`.mjs`/`.cjs`/`.js`.
`db/migrations/**` is ESLint-ignored, so it is covered by
`npx tsx scripts/strip-work-item-ids.ts --verify`. Exempt: `-ok` markers, `@openapi`.

**A comments-only commit** — `npx tsx scripts/check-comments-only-diff.ts <base-ref>`.

**Changed `.md`** — `markdownlint-cli2` on them, plus `node scripts/check-doc-links.mjs`
when a link or target moved.

**Staged `.github/workflows/*.yml`** — the pre-commit hook runs `actionlint` and hard-fails
if it isn't installed. Invoke by absolute path when running it before staging: `which
actionlint` misses a Homebrew install not on this shell's `PATH`.

**Changes touching `server/src/services/` or `server/src/ai/`** — verify tool schemas in
`server/src/ai/tools/` still match service signatures. Update them in the same commit.

**NLI behavior in `server/src/ai/`** — add or update eval cases in `qa/evals/`. Intent →
`nli-intent.yaml`, semantic → `nli-semantic.yaml`, RBAC → `nli-rbac.yaml`, PII →
`nli-pii.yaml`. Never route PII assertions through an LLM judge.

## Cross-cutting obligations

| You changed                                     | You must also                                                                               | Why it fails silently otherwise                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A test reading a file outside its own workspace | Make an existing filter cover both sides — see "Do not edit `ci.yml`"                       | `server` is `server/src/**`, `client` is `client/src/**`; a guard pinning the other workspace never runs on the edit it exists to catch   |
| A new filter output in `ci.yml`                 | Declare it in the `changes` job's `outputs:` block                                          | `actionlint` catches this — run it                                                                                                        |
| A route with no `authenticate`                  | Update the public-endpoint count in `swagger.ts`'s `info.description`                       | `swagger.test.ts` asserts the prose count matches `security: []` operations                                                               |
| Any new route                                   | A real `@openapi` block, plus a `tags:` entry if the tag is new                             | `swagger.test.ts` asserts the registration shortfall; redocly rejects an undeclared tag                                                   |
| A `t()` key that `qa/` references               | Add it to `qa/e2e/apps/minicrm/locale.ts` in all five maps                                  | `t()` throws `RangeError` on an unknown key and locator arrays are eagerly evaluated, so the page object throws before resolving anything |
| A new `@serial` E2E spec                        | A `resource-registry.ts` entry, then `npx tsx qa/e2e/scripts/gen-conflict-group-configs.ts` | A spec in no conflict group is never scheduled                                                                                            |
| A new table                                     | Add it to `reset-e2e-data.ts`                                                               | That script enumerates tables one by one; an omitted table accumulates rows across every run                                              |
| A migration                                     | Regenerate the ERD (`npm run db:erd --workspace=minicrm-server`)                            | Nothing in CI checks ERD staleness                                                                                                        |
| A `data-testid`, or an E2E `testId` locator     | `npm run audit:testids`, commit the regenerated report                                      | `check-testids.ts --check` gates the summary counts in `e2e-framework-purity`                                                             |
| Behavior a user can see                         | `docs/user-guide/`; new pages need an `index.md` row and a screenshot                       | Route parity checks a page exists, never that it is accurate                                                                              |

### Do not edit `ci.yml` — it costs the full E2E suite

Every `.github/workflows/**` edit forces the entire functional E2E suite: the TIA
selector's `ci-workflow` rule is `alwaysWiden`
(`server/src/coverageAgent/testSelection/dependencyGraphService.ts`). That price has been
paid 93 times, leaving `ci.yml` at 3,499 lines with 16 single-purpose filter outputs.

Work down this list and stop at the first that applies:

1. **Name the guard so an existing glob matches it.** `scripts/**/check-*.{sh,mjs,ts}` is
   already the `guard-invocation` output; `qa` already matches `qa/scripts/**`.
2. **Check whether a filter already covers both sides.** `config` matches `.github/**`,
   root-level `*.json`/`*.yml` and `Dockerfile*`.
3. **Put the assertion where the trigger already is.** Moving a test is free; widening CI
   is not.
4. **Only then edit `ci.yml`**, saying which of 1–3 you ruled out.

## Domain subsystems

- **i18n** — every string via `t()`, all five locales at matching positions, then
  `npm run pseudoloc`. `locale-completeness.test.ts` is bidirectional. RTL needs logical
  CSS (`ps-`/`pe-`, `ms-`/`me-`, `start-`/`end-`).
- **GDPR and retention** — a new table holding contact or lead data needs a cascade or an
  explicit note in `docs/dev/retention.md`.
- **Feature flags** — gated or explicitly always-on. `useFeatureFlag` fails closed, so an
  unknown key silently renders nothing.
- **RBAC and visibility** — a capability guard at the route, ownership in the WHERE clause.
  Adding a capability strands existing custom roles unless the migration grants it to
  `is_builtin = false` rows too.
- **Audit** — every write on the same client inside the same transaction.
- **AI exposure** — a sensitive new column belongs in `ALWAYS_EXCLUDED_FIELDS`.
- **Test infrastructure** — new tables reach `reset-e2e-data.ts`; `@serial` specs reach
  `resource-registry.ts`; fixtures clean up by a file-unique prefix.
- **TIA/coverage** — a file class no coverage unit represents belongs in
  `dependencyGraphService`'s rule table, or selection is blind to it.
- **Reporting and gRPC** — a new audit event type changes `server/src/grpc/proto/` and its
  handler together.

## Engineering practice

- **Query cost.** A new list endpoint joins or batch-loads rather than issuing N+1, and a
  new predicate over a large table has an index covering it. `EXPLAIN` rather than assume.
- **Rate limiting.** A new unauthenticated endpoint states whether it is limited.
  `E2E=true` bypasses the limiter.
- **Outbound calls.** `undici` reports every transport failure as the same
  `TypeError: fetch failed`, so classify on `cause.code` rather than the error name.
- **Time.** Store `timestamptz`, compare in UTC, format in the viewer's zone. See
  `docs/dev/dates-and-timezones.md`.

## Reading results

All three workspaces write `<workspace>/test-results/junit.xml` — not `junit.xml` at the
workspace root, which is where a guess lands and finds nothing.

Running one server suite on its own needs the workspace's own env:
`DOTENV_CONFIG_PATH=../.env.test npx vitest run <name>` from `server/`. A bare
`npx vitest run` there aborts in globalSetup but reports `no tests`, which reads as a
filter that matched nothing rather than a suite that never started.

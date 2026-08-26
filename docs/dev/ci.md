# Continuous Integration

What runs on a pull request, which jobs can block a merge, and how to reproduce each
failure locally.

`.github/workflows/ci.yml` triggers on `pull_request` against `main` only. There is no
`push` trigger, so nothing in this file runs on a direct push to a branch.

---

## What gates a merge

**`ci-gate` is the only required status check.** Every other job reaches branch
protection through it. It requires these 13 jobs:

`lint-and-typecheck` · `security-audit` · `server-tests` · `client-tests` ·
`coverage-dashboard-tests` · `e2e-framework-purity` · `e2e-framework-specs` ·
`lint-docs` · `e2e-aggregate` · `e2e-all-shards-passed` · `e2e-serial` · `ai-evals` ·
`docker-images`

`ci-gate` fails only on `failure` or `cancelled`. **A skipped job counts as passing** —
that is deliberate, so a path-scoped PR is not blocked by jobs that had no reason to run.

The jobs _not_ in that list never block a merge: `capacity-probe`, `changes`,
`tia-selection` (advisory, and labelled so in its own name), `e2e-timing-setup`, the two
report jobs, and `update-visual-snapshots`, which is `if: false`.

---

## The jobs

| Job                        | What it does                                                      |
| -------------------------- | ----------------------------------------------------------------- |
| `capacity-probe`           | Sizes the E2E matrix from runner CPU count                        |
| `changes`                  | Path filters — decides which jobs run at all                      |
| `lint-and-typecheck`       | Lint, typecheck, the API spec lint, and the repo-guard self-tests |
| `security-audit`           | Dependency audit; `always()` so it runs on every PR               |
| `docker-images`            | Builds the shipped server and client images                       |
| `tia-selection`            | Advisory test-impact selection — never blocks                     |
| `server-tests`             | Server Vitest suite and coverage, plus the doc-parity guards      |
| `client-tests`             | Client Vitest suite and coverage                                  |
| `coverage-dashboard-tests` | Dashboard suite, including the custom ESLint rule tests           |
| `e2e-framework-purity`     | Static guards over `qa/` — framework purity, parity checks        |
| `e2e-framework-specs`      | Framework unit specs with their own 80% coverage gate             |
| `e2e-timing-setup`         | Generates LPT shard configs from the timing baseline              |
| `e2e-functional`           | The sharded functional E2E matrix                                 |
| `e2e-all-shards-passed`    | Sentinel — fails if any shard failed                              |
| `e2e-serial`               | `@serial` specs in conflict-free groups, 1-2 workers each         |
| `e2e-aggregate`            | Merges per-shard JUnit and blob reports                           |
| `e2e-functional-report`    | Posts the sticky E2E results PR comment                           |
| `unit-test-report`         | Posts the sticky coverage PR comment                              |
| `lint-docs`                | markdownlint plus the documentation link guard                    |
| `update-visual-snapshots`  | Disabled (`if: false`); baselines refresh via manual dispatch     |
| `ai-evals`                 | Promptfoo evals; skipped on drafts, forks, and dependabot         |
| `ci-gate`                  | The sentinel described above                                      |

The `Phase N` prefixes in the real job names encode the ordering: Phase 1 jobs depend
only on `changes`, Phase 2 waits on `lint-and-typecheck`, and the Phase 3 E2E jobs wait
on the unit suites. `e2e-serial` additionally lists `e2e-functional` in its `needs`, so
it does not start until the shards finish — that is an explicit dependency added to avoid
runner contention, not a consequence of the phase ordering.

This table is maintained by hand and nothing pins it to `ci.yml`. Treat it as a map, not
as an authority — the workflow is the authority.

---

## Why a job was skipped

Jobs are gated by the `changes` job, which runs `dorny/paths-filter` and emits one
boolean per filter. A job whose filters did not match is skipped, and skipped counts as
passing at `ci-gate`.

Two rules govern how those filters are wired, both documented in CLAUDE.md:

- **Scope a trigger to the job, not the workspace.** A guard gets its own single-purpose
  filter output OR'd into the specific job that runs it, rather than being folded into
  `server` or `qa` — those gate the entire E2E matrix.
- **The invariant is usually bidirectional.** A test that pins a file outside its own
  workspace must make that file trigger the job, or the guard is silent on exactly the
  edit it exists to catch.

This is one reason `server-tests` runs on a PR that touches no server code: the
doc-parity outputs (`feature-flag-docs`, `user-guide-routes`, `attestation-docs`,
`user-guide-docs`, `redirect-status-docs`, `scheduled-jobs-docs`) are OR'd into it, so a
docs-only change still runs the guard that reads that doc — see
[Documentation parity guards](#documentation-parity-guards). `coverage-migrations`
(`qa/migrations/**`) and `shared-testing` (`shared/testing/**`) are OR'd in too, for
tests that exercise those files rather than document them. `record-paths`
(`shared/types/**`) is OR'd into **both** `server-tests` and `client-tests`: the
record-link mapping decides hrefs that suites in both workspaces assert, and
`recordPath.test.ts` pins both clauses so removing either fails.

`always()` is required on a job whose upstream can itself be skipped, because GitHub
auto-skips a dependent before evaluating its `if:`. It is **not** appropriate on a job
that depends only on `changes`, which is unconditional — adding it there would make the
job report `skipped` rather than blocking if `changes` ever failed.
Two jobs use `always()` on a `changes`-only dependency deliberately, for different
reasons. `security-audit` does it so the audit runs on every PR whatever the paths.
`docker-images` pairs it with an explicit `needs.changes.result == 'success'` check, which
closes the failure mode above — that is the form to copy if you need one.

---

## Documentation parity guards

Several tests in `server-tests` pin prose in `docs/` to the code it describes. They run
there because that job already has the `always()` wiring a docs-only PR needs — its
upstream is skipped when no code changes, and GitHub skips a dependent before evaluating
its `if:`. That is the thing to reuse when adding a seventh. Each guard fails with a
message naming the file to edit; this is what to do when one fires.

| Guard                        | Pins                                                              | Fix a failure by                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `featureFlagDocsParity`      | `FEATURE_FLAG_KEYS` ↔ the reference tables in `admin-guide.md` §8 | Adding or deleting the flag's row under the matching `####` category heading                                                                                                        |
| `userGuideRouteParity`       | `App.tsx`'s authenticated routes ↔ `docs/user-guide/`             | Mapping the route in `ROUTE_GUIDE_PAGES`, classifying the page in `ADMIN_ROUTE_PAGES`/`EMBEDDED_FEATURE_PAGES`, deleting a stale entry, or fixing the block bounds if the JSX moved |
| `userGuideLabels`            | Control names the guide quotes ↔ `en.json`                        | Quoting the string the locale file actually renders                                                                                                                                 |
| `verifyTestAttestation`      | `ATTESTATION_FAILURE_REASONS` ↔ `docs/dev/coverage.md`            | Documenting the new reason in "Reading a failed run"                                                                                                                                |
| `scheduledJobsDocumentation` | `buildScheduledJobs()` ↔ `operations.md`'s Scheduled Jobs table   | Updating that table — or deleting the schedule a `NO_SCHEDULE_LITERAL_DOCS` file restated                                                                                           |
| `legacyApiRedirect`          | `LEGACY_REDIRECT_STATUS` ↔ `api.md` and `operations.md`           | Correcting the status code in the prose                                                                                                                                             |

Each carries a single-purpose filter output OR'd into `server-tests`, per the two rules
above. That wiring has two halves, and a break in either leaves the guard green while it
no longer runs, so every guard asserts both through `expectGuardIsTriggered`: the output
must list exactly the files the guard reads, and the job's `if:` must consult the output.
Add a doc to a guard without adding it to that guard's filter and the guard itself fails.

Whether a filter globs a directory or enumerates files follows from what the guard
asserts. `userGuideRouteParity` checks completeness against `git ls-files`, so it has to
run when a page is **added** — and a list only triggers on paths it already names, hence
`docs/user-guide/**`. `userGuideLabels` reads only the pages it quotes a control from, so
it enumerates those twelve; globbing would run it on pages it makes no assertion about,
and its own check rejects a listed path it never reads.

The guards themselves are guarded: `scripts/check-guard-invocation.mjs`, in
`lint-and-typecheck`, fails when a `check-*` script in `scripts/` or `qa/scripts/` is run
by no CI job. One sat unwired long enough to go blind to the shape it existed to catch,
with only a developer doc — which blocks nothing — recording that it never ran.

Not every doc-to-code invariant is a test. Route coverage in the generated OpenAPI spec
is enforced at lint time instead, by the `local-openapi/require-openapi-tag` ESLint rule,
which fails `lint-and-typecheck` when a route registration carries no `@openapi` block.

Like the jobs table above, this one is maintained by hand — a guard renamed or removed
leaves its row behind. The tests are the authority.

---

## Reproducing a failure locally

| Failing job                     | Local command                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lint-and-typecheck`            | `npm run lint`, `npm run typecheck`, `npm run lint:api --workspace=minicrm-server`                                                                                       |
| `security-audit`                | `bash scripts/npm-audit-gate.sh`                                                                                                                                         |
| `server-tests`                  | `npm run test:coverage --workspace=minicrm-server`                                                                                                                       |
| `client-tests`                  | `npm run test:coverage --workspace=minicrm-client`                                                                                                                       |
| `coverage-dashboard-tests`      | `npm run test:coverage --workspace=minicrm-coverage-dashboard`                                                                                                           |
| `e2e-framework-purity`          | `bash qa/scripts/check-framework-purity.sh`, the other `qa/scripts/check-*` guards, plus `scripts/check-audit-gate-parity.sh` and `scripts/check-gate-pointer-parity.sh` |
| `e2e-framework-specs`           | `npm run test:framework:coverage --workspace=minicrm-qa`                                                                                                                 |
| `lint-docs`                     | `npx markdownlint-cli2 "**/*.md" "#node_modules"` and `node scripts/check-doc-links.mjs` (add `--self-test` for the guard's own cases)                                   |
| `e2e-functional` / `e2e-serial` | See [Running the E2E suite](../operations.md#running-the-e2e-suite)                                                                                                      |

Run the three unit suites together with `npm run unit_test`, which runs them in series.
**Never run them in parallel or alongside a Playwright run** — they are CPU-bound and
fail rather than slow down when oversubscribed, surfacing as timeouts in files unrelated
to your change.

For test outcomes, read the generated result files rather than console output or exit
codes. The three unit workspaces write `test-results/junit.xml` plus
`coverage/coverage-summary.json` — the latter only under `test:coverage`, which is why the
commands above use it; a bare `npm test` skips `--coverage` and never evaluates the
thresholds CI enforces. The framework suite writes `qa/e2e/test-results/results.xml`
instead.

---

## Shards and workers

`e2e-functional` runs a matrix of `project` × `shard`. Neither number is fixed:
`capacity-probe` derives them from the runner's CPU count and publishes them as job
outputs. Do not hardcode either value anywhere — `ci.yml` says so at the matrix
definition, and the counts change with the runner.

Each shard prefers an LPT config from `e2e-timing-setup` and falls back to Playwright's
native `--shard` if that artifact is absent.

Both expand by matrix, so the GitHub checks list shows more rows than the table above:
`e2e-functional` is one job per project × shard, and `e2e-aggregate` is one per project.

---

## The other workflows

| Workflow                     | Trigger                     | Purpose                                                 |
| ---------------------------- | --------------------------- | ------------------------------------------------------- |
| `lint-workflows.yml`         | PR, and push to `main` only | `actionlint` plus composite-action validation           |
| `security-audit.yml`         | Daily schedule              | Audits `main`; opens and closes an issue                |
| `tia-record-mode.yml`        | Push to `main`              | Full-suite instrumented run — the authoritative TIA map |
| `update-timing-baseline.yml` | After CI on `main`          | Refreshes the E2E timing baseline                       |
| `update-baselines.yml`       | Manual dispatch             | Regenerates visual baselines                            |
| `claude-review.yml`          | Manual dispatch only        | PR review — currently disabled                          |
| `claude-review-autofix.yml`  | Manual dispatch only        | Applies review fixes — currently disabled               |

Neither `claude-review` workflow runs on a PR today. `claude-review.yml` can still be
dispatched by hand; `claude-review-autofix.yml` cannot run at all, because its job
condition requires a review event that a manual dispatch does not produce.

---

## Local gates before you push

Pre-commit runs `lint-staged`: Prettier and ESLint on staged sources, markdownlint on
Markdown, `actionlint` on workflows.

Pre-push runs `scripts/pre-push-tia.ts` — typecheck, the audit gate, then a
TIA-selected E2E subset with attestation that it really ran. `SKIP_TIA_PREPUSH=1` skips
only the E2E leg; see [Troubleshooting](troubleshooting.md#the-pre-push-hook) for when
that is legitimate.

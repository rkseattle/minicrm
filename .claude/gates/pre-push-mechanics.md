# Pre-push — MiniCRM mechanics

The policy is `${CLAUDE_PLUGIN_ROOT}/gates/pre-push.md`. This file is what to run. The
human account is [docs/dev/contributing.md](../../docs/dev/contributing.md).

## The checklist, by step

**Step 1 — rebase.** `git fetch origin && git rebase origin/<parent>`. The plan-state hook
restores HEAD after any command that moves it during a `/deliver` run, so when a rebase is
refused, check `merge-base HEAD origin/<parent>` equals `origin/<parent>` — that means the
branch already sits directly on the parent and the rebase would replay nothing.

**Step 2 — lint.** `npm run lint` (ESLint, then Prettier `--check`).

**Step 3 — typecheck.** `npm run typecheck` at repo root — covers server, client, and qa.

**Step 4 — unit tests, scoped to what changed.**

```bash
npm test --workspace=minicrm-server    # if server files changed
npm test --workspace=minicrm-client    # if client files changed
```

Scoped rather than the full target: measured at 153s server and 133s client on an idle
machine, far worse oversubscribed, and the three workspaces must run in series. The full
`npm run unit_test` is the Definition of Done's step and runs per commit; this is the
delta. Compare the executed count against the previous run before believing a green
verdict.

**Step 5 — audit.** Always, never conditional on whether dependencies changed. The bar is
zero; there is no allowlist.

```bash
bash scripts/npm-audit-gate.sh
```

When something is reported, pin the fixed version in the root `package.json` `overrides`
block and **re-resolve from scratch**:

```bash
rm -rf node_modules package-lock.json && npm install
```

npm treats an existing `node_modules` + lockfile pair as already-satisfying and will not
reconsider an override for a transitive dependency on an incremental install — plain
`npm install`, `--package-lock-only`, and deleting only the lockfile all silently leave the
vulnerable version in place and make a working fix look impossible. Reasoning about why a
fix "cannot work" before running the clean re-resolve is how 16 advisories stayed
allowlisted while every one was already fixable. Once the re-resolved lockfile is
committed, CI's `npm ci` installs it verbatim and is authoritative.

**Step 6 — no release build.** There is no production configuration distinct from the test
build here; skip it.

**Step 7 — E2E, which `git push` runs.** The `pre-push` hook selects the affected specs and
attests they ran against this HEAD. Do not run Playwright by hand and then bypass the hook.
Cadence rules and the manual procedure are `.claude/gates/e2e-run.md`.

Before pushing, confirm the stack is set up — `npm run e2e:setup` seeds the storage config
the attachment specs need. A stack that never had it fails every F10 spec on a missing
`attachments-list`.

**Step 8 — `git status`.** Restore artifacts not part of the intended commit set:
`qa/e2e/heal-trends.json`, test results, generated outputs.

## Bypassing the push hook

`SKIP_TIA_PREPUSH=1` is this project's escape hatch. Prefer it over `--no-verify`: it
appends every use to `.git/tia-prepush-bypass.log` with a timestamp and the branch, while
`--no-verify` reaches the same end silently. Use `--no-verify` only when the hook itself is
broken in a way the env var cannot route around.

`SKIP_TIA_PREPUSH=1` does **not** skip typecheck or the audit gate — the hook runs both
before it consults the variable, so the bypass drops only the E2E leg.

If the reason is "I already ran the suite by hand", condition 1 is project-specific: **both
halves ran**, non-serial and serial. Skipping after only one half is how a whole class of
tests reaches CI unexecuted. The other three conditions are in the shared gate.

## After the hook's own E2E run fails

This is the case `post_fix_verification_scope` grants, and its bounds are not negotiable.

1. **Root-cause and fix.** `.claude/gates/e2e-run.md` governs: no failure is a flake, and a
   rerun that passes is not a resolution.
2. **Ask the selector which specs the fix affects** — do not assume the failed set is the
   whole set:

   ```bash
   cd server && DB_PORT=5433 DB_NAME=minicrm_e2e COVERAGE_DB_NAME=minicrm_coverage_e2e \
     LOG_DESTINATION=stderr npx tsx src/scripts/select-tests.ts \
     --base=origin/main --head=HEAD
   ```

   The database coordinates are not optional. `select-tests.ts` reads its mappings through
   `coverageDb.ts`, which imports `dotenv/config` — from a plain shell it picks up the root
   `.env` and queries the **dev** coverage database on 5432, which holds no E2E coverage
   links. It does not fail; it returns a confidently wrong selection. Those coordinates are
   the test stack's own, hardcoded in `qa/scripts/test-stack-db-env.ts` for this reason.

   Run the union of its selection and the specs that failed. A fix in a spec's own logic
   usually re-runs just that spec; a fix in shared production code pulls in
   previously-passing specs the failed set does not name. If the selector widens to the full
   suite, you are not in this exception — let the hook run.

   **Read `Dependency-graph widened scopes` as a warning, not a selection.** `shared-schema`
   and `i18n-locale` report their scopes in the rationale only; `select-tests.ts` builds
   `specFiles` from baseline and mapped tests alone, so a fix to a Zod schema or a locale
   file leaves those scopes unrun unless you name the specs yourself.

   Run that set as **two invocations, non-serial then serial**, same spec list to both,
   partitioned by grep exactly as `qa/scripts/targeted-run-plan.ts` plans it for the hook.
   Take both expressions from that file's `NON_SERIAL_GREP_INVERT` and `SERIAL_GREP`;
   `.claude/gates/e2e-run.md` shows them in place, and a copy here would be a fourth
   definition to drift.

   ```bash
   cd qa && rm -f test-results/targeted-non-serial.xml test-results/targeted-serial.xml

   cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
     PW_GLOBAL_TIMEOUT_MS=3600000 \
     PLAYWRIGHT_JUNIT_OUTPUT_FILE=test-results/targeted-non-serial.xml \
     npm run test -- <spec paths> --grep-invert "<NON_SERIAL_GREP_INVERT>" \
     --output=test-results/targeted-non-serial-artifacts

   cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
     PW_GLOBAL_TIMEOUT_MS=1500000 \
     PLAYWRIGHT_JUNIT_OUTPUT_FILE=test-results/targeted-serial.xml \
     npm run test -- <spec paths> --grep "<SERIAL_GREP>" \
     --project=desktop --workers=1 --output=test-results/targeted-serial-artifacts

   cd qa && npx tsx scripts/merge-junit-results.ts --output e2e/test-results/results.xml \
     --allow-empty-inputs --expected-files 2 \
     test-results/targeted-non-serial.xml test-results/targeted-serial.xml
   ```

   Delete the two XML files first — they are not in `outputDir`, so nothing else clears
   them, and an invocation that dies before its reporter writes leaves the previous push's
   file for the merge to fold in.

   Partition by **grep, not by hand**. `concurrency.spec.ts` is serial by
   `test.describe.serial` with no `@serial` tag, so eyeballing paths puts it in the wrong
   half. `--workers=1` belongs on the serial half only.

   `PW_GLOBAL_TIMEOUT_MS` is required on both: past the config's 20-minute default a run is
   **truncated, not failed** — Playwright marks what it never reached as skipped,
   `results.xml` reports `failures="0"`, and the merged file reads green.

   `--project=desktop` on the serial half is **not optional**: without it the `@serial`
   specs also run under mobile-web, which CI never does, and desktop-only surfaces fail with
   "HealingLocator: all strategies exhausted" — a false regression costing a full
   investigation to dismiss.

   Skip the half your specs have no tests for — Playwright exits 1 on "No tests found". When
   you skip one, drop its XML from the merge argument list **and** drop `--expected-files`
   to 1: the merge fails with `Cannot read input JUnit XML file` on a path never written.

3. **Push with the bypass**: `SKIP_TIA_PREPUSH=1 git push --force-with-lease origin <branch>`.

**What this gives up.** `attestOrThrow` binds a results file to the exact HEAD SHA through
coverage-session attribution; a hand-run does not. The merged `results.xml` proves these
specs passed, not that they passed against this commit — which is why "the sole delta is
the fix" is the bound to be strict about rather than eyeball.

## What CI runs

`lint-and-typecheck` ↔ steps 2–3 · `server-tests` / `client-tests` /
`coverage-dashboard-tests` ↔ step 4 · `security-audit` ↔ step 5 ·
`e2e-functional` / `e2e-serial` / `e2e-framework-*` ↔ step 7 · `tia-selection` picks the
E2E scope · `e2e-aggregate` and `e2e-all-shards-passed` aggregate.

The hooks live in the `delivery-kit` plugin and its own CI runs both self-tests on every
push, so a hook change is verified there rather than here.

## Pre-PR self-review — project items

- [ ] i18n keys in all 5 locale files; sibling pages fixed together; `data-testid` on all
      counterparts
- [ ] Audit entries present in every write transaction
- [ ] Assignment notification fired after commit if `owner_id` changed, not awaited
- [ ] DB errors mapped correctly
- [ ] `setState(updater)` has no side effects — fires twice in StrictMode
- [ ] Re-click on an active control is a no-op
- [ ] Modals and drawers manage focus on open and close
- [ ] RTL logical CSS classes throughout
- [ ] Feature flag gated, or documented as always-on
- [ ] Screenshots updated — `docs/screenshots/` via `scripts/screenshot.ts`
- [ ] E2E spec present for every story's AC
- [ ] `checkScreenshot()` added or updated for complex visual surfaces
- [ ] Framework coverage ≥ 80% if `qa/e2e/framework/` touched
- [ ] A new or moved spec guarding behavior its directory does not imply carries an
      `impacts` annotation — see [coverage.md](../../docs/dev/coverage.md)
- [ ] Roles and capabilities scoped for least privilege
- [ ] AI tool schemas reviewed if `server/src/services/` or `server/src/ai/` changed
- [ ] Eval tests added or updated in `qa/evals/` if NLI behavior changed

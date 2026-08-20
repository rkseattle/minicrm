# E2E Authoring Guide (MINCRM-555)

Reference for writing and maintaining MiniCRM functional E2E tests.

---

## Architecture overview

Tests live in a three-layer hierarchy:

```
specs → behaviors → page objects
```

- **Specs** (`qa/e2e/tests/apps/minicrm/functional/<domain>/`) — assert outcomes.
  Import only from `@behaviors/*`, `@apps/*`, `@framework/*`. Never import from
  `@pages/*` or call raw Playwright APIs (`page.locate()`, `page.getByTestId()`,
  `page.waitForLoadState()`) directly.
- **Behaviors** (`qa/e2e/behaviors/minicrm/`) — named async functions that
  encapsulate UI interactions and waits. Void `waitFor*` functions gate on a
  specific DOM condition; never return locators to callers.
- **Page objects** (`qa/e2e/pages/minicrm/`) — thin wrappers over healing
  locators. Used inside behaviors only; never referenced from specs.

---

## Shared global state and the `@serial` tag

### What is "shared global state"?

Shared global state is any database value that is **not scoped to a single test's
data** and affects the UI for all concurrent workers. In MiniCRM this includes:

- `system_settings` rows — nav layout, default language, home currency, branding,
  SSO configuration, email notification kill switch, visibility policy
- Feature flags stored in the DB (not via `withFlags()` helper, which is
  always in-process and safe)
- Pipeline stage `sort_order` (if reordered by a test; creation is scoped via
  testData)

### Decision tree

```
Does my test mutate any system_settings row, feature_flags row, or pipeline
stage sort order?
│
├─ Yes
│   ├─ Add @serial to every affected test's tag string.
│   ├─ Add ensureSystemDefaults() (or a domain-specific reset) to beforeEach AND afterEach.
│   ├─ Add an entry to qa/e2e/apps/minicrm/resource-registry.ts naming the
│   │   exact resource key(s) touched, so the conflict-graph scheduler
│   │   (MINCRM-661) can co-schedule your file with unrelated @serial files
│   │   instead of defaulting to a slow, isolated single-file group.
│   └─ Done — the e2e-serial CI job schedules these by resource conflict.
│
└─ No — no @serial needed; test is safe to run in the parallel shard job.
```

If you are unsure whether a behavior call mutates shared state, search for
`restClient.patch` or `restClient.put` inside the behavior implementation.

**Registering a new `@serial` file (MINCRM-661):** add an entry to
`RESOURCE_REGISTRY` in `qa/e2e/apps/minicrm/resource-registry.ts` naming the
resource key(s) your test reads/writes. Reuse an existing key
(`settings.nav_layout`, `feature_flags.ai_features`, etc.) if your test
touches the same underlying row as an existing entry — this is what lets the
scheduler detect the conflict and keep the two files apart. Introduce a new
key only for a genuinely new shared resource. If ALL tests in the file share
the resource, omit `testTitleContains` (a "file-wide" entry); if only some
tests do, set `testTitleContains` to a substring unique to those tests'
title — **file-wide entries are always scheduled at `workers=1`** (a
file-wide entry can't prove the rest of the file is safe from
`fullyParallel: true` racing itself), while `testTitleContains`-scoped
entries can share a group at higher worker counts. An unregistered `@serial`
file still works — it falls back to its own isolated single-file,
`workers=1` group — but registering it lets the scheduler co-locate it with
unrelated files for a faster run.

### The two CI jobs

| Job              | Playwright flag                                                               | What runs                                 |
| ---------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| `e2e-functional` | `--workers=N` per shard, `M` shards × 2 projects (N, M from capacity-probe)   | `@functional` tests **without** `@serial` |
| `e2e-serial`     | Sequential per-group invocations, `--workers=1` or `2` per group (MINCRM-661) | `@functional @serial` tests               |

`N` and `M` fall back to 2 and 4 respectively (the pre-probe constants, used
only when CPU count cannot be determined) but are normally computed dynamically
by the `capacity-probe` CI job — on today's 4-vCPU GitHub-hosted runners that
gives `N`=4 workers and `M`=2 shards — see [e2e-performance.md](e2e-performance.md) and
the "Shard/worker count" section in
[qa/e2e/README.md](../../qa/e2e/README.md#shardworker-count-mincrm-662).

The `e2e-functional` job passes `--grep-invert "visual-regression|serial"` so
`@serial` tests are never picked up by parallel workers, and the
visual-regression spec (which needs an isolated database) is left to
`update-visual-snapshots`.

Local non-serial runs share that exact expression via `NON_SERIAL_GREP_INVERT`
in `qa/scripts/targeted-run-plan.ts`, pinned across both sides by
`qa/scripts/check-grep-invert-parity.sh`. The `e2e-serial` job's grep filter
(`"@functional.*@serial|@serial.*@functional"`) is unchanged, but instead of
one blanket `--workers=1` invocation over every `@serial` file, it now runs
`qa/e2e/scripts/gen-conflict-group-configs.ts` to partition files into
conflict-free groups (via `qa/e2e/framework/reporting/conflict-graph.ts` and
`RESOURCE_REGISTRY`), then runs each group as its own sequential
`playwright test` invocation. Groups never overlap in wall-clock time —
process-level separation is the only reliable way to guarantee that (see
`gen-conflict-group-configs.ts`'s module doc) — but files WITHIN a
conflict-free group may share up to 2 workers, since by construction no two
files in the group touch the same resource. See
[e2e-performance.md](e2e-performance.md) for why Playwright's own scheduler
can't express this natively.

A test tagged only `@functional` (without `@serial`) that mutates shared state
will cause non-deterministic failures in the parallel job depending on shard
assignment and concurrency timing.

#### Merging the per-group and per-shard JUnit XML (MINCRM-689)

Both the `e2e-serial` job (per conflict group) and the `e2e-aggregate` job (per
shard) produce one JUnit XML file each, merged into a single document by
`qa/scripts/merge-junit-results.ts`. Two properties of that merger matter when
reading CI output:

- **The merged root declares real counts.** `tests`, `failures`, `skipped` and
  `errors` are summed across the merged suites. Both merge steps previously
  emitted a bare `<testsuites>`, so anything reading those attributes —
  `parseJUnitResults` in the attestation gate, in particular — saw `0` for a
  full green run.
- **Captured output survives the merge byte-for-byte.** Suite regions are located
  in a masked copy of each document and sliced from the original, so
  `<system-out>`/`<system-err>` and `<failure>` bodies reach the merged file
  intact. `.github/scripts/parse-junit.py` reads `<failure>` bodies to build the
  PR comment's failure details, so redacting them would blank it.

`time`, `id` and `name` are deliberately absent from the merged root: the
reporter's own root `time` is wall-clock while each suite's is summed test
duration, so a summed value would be wrong whenever a group runs more than one
worker.

**The two call sites treat a missing input file differently, on purpose.**

- `e2e-serial` merges per-group files produced by sequential invocations _within
  one job_. A shortfall there is reported as an error annotation and the merge
  still runs over what survived, because aborting would write no `results.xml` at
  all — blanking the GitHub Check, the artifact and the PR-comment row for every
  group, when only one group was lost. The job still fails via the run step's own
  exit code.
- `e2e-aggregate` merges one file per shard _job_, and passes `--expected-files`
  as a hard failure. That preserves the pre-existing MINCRM-662 guard: a whole
  shard job dying is a different signal from one sequential group failing, and a
  silently partial full-suite result is what that check exists to prevent.

Both sites pass `--allow-empty-inputs`, because Playwright writes a
zero-`<testsuite>` document for a run that matched no tests or whose
`globalSetup` threw. Only a _config-load_ failure produces no file at all.

Native `npx playwright merge-reports --reporter junit` was evaluated as a
replacement. It is blocked for different reasons per job, and the distinction
matters for anyone revisiting it:

- **`e2e-serial`** — blocked twice over. The blob reporter deletes its
  `outputDir` on every `playwright test` invocation, and this job runs one
  invocation per conflict group _sequentially_, so each group destroys the
  previous group's blob. Blob filenames also collide, since they are
  disambiguated only by `--shard`, which these groups do not use.
- **`e2e-aggregate`** — only the output-path limitation applies. This job runs no
  Playwright tests; it downloads blobs from the shard jobs and already runs
  `merge-reports --reporter html` successfully. But `--reporter` on the
  `merge-reports` CLI carries no output-file option, so a `junit` reporter added
  there writes the XML to stdout rather than to `merged-results.xml`. Directing
  it would need `PLAYWRIGHT_JUNIT_OUTPUT_FILE`, plus a replacement for the
  shard-completeness assertion that `--expected-files` currently provides.

Re-check both against the installed Playwright version before acting on either.

### Tagging syntax

Inline tag string (most tests):

```ts
test('@functional @serial F9-L1: admin sets system default language to es', async ({ ... }) => {
```

Parameterized tests using the `tag` option:

```ts
test('test title @functional @serial', { tag: ['@functional', '@serial'] }, async ({ ... }) => {
```

Both forms are required — the string form is what `--grep` matches; the `tag`
array is what Playwright's filter API uses. Always include both.

### Currently known `@serial` domains

The authoritative list is `RESOURCE_REGISTRY` in
`qa/e2e/apps/minicrm/resource-registry.ts` — this doc previously
hand-maintained a table here that went stale (it listed 9 files against a much
larger real population). No count is given here for the same reason — the one in
the registry itself drifted too. Do not hand-maintain a duplicate list; read
the registry directly, or run
`npx tsx qa/e2e/scripts/build-conflict-graph.ts` for a full report of every
tracked file, its resource(s), and its computed conflict groups. A
representative sample of resource keys in use, as of MINCRM-661:

| Resource key                        | Example file                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `settings.nav_layout`               | `navigation/navigation.spec.ts`                                                             |
| `settings.default_language`         | `i18n/i18n.spec.ts`                                                                         |
| `settings.currencies`               | `settings/settings.spec.ts`                                                                 |
| `settings.branding`                 | `branding/branding.spec.ts`                                                                 |
| `settings.sso`                      | `sso/sso.spec.ts`                                                                           |
| `settings.visibility_policy`        | `visibility/visibility.spec.ts`                                                             |
| `settings.ai_configuration_enabled` | `ai/ai.spec.ts` (and 8 other `ai/*.spec.ts` files)                                          |
| `settings.ai_cost_rates`            | `ai/ai-usage-dashboard.spec.ts` (F-AI-UD-6 only — distinct from `ai_configuration_enabled`) |
| `feature_flags.mobile_access`       | `feature-flags/feature-flags.spec.ts`                                                       |
| `settings.mfa_required`             | `auth/mfa.spec.ts` (F8-A1 only — the other four tests are per-user enrolment)               |
| `settings.pipeline_stages_reviewed` | `onboarding/onboarding.spec.ts` (also reset by every `ensureSystemDefaults()` caller)       |
| `settings.ensure_system_defaults`   | Composite: declaring it means declaring all ten rows that helper resets                     |
| `users.admin_onboarding_completed`  | `onboarding/onboarding.spec.ts` — a `users` column, not a `system_settings` row             |
| `pipeline_stages`                   | `pipeline-stages/pipeline-stages.spec.ts` (the stage rows, not the checklist boolean)       |

**Note on `test.describe.serial` vs the `@serial` tag:** they do different jobs
and one does not substitute for the other.

`test.describe.serial(...)` orders tests **within one file**. It does nothing
about other spec files, which under `fullyParallel: true` run concurrently on
other workers. The `@serial` **tag** is what moves a file out of the parallel
shard matrix into the `e2e-serial` job, because
`gen-conflict-group-configs.ts` discovers files by scanning test **titles** for
it and CI filters on titles too.

So a file that mutates a shared row and relies on `describe.serial` alone is
still racing every other file. `onboarding.spec.ts` was exactly that case until
MINCRM-705: it carried `describe.serial` and no tag, so it ran in the parallel
matrix while writing `system_settings.pipeline_stages_reviewed` — a row eight
other spec files also write via `ensureSystemDefaults()`. An earlier version of
this note claimed the flag was "per-session state that self-isolates within the
describe block"; that was wrong on both halves, and the belief is what kept the
race open.

Use the `@serial` tag (in the **title**), plus a `RESOURCE_REGISTRY` entry,
whenever a mutation affects a row another file could read or write. Add
`test.describe.serial` on top when tests within the file also need ordering.

### Enforcement

`node qa/scripts/check-settings-mutations.mjs` — run as part of the
`e2e-framework-purity` CI job and required locally before every commit (see
CLAUDE.md). Enforces two invariants:

1. A spec that calls a settings-mutating behavior must also call
   `ensureSystemDefaults()` (or a domain reset) and carry `@serial`. The set of
   mutating behavior functions is **derived** from `qa/e2e/behaviors/minicrm/`
   rather than hand-listed, so calling through a helper does not exempt a spec —
   which is how `onboarding.spec.ts` and `data-hygiene.spec.ts` both escaped the
   previous bash implementation (MINCRM-705).
2. Every `test.describe.serial(...)` **block** must contain a `@serial`-tagged
   test or be allow-listed in the guard with a written reason. Detection is
   per-block, not per-file: `notifications.spec.ts` has one tagged and one
   untagged block, and a file-level check passes it on the strength of the wrong
   one.

`--self-test` runs the scanner against fixtures for every shape it must catch,
including reset-vs-mutation at the call site and multi-line declarations. CI runs
it as its own step before the real scan.

---

## Waiting for page readiness

### Never use `waitForLoadState('networkidle')` in spec files

`networkidle` resolves as soon as no network requests have fired for 500 ms.
Under CI load, React Query's optimistic updates and background re-fetches can
start after that window, causing a test to proceed before the UI has settled.

Instead, wait for the exact DOM condition the test needs:

```ts
// Wrong — in a spec file:
await page.waitForLoadState('networkidle');

// Right — delete the wait if the surrounding behavior already guarantees readiness.
// Or call a void waitFor* behavior:
await waitForContactDetailReadMode({ page });

// Or use an expect assertion (which retries automatically):
await expect(locator).toBeVisible();
```

`page.waitForLoadState('networkidle')` inside **behavior files and page objects**
is fine — it's only banned in spec files.

`bash qa/scripts/check-networkidle.sh` fails CI if any `*.spec.ts` file under
`qa/e2e/tests/` uses `waitForLoadState('networkidle')`.

### How to choose a replacement

1. **Delete** the wait if the behavior called immediately before already
   guarantees readiness (most navigation behaviors wait internally).
2. **Call an existing void `waitFor*` behavior** if one exists for the state you
   need (e.g. `waitForContactDetailReadMode`).
3. **Add a new void `waitFor*` behavior** if no suitable one exists. The behavior
   should encapsulate the wait, not return a locator. Name it `waitForFooReady`
   or `waitForFooVisible`.

---

## Locator strategy

- **Primary strategy** in every `locate()` call must be `testId`.
- Every `locate()` must have at least two strategies and an `intent` string
  (5–10 words describing what the locator is for).
- Spec-layer single-`testId` locates for dynamic IDs are allowed with a one-line
  inline comment, but all such locates must go through a behavior function —
  specs must never call `page.locate()` or `page.getByTestId()` directly.

---

## Settings mutations — cleanup contract

Any test that mutates a `system_settings` row must:

1. Call `ensureSystemDefaults(restClient)` in **both** `test.beforeEach` and
   `test.afterEach`.
2. Carry the `@serial` tag (see above).
3. Optionally add a pre-condition assertion at the start of the test body to
   catch concurrent mutations that race between `beforeEach` and the test:

```ts
const navLayout = (await restClient.get('/api/v1/settings/nav-layout')).body.layout;
expect(
  navLayout,
  "[pre-condition] nav_layout expected 'top' — likely a concurrent mutation from another worker",
).toBe('top');
```

No shared `assertSettingEquals` helper is introduced — inline `expect` with a
message argument is sufficient and keeps the assertion visible in the spec.

---

## Tags reference

| Tag           | Meaning                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `@functional` | Required on every test in this suite                                      |
| `@serial`     | Mutates shared global state; runs in `e2e-serial` job (1-2 workers/group) |
| `@smoke`      | Subset of functional tests for quick sanity checks                        |
| `@visual`     | Screenshot comparison tests; run in a separate visual regression pipeline |

---

## Static checks (run before every commit)

```bash
bash qa/scripts/check-framework-purity.sh   # no app-domain strings in framework/
bash qa/scripts/check-behavior-layer.sh     # no @pages/* imports in specs
node qa/scripts/check-settings-mutations.mjs # @serial + ensureSystemDefaults enforced
bash qa/scripts/check-networkidle.sh        # no networkidle in spec files
bash qa/scripts/check-sha-pattern-parity.sh # coverage build-SHA accept-set parity
bash qa/scripts/check-e2e-cleanup.sh        # created records registered for teardown
```

All of these must pass before pushing. They run in the `e2e-framework-purity` CI
job, alongside `check-compose-isolation.sh` — the job is gated on the `qa` paths
filter, which includes `docker-compose*.yml`, so a compose-only change still
triggers it. `check-env-example-parity.sh` and `check-e2e-beforeall.sh` are
local-only and run in no CI job today.

---

## Cleaning up what a test creates

`TestDataManager` deletes only what a test registers — it never truncates and never
issues a bulk delete. A record created by a `create*ViaApi` behavior helper and not
registered stays in the database for the rest of the run.

Prefer the `createTest*` helpers in `qa/e2e/apps/minicrm/helpers.ts`, which create and
register in one call:

```ts
const contact = await createTestContact(testData, restClient, { first_name: 'Ada' });
```

When a behavior helper is the right tool, register immediately after creating — before
any assertion, so cleanup still runs if the test throws mid-setup:

```ts
const contact = await createContactViaApi(restClient, { first_name: 'Ada' });
testData.register('contact', contact.id, `/api/v1/contacts/${contact.id}`);
```

**If the test re-authenticates `restClient` as a non-admin at any point, use
`registerAdminTeardown()` instead.** Teardown runs with the client in whatever auth
state the test left it, so a rep deleting another user's record takes a 403 and the
record is never cleaned up:

```ts
registerAdminTeardown(testData, restClient, 'contact', c.id, `/api/v1/contacts/${c.id}`);
```

That 403 is now reported rather than swallowed. `registerAdminTeardown` swallows only
a 404 — the expected outcome when the test already deleted the record itself, and the
same rule a plain `register()` entry follows — and propagates everything else, so
`TestDataManager` records `success: false` and the `testData` fixture annotates the test
with `teardown-failed`.

Where that annotation shows up depends on where you are running:

- **Locally** — as a `<property>` on the test in `qa/e2e/test-results/results.xml`, plus
  a `[TestDataManager] teardown failed` line on stderr. There is no step summary locally;
  `StepSummaryReporter` is registered only under CI.
- **In CI** — additionally in the job summary's **Cleanup Failures** section, which
  collects them from every attempt, _including tests that passed_. A green test that
  leaked a record is the case with no other signal, and the one that accumulates.

If you see one, a record leaked. Treat it as a real failure rather than noise — a 404 is
already filtered out, so anything reported here means the row is still in the database.
(MINCRM-668)

Register a record even when the test deletes it itself through the UI: registration is
what covers the path where the test fails before reaching its own delete. On the happy
path the record is already gone and the teardown DELETE 404s, which counts as successful
cleanup — a plain `register()` entry is fine here and costs nothing on a green run. Pick
between `register()` and `registerAdminTeardown()` on the auth question above, not on
whether the test deletes its own record. (MINCRM-668)

**Users need `registerUserDeactivation()`, not `register()`.** Users cannot be
hard-deleted, so cleanup is `PATCH /api/v1/users/:id/deactivate` rather than the DELETE a
plain entry issues. The helper re-authenticates as admin inside the teardown callback,
because tests routinely leave `restClient` authenticated as the user they just created
and deactivation is admin-only:

```ts
const { user } = await inviteUserViaApi(restClient, { name, email, role: 'rep' });
registerUserDeactivation(testData, restClient, user.id, 'rep');
```

`createTestUser`, `createTestRep`, and `createTestAdmin` call it for you — prefer those.
Reach for `registerUserDeactivation` directly only when you need a role or a response
field those helpers do not expose, as the `iam/` specs do for `viewer` and
`service_account`. Register immediately after the invite returns an id, before
set-password and onboarding: the row exists from that moment, and every later step can
throw. Pass the **fixture** `restClient`, never a client the test disposes in a
`finally` — the callback runs after the test body and would throw against a dead
context. (MINCRM-668)

A record that is deliberately left behind, or is already cleaned up by other means,
opts out with a `// MINCRM-686-ok: <reason>` marker on the create line or in a comment
block directly above it, within three lines. The reason is required and brief — it
is what makes a deliberate exception distinguishable from an oversight.

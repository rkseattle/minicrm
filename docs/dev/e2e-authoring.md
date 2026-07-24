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
Does my test mutate any system_settings row or pipeline stage sort order?
│
├─ Yes
│   ├─ Add @serial to every affected test's tag string.
│   ├─ Add ensureSystemDefaults() to beforeEach AND afterEach.
│   └─ Done — the e2e-serial CI job runs these with --workers=1.
│
└─ No — no @serial needed; test is safe to run in the parallel shard job.
```

If you are unsure whether a behavior call mutates shared state, search for
`restClient.patch` or `restClient.put` inside the behavior implementation.

### The two CI jobs

| Job              | Playwright flag                                                                         | What runs                                 |
| ---------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| `e2e-functional` | `--workers=N` per shard, `M` shards × 2 projects (N, M from capacity-probe, MINCRM-662) | `@functional` tests **without** `@serial` |
| `e2e-serial`     | `--workers=1`                                                                           | `@functional @serial` tests               |

`N` and `M` default to 2 and 4 respectively (today's known-good values on
GitHub's free-tier 2-vCPU runners) but are computed dynamically by the
`capacity-probe` CI job — see [e2e-performance.md](e2e-performance.md) and
the "Shard/worker count" section in
[qa/e2e/README.md](../../qa/e2e/README.md#shard-worker-count-mincrm-662).

The `e2e-functional` job passes `--grep-invert serial` so `@serial` tests are
never picked up by parallel workers. The `e2e-serial` job greps for
`"@functional.*@serial|@serial.*@functional"`.

A test tagged only `@functional` (without `@serial`) that mutates shared state
will cause non-deterministic failures in the parallel job depending on shard
assignment and concurrency timing.

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

| Domain                    | File                                  | Setting mutated               |
| ------------------------- | ------------------------------------- | ----------------------------- |
| Navigation layouts        | `navigation/navigation.spec.ts`       | `nav_layout`                  |
| i18n language switching   | `i18n/i18n.spec.ts`                   | `default_language`            |
| Currency settings         | `settings/settings.spec.ts`           | `home_currency`, `currencies` |
| Branding                  | `branding/branding.spec.ts`           | `branding.*`                  |
| SSO configuration         | `sso/sso.spec.ts`                     | `sso.*`                       |
| Reports left-nav          | `reports/reports-nav.spec.ts`         | `nav_layout`                  |
| Accessibility (A11Y-N1)   | `accessibility/accessibility.spec.ts` | `nav_layout`                  |
| Admin email notifications | `notifications/notifications.spec.ts` | `email_notifications_enabled` |
| Visibility policy         | `visibility/visibility.spec.ts`       | `visibility_policy`           |

**Note on `test.describe.serial` vs `@serial` tag:** `onboarding.spec.ts` uses
`test.describe.serial(...)` at the describe level to serialize tests within the
file, but its tests are not tagged `@serial` and run in the parallel shard job.
This works because `setOnboardingCompleted` modifies per-session state that
self-isolates within the describe block. Use `@serial` (not just
`test.describe.serial`) whenever the mutation affects a shared row that parallel
workers across different files could also be reading or writing.

### Enforcement

`bash qa/scripts/check-settings-mutations.sh` — run as part of the
`e2e-framework-purity` CI job and required locally before every commit (see
CLAUDE.md). Fails if a spec that calls a settings-mutating behavior does not
also call `ensureSystemDefaults()` and carry `@serial`.

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
- Spec-layer single-`testId` locates for dynamic IDs are allowed with an
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
| `@serial`     | Mutates shared global state; runs in `e2e-serial` job (--workers=1)       |
| `@smoke`      | Subset of functional tests for quick sanity checks                        |
| `@visual`     | Screenshot comparison tests; run in a separate visual regression pipeline |

---

## Static checks (run before every commit)

```bash
bash qa/scripts/check-framework-purity.sh   # no app-domain strings in framework/
bash qa/scripts/check-behavior-layer.sh     # no @pages/* imports in specs
bash qa/scripts/check-settings-mutations.sh # @serial + ensureSystemDefaults enforced
bash qa/scripts/check-networkidle.sh        # no networkidle in spec files
```

All four must pass before pushing. They also run in the `e2e-framework-purity`
CI job on every PR.

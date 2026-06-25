# E2E Parallelism Notes (MINCRM-550)

This document records which spec files have been evaluated for intra-file
parallelism, the decision made for each, and the safety checklist to apply
when auditing future candidates.

---

## Safety Checklist

Before adding `test.describe.configure({ mode: 'parallel' })` to any spec file,
verify **every item** on this checklist:

- [ ] All test data is UUID-scoped (unique suffix per test, per run). No two
      tests can observe each other's records in the database.
- [ ] `beforeEach` creates a fresh user (rep or admin) per test — not a shared
      user reused across tests.
- [ ] No test asserts an aggregate count on the full table (e.g. "there are 3
      contacts"). All count assertions are scoped to a UUID search term.
- [ ] `storageState` is either cleared (`{ cookies: [], origins: [] }`) or
      is a **read-only** pre-auth cookie that no test in the file invalidates
      (no logout, no password change that would revoke the shared session).
- [ ] No test writes to a `system_settings` row (nav_layout, default_language,
      onboarding_completed, visibility_policy, ai_settings, feature flag state,
      branding, etc.). Such tests must be `@serial` and live in a
      `test.describe.serial` block.
- [ ] After conversion, the file passes locally with `--workers=4` and shows
      no ordering-dependent failures across 3 consecutive runs.

---

## Files Parallelized

| File                                              | Baseline Duration | Parallel Since |
| ------------------------------------------------- | ----------------- | -------------- |
| `search/search.spec.ts`                           | 112.6 s           | MINCRM-550     |
| `auth/auth.spec.ts`                               | 86.6 s            | MINCRM-550     |
| `leads-opportunities/leads-opportunities.spec.ts` | 85.2 s            | MINCRM-550     |
| `pipeline-dnd/pipeline-dnd.spec.ts`               | 69.9 s            | MINCRM-550     |
| `permissions/permissions.spec.ts`                 | 68.6 s            | MINCRM-550     |
| `contacts/contacts.spec.ts`                       | 65.1 s            | MINCRM-550     |
| `notes/notes.spec.ts`                             | 44.5 s            | MINCRM-550     |
| `leads/leads.spec.ts`                             | 44.5 s            | MINCRM-550     |
| `accounts/accounts.spec.ts`                       | 36.3 s            | MINCRM-550     |
| `activities/activities.spec.ts`                   | 35.0 s            | MINCRM-550     |
| `error-states/error-states.spec.ts`               | 30.5 s            | MINCRM-550     |
| `reports/stage-trend.spec.ts`                     | 27.2 s            | MINCRM-550     |

**Isolation notes per file:**

- **`search/search.spec.ts`** — Each test creates UUID-suffixed contacts, accounts,
  and deals. API cross-checks use the same UUID search term so sibling test inserts
  cannot appear in results. No shared session state; auth cookie is per-worker.

- **`auth/auth.spec.ts`** — Each test creates its own user via invite + password
  setup, exercising that user's session in isolation, then deactivates it in a
  `finally` block. The lockout test (F1-LK1) locks only the user it creates.

- **`leads-opportunities/leads-opportunities.spec.ts`** — `beforeEach` creates a
  fresh UUID-suffixed rep. All leads, deals, and contacts belong to that rep and
  are torn down by `TestDataManager`. No shared table-wide count assertions.

- **`pipeline-dnd/pipeline-dnd.spec.ts`** — `beforeEach` authenticates via REST
  only; the browser rep is created fresh inside each test body. DnD tests are
  desktop-only; mobile-web tests skip cleanly without mutating state.

- **`permissions/permissions.spec.ts`** — Every test creates isolated admin and rep
  users with UUID-scoped credentials. All assertions use HTTP status codes, not
  table-count totals. Records are cleaned up in `finally` blocks.

- **`contacts/contacts.spec.ts`** — `beforeEach` creates a fresh rep. All API count
  assertions (`search.total`, `page.data.length`) are scoped to UUID-suffixed
  search terms that match only that test's records.

- **`notes/notes.spec.ts`** — `beforeEach` creates a fresh rep. Visibility tests
  (F14-V1/V2) create an isolated rep pair; both are deactivated in `finally`.

- **`leads/leads.spec.ts`** — `beforeEach` creates a fresh rep and resets language
  to English (idempotent). No shared leads table assertions.

- **`accounts/accounts.spec.ts`** — `beforeEach` creates a fresh rep. All API
  count assertions are scoped to UUID-suffixed search terms.

- **`activities/activities.spec.ts`** — `beforeEach` creates a fresh rep.
  F5-MY2/MY3 create a second isolated REST context (second rep user); both are
  UUID-scoped and deactivated in `finally`.

- **`error-states/error-states.spec.ts`** — `beforeEach` creates a fresh rep.
  `page.mockRoute()` mocks are scoped per test and live in separate worker browser
  contexts; they cannot bleed across parallel tests.

- **`reports/stage-trend.spec.ts`** — `beforeEach` creates a fresh admin per test.
  The stage-trend report is read-only; tests only change the date-range selector
  and assert on empty/populated rendering state.

---

## Files Evaluated and Rejected

| File                                  | Baseline Duration | Reason Rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigation/navigation.spec.ts`       | 111.5 s           | Mutates `nav_layout` system_settings row. Layout-mutating tests are already inside a single `test.describe.serial` block. Deep-link and global-UI tests outside that block are already parallel-safe. No further action possible without restructuring the serial block.                                                                                                                                                                                                                          |
| `onboarding/onboarding.spec.ts`       | 73.5 s            | All tests mutate the shared `onboarding_completed` system_settings row on the singleton admin account. The entire file is already wrapped in `test.describe.serial`. Cannot parallelize without a dedicated per-test admin account (expensive refactor, out of scope).                                                                                                                                                                                                                            |
| `i18n/i18n.spec.ts`                   | 60.5 s            | All tests mutate the system default language (`default_language` system_settings row) or the admin user's `preferred_language`. The entire file is already wrapped in `test.describe.serial`.                                                                                                                                                                                                                                                                                                     |
| `feature-flags/feature-flags.spec.ts` | 46.7 s            | All tests are `@serial`. Tests that toggle real feature flags (F-FF2, F-FF9) mutate global flag state that affects all concurrent API responses. Tests that use `withFlags()` (F-FF5/6/7/8) could run in parallel, but they are interleaved with serial tests in the same file — separating them is a larger refactor out of scope here.                                                                                                                                                          |
| `concurrency/concurrency.spec.ts`     | 40.5 s            | All tests are inside `test.describe.serial` by design. The concurrency tests use a choreographed sequence (User A reads, User B writes with a newer version, User A writes with the stale version). The order of these steps must be deterministic — parallelizing tests would require each test to own completely separate records, which they already do, but the serial block was added explicitly to prevent worker contention on the test DB under load. Revisit after load-test validation. |
| `admin/aiSettings.spec.ts`            | 30.3 s            | `beforeEach`/`afterEach` both call `resetAiSettings()`, which writes to the `ai_settings` system_settings row. Parallel tests would race on this reset: one test's `afterEach` reset could overwrite the state set up by another test's `beforeEach`. Requires per-test AI settings isolation (not available without schema changes).                                                                                                                                                             |
| `visibility/visibility.spec.ts`       | 27.8 s            | All tests are `@serial` and mutate the global `visibility_policy` system_settings row. The entire file is already run in the dedicated `e2e-serial` CI job.                                                                                                                                                                                                                                                                                                                                       |

---

## Guidance for Future Spec Files

**New spec files covering shared system resources should default to sequential
(`test.describe.serial`) unless explicitly audited against the checklist above.**

"Shared system resources" includes any row in `system_settings`, any flag in
`feature_flags`, any shared admin user account, or any test that mutates state
that is visible to all concurrent workers (e.g., global pipeline stage order,
org-level visibility policy, AI provider configuration).

Spec files that create all their own data via `TestDataManager` with UUID-scoped
names and never touch `system_settings` are strong candidates for parallel mode.
Run the hotspot finder after accumulating 3+ CI baseline runs:

```bash
npm run e2e:timing:hotspots
```

Then apply the safety checklist above to each identified hot-spot file before
enabling `test.describe.configure({ mode: 'parallel' })`.

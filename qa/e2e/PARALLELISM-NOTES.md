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
      pipeline_stages_reviewed, visibility_policy, ai_settings, feature flag
      state, branding, etc.), or to a singleton-shared row on another table —
      notably `users.onboarding_completed` on the seeded admin account every
      spec logs in as. Such tests must carry the `@serial` tag **in the test
      title** and have a `RESOURCE_REGISTRY` entry; a `test.describe.serial`
      block is for intra-file ordering and is not a substitute, because it
      gives no cross-file protection. (MINCRM-705)
- [ ] After conversion, the file passes locally with `--workers=4`. The
      local Definition of Done (`--workers=1`) is the required gate; `--workers=4`
      is advisory validation that should be run before merging to confirm no
      ordering-dependent failures emerge under higher concurrency.

---

## Files Parallelized

| File                                              | Baseline Duration | Parallel Since |
| ------------------------------------------------- | ----------------- | -------------- |
| `search/search.spec.ts`                           | 112.6 s           | MINCRM-550     |
| `leads-opportunities/leads-opportunities.spec.ts` | 85.2 s            | MINCRM-550     |
| `pipeline-dnd/pipeline-dnd.spec.ts`               | 69.9 s            | MINCRM-550     |
| `permissions/permissions.spec.ts`                 | 68.6 s            | MINCRM-550     |
| `contacts/contacts.spec.ts`                       | 65.1 s            | MINCRM-550     |
| `notes/notes.spec.ts`                             | 44.5 s            | MINCRM-550     |
| `accounts/accounts.spec.ts`                       | 36.3 s            | MINCRM-550     |
| `activities/activities.spec.ts`                   | 35.0 s            | MINCRM-550     |
| `error-states/error-states.spec.ts`               | 30.5 s            | MINCRM-550     |
| `reports/stage-trend.spec.ts`                     | 27.2 s            | MINCRM-550     |
| `tags/tags.spec.ts`                               | 46.7 s            | MINCRM-662     |

**Isolation notes per file:**

- **`search/search.spec.ts`** — Each test creates UUID-suffixed contacts, accounts,
  and deals. API cross-checks use the same UUID search term so sibling test inserts
  cannot appear in results. No shared session state; auth cookie is per-worker.

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

- **`notes/notes.spec.ts`** — `beforeEach` creates a fresh rep. F14-V1 creates an
  isolated rep pair (repA writes a private note; repB verifies the masked placeholder);
  both are deactivated in `finally`. F14-V2 uses the singleton admin account for
  visibility-change verification (read-only — no system_settings writes).

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

- **`tags/tags.spec.ts`** — `beforeEach` creates a fresh admin. This file was
  running under the global `fullyParallel: true` default without ever being
  audited; F8-TG1b ("pagination controls always visible") was the one
  checklist violation — it asserted a condition on the shared global admin
  tags list without owning any data, so it raced F8-TG3 (delete) and F8-TG4
  (attach) under concurrent CI load and intermittently timed out waiting for
  the tags query to resolve (MINCRM-662, observed as
  `StrategyExhaustedError` on the `pagination` testId). Fixed by having
  F8-TG1b create its own UUID-suffixed tag via `createTestTag` like every
  other test in the file, removing the dependency on ambient/racing state.
  Every other test already creates UUID-suffixed tags/contacts/deals and
  makes no table-wide count assertions.

---

## Files Evaluated and Rejected

| File                                     | Baseline Duration | Reason Rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth/auth.spec.ts`                      | 86.6 s            | Intra-file isolation holds (UUID-scoped users, no system_settings writes), but tests hammer the rate-limited `POST /api/v1/auth/login` endpoint. The lockout test (F1-LO1) fires 11 consecutive login requests. When this file runs in parallel at the same time as other shards, concurrent login load causes `ECONNRESET` on the shared CI test server, breaking unrelated tests in other files. The login endpoint is effectively a shared resource under rate limiting. (MINCRM-550: observed F1-PR6 ECONNRESET and F8-TN1 nav stall in CI.)                                                                                                                                           |
| `navigation/navigation.spec.ts`          | 111.5 s           | Mutates `nav_layout` system_settings row. Layout-mutating tests are already inside a single `test.describe.serial` block. Deep-link and global-UI tests outside that block are already parallel-safe. No further action possible without restructuring the serial block.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `onboarding/onboarding.spec.ts`          | 73.5 s            | Writes two shared resources: the `pipeline_stages_reviewed` **system_settings** row (via `ensureSystemDefaults` and `resetPipelineStagesReviewed`), which seven other spec files also write, and the singleton seeded admin's `users.onboarding_completed` **column** — not a system_settings row, and per-user, but shared because every spec authenticates as that same admin. Now `@serial`-tagged and registered, so it runs in the `e2e-serial` job; `test.describe.serial` remains for intra-file ordering. Until MINCRM-705 it had the describe.serial WITHOUT the tag, so it ran in the parallel matrix — describe.serial gives no cross-file protection.                          |
| `i18n/i18n.spec.ts`                      | 60.5 s            | All tests mutate the system default language (`default_language` system_settings row) or the admin user's `preferred_language`. The entire file is already wrapped in `test.describe.serial`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `feature-flags/feature-flags.spec.ts`    | 46.7 s            | All tests are `@serial`. Tests that toggle real feature flags (F-FF2, F-FF9) mutate global flag state that affects all concurrent API responses. Tests that use `withFlags()` (F-FF5/6/7/8) could run in parallel, but they are interleaved with serial tests in the same file — separating them is a larger refactor out of scope here.                                                                                                                                                                                                                                                                                                                                                   |
| `concurrency/concurrency.spec.ts`        | 40.5 s            | All tests are inside `test.describe.serial` by design. The serial constraint is about in-test step ordering, not cross-test isolation: each test uses a choreographed three-step sequence (User A reads → User B writes with newer version → User A writes with stale version) where deterministic ordering is required. Each test already owns separate records; the `test.describe.serial` block was added to preserve the intra-test choreography ordering guarantee under worker scheduling.                                                                                                                                                                                           |
| `leads/leads.spec.ts`                    | 44.5 s            | `beforeEach` calls `setSystemDefaultLanguage(restClient, 'en')` and `setUserLanguage(restClient, null)`, both of which write to shared system_settings / admin user rows. When `i18n.spec.ts` runs concurrently on another worker and sets `default_language='de'`, a `leads.spec.ts` `beforeEach` reset can clobber that setting mid-test, causing intermittent cross-worker races on badge text assertions. The write to `default_language` violates the "no system_settings writes" checklist item.                                                                                                                                                                                     |
| `admin/aiSettings.spec.ts`               | 30.3 s            | `beforeEach`/`afterEach` both call `resetAiSettings()`, which writes to the `ai_settings` system_settings row. Parallel tests would race on this reset: one test's `afterEach` reset could overwrite the state set up by another test's `beforeEach`. Requires per-test AI settings isolation (not available without schema changes).                                                                                                                                                                                                                                                                                                                                                      |
| `visibility/visibility.spec.ts`          | 27.8 s            | All tests are `@serial` and mutate the global `visibility_policy` system_settings row. The entire file is already run in the dedicated `e2e-serial` CI job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ai/ai*.spec.ts` (all files, MINCRM-435) | varies            | Every AI spec file's `beforeEach` calls `setAiEnabled(restClient, true)`, which writes to the `ai_configuration` system_settings row (the master AI toggle). All AI session/context data is user-scoped, so per-test isolation via `ephemeralRep`/`ephemeralAdmin` would be feasible for the session/message CRUD itself, but the shared master-toggle write remains a real cross-file race: a parallel worker's `afterEach`/reset in another AI file could flip the toggle off mid-test on this worker. Kept serial for consistency with every pre-existing AI spec file rather than partially parallelizing a subset — the toggle write is the actual constraint, not session ownership. |

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

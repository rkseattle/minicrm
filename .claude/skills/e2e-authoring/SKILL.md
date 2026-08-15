---
name: e2e-authoring
description: E2E test authoring conventions for this repo — locator strategy, waits, tags, layering, and parallelism rules. Applies when writing or editing anything under qa/.
paths:
  - 'qa/**'
user-invocable: false
---

Conventions for anything under `qa/`. Full reference: `docs/dev/e2e-authoring.md`.

## Layering

- Specs import only from `@behaviors/*`, `@apps/*`, `@framework/*` — never `@pages/*`.
- Behavior functions carry intent in the name: `click*`, `fill*`, `expect*`. No
  `get<Xxx>Locator()` calls in spec files.
- `qa/e2e/framework/` contains zero app-domain strings — enforced by
  `check-framework-purity.sh`, and it scans JSDoc too. `MINCRM-*` refs match the
  `mini?crm` pattern and the word `pipeline` matches the CRM i18n namespace check, both
  inside `@example` and `@param` blocks. Rephrase rather than suppress.
- Spec location: `qa/e2e/tests/apps/minicrm/functional/<domain>/<domain>.spec.ts`.

## Locators

Primary strategy is always `testId`. Every `locate()` in a page object needs at least
two strategies and a 5–10 word `intent` string. Spec-layer single-testId locates are
allowed for dynamic IDs with a comment explaining why.

## Waits

- No `page.waitForTimeout()` in page objects. Use `locator.waitFor({ state })`,
  `expect(locator).toBeVisible()`, or `page.waitForFunction()`.
- No `page.waitForLoadState('networkidle')` in spec files — enforced by
  `check-networkidle.sh`. Note the check only scans `qa/e2e/tests/`, not `behaviors/`
  or `pages/`, so grep those directly when auditing.
- For mutation outcomes, use the HTTP response, not DOM polling: set up
  `waitForResponse` **before** clicking, then branch on the status code. DOM waits are
  UI catch-up only, never the primary decision-maker. Watch for actions that skip the
  network entirely — native required-field validation, for instance — before adding a
  response-only wait.

## Tags and isolation

- Every test is `@functional`; smoke tests add `@smoke`.
- Any test that mutates a shared `system_settings` row — nav layout, visibility policy,
  default language, MFA policy, branding, SSO, email notifications, currencies,
  pipeline stage sort order — **must** be `@functional @serial`. Enforced by
  `check-settings-mutations.mjs`, which follows calls into the behavior layer, so
  mutating through a helper does not exempt you.
- The `@serial` tag must be in the test's **title**. A tag supplied only via the
  `{ tag: [...] }` options object is invisible to `gen-conflict-group-configs.ts`
  and to CI's `--grep`, so the file still runs in the parallel matrix.
- Settings mutations call `ensureSystemDefaults()` for cleanup.
- Feature flags via `withFlags()` only — never via API or DB mutation.
- No `loginAsAdmin` in `test.beforeAll` — call it at the start of the test body.
- `test.describe.serial` is **not** isolation. It orders tests within one file and
  gives no cross-file protection; a file relying on it alone still runs beside
  other spec files. Shared-resource files need the `@serial` tag (which is what
  moves them to the `e2e-serial` job) plus a `RESOURCE_REGISTRY` entry. Every
  `describe.serial` block must be tagged or allow-listed. (MINCRM-705)
- New spec files touching any shared system resource use `@serial` + a registry
  entry, and may add `test.describe.serial` for intra-file ordering.
  Files creating all their own data via UUID-scoped `TestDataManager` may be candidates
  for `parallel` mode — apply the checklist in `qa/e2e/PARALLELISM-NOTES.md` first, and
  see `npm run e2e:timing:hotspots` for which files are worth auditing.

## Fixtures

Test fixture passwords must be ≥ 12 characters (`PASSWORD_MIN_LENGTH=12`); shorter ones
fail auth validation.

`createContactHandler` always uses `req.user.id` for the owner and ignores `owner_id`
in the body — to create a contact owned by a specific user, authenticate the REST
client as that user.

## Gates

Every story includes or updates a functional E2E spec. Any `qa/e2e/` file in a diff
triggers all four QA static checks before that commit; `qa/e2e/framework/` files also
trigger the 80% coverage check. See `.claude/gates/definition-of-done.md`.

# behaviors/

The behavior layer is the primary seam between test specs and Page Objects.
Behaviors are named, reusable async functions that express multi-step user
journeys in plain language. A test spec should read like a user scenario — it
must not contain raw locators or direct Page Object method calls.

## Directory layout

```
behaviors/
  minicrm/
    auth.behaviors.ts      # login, logout
    contacts.behaviors.ts  # navigateToContacts, (future: createContact, etc.)
    index.ts               # barrel export
  README.md
```

Add a new file per domain area. If a file exceeds ~150 lines, split it.

---

## Contract

### What belongs in a behavior

- Multi-step UI journeys composed from one or more Page Objects.
- Optional REST/gRPC calls via `restClient` when setup data is needed before
  touching the UI (e.g. seed a record, then navigate to it).
- Return values that describe the observable outcome (typed result objects).

### What does NOT belong in a behavior

| Do NOT put this in a behavior | Put it here instead |
| ----------------------------- | ------------------- |
| `expect()` assertions         | Test spec           |
| Raw `page.locator()` calls    | Page Object         |
| Direct element interactions   | Page Object         |
| Business logic / calculations | Service layer       |

---

## Writing a behavior

### 1. Define a typed parameter object

Every behavior accepts exactly **two arguments**:

```ts
async function myBehavior(
  params: MyBehaviorParams, // typed — no `any`
  context: MyBehaviorContext, // fixture context: { page: PageFacade, restClient?, ... }
): Promise<MyBehaviorResult>;
```

If the behavior takes no external parameters (e.g. `navigateToContacts`), omit
the first argument. Never use positional `string` / `number` arguments directly
— wrap them in a named params object so call sites are self-documenting.

### 2. Define a typed result object

Return a plain object (not `void`) so test specs can assert on it:

```ts
export interface LoginResult {
  success: boolean;
  finalUrl: string;
  errorMessage: string | null;
}
```

### 3. Compose Page Objects — never raw locators

```ts
// CORRECT
export async function login(credentials: LoginCredentials, context: AuthBehaviorContext) {
  const loginPage = new LoginPage(context);
  await loginPage.navigate();
  await loginPage.fillEmail(credentials.email);
  await loginPage.fillPassword(credentials.password);
  await loginPage.submit();
  // ...
}

// WRONG — element interaction called directly from a behavior instead of via a Page Object
await context.page.click([{ type: 'testId', value: 'login-email' }]);
await context.page.fill(credentials.email, [{ type: 'testId', value: 'login-password' }]);
```

### 4. No assertions

```ts
// CORRECT — behavior returns result, spec asserts
const result = await login(credentials, { page });
expect(result.success).toBe(true); // in the spec

// WRONG — assertion inside behavior
expect(await loginPage.errorMessage()).toBeNull();
```

### 5. Wait for stable state before returning

Behaviors should leave the page in a settled state so the spec can assert
immediately without extra waits:

```ts
await context.page.waitForLoadState('networkidle');
```

---

## Fixture context

Each behavior file defines its own `*Context` interface that lists only the
fixtures it actually needs. Use `PageFacade` as the `page` type — it combines
safe navigation methods with all healing element interactions in one object.

```ts
import type { PageFacade } from '@framework/fixtures/index.js';

export interface AuthBehaviorContext {
  page: PageFacade;
}
```

Pass the `page` fixture directly from the test (no `testName` or `healPage`
needed — they are baked into `PageFacade`):

```ts
test('logs in as admin', async ({ page }) => {
  const result = await login({ email: '...', password: '...' }, { page });
  expect(result.success).toBe(true);
});
```

---

## Composing multiple Page Objects

A single behavior may use more than one Page Object when a journey spans
multiple pages:

```ts
export async function createContactAndVerify(
  params: CreateContactParams,
  context: ContactsBehaviorContext,
): Promise<CreateContactResult> {
  const contactsPage = new ContactsPage(context);
  const contactFormPage = new ContactFormPage(context);

  await contactsPage.navigate();
  await contactsPage.clickNewContact();
  await contactFormPage.fillName(params.firstName, params.lastName);
  await contactFormPage.save();

  await context.page.waitForLoadState('networkidle');
  return { finalUrl: context.page.url() };
}
```

---

## Barrel exports

Always export from `behaviors/minicrm/index.ts`. Test specs import from the
barrel:

```ts
import { login, navigateToContacts } from '@behaviors/minicrm/index.js';
```

---

---

## `test.beforeAll` usage rules (MINCRM-368)

### The `storageState` + `restClient` relationship

`playwright.config.ts` sets `storageState: ADMIN_STORAGE_STATE` for every project.
This file is written by `globalSetup.ts` once before any worker starts and contains
the browser cookies (including the admin JWT) for a pre-authenticated admin session.

The `restClient` fixture used in test bodies is a REST API client that is separate from
the browser context. **It does not automatically inherit the `storageState` cookies.**
`loginAsAdmin(restClient)` authenticates the `restClient` so that REST calls made inside
a test body (e.g. seeding data, calling admin APIs) carry an admin JWT.

Because `restClient` is a **per-test** fixture (created fresh for each test), it starts
unauthenticated. The `storageState` only applies to browser navigation — it does not
pre-authenticate `restClient`.

### Why `beforeAll` + `loginAsAdmin` is an anti-pattern

`test.beforeAll` runs **once per worker**, but each individual test receives a **new
`restClient` instance**. Calling `loginAsAdmin(restClient)` inside `beforeAll` authenticates
the fixture instance that exists at `beforeAll` time — not the per-test instances.
The call is therefore a no-op for all subsequent tests: it does not carry forward.

More critically, any test that then calls `loginAs(restClient, ...)` to switch to a rep
session does so on its own fresh `restClient` and correctly restores with
`loginAsAdmin(restClient)` inside a `finally` block. The `beforeAll` call never provided
safety here, and its presence created a false impression that auth state was shared.

**Rule: do not call `loginAsAdmin(restClient)` in `test.beforeAll`.**

If a test needs `restClient` to be admin-authenticated, call `loginAsAdmin(restClient)` at
the start of that test body, or — the preferred pattern — use the `restClient` directly
(it starts unauthenticated; the server will reject non-admin calls, and the test will fail
with a clear 401/403 rather than silently using stale auth).

### When is `test.beforeAll` acceptable?

`test.beforeAll` is acceptable **only** for seeding immutable, read-only shared data that
would be expensive to create per-test and that no test mutates. When used this way, add an
inline comment explaining why the shared state is safe, in a line or two:

```ts
// Safe: seeds a pipeline stage that all tests in this file read but never modify.
// Runs once per worker; stage is cleaned up in afterAll.
test.beforeAll(async ({ restClient }) => {
  sharedStage = await createPipelineStage(restClient, { name: 'Shared Stage' });
});
```

### When is `loginAsAdmin(restClient)` in individual tests acceptable?

`loginAsAdmin(restClient)` is correct and necessary when a test switches the `restClient`
session to a non-admin user (via `loginAs`) and must restore admin credentials before
performing teardown or subsequent API calls. This pattern always belongs in a `finally`
block:

```ts
try {
  await loginAs(restClient, rep.email, repPassword);
  // ... test assertions
} finally {
  // Restore admin so teardown API calls (deactivateUser, etc.) succeed.
  await loginAsAdmin(restClient);
  await deactivateUser(restClient, rep.id);
}
```

### CI enforcement (MINCRM-368)

`scripts/check-e2e-beforeall.sh` (run in CI) rejects any spec file that calls
`loginAsAdmin` inside a `test.beforeAll` block. If you believe your use case is an
exception, add an `// MINCRM-368-ok: <reason>` comment on the same line as the call and
the script will allow it.

---

## Checklist before adding a behavior

- [ ] Parameter object is a named typed interface (no loose `any`)
- [ ] Result object is a named typed interface (no `void` unless truly nothing to report)
- [ ] No `expect()` calls anywhere in the file
- [ ] No raw `page.locate()` calls outside of Page Objects — all via Page Objects
- [ ] Behavior waits for stable page state before returning
- [ ] New behavior is exported from `index.ts`

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
| Direct `healPage.click()`     | Page Object         |
| Business logic / calculations | Service layer       |

---

## Writing a behavior

### 1. Define a typed parameter object

Every behavior accepts exactly **two arguments**:

```ts
async function myBehavior(
  params: MyBehaviorParams, // typed — no `any`
  context: MyBehaviorContext, // fixture context: { page, healPage, restClient, ... }
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

// WRONG — raw locator inside a behavior
await context.page.getByTestId('login-email').fill(credentials.email);
```

### 4. No assertions

```ts
// CORRECT — behavior returns result, spec asserts
const result = await login(credentials, { page, healPage });
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
fixtures it actually needs. This keeps behaviors composable and avoids pulling
in fixtures that aren't used.

```ts
export interface AuthBehaviorContext {
  page: Page;
  healPage: HealPage;
}
```

Pass the full fixture object from the test:

```ts
test('logs in as admin', async ({ page, healPage }) => {
  const result = await login({ email: '...', password: '...' }, { page, healPage });
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

## Checklist before adding a behavior

- [ ] Parameter object is a named typed interface (no loose `any`)
- [ ] Result object is a named typed interface (no `void` unless truly nothing to report)
- [ ] No `expect()` calls anywhere in the file
- [ ] No raw `page.locator()` / `healPage.click()` calls — all via Page Objects
- [ ] Behavior waits for stable page state before returning
- [ ] New behavior is exported from `index.ts`

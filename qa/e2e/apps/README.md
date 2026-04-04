# apps/

App-specific fixtures, helpers, and `TestDataManager`. Organized per app: `apps/<app>/`.

This is the integration point between the product-agnostic framework and a specific
application. It wires app credentials, entity-specific REST paths, and domain-specific
setup logic into the framework fixtures.

## Structure

```
apps/
  minicrm/
    fixtures.ts          — extends framework test with testData fixture
    test-data-manager.ts — tracks and surgically tears down test-created entities
    helpers.ts           — setup helpers: createTestContact, createTestAccount, …
```

---

## TestDataManager Pattern

`TestDataManager` ensures tests are **self-contained and surgical**: they create only
what they need and clean up only what they created, leaving all pre-existing system
data intact.

### Rules

- **Register immediately after creation.** Call `testData.register()` right after a
  successful create call, before any further setup that could throw. This ensures the
  entity is cleaned up even if setup fails partway through.
- **Never call bulk delete or truncation.** TestDataManager issues one `DELETE` per
  registered entity, keyed by the exact ID returned at creation.
- **Teardown is automatic.** The app-level fixture calls `testData.teardown()` in a
  `finally` block — you never call it manually.
- **Reverse order.** Teardown deletes in reverse registration order so dependents
  (e.g. contacts linked to an account) are removed before their dependencies.
- **Partial failure is safe.** A 500 on one delete is logged to stderr and does not
  abort cleanup of remaining entities.

### Setup Helper Shape

Every setup helper follows the same three-step pattern:

```ts
export async function createTestWidget(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: CreateWidgetOverrides = {},
): Promise<TestWidget> {
  const payload = {
    name: overrides.name ?? `Test Widget ${Date.now()}`,
    // … merge remaining overrides …
  };

  // Step 1: create via REST.
  const response = await restClient.post<TestWidget>('/api/widgets', payload);
  const widget = response.body;

  // Step 2: register for teardown immediately.
  testData.register('widget', widget.id, `/api/widgets/${widget.id}`);

  // Step 3: return entity for test assertions.
  return widget;
}
```

The `overrides` parameter lets individual tests supply specific field values
(a known email address, a particular stage) without re-implementing the full payload.

---

## Working Example

```ts
import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestAccount } from '@apps/minicrm/helpers.js';

test('contact is linked to account', async ({ restClient, testData }) => {
  // Create an account first — registered at position 0.
  const account = await createTestAccount(testData, restClient, {
    name: 'Acme Corp',
  });

  // Create a contact linked to that account — registered at position 1.
  const contact = await createTestContact(testData, restClient, {
    firstName: 'Alice',
    accountId: account.id,
  });

  expect(contact.accountId).toBe(account.id);

  // After the test, teardown deletes:
  //   1. contact (position 1 — reversed first)
  //   2. account (position 0 — reversed second)
  // Pre-existing contacts and accounts are not touched.
});
```

### Verifying surgical teardown

You can assert that pre-existing data is unchanged by counting records before and
after via the REST API:

```ts
test('pre-existing data is untouched', async ({ restClient, testData }) => {
  // Count before.
  const before = await restClient.get<{ total: number }>('/api/contacts?limit=1');
  const totalBefore = before.body.total;

  // Create a test contact (registered for teardown).
  await createTestContact(testData, restClient);

  // Count during test — should be totalBefore + 1.
  const during = await restClient.get<{ total: number }>('/api/contacts?limit=1');
  expect(during.body.total).toBe(totalBefore + 1);

  // After the test body, the fixture tears down the created contact.
  // In the NEXT test, total is back to totalBefore.
});
```

---

## Adding a New Helper

1. Add `TestXxx` and `CreateXxxOverrides` interfaces to `helpers.ts`.
2. Implement `createTestXxx(testData, restClient, overrides?)` following the
   three-step pattern above.
3. Export from `helpers.ts`.
4. Add a test in `tests/apps/minicrm/` that exercises teardown for the new entity type.

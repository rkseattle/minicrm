# framework/

Product-agnostic framework code. **Must contain zero application-domain references.**

## Contents

- `HealingLocator` — self-healing UI locator with CSS/ARIA/AI fallback tiers
- `HealingRegistry` — stores locator strategies per element
- `PageFacade` — unified fixture that combines SafePage + HealMethods via a Proxy
- `SafePage` — structural type alias exposing only navigation/browser-state primitives; blocks raw locator access at compile time (Pick-based allowlist)
- `SafeLocator` — structural interface extending Playwright `Locator`; shadows child-factory and index methods with `never` to prevent healing escapes
- `SafeContext` — structural type alias that omits `newPage()` and `newCDPSession()` from `BrowserContext`; prevents unhealed tab creation
- Playwright fixtures — base fixture wiring (exports `page: PageFacade`, `restClient`, `grpcClient`; `healPage` retained as a legacy fixture for framework-level tests only)
- REST API client
- gRPC client (unary, server-streaming, client-streaming, bidirectional-streaming)
- `HealingReporter` — custom Playwright reporter that emits `healing-report.json`

A CI lint step (`check-framework-purity.sh`) greps this directory for application-domain
strings and fails the build if any are found.

## gRPC client

`GrpcClient` supports all four gRPC call patterns via a typed async-iterable interface.
The fixture wires up the client from `E2E_GRPC_HOST` and `E2E_GRPC_TLS` env vars.

### Unary call

```ts
const response = await grpcClient.call<MyRequest, MyResponse>('/my.Service/Method', {
  field: 'value',
});
console.log(response.field);
```

### Server-streaming call

```ts
for await (const msg of grpcClient.serverStream<StreamRequest, StreamResponse>(
  '/my.Service/Stream',
  { message: 'hello', count: 3 },
)) {
  console.log(msg.index, msg.message);
}
```

### Client-streaming call (MINCRM-233)

The caller supplies an async iterable of request messages; the server accumulates
the full stream and responds with a single message.

```ts
async function* myRequests() {
  yield { message: 'first' };
  yield { message: 'second' };
  yield { message: 'third' };
}

const response = await grpcClient.clientStream<MyRequest, MySummaryResponse>(
  '/my.Service/Collect',
  myRequests(),
);
console.log(response.count); // 3
```

### Bidirectional-streaming call (MINCRM-233)

Both client and server stream messages simultaneously. The caller supplies an
async iterable of request messages and iterates over the async iterable of
responses.

```ts
async function* requests() {
  yield { message: 'ping' };
  yield { message: 'pong' };
}

for await (const resp of grpcClient.bidiStream<MyRequest, MyResponse>(
  '/my.Service/Echo',
  requests(),
)) {
  console.log(resp.message); // echoed back: "ping", then "pong"
}
```

## PageFacade (unified fixture)

Since MINCRM-210, all spec files and Page Objects use a single `page: PageFacade` fixture.

`PageFacade = SafePage & HealMethods` — a Proxy that:

- Routes `HealMethods` calls (`.locate()`, `.click()`, `.fill()`, etc.) to the internal heal layer
- Routes all other calls to the raw Playwright `Page`
- Captures the test name at fixture creation time (no need to pass it to `.resolve()`)

### Usage in spec files

```ts
import { test, expect } from '@apps/minicrm/fixtures.js';
import { someAction } from '@behaviors/minicrm/some.behaviors.js';

test('@functional F1-L1: example test', async ({ page, restClient, testData }) => {
  // HealMethods — no testName argument needed
  await page.click([{ type: 'testId', value: 'submit-btn' }]);
  const el = await page.locate([{ type: 'testId', value: 'heading' }]).resolve();

  // SafePage navigation methods still work directly
  await page.goto('/contacts');
  const url = page.url();

  // Behaviors receive { page } — PageFacade satisfies all context types
  await someAction({ page });
});
```

### Usage in Page Objects

```ts
import type { PageFacade } from '@framework/fixtures/index.js';

export interface MyPageContext {
  page: PageFacade;
}

export class MyPage {
  private readonly page: PageFacade;

  constructor(context: MyPageContext) {
    this.page = context.page;
  }

  async doSomething(): Promise<void> {
    await this.page.click([{ type: 'testId', value: 'my-btn' }]);
    const el = await this.page
      .locate([
        { type: 'testId', value: 'my-field' },
        { type: 'role', value: 'textbox', options: { name: 'My field' } },
      ])
      .resolve();
  }
}
```

### Migration from pre-MINCRM-210 code

If you encounter old code that passes `testName` to `.resolve()` or uses a
separate `healPage` fixture, update it to the pattern above. The `testName`
argument to `.resolve()` is no longer accepted — `PageFacade` captures the
test name at fixture creation time.

```ts
// BEFORE (do not use — removed in MINCRM-210):
// test('example', async ({ page, healPage, testName }) => {
//   await healPage.click([...]);
//   const el = await healPage.locate([...]).resolve(testName);
// });

// AFTER (current pattern):
test('example', async ({ page }) => {
  await page.click([{ type: 'testId', value: 'submit-btn' }]);
  const el = await page.locate([...]).resolve();
});
```

## Visual Regression (`checkScreenshot` / `checkLocatorScreenshot`) (MINCRM-319)

`PageFacade` exposes two visual regression assertion methods backed by Playwright's
native `toHaveScreenshot`. No third-party library (pixelmatch, resemble.js, etc.) is
required.

### Methods

```ts
// Full-page visual assertion
await page.checkScreenshot('my-page.png');
await page.checkScreenshot('my-page.png', { fullPage: true, maxDiffPixels: 10 });

// Element-scoped visual assertion — pass a SafeLocator from page.locate().resolve()
const card = await page
  .locate(
    [
      { type: 'testId', value: 'deal-card' },
      { type: 'role', value: 'article' },
    ],
    { intent: 'deal card component' },
  )
  .resolve();
await page.checkLocatorScreenshot(card, 'deal-card.png');
await page.checkLocatorScreenshot(card, 'deal-card.png', { maxDiffPixels: 5 });
```

The `name` argument must include the `.png` extension by convention.

### Default threshold

Both methods default to `maxDiffPixels: 50` — permissive enough to absorb anti-aliasing
and sub-pixel font rendering differences across machines without masking genuine visual
regressions. Pass a lower `maxDiffPixels` or a `threshold` value in options to tighten
the assertion for pixel-perfect components.

### Snapshot storage

Snapshots are stored in `qa/e2e/snapshots/` under a path that mirrors the test file
structure (`<test-file>/<browser>/`). This directory is committed to version control so
baselines travel with the tests that own them.

### Generating baselines (first run)

When no baseline exists for a given snapshot name, Playwright writes the file
automatically on first run — the test still passes. Subsequent runs compare against
that baseline. To generate all baselines for a suite in one pass:

```bash
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
  npm run test -- --grep @functional
```

### Updating baselines after an intentional UI change

After a deliberate visual change (new layout, colour token update, etc.), regenerate
the affected snapshots with `--update-snapshots`:

```bash
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
  npm run test -- --update-snapshots --grep @functional
```

Review the diff in `qa/e2e/playwright-report/` before committing the new baselines.

### OS requirement for CI-compatible baselines

**Baselines must be generated on Linux.** Playwright renders fonts differently on macOS
and Windows, so a baseline created on macOS will produce false pixel-diff failures in CI
(which runs on Linux). Always generate or update baselines inside the Docker E2E
environment:

```bash
# Start the e2e Compose profile (once per session)
docker compose -f docker-compose.dev.yml --profile e2e up -d

# Run tests with --update-snapshots inside the Linux container
docker compose -f docker-compose.dev.yml exec e2e \
  bash -c "cd /app/qa && npm run test -- --update-snapshots --grep @functional"
```

Commit the updated snapshot files from `qa/e2e/snapshots/` as part of the same PR that
changes the UI.

---

## Accessibility Auditing (`auditAccessibility`) (MINCRM-320)

`PageFacade` exposes an `auditAccessibility()` method backed by
[`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright).
It runs an axe-core audit against the current page and returns the raw `AxeResults` object.
The method never throws on violations — all assertion logic belongs in the caller.

### Method

```ts
auditAccessibility(options?: AccessibilityAuditOptions): Promise<AxeResults>
```

`AccessibilityAuditOptions`:

| Field     | Type                 | Description                                                                       |
| --------- | -------------------- | --------------------------------------------------------------------------------- |
| `exclude` | `string \| string[]` | CSS selectors to exclude from the audit (e.g. third-party widgets)                |
| `tags`    | `string \| string[]` | axe-core tag names restricting the active rule set (see recommended values below) |

### Recommended WCAG level tags

| Tag        | Coverage                              |
| ---------- | ------------------------------------- |
| `wcag2a`   | WCAG 2.0 Level A                      |
| `wcag2aa`  | WCAG 2.0 Level AA (industry baseline) |
| `wcag21aa` | WCAG 2.1 Level AA (extends `wcag2aa`) |

Pass all three together for the broadest conformance check:

```ts
{
  tags: ['wcag2a', 'wcag2aa', 'wcag21aa'];
}
```

### Usage

```ts
// Basic — full-page audit with default axe rule set
const results = await page.auditAccessibility();
expect(
  results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
  'No critical or serious WCAG violations',
).toHaveLength(0);

// With WCAG 2.1 AA tags and a third-party widget excluded
const results = await page.auditAccessibility({
  tags: ['wcag2a', 'wcag2aa', 'wcag21aa'],
  exclude: '#third-party-chat-widget',
});
expect(results.violations, 'No WCAG 2.1 AA violations').toHaveLength(0);
```

### Dynamic import

`@axe-core/playwright` is loaded via a dynamic `import()` inside the method body.
This means the axe bundle is **not** included in the startup cost of test suites
that never call `auditAccessibility()`.

---

## SafePage, SafeLocator, SafeContext

These three types enforce the self-healing boundary at the TypeScript type level:

### SafePage (`framework/types/safe-page.ts`)

A `Pick<Page, AllowedPageMethods>` type alias that exposes only navigation and
browser-state primitives (e.g. `goto`, `url`, `waitForLoadState`). All element-locating
and element-action methods are intentionally absent — they are accessed via `HealMethods`
on `PageFacade` instead.

**Why `Pick` and not `Omit`:** An `Omit`-based blocklist silently allows new Playwright
methods as Playwright releases them. A `Pick` allowlist blocks new methods by default;
they must be consciously added to `AllowedPageMethods` before they are accessible.

`SafePage` also re-declares `context()` to return `SafeContext` instead of the raw
`BrowserContext`.

### SafeLocator (`framework/types/safe-locator.ts`)

An interface that `extends Locator` but shadows child-locator factories (`locator`,
`getByTestId`, `getByRole`, etc.), `filter()`, and index methods (`first`, `last`, `nth`)
with `never`. Calling any of these is a compile error.

**Why extend rather than `Omit<Locator, ...>`:** Playwright's `expect()` overloads check
`T extends Locator` to unlock locator-specific matchers like `toBeVisible()`. An `Omit`-based
alias breaks that compatibility. By extending `Locator` and overriding with `never`, matchers
still work and forbidden methods are still blocked.

### SafeContext (`framework/types/safe-context.ts`)

`Omit<BrowserContext, 'newPage' | 'newCDPSession'>`. Blocks:

- `newPage()` — would create an unhealed raw `Page` outside `PageFacade`
- `newCDPSession()` — grants unrestricted CDP access with no healing or audit trail

To open additional tabs in multi-tab tests use `PageFacade.newTab()`, which wraps the new
page in `createPageFacade()` so it participates in the same healing guarantees.

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

### Client-streaming call

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

### Bidirectional-streaming call

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

All spec files and Page Objects use a single `page: PageFacade` fixture.

`PageFacade = SafePage & HealMethods` — a Proxy that:

- Routes `HealMethods` calls (`.locate()`, `.click()`, `.fill()`, etc.) to the internal heal layer
- Routes all other calls to the raw Playwright `Page`
- Captures the test name at fixture creation time (no need to pass it to `.resolve()`)

### Usage in spec files

```ts
import { test, expect } from '@apps/myapp/fixtures.js';
import { someAction } from '@behaviors/myapp/some.behaviors.js';

test('@functional F1-L1: example test', async ({ page, restClient, testData }) => {
  // HealMethods — no testName argument needed
  await page.click([{ type: 'testId', value: 'submit-btn' }]);
  const el = await page.locate([{ type: 'testId', value: 'heading' }]).resolve();

  // SafePage navigation methods still work directly
  await page.goto('/dashboard');
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

### Migrating from the legacy three-fixture pattern

If you encounter old code that passes `testName` to `.resolve()` or uses a
separate `healPage` fixture, update it to the pattern above. The `testName`
argument to `.resolve()` is no longer accepted — `PageFacade` captures the
test name at fixture creation time.

```ts
// BEFORE (do not use — legacy pattern, now removed):
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

## Visual Regression (`checkScreenshot` / `checkLocatorScreenshot`)

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

## Accessibility Auditing (`auditAccessibility`)

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

---

## Network Route Interception (`mockRoute` / `unmockRoute` / `unmockAllRoutes`)

`PageFacade` exposes three methods for intercepting HTTP requests during tests. All registered
mocks are automatically removed at fixture teardown — routes can never bleed into subsequent tests.

### Methods

```ts
// Register a mock — auto-cleaned up at test end
mockRoute(pattern: string | RegExp, handler: MockRouteHandler): Promise<void>;

// Remove a specific mock mid-test (optional — teardown handles this automatically)
unmockRoute(pattern: string | RegExp): Promise<void>;

// Remove all registered mocks (called automatically in fixture teardown)
unmockAllRoutes(): Promise<void>;
```

`MockRouteHandler` receives Playwright's `Route` and `Request` objects, giving full access to
`route.fulfill()`, `route.continue()`, `route.abort()`, and `route.request()` inspection.

### Usage

#### Simulate a server error

```ts
await page.mockRoute('/api/items', async (route) => {
  await route.fulfill({
    status: 500,
    body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Server error' } }),
  });
});
// Exercise the UI, then assert the error state is rendered correctly.
```

#### Simulate a slow response to test loading states

```ts
await page.mockRoute('/api/items', async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await route.continue();
});
// Assert the loading spinner or skeleton is visible before the response arrives.
```

#### Verify request payload

```ts
await page.mockRoute('/api/items', async (route) => {
  const body = route.request().postDataJSON();
  expect(body.email).toBe('test@example.com');
  await route.continue();
});
// Trigger the form submission, then assert the route handler was called.
```

### Automatic teardown

`unmockAllRoutes()` is called in the fixture `finally` block for both the `page` (PageFacade)
and `healPage` fixtures. No explicit cleanup is needed in test bodies. If you need to stop
intercepting a route before the test ends, call `page.unmockRoute(pattern)` directly.

### Both string and RegExp patterns are supported

```ts
// String pattern
await page.mockRoute('/api/items', handler);

// RegExp pattern
await page.mockRoute(/\/api\/items.*/, handler);
```

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

---

## AI Healing Tier

The AI healing tier is the final fallback after all static strategies (testId, role, label,
text, css, xpath) are exhausted. It sends a scoped DOM snapshot and the locator's `intent`
string to `claude-sonnet-4-20250514`, which returns a new locator candidate with a confidence
score. The tier is activated only when both conditions are true.

### Activation requirements

**1. `AI_HEALING` environment variable must be set to `'true'`.**

In CI this is set in the `e2e-functional` job's `env` block. Locally, set it
in `qa/e2e/.env`:

```
AI_HEALING=true
```

When `AI_HEALING` is absent or empty the `AiHealer` returns `null` immediately — no API
call is made and `StrategyExhaustedError` is thrown as usual.

**2. Each `HealingLocator` must have a non-empty `intent` string.**

If `intent` is an empty string (the default when `options.intent` is omitted), the AI tier
is skipped even when `AI_HEALING=true`. Intent strings are required on every
`page.locate()` call in page objects.

### `ANTHROPIC_API_KEY`

The key must have permission to call the Messages API. Set it as a GitHub Actions repository
secret (`Settings → Secrets and variables → Actions`) and in your local `qa/e2e/.env`.

### Token cost model

Each AI heal attempt consumes tokens from your Anthropic quota:

- **Input tokens:** the scoped DOM snapshot (capped at 8 000 chars) + the intent + the list
  of failed strategies. Typically 500–2 000 input tokens per heal.
- **Output tokens:** the JSON response (type, value, confidence). Always ≤ 512 tokens.

Token usage is recorded per heal event and summed in `healing-report.json` as
`estimatedTokenCost`. A run with zero AI heals costs zero tokens.

### `AI_HEAL_COST_WARNING_THRESHOLD`

Controls the CI warning threshold for AI heal count:

```yaml
AI_HEAL_COST_WARNING_THRESHOLD: '20' # CI default (conservative for initial activation)
```

When the number of AI heals in a run exceeds this value, a GitHub Actions warning annotation
is emitted. A high heal count signals broad selector drift — the correct response is to
apply the patch suggestions from `healing-suggestions.md` rather than raise the threshold.

The default when this variable is unset is 50. CI uses 20 for initial activation so the
team sees selector drift signals promptly.

### Reading `healing-report.json`

The merged report (produced after all shards complete) contains:

| Field                | Type     | Description                                            |
| -------------------- | -------- | ------------------------------------------------------ |
| `totalHeals`         | `number` | Static + AI heals combined                             |
| `staticHeals`        | `number` | Heals resolved by a static fallback strategy           |
| `aiHeals`            | `number` | Heals resolved by the AI tier                          |
| `aiHealCount`        | `number` | Same as `aiHeals` (alias for readability)              |
| `estimatedTokenCost` | `number` | Sum of `tokenCost` across all AI heal events           |
| `events`             | `array`  | Per-heal detail: test name, strategies, wasAiHeal flag |

A non-zero `aiHealCount` after a run means at least one locator's static strategies all
failed and the AI tier successfully identified an alternative. Check `healing-suggestions.md`
(uploaded as a CI artifact) for actionable patch suggestions.

### `healing-suggestions.md`

The patch suggester generates a markdown file listing each heal event grouped by page object
and method, with a description of the failed primary strategy and the working fallback. After
the first activated CI run, review this file to confirm suggestions are actionable and apply
any fixes to the page objects (which eliminates the heal overhead on subsequent runs).

---

## Healing Internals

### `probeLocator` uses `state: 'attached'`, not `state: 'visible'`

When `HealingLocator.resolve()` tests whether a strategy found the element, it calls:

```ts
await locator.first().waitFor({ state: 'attached', timeout: timeoutMs });
```

**Why `attached` and not `visible`:** `attached` resolves as soon as the element is in the
DOM, regardless of its CSS visibility. This is faster than `visible` and avoids false
negatives caused by elements that are momentarily hidden during CSS transitions or React
conditional renders (e.g. a modal whose backdrop fades in before the content is visible).

**Trade-off:** A strategy can probe successful against an element that is present in the DOM
but not yet visible. If that element is the one returned by `resolve()`, the subsequent
interaction (`.click()`, `.fill()`, etc.) will fail with a Playwright "not visible" error —
even though the heal appeared to succeed.

**How to diagnose:** Check `healing-report.json` for the healed strategy's `type` and
`value`. Inspect whether the element at that locator is actually visible at the time of
interaction. The correct fix is usually to add a `within` scoping strategy so the locator
targets the visible copy of the element, or to add an explicit `waitFor` call with
`state: 'visible'` before interacting.

---

### Two-strategy probe in `isNotVisible` and `doesNotExist`

These two `HealMethods` methods do not go through `HealingLocator.resolve()`. Instead they
probe strategies directly, and they use a two-strategy pattern for drift resilience.

#### Why two strategies?

A stale primary `testId` (e.g. the data-testid was renamed in the app) matches zero
elements. Playwright's `waitFor({ state: 'detached' })` (used by `doesNotExist`) and
`waitFor({ state: 'hidden' })` (used by `isNotVisible`) both resolve immediately when zero
elements match — producing a **false-positive absence**: the method returns `true` ("element
is gone") when the element is actually present under a different testId.

The guard: if strategy 0 reports absent/hidden, strategy 1 is probed. If strategy 1 finds
the element present/visible, the method overrides to `false` (element is present). No heal
event is recorded — this is a drift guard, not a heal.

```
Strategy 0 (e.g. testId)  →  "detached" immediately (stale testId, 0 matches)
Strategy 1 (e.g. role)    →  "attached" within timeout  →  override: return false
```

#### Timeout budget

Both strategies are probed sequentially and each can run to its full timeout. In the worst
case (strategy 0 times out genuinely, then strategy 1 times out genuinely) the method takes
up to **2× `timeoutMs`** before returning `true`. The default `timeoutMs` is 10 000 ms,
so the worst case is 20 seconds.

Pass an explicit `timeoutMs` to bound the duration in time-sensitive tests:

```ts
// Worst case: 2 × 3000 ms = 6 s instead of the default 20 s
const absent = await page.doesNotExist(strategies, 3_000);
```

#### Two-strategy ceiling

The guard is intentionally limited to strategies 0 and 1. Extending the probe to strategy 2
and beyond increases the risk of finding a different element that happens to match the
selector — a false override. If you need more drift resilience, prefer using a more specific
strategy 1 (e.g. a role + accessible name combination) rather than adding more strategies.

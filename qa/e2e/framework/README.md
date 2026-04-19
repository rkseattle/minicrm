# framework/

Product-agnostic framework code. **Must contain zero application-domain references.**

## Contents

- `HealingLocator` — self-healing UI locator with CSS/ARIA/AI fallback tiers
- `HealingRegistry` — stores locator strategies per element
- `PageFacade` — unified fixture that combines SafePage + HealMethods via a Proxy
- Playwright fixtures — base fixture wiring
- REST API client
- gRPC client
- `HealingReporter` — custom Playwright reporter that emits `healing-report.json`

A CI lint step (`check-framework-purity.sh`) greps this directory for application-domain
strings and fails the build if any are found.

## PageFacade (unified fixture)

Since MINCRM-210, all spec files and Page Objects use a single `page: PageFacade` fixture instead of the old three-fixture pattern (`page: SafePage`, `healPage: HealPage`, `testName: string`).

`PageFacade = SafePage & HealMethods` — a Proxy that:

- Routes `HealMethods` calls (`.locate()`, `.click()`, `.fill()`, etc.) to an internal `HealPage` instance
- Routes all other calls to the raw Playwright `Page`
- Captures `testName` at fixture creation time (no need to pass it to `.resolve()`)

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

### Old three-fixture pattern (removed in MINCRM-210)

```ts
// BEFORE (do not use):
test('example', async ({ page, healPage, testName }) => {
  await healPage.click([{ type: 'testId', value: 'submit-btn' }]);
  const el = await healPage.locate([...]).resolve(testName);
});

// AFTER:
test('example', async ({ page }) => {
  await page.click([{ type: 'testId', value: 'submit-btn' }]);
  const el = await page.locate([...]).resolve();
});
```

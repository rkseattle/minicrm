# apps/

App-specific fixtures, configuration, and `TestDataManager`. Organized per app: `apps/<app>/`.

This is the integration point between the product-agnostic framework and MiniCRM.
It wires app credentials, database connection strings, and domain-specific seed/teardown
logic into the framework fixtures.

Example structure (added in S7):

```
apps/
  minicrm/
    fixtures.ts       — extends base Playwright fixtures with MiniCRM-specific context
    TestDataManager.ts — creates and tears down test data via REST API
    config.ts         — reads E2E_* env vars and validates them at startup
```

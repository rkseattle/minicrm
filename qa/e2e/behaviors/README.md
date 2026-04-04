# behaviors/

Behavior/action layer. Organized per app: `behaviors/<app>/`.

Behaviors compose Page Objects and API/gRPC clients to express higher-level user
workflows (e.g., "create a deal and move it through two pipeline stages"). Test specs
call behaviors — they never call Page Objects directly.

Example structure (added in S8):

```
behaviors/
  minicrm/
    authBehaviors.ts
    dealBehaviors.ts
    contactBehaviors.ts
```

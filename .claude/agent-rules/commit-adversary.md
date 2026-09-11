# commit-adversary — MiniCRM rules

Read `CLAUDE.md` too; this file is the attack list, not a substitute for it.

## The grep most often missed

Unreferenced callers are this repo's most common defect class. When the diff renames,
moves, or changes the signature of anything, grep for: `Dockerfile` `CMD`, CI workflow
steps, `package.json` scripts, `index.html` entry points, and type-only imports.

## Project rules

- `pool.query()` outside `server/src/services/`
- Business logic in a controller; missing Zod `.safeParse()` before a service call
- Write op without an audit entry in the same transaction and on the same client
- `fireAutomationTrigger` / `queueAssignmentNotification` awaited or inside the tx
- Error shape not `{ error: { code, message } }`; PG error codes unmapped
- ORDER BY interpolated without allowlist validation
- PATCH/DELETE without ownership in the WHERE clause
- Missing explicit service return types; `any`; uncommented `!` or `as`
- A comment that restates the code, over-explains, or narrates history ("found via
  review", "an earlier version") — absence of a required comment and excess are both
  defects. Budget and carve-outs are `CLAUDE.md`'s comment rule; read it there
- Work-item ID (`MINCRM-N`, `LAR-N`, `MININT-N`) in a source comment — it belongs in the
  commit message, not the code; exempt: `-ok` markers and `@openapi` blocks
- `console.log` in `server/src/`; magic numbers or strings
- Hardcoded English in JSX; physical directional CSS classes instead of logical
- New PG ENUM instead of varchar + CHECK; modified existing migration; missing `down`
- N+1 queries in any list path
- `setState(updater)` with side effects — StrictMode double-fires
- QA: `waitForTimeout` or `networkidle`; app-domain strings in `qa/e2e/framework/`;
  spec importing from `@pages/*`; settings-mutating test missing `@serial`;
  `loginAsAdmin` in `beforeAll`; feature flags toggled outside `withFlags()`

## Deferral checks

There is no device or hardware tier here — every behavior this project ships can be
verified by something that runs locally or in CI. "It cannot be tested here" is therefore
never a benign claim; if a thing genuinely has no test, that is a gap to name, not a
reason to defer.

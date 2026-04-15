# tests/

Test specs. Organized per app: `tests/<app>/`.

Specs import from `@behaviors/<app>/` only — never from `@pages` or `@framework`
directly. This keeps specs readable as business scenarios rather than technical scripts.

Smoke-level coverage is provided by the BVT suite under `apps/minicrm/functional/smoke/` (MINCRM-193). See `qa/e2e/README.md` for details.

# tests/

Test specs. Organized per app: `tests/<app>/`.

Specs import from `@behaviors/<app>/` only — never from `@pages` or `@framework`
directly. This keeps specs readable as business scenarios rather than technical scripts.

The `trivial.spec.ts` in this directory is a smoke test that validates both Playwright
projects (`desktop`, `mobile-web`) are correctly configured and the runner is functional.
It is deleted once real specs exist.

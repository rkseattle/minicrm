# Custom ESLint Rules

`eslint-plugins/` holds eight rules written for this repo. They enforce conventions that
CLAUDE.md states in prose — architecture, E2E authoring, and comment hygiene — so that a
violation is caught mechanically rather than in review.

All eight are registered in `eslint.config.mjs` and resolve to `error` where they apply,
so a violation fails the build rather than warning. Two carry deliberate exemptions:
`no-page-direct-in-spec` is `off` for behaviors, which are exactly where direct page calls
belong, and `require-data-testid` is `off` for test files in both workspaces. Each
exemption carries its rationale in the config.

**Two rules have unit tests:** `no-work-item-id-in-comment` and `require-openapi-tag`.
Their `RuleTester` cases live in `coverage-dashboard/src/__tests__/`, which is why the
`eslint-config` paths filter is OR'd into `coverage-dashboard-tests` in CI. The other six
rules have no tests anywhere: their only verification is that the repo's own code still
lints clean.

---

## The rules

| Rule                                        | Enforces                                                                         | Applies to                               |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| `local/require-data-testid`                 | `data-testid` on interactable JSX elements, so E2E locators have a stable anchor | `client/src/`, `coverage-dashboard/src/` |
| `local/no-page-forbidden-methods`           | No raw Playwright `Page` locator calls — use `page.locate([...]).resolve()`      | E2E specs and behaviors                  |
| `local/no-playwright-imports`               | No direct Playwright imports — take `test`/`expect` from the fixtures module     | E2E specs and behaviors                  |
| `local/require-locator-fallback`            | At least two strategies per `page.locate()`, so healing has somewhere to fall to | E2E specs, behaviors, and page objects   |
| `local/no-page-direct-in-spec`              | No direct page navigation or interaction in specs — move it into a behavior      | E2E specs                                |
| `local/require-locator-intent`              | A non-empty `intent` string on every `page.locate()`, which the AI healer needs  | Page objects                             |
| `local-comments/no-work-item-id-in-comment` | No `MINCRM-N` / `LAR-N` / `MININT-N` in source comments                          | All `.ts`, `.tsx`, `.mjs`, `.cjs`, `.js` |
| `local-openapi/require-openapi-tag`         | An `@openapi` tag on every route handler, so the generated spec stays complete   | `server/src/routes/*.ts`                 |

`work-item-id-patterns.mjs` is a shared helper rather than a rule. It exports the ID
pattern, the `-ok` suppression marker, and the `@openapi` exemption that the comment rule
and `scripts/strip-work-item-ids.ts` both depend on.

---

## Three plugin keys, not one

Six rules register under `local`; the comment rule registers under `local-comments`, and
`require-openapi-tag` under `local-openapi`. That split is required, not stylistic:
ESLint 9's flat config rejects two overlapping configs that both declare the same plugin
key, and both of those rules apply to globs that overlap the `local` ones — the comment
rule to a broader glob, the OpenAPI rule to `server/src/routes/*.ts`.

---

## Why the comment rule has a second enforcement path

`db/migrations/**` is the one path in ESLint's ignore list, so the rule never sees it.
`npx tsx scripts/strip-work-item-ids.ts --verify` covers it — that script scans **every
git-tracked source file**, not just migrations, and CI runs it in `lint-and-typecheck`.
(`qa/migrations/` is not ignored; ESLint lints it normally, and `--verify` also covers it.)

Catalog comments — `COMMENT ON` strings and the `comment:` option in migrations — are
string tokens rather than comment tokens, so neither tool sees them. That is a designed
property, not a gap: the script walks AST comment tokens, which structurally cannot reach
a string literal, so it can never corrupt a live catalog description. Fix those with a
corrective migration instead; see CLAUDE.md.

---

## Working on a rule

`npm run lint` caches by file content, so editing a rule does not re-lint unchanged
sources — the edited rule never runs against them. Bypass the cache after any rule change:

```bash
npx eslint . --no-cache
```

For `no-work-item-id-in-comment`, change its `RuleTester` cases in the same commit:

```bash
npm test --workspace=minicrm-coverage-dashboard
```

The other six have no tests, so a clean `--no-cache` run over the repo is the only signal
that a change to them behaves as intended. Treat that as weak: it proves the rule does not
fire on existing code, not that it fires where it should. Adding `RuleTester` cases
alongside any behavior change is the way to make it stronger.

# Pre-push and pre-PR gate

## Pre-push checklist

In order, all green, before every `git push`:

1. `npm run lint`
2. `npm run typecheck` at repo root — covers server, client, and qa
3. `npm test --workspace=minicrm-server` if server files changed;
   `npm test --workspace=minicrm-client` if client files changed
4. `npm audit --audit-level=high` — **always, never conditional on whether dependencies
   changed.** Advisories are published against versions you already have: a lockfile
   that was clean yesterday fails today because the advisory database moved, not because
   anything in the repo did. Skipping this on a branch that touched no `package.json`
   is how a red CI audit job first gets discovered from CI instead of locally
   (MINCRM-703 did exactly that). Zero high or critical, or every remaining advisory
   already in `ci.yml`'s `ALLOWED_ADVISORIES` with a written justification.
5. E2E per `.claude/gates/e2e-run.md`
6. `git status` — scan for tracked files with local modifications that are **not** part
   of the intended commit set. Restore artifacts (`qa/e2e/heal-trends.json`, test
   results, generated outputs) with `git restore <file>`. When unsure whether a change
   was intentional, ask — never silently include or silently drop it.

Lint and typecheck are separate gates from tests: a branch with type errors fails CI
even when every test passes locally.

## Pre-PR self-review

- [ ] i18n keys in all 5 locale files; sibling pages fixed together; `data-testid` on
      all counterparts
- [ ] Dead code removed — unused keys, imports, vars
- [ ] Audit entries present in every write transaction
- [ ] Assignment notification fired after commit if `owner_id` changed, not awaited
- [ ] DB errors mapped correctly
- [ ] `setState(updater)` has no side effects — fires twice in StrictMode
- [ ] Re-click on an active control is a no-op
- [ ] Modals and drawers manage focus on open and close
- [ ] RTL logical CSS classes throughout
- [ ] Loading, error, and empty states handled for every async component
- [ ] Feature flag gated, or documented as always-on
- [ ] User docs updated — `docs/user-guide/`, `docs/admin-guide.md`, `index.md` entry
- [ ] Screenshots updated — `docs/screenshots/` via `scripts/screenshot.ts`
- [ ] E2E spec present for every story's AC
- [ ] `checkScreenshot()` added or updated for complex visual surfaces
- [ ] Framework coverage ≥ 80% if `qa/e2e/framework/` touched
- [ ] Roles and capabilities scoped for least privilege
- [ ] AI tool schemas reviewed if `server/src/services/` or `server/src/ai/` changed
- [ ] Eval tests added or updated in `qa/evals/` if NLI behavior changed
- [ ] Would pass a Greptile review

## PR conventions

- Branch from `main` unless instructed otherwise.
- PR title lists **every** covered ticket ID in full: `MINCRM-542, MINCRM-565 — ...`.
  Never abbreviated, never partial.
- Reference the ticket number in every commit message.

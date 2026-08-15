# Pre-push and pre-PR gate

## Pre-push checklist

In order, all green, before every `git push`:

1. **Rebase onto the parent branch.** Required before every push, not only the first.

   ```bash
   git fetch origin
   git rebase origin/<parent>          # `main` unless the branch was cut from another
   ```

   The parent is whatever this branch was cut from — `main` in almost every case, but a
   stacked branch rebases onto its own parent, not past it. `git merge-base` against the
   candidate confirms it when you are unsure.

   **This is step 1 because every step below it certifies a specific tree.** A rebase
   rewrites the branch onto commits that were not present when lint, typecheck, tests,
   or E2E ran, so a gate run before the rebase describes code you are no longer pushing —
   the exact failure mode where a branch is green locally and red in CI, because CI tests
   the merged result and you tested the unmerged one. If you rebase after running any
   gate step, every step below has to run again.

   **Resolve conflicts, never paper over them.** A conflict means someone changed what
   you changed. Read both sides and reconcile the intent — `--ours`/`--theirs` wholesale,
   or `git rebase --skip`, silently drops one side's work. If the resolution is not
   obvious, stop and ask rather than guessing.

   **Do not substitute a merge.** `git merge origin/main` also integrates the parent, but
   it puts a merge commit in the branch's history and is not what this gate asks for.

   After the rebase the branch has diverged from its remote, so the push in the PR flow
   is `git push --force-with-lease` (never bare `--force` — `--force-with-lease` refuses
   when the remote moved under you, which is the case where a blind force destroys
   someone else's commits).

2. `npm run lint`
3. `npm run typecheck` at repo root — covers server, client, and qa
4. `npm test --workspace=minicrm-server` if server files changed;
   `npm test --workspace=minicrm-client` if client files changed
5. `npm audit --audit-level=high` — **always, never conditional on whether dependencies
   changed.** Advisories are published against versions you already have: a lockfile
   that was clean yesterday fails today because the advisory database moved, not because
   anything in the repo did. Skipping this on a branch that touched no `package.json`
   is how a red CI audit job first gets discovered from CI instead of locally
   (MINCRM-703 did exactly that). **The bar is zero** — there is no allowlist.

   When something is reported, pin the fixed version in the root `package.json`
   `overrides` block and then **re-resolve from scratch**:

   ```bash
   rm -rf node_modules package-lock.json && npm install
   ```

   This step is not optional and not a formality. npm treats an existing
   `node_modules` + lockfile pair as already-satisfying and will **not** reconsider an
   override for a transitive dependency on an incremental install — plain
   `npm install`, `--package-lock-only`, and deleting only the lockfile all silently
   leave the vulnerable version in place and make a working fix look impossible.
   Reasoning about why a fix "cannot work" before running the clean re-resolve is how
   16 advisories stayed allowlisted while every one of them was already fixable
   (MINCRM-703).

   **This applies to changing `overrides`, not to installing.** Once the re-resolved
   `package-lock.json` is committed, `npm ci` installs it verbatim and reproduces the
   pinned tree exactly — which is why CI's `npm ci` is authoritative and does not need
   the clean re-resolve. Commit the regenerated lockfile alongside the
   `package.json` change, or CI will install the old tree.

6. E2E per `.claude/gates/e2e-run.md`
7. `git status` — scan for tracked files with local modifications that are **not** part
   of the intended commit set. Restore artifacts (`qa/e2e/heal-trends.json`, test
   results, generated outputs) with `git restore <file>`. When unsure whether a change
   was intentional, ask — never silently include or silently drop it.

Lint and typecheck are separate gates from tests: a branch with type errors fails CI
even when every test passes locally.

Steps 2–7 all describe the post-rebase tree. If anything sends you back to step 1 —
a late conflict, a parent that moved while E2E was running — the steps after it are
stale and run again.

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
- Rebase onto the parent before every push, per step 1 — including pushes that answer
  review feedback on an open PR.
- PR title lists **every** covered ticket ID in full: `MINCRM-542, MINCRM-565 — ...`.
  Never abbreviated, never partial.
- Reference the ticket number in every commit message.

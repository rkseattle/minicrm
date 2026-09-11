# design-adversary — MiniCRM rules

## Architecture the plan must follow

Services own all DB access; controllers shape only; Zod at the boundary; audit entry in
the same transaction on the same client; automation triggers and assignment notifications
fired after commit and never awaited; ownership in the WHERE clause on PATCH/DELETE;
ORDER BY allowlist; explicit PG error mapping; varchar + CHECK over new enums; corrective
migrations only, each with a real `down`.

## Completeness this project requires

- Test strategy: service-layer unit tests, client tests for loading/error/empty, and a
  functional E2E spec per story
- i18n across all five locale files, then `npm run pseudoloc`; `data-testid` on new
  interactive elements
- Feature flag gating, or an explicit statement that it ships always-on
- User docs and screenshots
- AI tool schemas in `server/src/ai/tools/` if service signatures change
- Evals in `qa/evals/` if NLI behavior changes
- A new table reaches `reset-e2e-data.ts`; a new `@serial` spec reaches
  `resource-registry.ts` and its regenerated conflict group

## Dependencies

A new dependency is routine here, not an architectural stop — but it needs a license and
transitive-tree check, the audit gate, and a clean re-resolve if it adds an override. An
unmentioned new dependency is a finding.

## The CI cost the plan must respect

Every `.github/workflows/**` edit forces the entire functional E2E suite — the TIA
selector's `ci-workflow` rule is `alwaysWiden` by design. A plan that edits `ci.yml`
must say which of the four alternatives in `.claude/gates/dod-mechanics.md` it ruled out.

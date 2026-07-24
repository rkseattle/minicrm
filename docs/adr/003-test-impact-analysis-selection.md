# ADR-003: Test Impact Analysis — change-to-test selection design

**Status:** Accepted
**Date:** 2026-07-24
**Tickets:** MINCRM-623, MINCRM-624, MINCRM-625, MINCRM-626, MINCRM-627
**Depends on:** MINCRM-618/619/620/621 (mapping engine, pr-tia-4)
**Enables:** MINCRM-638-640 (ML predictive selection, pr-tia-10)

---

## Context

Phases 1-4 of the Coverage/TIA initiative (instrumentation, session management, the
coverage data pipeline, and the code⇄test mapping engine) established a bidirectional
index — `coverage_test_links`, joined against `coverage_units` — answering "which tests
exercise this code unit" for a given commit SHA. No phase before this one, however, turns
a **git diff** into a **test selection decision**. `docs/dev/coverage.md`'s own "Deferred
to later phases" section explicitly named "ML-based test selection" as out of scope, but
deterministic selection itself — the actual mechanism CI would use to run fewer tests
without losing signal — had never been designed. This ADR records that design, since none
of the five prior phases (each of comparable architectural weight — structural key
derivation, confidence scoring, rename reconciliation) had one, and this phase introduces
the load-bearing algorithm the whole "faster CI without losing signal" goal depends on.

### Why an ADR now, when prior phases didn't write one

Prior phases' design decisions live in code docblocks (e.g. `structuralKeyService.ts`'s
own extensive rationale for AST-scanner-based normalization over regex). That worked
because each prior phase was a single, mostly self-contained module. This phase is
different: it is five interdependent stories forming one pipeline (diff → changed units →
selected tests → widened tests → safety-netted tests → scored/ranked tests), where the
ordering and invariants BETWEEN modules are the actual design decision — not any single
module's internals. That cross-module contract is exactly what an ADR is for.

---

## Decision

### Pipeline shape

```
git diff (base..head)
  → diffParser.parseGitDiff                     (MINCRM-623)
  → changeUnitResolver.resolveChangedUnits       (MINCRM-623)
      ├─ changedUnits: (filePath, unitKey, branchId)[]
      ├─ nonSourceFileChanges: FileDiff[]
      └─ unresolvedFileChanges: UnresolvedFileChange[]
  → testSelectionService.selectTestsForChangedUnits   (MINCRM-624, MINCRM-627)
      → calls coverageMappingService.findTestsForUnitWithConfidence per changed unit
      → calls scorer.score(changedUnits, dedupedCandidates, features) ONCE, at the end
      selectedTests, unmappedChanges
  → dependencyGraphService.resolveDependencyWideningForFiles(nonSourceFileChanges)  (MINCRM-625)
      widenedTestScopes, alwaysWiden
  → safetyNetPolicy.applySafetyNetPolicy(selectedTests, {baselineTests, unmappedChanges,
      dependencyWideningResults, ...})                (MINCRM-626)
      → FinalSelectionResult: { mode: 'targeted' | 'full-suite', selectedTests, ... }
```

### 1. Structural-key reuse over a second parser (MINCRM-623)

Changed-unit resolution reuses `structuralKeyService.deriveStructuralUnitKey` — the exact
function that produced `coverage_units.unit_key` in the first place — driven by the
TypeScript compiler API (`ts.createSourceFile` + a manual `forEachChild` walk), not
`istanbul-lib-instrument` (which is Babel-AST-based and already a transitive dependency,
but would require a second, redundant parser). This guarantees a changed unit's key is
byte-identical to what the mapping engine already stored, with zero translation layer that
could silently drift out of sync with the mapping engine's own key derivation.

**Body range, not full-node range, is what gets hashed.** `changeUnitResolver.ts` tracks
TWO ranges per function-like AST node: a `containmentRange` (the full node, signature
through closing brace — used only to decide "which function encloses this changed line",
matching istanbul's own `decl.start` through `loc.end` convention for that same decision)
and a `bodyRange` (istanbul's `loc` — the `{ ... }` block only, excluding the
`function name(...)` signature). Only `bodyRange` is ever passed to
`deriveStructuralUnitKey`, exactly matching `coverageSymbolicationService.ts`'s own
`qualifiedUnitKey`, which passes `mapping.loc`, never `mapping.decl`. This was caught and
fixed during this phase's own self-review: an earlier draft hashed the full node
(including the function's name), which would make a function's `unit_key` change on a
pure rename with no logic change — silently diverging from how the mapping engine itself
derives `unit_key`, and defeating the rename-detection fix described in the next
paragraph.

**Same-file renames surface a `'deleted'` unit for the old name, not just a `'new'` unit
for the new name.** `classifyChange` alone only looks FORWARD from a new-side boundary to
its old-side namesake by NAME — a rename (where the name is exactly what changed) is
therefore invisible to it and was, in an earlier draft, only ever reported as `'new'`,
silently losing the "this unit no longer exists" signal. `findRenamedAwayUnits` closes
this gap by walking backward from the old side: an old boundary whose name no longer
exists in the new file, but whose **body hash** (the `bodyRange`-derived hash suffix,
matched independently of name) survives unchanged under a different name elsewhere in the
new file, is emitted as a `'deleted'` unit for its old identity — proportionate to how the
whole-file-deletion path already emits `'deleted'` for every unit in a removed file.

### 2. Widen-only, never narrow (MINCRM-625)

The dependency graph rule table for config/resource/migration files is explicitly
deterministic (a `RegExp`-keyed table), per MINCRM-625's own AC — not a scoring model. Its
output is always **unioned** into whatever the mapping-based selection already found,
never subtracted. A file class whose blast radius can't be safely bounded by any targeted
rule (schema migrations, CI workflow files, `.env`/docker-compose files) is flagged
`alwaysWiden: true`, forcing the safety net's full-suite fallback rather than guessing a
targeted scope for something the rule table has no confident answer for.

### 3. Safety net is structurally decoupled from the scorer (MINCRM-626, MINCRM-627)

This is the ADR's central invariant, worth stating explicitly because it's easy to violate
by accident in a future change: **`safetyNetPolicy.ts` never imports, calls, or is aware
of `scorer.ts`/`TestScorer` at all.** The always-run baseline set is a parameter
`safetyNetPolicy.applySafetyNetPolicy` receives directly from its caller — never derived
from, filtered by, or passed through a `TestScorer`. A `TestScorer` (including a
maximally-adversarial one that drops every candidate) therefore has no code path by which
it could suppress a baseline test. `scorer.test.ts` asserts this at two levels: behavior
(an adversarial drop-all scorer still leaves baseline tests present after
`applySafetyNetPolicy`) and structure (a source-text scan asserting `safetyNetPolicy.ts`
contains no reference to "scorer" at all).

This ordering — mapping resolution → scoring/ranking → safety net, never the reverse —
is the extension point MINCRM-627 documents for the future ML ranker (pr-tia-10,
MINCRM-638-640): a new `TestScorer` implementation can replace `mapBasedScorer` (passed as
an optional parameter to `selectTestsForChangedUnits`, defaulting to `mapBasedScorer` so
existing callers are unaffected) to change ranking/capping behavior, but can never touch
whether the safety net fires or what it protects.

### 4. A `TestScorer` is invoked once, over the whole diff, not once per changed unit

Early design considered `score(change: ChangedUnit, candidates, features)` — one call per
changed unit. This was rejected: ranking is fundamentally a cross-candidate decision (e.g.
"is test A more relevant than test B", "cap to the top N overall across the whole diff"),
which a per-unit call could only approximate before cross-unit deduplication, then would
need re-doing anyway on the merged, deduplicated list. The interface instead is
`score(changedUnits: ChangedUnit[], candidateTests: SelectedTest[], features) => SelectedTest[]`,
called exactly once per selection, after `testSelectionService` has already deduplicated
candidates across all changed units.

### 5. No batch mapping-query endpoint — bounded concurrency instead

The mapping query API (MINCRM-621) only exposes single-lookup endpoints
(`findTestsForUnitWithConfidence(commitSha, unitKey, branchId)`). Rather than add a batch
endpoint (out of scope for this phase, and `coverageDb`'s own connection pool caps at 10 —
see `coverageDb.ts`), `testSelectionService` fans out with a small bounded-concurrency
helper (`MAX_CONCURRENT_MAPPING_LOOKUPS = 5`) rather than an unbounded `Promise.all`, which
could otherwise exhaust the pool on a large diff.

### 6. Pure-deletion hunks and branch-agnostic mapping lookups (found via Greptile PR review)

Two further correctness bugs surfaced by Greptile's automated PR review, after this
branch's own self-review round:

**Pure-deletion hunks were silently discarded.** `git diff --unified=0`'s hunk header for
a hunk that deletes lines with nothing added on the new side takes the shorthand `+c,0`
(zero new-side lines). `diffParser.parseHunkRanges` originally treated `lineCount === 0`
as "nothing to report" and skipped the hunk entirely — but a function changed **only** by
deleting lines (no other hunk in the file survives with a positive new-side line count)
would then resolve to **no changed unit at all**, with no unresolved-change signal either,
silently dropping its covering tests from selection. The fix: `+c,0` now emits a
**zero-width anchor range** `{startLine: c, endLine: c}` — `c` is git's own new-side
position for where the deleted content used to sit — and
`changeUnitResolver.resolveEnclosingUnitsForRanges` explicitly checks that anchor line
even when the range's `[startLine, endLine)` loop body would never execute for a
zero-width range.

**Changed units could never match branch-level coverage.** `changeUnitResolver` resolves
a diff to changed **functions**, never individual branch arms within a function — every
`ChangedUnit.branchId` is always `null`, since there's no way to know which specific
branch (e.g. an `if` statement's true/false arm) a line-level diff touched without
deeper branch-aware diffing (out of scope for this ticket). But a branching function's
own coverage is stored in `coverage_test_links` under one or more **non-null** `branch_id`
rows (see `coverageSymbolicationService.ts`'s branch-granularity path) — never a
null-branch row. Looking it up via the mapping query API's own
`findTestsForUnitWithConfidence`, which requires an **exact** `(unitKey, branchId)` match,
would therefore always return zero results for exactly the functions most likely to have
meaningful branch-level test coverage. The fix: a new, additive
`coverageMappingService.findTestsForUnitAcrossBranches(commitSha, filePath, unitKey)`
matches on `(file_path, unit_key)`, ignoring `branch_id` — `testSelectionService` now calls
this instead. This is deliberately a **new function**, not a change to
`findTestsForUnitWithConfidence`'s existing exact-match semantics — that function's
documented, versioned contract (MINCRM-621) is unchanged and still used as-is by any other
consumer requiring an exact identity match.

### 6a. Two follow-up bugs in the section-6 fixes themselves (found via a second Greptile review pass)

Greptile's review of the section-6 fixes above caught two further, more subtle bugs in
those very fixes:

**A genuinely-deleted (not renamed) function was still unresolved.** The first version of
`findRenamedAwayUnits` only emitted a `'deleted'` unit for an old boundary whose NAME
disappeared AND whose BODY HASH survived (unchanged) elsewhere in the new file under a
different name — i.e., only the rename case. A function removed OUTRIGHT from an
otherwise-retained file (no rename, name gone, body gone too) fell through both this
function and `resolveEnclosingUnitsForRanges`'s zero-width-anchor fix from section 6 — the
anchor is checked only against the NEW file's AST, where a fully-removed function simply
has no boundary at all to find. The fix: `findRenamedAwayUnits` now emits `'deleted'` for
**every** old boundary whose name is gone from the new file, whether or not its body
survives under a different name — a rename's old identity and an outright removal's
identity both need retiring from the mapping engine's perspective, and both are equally
invisible from the new side alone.

**`findTestsForUnitAcrossBranches` lost file identity.** The initial version matched on
`unit_key` alone. But `unit_key` is derived purely from a function's own qualified name +
normalized body hash (see `structuralKeyService.ts`) — file path is never folded into the
hash, and `coverage_units_identity_idx`'s own uniqueness is keyed on `(commit_sha,
file_path, unit_key, branch_id)` for exactly this reason: two different files can
legitimately produce the same `unit_key` for two unrelated, coincidentally-identical
functions. Matching on `unit_key` alone would return coverage links from BOTH files,
letting test selection attribute an unrelated file's tests to the actually-changed one.
Fixed by adding `filePath` back into the match (`WHERE file_path = $2 AND unit_key = $3`)
— still dropping only `branch_id`, not `file_path`. This required widening
`selectTestsForChangedUnits`'s `enclosingUnitsByUnitKey` parameter from
`Map<string, string>` (unitKey → unitKey) to `Map<string, EnclosingUnit>` (unitKey →
`{filePath, unitKey}`), since the enclosing/calling unit's own file path is needed for the
lookup and isn't necessarily identical to the changed unit's file (though it usually is,
in practice).

### 7. Explicit git-ref validation before shelling out

`diffParser.parseGitDiff` and `changeUnitResolver.resolveChangedUnits` both validate every
caller-supplied `baseRef`/`headRef` via `assertSafeGitRef` before passing them to `git` at
all, rejecting any ref beginning with `-` (which git could otherwise interpret as a CLI
flag rather than a revision). Found during this phase's own self-review: refs were
originally fused into a combined argv string (`${baseRef}..${headRef}`,
`` `${revision}:${filePath}` ``) without explicit validation — `coverageConfig.ts`'s own
`resolveCommitSha` validates its commit SHA against `SAFE_PATH_SEGMENT_PATTERN` before use,
and this phase's git-ref handling should hold itself to the same bar rather than relying on
git's own argument parsing to incidentally neutralize a malformed ref. `SAFE_PATH_SEGMENT_PATTERN`
itself is not reused here — it's scoped to a single filesystem path segment (a commit SHA),
too strict for an arbitrary ref (which legitimately contains `/`, e.g. `origin/main`) — so
`assertSafeGitRef` validates only the one shape that's actually dangerous to pass to a CLI.
No production caller of these functions exists yet (CI wiring is `pr-tia-8`'s job), so this
guard has no live exploit to close today; it exists so the safety isn't deferred to whatever
wires this into CI later.

---

## Consequences

### What this makes easy

- A future ML ranker (pr-tia-10) is a drop-in `TestScorer` implementation with no changes
  to `testSelectionService`, `dependencyGraphService`, or `safetyNetPolicy` — exactly the
  "ML-ready" framing MINCRM-627's own summary calls for.
- The safety-net guarantee ("a missed test never becomes a missed regression") is provable
  by reading `safetyNetPolicy.ts` in isolation — it has no scorer import to audit for a
  subtle bypass.
- Changed-unit identity is guaranteed consistent with the mapping engine's own storage,
  since both derive from the same `deriveStructuralUnitKey` function.

### What this forecloses / accepted tradeoffs

- No batch mapping-query endpoint exists yet. A very large diff (hundreds of changed
  units) makes hundreds of sequential-in-groups-of-5 round trips to the coverage DB. This
  is an accepted tradeoff for this phase; a batch endpoint is a natural follow-up if CI
  latency on large diffs becomes a problem (tracked informally, no ticket yet — this ADR
  should be revisited if one is filed).
- The dependency-graph rule table (MINCRM-625) is a hand-maintained `RegExp` list. Adding
  a new config/resource file class requires a code change to `dependencyGraphService.ts`,
  not a data-driven config file. This mirrors the AC's own "explicitly a deterministic
  rule set, not ML" framing, but does mean the rule table itself has no test coverage
  enforcement beyond the unit tests already written for the classes it lists today.
- `selectTestsForChangedUnits`'s `enclosingUnitKeysByUnitKey` inheritance map must be
  supplied by the caller (resolved from the same AST pass that produced `changedUnits`) —
  this service has no AST access of its own. A caller that fails to wire this up loses the
  "new code inherits from its enclosing unit" behavior silently degrading to "new code is
  always unmapped" (which the safety net still catches, just via the broader/costlier
  full-suite fallback rather than a targeted selection).

### Explicitly out of scope (still deferred to later phases)

- Wiring this selection output into CI (`gen-shards.ts`, the CI plugin) — pr-tia-8
  (MINCRM-633, MINCRM-634, MINCRM-660).
- An HTTP endpoint for test selection — not built in this phase; service+CLI-only, since no
  ticket in this phase's scope calls for an API surface. If a manual-trigger UI is wanted
  later, mirror `coverageMapping.ts`'s route/controller pattern.
- ML-based scoring itself — only the interface (MINCRM-627) is built here.

### Why no Playwright functional E2E spec accompanies this phase

Every prior Coverage/TIA phase's functional E2E spec (`coverage-mapping.spec.ts`,
`coverage-pipeline.spec.ts`, etc.) exercises a real HTTP endpoint via `restClient` against
a running server — there is no Playwright convention in this repo for testing a
service-layer library with no HTTP or UI surface. Since this phase is deliberately
service+CLI only (see "Explicitly out of scope" above — no ticket in this label calls for
an HTTP surface, and CI/UI wiring is `pr-tia-8`'s job), there is no endpoint for a
Playwright spec to visit. The 50 tests across the six `server/src/__tests__/*.test.ts`
files added in this phase already exercise the real end-to-end behavior at the
appropriate layer: `diffParser`/`changeUnitResolver` against real git repositories
(`mkdtemp` + `git init/commit`, no mocked git), and `testSelectionService` against the
real `coverageDb` Postgres test database. When `pr-tia-8` wires this into CI and/or adds
an HTTP surface, that phase should add the corresponding functional E2E spec, following
`coverage-mapping.spec.ts`'s own precedent.

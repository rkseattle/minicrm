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
never subtracted.

**`alwaysWiden` is the half of that union which is wired.** A rule that sets it forces the
full-suite fallback, and that path is live. `testScopes` is not: `select-tests.ts` prints
the tags in its rationale and never resolves them to spec files, so a rule with
`alwaysWiden: false` contributes nothing to `specFiles` today. Both non-widening rules —
`shared-schema` and `i18n-locale` — are therefore advisory, and the tags they emit
(`functional:*`, `functional:i18n`) have no consumer anywhere in the repo. Making targeted
widening real means adding a tag→spec resolver; until then, treat a `testScopes` value as
documentation of intent rather than as selection behavior. A file class whose blast radius can't be safely bounded by any targeted
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

> **Amendment (MINCRM-637, `pr-tia-9`):** this section's own closing line ("a batch
> endpoint is a natural follow-up if CI latency on large diffs becomes a problem") was
> acted on once `pr-tia-8`'s CI integration made that latency concern real rather than
> hypothetical. `testSelectionService`'s **direct-lookup step** now calls a batched
> **service-layer function**, `coverageMappingService.findTestsForUnitsAcrossBranches`
> — not an HTTP endpoint, since the only real caller (`select-tests.ts`) invokes the
> selection pipeline in-process and never makes an HTTP request to this server at all.
> The bounded-concurrency fan-out described above is retained for the **inheritance**
> step only (units with zero direct matches), which remains unreachable from
> `select-tests.ts` today. See `docs/dev/coverage.md`'s "Test selection algorithm"
> section for the current design.

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

### 6b. A third Greptile pass, plus two self-found bugs while fixing it

Greptile's THIRD review pass on this branch caught one more real bug, and verifying the
fix surfaced two more of this phase's own making:

**Anonymous-function deletions weren't detected when multiple anonymous callbacks
coexist.** `findRenamedAwayUnits`'s "still present" check (section 6a) compared by NAME for
non-anonymous boundaries, which is correct (`classifyChange` already handles the
edited-in-place case for named functions from the forward direction) — but for
`'<anonymous>'`, every anonymous function in a file shares that exact same fallback name
(see `qualifiedNameOf`), so a file with two or more anonymous callbacks would always find
SOME `'<anonymous>'` survivor and wrongly conclude nothing was removed, even when a
DIFFERENT anonymous callback was genuinely deleted.

The fix required real care, verified by writing regression tests first and watching them
fail in different ways as each naive fix attempt was tried:

- **Body-hash equality alone** (first attempt) is unsound for NESTED anonymous functions:
  an outer anonymous function's own hash covers its full source text, nested functions
  included, so editing only an inner callback's literal changes the OUTER callback's hash
  too — even though the outer callback's own logic never changed. This was caught by the
  existing same-line-nested-callback test from section 6, which started failing again.
- **Structural-path equality alone** (second attempt — `FunctionBoundary.path`, each
  function's own index among its parent's function-like children, tracked via a counter
  stack during the AST walk) is unsound when an EARLIER anonymous sibling is added or
  removed: every LATER sibling's own path index shifts, so an untouched later callback's
  new path can coincidentally collide with a REMOVED earlier callback's old path, again
  producing a false "still present."
- **The final fix** performs actual one-to-one PAIRING between old and new anonymous
  boundaries (not two independent "does X exist anywhere in Y" membership checks, which
  can each match a different survivor than the one being tested): pass 1 matches by exact
  body hash (unambiguous — an unchanged function's hash is stable regardless of new
  position); pass 2 matches by exact path among whatever pass 1 left unmatched (recovers
  an in-place body edit at the same nesting slot, whose hash changed but whose position
  didn't). An old anonymous boundary left unmatched after both passes is genuinely gone.

**A related, distinct bug surfaced while writing the anonymous-deletion regression test: a
pure-deletion hunk at the very start of a file anchored to line 0, not line 1.** Git's own
`+c,0` hunk-header convention (section 6) reports `c = 0` specifically when the deleted
content was the file's own first lines — there is no new-side line 0 (line numbers are
1-based) for "before the file's first surviving line" to point at. Left un-clamped, this
anchor could never resolve to any enclosing function (every real line is `>= 1`), so a
file's first function being deleted entirely fell into `resolveEnclosingUnitsForRanges`'s
"no enclosing function found" unresolved bucket instead of anchoring to whatever function
now starts the file — silently skipping the change-detection and rename/removal-detection
passes entirely for that file. Fixed by clamping `parseHunkRanges`' own computed
`startLine` to a minimum of 1.

**Accepted, documented residual gap:** `resolveFileChange` only calls
`findRenamedAwayUnits` when the OLD revision's content is actually readable at `baseRef`
(`git show` can fail — e.g. a shallow clone, or a base ref that's been garbage-collected).
When unreadable, rename/removal detection for that file is silently skipped, and every
changed unit in the file is instead classified `'new'` — consistent with `classifyChange`'s
own existing fallback for the same condition, so this is not a new regression, just an
explicitly accepted limitation of relying on `git show` for historical content.

### 6c. A fourth Greptile pass: the anonymous-only fix generalized incorrectly

Greptile's FOURTH review pass caught that section 6b's fix special-cased `'<anonymous>'`
as the only name capable of colliding — but any two boundaries sharing the same qualified
name have the identical false-survivor problem (e.g. two unrelated `render()` methods on
different classes): `newNamedNames.has(oldBoundary.name)` finds the surviving `render()`
and wrongly concludes the deleted one was never removed.

This was a real gap in how the anonymous fix was scoped, not a new edge case appearing
from nowhere: the fix in 6b treated "is this the anonymous sentinel" as the dividing line
between "needs pairing" and "safe with a plain name check," when the actual invariant is
"any name shared by 2+ boundaries needs pairing" — anonymous names are simply the common
case of that, not a special case distinct from it. The fix: `findRenamedAwayUnits` no
longer branches on `ANONYMOUS_NAME` at all — every boundary (named or anonymous) is
grouped by its own name, and the SAME hash-then-path pairing runs within each name group,
including groups of size one (a truly-unique name), where pairing trivially degenerates
to the original simple check.

**Fixing the regression test for this surfaced a second, distinct bug — the same class of
issue as section 6b's `+0,0` fix, one level deeper.** The test scenario (two classes, each
with their own `render()`, the first class removed entirely) reproduced a case where
`parseHunkRanges`' `+0,0`-clamped-to-line-1 anchor (section 6b's own fix) pointed at a
real, valid new-side line — but that line (the surviving class's own opening line) still
fell OUTSIDE every function's own containment range, since it's a class declaration line,
not a method body line. `resolveFileChange`'s existing "no enclosing function found"
early-return fired before `findRenamedAwayUnits` was ever reached, exactly as if the
anchor had failed to resolve at all — even though the backward-looking pass would
correctly have found the removed `render()` if it had run. Fixed by reordering
`resolveFileChange`: `findRenamedAwayUnits` now runs BEFORE the "no enclosing function
found" determination is finalized, and that determination is now based on whether the
COMBINED forward-plus-backward result is empty, not on the forward pass alone.

**Retrospective — why three fix cycles were needed for what looks, in hindsight, like one
bug:** each fix addressed the literal case being reported rather than the general
invariant the case was an instance of, and each time, the verification step trusted "the
reported repro now passes" as proof of correctness rather than asking "what property was I
actually claiming, and did I try to break that property specifically." The fix that
finally generalized correctly (this section) only did so because the process changed: name
uniqueness was treated as the actual invariant across ALL boundaries from the start, not
inferred backward from what different specific inputs required. The `+0,0`→line-1 clamp
had the identical shape of miss — fixing the immediate symptom (a literal `0`) without
tracing whether the fixed value was actually guaranteed to resolve downstream, which it
was not.

### 6d. Path-matching abandoned entirely: hash-only pairing plus an explicit `'ambiguous'` classification (fifth, sixth, and seventh independent adversarial review passes)

Section 6c's fix paired same-named survivors with a two-pass strategy: exact body-hash
match first, then — among what pass 1 left unmatched — exact match on `FunctionBoundary
.path`, a structural address tracking each function's own index among same-named siblings.
A `path`-preferring variant was also added to `classifyChange` on the belief that
preferring a path match, and falling back to first-match otherwise, was safe specifically
in that function (even though path-matching had already been rejected as a _pairing_
strategy for `findRenamedAwayUnits`).

Two independent adversarial review passes each found a live, repro'd case where
`path`-based disambiguation was unsound in a NEW way section 6c's fix hadn't covered:

- `classifyChange`'s path-preferring branch could still select the wrong sibling: deleting
  an earlier same-named sibling shifts a later one into that path slot, and if the shifted
  sibling's body hash happens to coincide with the new boundary's own hash, the function
  reports `'refactor'` for what is actually a brand-new, unrelated function.
- `findRenamedAwayUnits`'s `originalGroupSizesEqual` guard (added in 6c to gate path-
  matching pass 2) was necessary but not sufficient: a same-named sibling ROTATION — one
  deleted, a different one independently added, net group size unchanged — passes the
  equal-counts guard yet has no genuine positional correspondence between any old and new
  boundary, so path-matching could still misclassify the rotation.

Given path-matching had now failed adversarial review in three separate, independently-
found forms across two functions, the fix abandons structural position as a signal
entirely rather than attempting a fourth guard. **The `path` field has been removed from
`FunctionBoundary`** — nothing in `changeUnitResolver.ts` reads structural position
anymore. Both functions are now hash-only:

- **`classifyChange`** returns `'refactor'`/`'in-line'` only when EXACTLY ONE old boundary
  AND exactly one new boundary share a name (an unambiguous 1:1 comparison against the
  boundary's own old self). Any other count on either side returns a new `ChangeKind`
  value, **`'ambiguous'`** — an explicit "detectable but not classifiable" signal, rather
  than guessing. (Old-side-only counting was tried first and found by a further adversarial
  pass to still under-guard: a brand-new same-named sibling added alongside an untouched
  old namesake has an old-side count of 1, so the check must also require the new-side
  count to be 1 — `resolveFileChange` now computes and passes both.)
- **`findRenamedAwayUnits`** pairs old and new boundaries within each same-name group by
  exact body-hash match ONLY, for every group size — including 1-old/1-new. An
  unconditional 1:1 shortcut was tried and rejected by a fourth adversarial pass: a
  same-named group's own counts can coincidentally collapse to 1-and-1 when an unrelated
  old boundary is deleted while an unrelated new boundary is independently added in the
  same group, and the shortcut would pair them regardless of hash, silently swallowing the
  real deletion. Any old boundary left unpaired is reported `'deleted'` — over-reporting a
  spurious deletion remains the accepted, intentionally safe direction (a stale
  mapping-engine entry retires a build early; reconciliation repopulates it on next
  ingest).

**A fifth adversarial pass** found one further gap in the same shape: `classifyChange`
returned `'refactor'` whenever ANY of 2+ old candidates' hashes matched the new boundary's
hash, even though — with 2+ candidates — a hash match proves nothing about whether the
resolved boundary changed from _its own_ old self (the match may be a coincidence between
two unrelated, differently-edited siblings that happen to produce identical bodies). Fixed:
2+ candidates on either side now always return `'ambiguous'`, never `'refactor'`, no matter
whether some candidate's hash happens to match.

**One residual limitation was analyzed and deliberately left as documented, not fixed:**
hash-only matching cannot distinguish "old boundary X1 was renamed/moved to become new
boundary X3" from "X1 was deleted outright, and X3 is an unrelated new boundary that
happens to have a byte-identical body" — e.g. `X1.render()` (body A) deleted, `X2.render()`
(body B) survives untouched, and an unrelated new `X3.render()` (body A, coincidentally
matching X1's OLD body) is added: hash-matching pairs X1↔X3 and X2↔X2, reporting zero
deletions even though X1 is genuinely gone. This is not an oversight — it is the same
fundamental ceiling `git diff --find-renames` itself has when pairing deleted/added FILES
by content similarity (see `diffParser.ts`'s own use of `--find-renames=50%`): a purely
content-addressed signal cannot, even in principle, distinguish "same content because same
entity" from "same content, coincidentally, for a different entity" without information
this module doesn't have (authorial intent, cross-file call-site graphs). Any attempt to
add a positional/containment tie-breaker (e.g. "which enclosing class each `render`
belongs to") is structurally the same move as the sibling-index/path-matching approaches
already tried and rejected above, and fails the same way (e.g. if X1's own enclosing class
is _also_ renamed in the same commit). Documented directly in `findRenamedAwayUnits`'s own
docblock as a "KNOWN, ACCEPTED LIMITATION," with a test
(`changeUnitResolver.test.ts`) that locks in the current, accepted behavior rather than
asserting it as correct.

**Retrospective — six adversarial review passes across sections 6–6d, all found by asking
"can I construct an input that breaks the stated invariant" rather than "does the reported
repro now pass":** every one of the six additional findings was a variation on the same
underlying trap — using SOME signal (anonymous-sentinel special-casing, group-size-equality
guards, structural position, single-sided counting, "any hash match implies refactor") as a
stand-in for genuine identity, and each stand-in broke under an adversarial input the
previous fix's own verification hadn't tried to construct. The fix that finally held (this
section) is the one that stopped looking for a better proxy signal and instead asked "what
is the ONLY signal that can never be wrong, and what must the function honestly report when
that signal doesn't resolve the question" — exact hash equality is that signal, and
`'ambiguous'`/accepted-over-reporting is the honest answer when it doesn't resolve. See
`changeUnitResolver.ts`'s own docblocks for `classifyChange` and `findRenamedAwayUnits` for
the full, live-repro'd history of each rejected approach.

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

- ~~No batch mapping-query endpoint exists yet. A very large diff (hundreds of changed
  units) makes hundreds of sequential-in-groups-of-5 round trips to the coverage DB.~~
  **Resolved by MINCRM-637 (`pr-tia-9`)** — see the amendment on §5 above. The
  direct-lookup step is now one batched service-layer call; the inheritance step (still
  unreachable from the sole production caller) retains the original bounded-concurrency
  fan-out.
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

---
name: plan-work
description: Research Jira work items and the codebase, produce a phased implementation plan, have it adversarially reviewed, and present it for approval. Produces no code.
argument-hint: <MINCRM-N ...> or <pr-group-label>
disable-model-invocation: true
allowed-tools: Read, Write, Grep, Glob, Bash, Task, WebSearch, WebFetch
---

Plan the work for: $ARGUMENTS

This skill produces a plan and stops. **No file in the repo is created, edited, or
staged during this skill**, other than the plan document itself. No branch, no Jira
transition, no commit. The approval gate at the end is real.

## Step 1 — Resolve the arguments to a ticket set

$ARGUMENTS may be ticket IDs, a PR-group label, or a mix. Resolve before fetching.

**Matches `MINCRM-\d+`** → a ticket ID. Use directly.

**Anything else** → treat as a PR-group label (`iam-pr-03`, `ai-pr-14`,
`pr-tia-9-platform-governance`). Resolve it:

```
project = MINCRM AND labels = "<label>" ORDER BY created ASC
```

**If that returns nothing, do not conclude the label is unused.** In this Jira, `~` is
fuzzy text matching against a text index, not glob — `labels ~ "iam-pr*"` will not
match `iam-pr-03`. An empty exact match almost always means the slug you were given is
a prefix or fragment of the real label. Recover by widening, not by giving up:

1. `project = MINCRM AND labels ~ "<distinctive-fragment>"` — a single word from the
   middle of the slug works better than the leading token
2. If still empty, list broadly — `project = MINCRM ORDER BY created DESC` — and read
   the actual label strings off recent issues
3. Re-run the exact `labels = "<full-slug>"` match once you have the real string

Report the resolved label if it differed from what you were given.

**Then, before going further:**

- Report the resolved ticket set — IDs and summaries — so the scope is visible.
- **If a label resolves to more than 3 items, stop and flag it.** The working limit for
  a single handoff is 3; a larger group should be split into separate PR groups before
  planning, not planned as one unit. Propose a split and wait.
- Order the set by the label's implied sequence. PR-group labels in this project are
  numbered to match expected implementation order, so `iam-pr-02` precedes `iam-pr-03`
  and that ordering is meaningful for phase sequencing.

## Step 2 — Fetch the tickets, sequentially

Fetch each resolved ticket and read the full description and acceptance criteria
**before launching anything else**. Do not parallelize the fetch with exploration. The
session context contains recent git commits, and launching an exploration agent before
the ticket content is known anchors it on the wrong domain — this has happened.

Read linked and blocking tickets too. Cross-story dependencies in this project are
documented in prose inside issue descriptions rather than via Jira issue links, so read
the descriptions for sequencing constraints rather than relying on link metadata.

## Step 3 — Explore the codebase

Now, and only now, survey the code. Delegate breadth to `Explore` subagents so the
survey does not consume the main context; run several in parallel across distinct
questions. Give each one ticket-derived scope, not commit-derived scope.

Establish:

- Where the affected domain currently lives — routes, controllers, services, client
  API modules, page objects, behaviors, specs
- The established in-repo pattern for the thing being built. If the repo already solves
  this problem somewhere, the plan follows that solution.
- Blast radius: every caller, import, config key, script, Dockerfile line, and CI step
  that references what will change
- Existing test coverage and where new coverage lands
- Relevant ADRs under `docs/adr/` and dev docs under `docs/dev/`

### Enumerate every registry consumer with a command, not from memory

A **registry** is any single source of truth that other files enumerate, switch over,
render, or assert against. Editing one looks like a one-line change and is not: the line
is a fan-out point, and the real work is in its consumers.

For every registry the plan will touch, **run the grep and paste the file list into the
phase that edits it.** Not "consider the blast radius" — run it:

```bash
grep -rln "<REGISTRY_NAME>" client/src server/src shared qa db docs .github
```

The registries in this repo, and the consumer class each one hides:

| Registry                                   | Where                                      | Consumers that break silently                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Capability` enum                          | `shared/schemas/capabilitySchema.ts`       | `RolesSettings.tsx`'s `CAPABILITY_GROUPS`; a `role_capabilities` migration; **custom roles**, which `userCapabilities()` resolves _instead of_ the built-in fallback              |
| `FEATURE_FLAG_KEYS`                        | `shared/schemas/featureFlagSchema.ts`      | `featureFlagDocsParity.test.ts` (three assertions: key present, key registered, **`####` category groupings**); `admin-guide.md`'s reference table; MSW handlers                  |
| `AUDIT_RECORD_TYPES` / `AUDIT_EVENT_TYPES` | `shared/schemas/auditSchema.ts`            | `ChangeHistory.tsx`'s `never`-terminated switch (**build break**); `ChangeHistory.test.tsx`'s `it.each`; `AuditLogPage.tsx`'s `t('auditLog.recordTypes.<x>')` → 1 key × 5 locales |
| Env vars                                   | `.env.example`                             | `docker-compose{,.dev,.test}.yml` each enumerate keys individually — an env var absent there is **permanently unset in every container**                                          |
| Product tables                             | `db/migrations/`                           | `reset-e2e-data.ts` enumerates every table it clears                                                                                                                              |
| `LEGACY_PREFIXES`                          | `server/src/app.ts`                        | sunset shim — new resources must NOT be added                                                                                                                                     |
| `ALWAYS_EXCLUDED_FIELDS`                   | `server/src/ai/piiFilter.ts`               | flat set of bare column names, no qualification                                                                                                                                   |
| Locale keys                                | `client/src/locales/en.json`               | `locale-completeness.test.ts` (bidirectional, 4 locales); `pseudo.json` needs `npm run pseudoloc`                                                                                 |
| `@serial` E2E specs                        | `qa/e2e/tests/`                            | `check-settings-mutations.mjs`; the 16 generated `playwright.serial-group.*.config.ts` — an unregenerated group means the spec **never runs**                                     |
| CI paths filters                           | `.github/workflows/ci.yml`                 | `server` is `server/src/**` and `client` is `client/src/**` — a `shared/schemas/**` edit reaches **neither** test job                                                             |
| `WEBHOOK_EVENT_TYPES`                      | `shared/schemas/webhookSchema.ts`          | `WebhookSettings.tsx`'s event picker; `swagger.ts`'s enum                                                                                                                         |
| `AuditRecordType` / `AuditEventType`       | `server/src/services/auditService.ts`      | server-only and safe to extend alone; `audit_log`'s CHECK constraints were dropped deliberately, so no migration is needed                                                        |
| Visibility policies                        | `server/src/services/visibilityService.ts` | every list endpoint's WHERE clause — a new object type needs a policy or it silently returns everything                                                                           |

The table is not exhaustive. When a plan edits a symbol that other files enumerate,
switch over, or assert against, it is a registry — grep it and list what came back.

**A registry edit is never a one-line phase entry.** State, per consumer, what changes
there. If the answer is "nothing", say why — the alternative is discovering it in review.

Read the actual code. Do not plan from file names.

## Step 4 — Write the plan

Write it to `docs/plans/<primary-ticket>.md`. This is the one file this skill creates,
and it is not source code. (Kept out of `.claude/plans/`, which Claude Code uses for
its own plan-mode artifacts.)

Structure:

```markdown
# <MINCRM-N ...> — <title>

## Scope

What ships. What explicitly does not.
Covering tickets, and the PR-group label if the work was resolved from one.

## Acceptance criteria coverage

| Ticket | AC | Phase | Deviation |

**One row per AC clause, not per AC theme.** Split on commas and semicolons: an AC
reading "DELETE /x/:id (own only, revokes OAuth token where provider supports it)" is
three rows — the route, the ownership check, the revocation — because each can be
independently forgotten, and a theme-level row lets a clause vanish without leaving a
visible hole. Any clause whose phase cell you cannot fill is a gap in the plan, not a
gap in the table.

Use the `Deviation` column wherever the plan ships something other than what the AC
literally says, with a one-line reason. A reader checking coverage must be able to see
every departure from this table alone, without reading the prose.

## Approach

The chosen approach, and why it is the industry-standard one for this problem —
name the pattern (optimistic locking, outbox, capability check at the boundary,
whatever applies). Where an in-repo precedent exists, cite it as `file:line`.
Where this departs from precedent, say so and justify it.

## Rejected alternatives

Each with the reason it loses. If the simplest approach is rejected, say why.

## Phases

### Phase N — <name>

- Files touched
- Change summary
- Tests added or updated
- Commit message
  Each phase must be independently committable and leave the branch coherent.

## Risks and open questions
```

Rules the plan must respect: services own all DB access; controllers shape only; Zod at
the boundary; audit entry in the same transaction on the same client; automation
triggers and assignment notifications fired after commit and never awaited; ownership in
the WHERE clause on PATCH/DELETE; ORDER BY allowlist; explicit PG error mapping;
varchar + CHECK over new enums; corrective migrations only, each with a real `down`.

### Length: 40 lines per phase, 400 for the document

Hard caps, counted on the finished file. A phase over 40 lines is a phase doing too much
— **split it or cut its scope; do not compress the prose to fit.** A document over 400
means the branch is too large to review, which is a scope finding to raise with Rob, not
a formatting problem. Plans for comparable work in `docs/plans/` land at 430–530 lines
total including the shared sections; a phase needs well under 40 to say what it does.

The four phase bullets are the phase. `Files touched` is a list of paths, not prose.
`Change summary` is what changes and why, in a few sentences. If a claim needs three
paragraphs of defense, that is a signal the approach is wrong or unverified — not that
it needs more words.

### Describe the end state, never the revision history

The plan says what will ship. It does not narrate how the plan got here. Never write
"an earlier draft said…", "this was previously scoped as…", "round N found…", or any
justification of the current text against a superseded version. When review changes
something, **edit it in place so the document reads as if it were always right**, and
carry the correction into every other passage stating the same fact — a corrected claim
left standing in three other paragraphs is how a plan starts contradicting itself.

Revision history belongs in chat, where Rob can see the reasoning moved. In the document
it is pure bulk, and it actively causes defects: every restatement of a fact is another
copy to drift.

### Verify claims instead of arguing for them

A plan asserting "safe by construction", "closes the class", "transcribed flag-for-flag",
or "exhaustive" must have run something that shows it. Fluent prose is where a
plausible-but-wrong claim survives — a shell command settles it in seconds and a
paragraph never does.

Prefer a guard that enumerates instances over a hand-maintained list of them: a list is a
count you will get wrong, a guard is one the repo reports. Where a claim genuinely cannot
be checked before implementation, mark it unverified in one clause and move on. Do not
compensate with length.

Never the simplest, quickest, or easiest solution. If you catch yourself writing "wait",
"actually", or "let me look at this differently" more than once, stop and think it
through rather than iterating in the open.

**Scope exclusions are decided here, with Rob, not later on your own.** If exploration
finds instances of a root cause the plan otherwise fixes, the plan's "What explicitly
does not ship" must list each one and justify it as **benign in context** — it cannot
produce a wrong result for any user or any test. A different feature, page, or workspace
is not a justification. `design-adversary` will evaluate each exclusion on that bar.

This is the right moment to split work: if covering every instance would make one branch
too large to review, propose sequenced tickets in the plan and let Rob choose. Do not
create those tickets yet — deciding mid-implementation to file a follow-up instead of
fixing is the failure this exists to prevent.

## Step 5 — Self-check, then adversarial design review

### Before launching the reviewer, verify your own claims

The reviewer's scarcest output is the finding you could not have found yourself. Spending
a round on a claim one grep would have settled wastes it. Walk the finished plan and, for
each item below, either fix it or satisfy yourself it holds:

1. **Every "X currently does Y" claim about existing behavior** — name the command you
   ran. A claim about what a schema validates, what a middleware returns, what a test
   asserts, or what a CI filter matches is checkable in seconds, and stating one from
   memory is how a plan argues confidently for the wrong design. Where a claim rests on
   something being _absent_, grep for it and count: absence is a claim like any other.
2. **Every registry the plan edits** — the grep from Step 3 was run and its consumers are
   listed in the phase that edits it.
3. **Every AC clause** — has a row and a phase number.
4. **Every cross-phase reference** — a phase naming a function, error code, or type that a
   later phase introduces does not compile on its own; either move it or reorder.
5. **Every "independently committable" claim** — pick the phase you are least sure of and
   ask what `npm run typecheck` does on it alone.

Findings from this pass are edited in place, silently. They never appear in the plan as
revision history.

### Then launch the review

Launch the `design-adversary` subagent.

**The delegation prompt contains only:** the path to the plan file, and the ticket IDs.
Nothing about why you chose the approach, nothing you learned during exploration,
nothing about what you expect it to find. It reviews the plan as written, cold.

Fix every BLOCKER and MAJOR in the plan, then re-run the review on the revised plan.
Repeat until it returns no BLOCKERs, to a maximum of three rounds. If it still returns
BLOCKERs after the third round, stop and bring the disagreement to Rob rather than
continuing to iterate.

## Step 6 — Present for approval

Present in chat, concisely:

- The resolved ticket set, and the label it came from if applicable
- The phase list with one line each
- The approach and its justification, with the in-repo precedent cited
- What the adversarial review found and what changed as a result
- Open questions needing a decision

Then stop and wait. Do not begin implementation, do not create the branch, do not
transition Jira. Approval is an explicit "approved", "do it", or equivalent — a
clarifying question is not approval.

# Dates and timezones

Postgres sessions in this stack run `Etc/UTC` — dev, CI, and production containers alike.
Timezone-naive `date` columns (`ai_token_usage_daily.usage_date`, `deals.close_date`,
`activities.due_date`) are therefore written and compared against a **UTC** notion of
"today".

Anything in Node that builds a calendar boundary to compare against one of those columns
must resolve in UTC too. A boundary built from the process's local calendar fields names
a different day than the database does whenever the process timezone isn't UTC, which
silently drops or double-counts the edge days of a range.

## The rule

**Build calendar boundaries with `Date.UTC` and the `getUTC*` accessors. Never the
multi-argument `new Date(year, month, day)` constructor.**

```ts
// Wrong — resolves in the process's local timezone
const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

// Right — resolves in UTC, matching the DB
const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
```

`Date.UTC` normalizes out-of-range months, so offsets that cross a year boundary
(December + 1, January − 3) need no special handling.

Bind an explicit `YYYY-MM-DD` string against a `date` column rather than a `Date` object.
node-postgres infers the wire type from the target column and serializes `date` params
using the JS Date's **local** calendar fields, so a bare `Date` shifts by a day off-UTC.
`server/src/utils/utcDate.ts`'s `toUtcDateString` exists for exactly this.

Where "today" only needs to reach SQL, prefer pushing it into the query — `CURRENT_DATE`
resolves in the database's timezone by construction. `notificationService.ts:181`
(`a.due_date < CURRENT_DATE`) takes this route, as does `dashboardService.ts`, whose
comment at `:166` explains the choice.

## Canonical implementations

| Helper                                  | Location                      | Purpose                               |
| --------------------------------------- | ----------------------------- | ------------------------------------- |
| `toUtcDateString()`                     | `server/src/utils/utcDate.ts` | `Date` → UTC `YYYY-MM-DD` for binding |
| `utcDayOffset()`                        | `server/src/utils/utcDate.ts` | `YYYY-MM-DD` N days from UTC midnight |
| `utcMonthStart()`                       | `server/src/utils/utcDate.ts` | Month boundary at a month offset, UTC |
| `todayIso()`                            | `client/src/utils/utcDate.ts` | Today's UTC day, client side          |
| `firstOfMonthIso()`                     | `client/src/utils/utcDate.ts` | First of the UTC month, client side   |
| `dayOffsetIso()`                        | `client/src/utils/utcDate.ts` | UTC day N days out, client side       |
| `monthStartIso()` / `monthEndIso()`     | `client/src/utils/utcDate.ts` | UTC month bounds at an offset         |
| `quarterStartIso()` / `quarterEndIso()` | `client/src/utils/utcDate.ts` | UTC quarter bounds at an offset       |
| `weekStartIso()`                        | `client/src/utils/utcDate.ts` | Monday of the UTC week                |
| `currentYearMonth()`                    | `aiTokenBudgetService.ts:60`  | Current month as `YYYY-MM`, UTC       |
| `rangeIncludesCurrentMonth()`           | `aiUsageDashboardService.ts`  | UTC month-overlap test                |

Shared helpers live in `server/src/utils/utcDate.ts` and `client/src/utils/utcDate.ts` —
one per workspace, since the two cannot import across the boundary. Import from there
rather than writing another local copy; three divergent implementations of "N days from
UTC midnight" is what prompted the extraction.

**This is the target convention, not yet the state of the repo.** MINCRM-700 consolidated
the call sites it touched. Several already-correct local copies of `toISOString().slice(0, 10)`
survive elsewhere — `aiTokenBudgetService.ts`'s `currentDate`, `dealController.ts`,
`meetingBriefController.ts`, `taskSuggestionService.ts`, `activitySummaryService.ts`, and
on the client `MyTasksPage.tsx`, `DealDetailPage.tsx`, `ActivityTimeline.tsx`. None is a
live defect. Two pairs are worth folding in when they are next touched, because each pair
has to agree and nothing enforces it: `ActivityTimeline.tsx` / `meetingBriefController.ts`
(the same brief-eligibility gate) and `MyTasksPage.tsx` / `dashboardService.ts` (the same
overdue rule). `qa/` cannot import from either workspace, so its specs carry a documented
local mirror instead.

No date library is used: `date-fns`, `dayjs`, and `luxon` are all deliberately absent
from `server/package.json`. `Date.UTC` plus the `getUTC*` accessors covers every case
here.

## Testing

Pin the instant; do not read the wall clock. Give the function an injectable
`now: Date = new Date()` parameter and pass a fixed instant from the test — see
`resolveDateRange` in `aiUsageDashboardService.ts`.

**Do not reach for `vi.setSystemTime`.** In vitest 4 it requires `vi.useFakeTimers()`
first, and faked timers cannot wrap `pool.query` — the call hangs on the pool's
connection and idle timeouts. Every existing fake-timer use in the server suite
(`notificationService.test.ts`, `verifyTestAttestation.test.ts`) deliberately avoids
awaiting DB work inside the faked window.

A useful pinned instant is `2026-07-31T22:30:00.000Z`: month-end in UTC, but already the
next month for any zone more than 90 minutes ahead. A test pinned there fails if a
local-time constructor is reintroduced, regardless of when the suite runs.

Run timezone-sensitive suites under `TZ=UTC`, a UTC-behind zone
(`TZ=America/Los_Angeles`), and a UTC-ahead zone (`TZ=Pacific/Auckland`).

CI pins `TZ=Pacific/Auckland` on the `server-tests` and `client-tests` jobs
(`.github/workflows/ci.yml`). This is load-bearing: runners and the `postgres:16`
service container both default to UTC, and under UTC a local-time constructor produces
byte-identical values to a UTC one — so every guard in this document would pass on a
revert. A UTC-ahead zone is chosen because the month-boundary defects here (a local
month start serializing to the previous month, an end-of-month landing a day early) only
manifest ahead of UTC. Postgres still resolves `CURRENT_DATE` in UTC, so the Node/DB
disagreement stays permanently exercised.

Note the blast radius: that pin applies to the whole suite, not just date tests. It
already surfaced one unrelated assumption — `formatLocalDate.test.ts` used a noon-UTC
instant to mean "the same day everywhere", which only holds within ±12h.

## Reviewed and safe

These use local `setDate`/`setMonth` arithmetic but serialize with `toISOString()` (UTC),
so no local boundary is ever compared against a UTC-resolved column. Their only exposure
is that "today + N" is computed from a locally-offset instant, which can land a day off
within a few hours of UTC midnight. Audited under MINCRM-700 and left as-is:

- `reportService.ts:604` — the values built here never reach a SQL predicate at all. The
  query uses `NOW() - ($1 || ' days')::interval`; these strings are returned only as
  response metadata describing the window.

Fixed under MINCRM-700 rather than filed as safe: `automationService.ts` (wrote
`activities.due_date`, which `notificationService.ts:181` compares against
`CURRENT_DATE` — a day's drift moves whether a task reads as overdue),
`ai/toolExecutor.ts`'s `thirtyDaysAgo` (reaches `deals.close_date` filters via the NLI
report tools), and `demoService.ts`'s `relativeDate`/`futureMonths`, which reach
`activities.due_date`, `deals.close_date`, and a "Contract Signed Date" custom field.
That last one was initially filed as safe on an offset-magnitude argument; the argument
was wrong, because the drift mechanism is DST rather than the UTC offset. Under
`TZ=Pacific/Auckland`, `relativeDate(-4)` crossed a **month** boundary at the 2026-04-05
transition — exactly what its own docblock says must not happen.

## Known unfixed

No known local-boundary-vs-UTC-column **defects** remain.
`client/src/hooks/useReportFilters.ts` was the last one: its nine local-calendar helpers
now use the shared `client/src/utils/utcDate.ts` primitives (`monthStartIso`,
`monthEndIso`, `quarterStartIso`, `quarterEndIso`, `weekStartIso`, `dayOffsetIso`), each
covered by boundary tests at pinned instants.

That is narrower than "nothing left to do" — see the convention note above for the
already-correct-but-un-consolidated copies, including the two pairs that must agree with
each other and are not enforced.

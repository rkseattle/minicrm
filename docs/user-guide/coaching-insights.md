# Coaching Insights

> **Managers and admins only.** Reps who open this page are returned to the dashboard
> without a message — that check runs first, so a rep never sees anything else here.
> Their own numbers are on the dashboard instead, under **My Performance** — see
> [Dashboard](dashboard.md).
>
> **Feature flag:** `ai_rep_coaching_insights`. For a manager or admin, the page reads
> _This feature is not available._ while the flag is off.

Coaching Insights compares each rep on your team against the team's own averages and
flags where someone stands out — deals sitting too long in a stage, follow-ups going out
slower than usual, a win rate well above or below the rest.

> **This is not AI, despite the flag name.** Every number here is computed in SQL from
> your own deal and activity history. Nothing is sent to a model, and nothing is
> inferred — an observation you see is arithmetic on records your team created.

---

## Tutorial: review a rep

### Step 1 — Open the page

Go to `/insights/coaching`. The page sits outside the navigation, so reach it by URL or
from the dashboard's **My Performance** section, where **View all** links here.

### Step 2 — Pick a rep

Use the **Rep** dropdown. Anyone without enough closed-deal history to compare has
_insufficient data_ in parentheses after their name, so you can see at a glance who has a
usable picture.

### Step 3 — Read the insights

Each row is an observation with a recommended action underneath it. Rows where the rep
stands out from the team are highlighted and carry an **Outlier** badge.

An outlier is not automatically a problem: a rep closing far faster than the team average
is flagged the same way as one closing far slower. Read the observation before acting on
the badge.

---

## Reference

### When a rep has no insights

| What you see                                                         | When                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| _Not enough closed deal history yet_, with the shortfall spelled out | The rep is below the minimum your admin has configured |
| _No coaching insights available yet._                                | The rep clears the minimum but nothing stood out       |
| _No reps available._                                                 | No active reps or managers exist to compare            |
| _Failed to load coaching insights._                                  | The data could not be fetched                          |

A rep below the minimum is not hidden — they stay selectable, with the shortfall spelled
out. The minimum is set by your admin; see
[Admin guide — Insights](../admin-guide.md#24-insights).

### The numbers are recomputed once a day

Insights are rebuilt on a daily schedule, not when you open the page, so a deal closed
after the last run is not reflected until the next one. Admins can trigger a run
immediately from **Admin Settings → AI → Rep Coaching Insights**, and the exact time is
listed in [Scheduled Jobs](../operations.md#scheduled-jobs).

### Who can see whose numbers

Managers see the reps in the teams they manage, including any nested teams, plus
themselves. Admins see every active rep and manager across the organization — other
administrators are not listed, because the comparison is between people carrying a
pipeline. A rep sees only their own figures, and only through the dashboard's
**My Performance** section — they cannot reach this page at all.

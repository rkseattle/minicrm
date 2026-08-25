# Dashboard

> **Feature flag:** Only the **My Performance** section is flag-gated
> (`ai_rep_coaching_insights`). Reaching the page at all needs the `dashboards:view`
> capability — every built-in role except a service account has it, but a custom role must
> be granted it explicitly, and without it the page shows only an error.

The dashboard gives you an at-a-glance summary of your pipeline and your workload. It is
the first page you see after logging in.

---

## Tutorial: reading your dashboard

### Stat cards

Five cards run across the top. Each is prefixed **Team** for an admin, who sees org-wide
numbers, and **Your** for everyone else:

- **Overdue tasks** — open tasks past their due date. The count turns red when it is above
  zero, and for non-admins the card is a link: click it to open
  [My Tasks](my-tasks.md) filtered to your overdue tasks. This card counts every overdue
  task you own, while the page filters a page at a time, so the two can differ.
- **Due today** — open tasks due today.
- **Open deals** — count of deals not in a terminal stage.
- **Pipeline value** — total value of those open deals.
- **Weighted pipeline** — the same total with each deal multiplied by its probability.

If your open deals span more than one currency, the value cards say so rather than summing
across currencies. When exchange rates are configured, a converted total appears below the
cards in your org's home currency.

### Pipeline by stage

A table below the cards lists each stage that currently holds open deals, with **Deals**,
**Value**, and **Weighted Value** columns. Closed Won and Closed Lost are excluded. The
rows are read-only — to work a stage, open the pipeline board from **Deals** in the
navigation.

### My Performance

> **Feature flag:** `ai_rep_coaching_insights`.

Appears once you have enough **closed** deals — won or lost — for a comparison to be
meaningful, and then only where your numbers stand out. The **View all** link opens
[Coaching Insights](coaching-insights.md), which only managers and admins can reach; for
anyone else it returns to the dashboard.

### Recent Activity

The **Recent Activity** feed shows the ten most recently updated activity entries (calls,
emails, meetings, tasks, notes) that you own — org-wide for admins — newest first.
**View all** opens the Activities page.

---

## Reference

### What counts as "my pipeline"?

Every figure on the dashboard is scoped to deals and tasks **you** own. Admins see
org-wide numbers instead, which is what the **Team** prefix on each card indicates. There
is no owner filter on this page — to break numbers down by rep, use
[Reports](reports.md).

### Dashboard refresh

Dashboard data refreshes when you open the page and again whenever you return to the
browser tab, so you do not need to reload to pick up a teammate's changes.

### Overdue tasks

A task is overdue when its due date is in the past and its status is still _Open_. The
**Overdue tasks** card counts them and shows the count in red; click it to see the tasks
themselves.

If email notifications are enabled, you will also receive a daily digest listing your
overdue tasks.

# Reports

> **Feature flag:** Reports & Dashboards can be disabled by your admin. If the Reports
> navigation item is missing, contact your admin to enable the **Reporting & Dashboards**
> feature flag.

MiniCRM includes four built-in report views accessible from the **Reports** navigation
item. Each view has a **My View** / **Team View** toggle (where applicable) and a
date-range selector.

---

## Built-in reports

### Win/Loss Report

Shows closed deal performance over a selected period.

**Headline metrics:**

| Metric      | What it counts                                 |
| ----------- | ---------------------------------------------- |
| Closed Won  | Number of deals moved to _Closed Won_          |
| Won value   | Total value of won deals in your org currency  |
| Closed Lost | Number of deals moved to _Closed Lost_         |
| Lost value  | Total value of lost deals in your org currency |
| Win rate    | Won ÷ (Won + Lost) as a percentage             |

Below the headline numbers, a **Per-rep breakdown** table shows the same columns for
each rep. A **Loss reason breakdown** table lists the reasons entered on lost deals.

**Filtering:**

- **Date range** — choose _This month_, _This quarter_, or a custom range.
- **My View / Team View** — toggle between your own deals and all reps.
- **Owner** (Team View only) — filter to a specific rep.

---

### Activity Volume Report

Shows how many activities each rep has logged, broken down by type.

**Columns:** Rep, Note, Call, Email, Meeting, Task, Total.

The **Per-rep breakdown** table lists each rep's counts for the period. Use this report
to track outreach volume and coaching needs.

**Filtering:**

- **Date range** — choose _This week_, _This month_, _This quarter_, or a custom range.
- **My View / Team View** toggle.
- **Owner** (Team View only).

You can export the table as a CSV or PDF file using the **Export CSV** or **Export PDF**
button.

---

### Pipeline Stage Trend

Shows how many deals entered each pipeline stage over time, and what percentage advanced
to the next stage.

**Columns:** Stage, Period, Entered, Advanced, Advance rate.

Use this report to spot where deals are stalling. A low advance rate on a particular
stage means deals tend to die there.

**Filtering:**

- **Date range** — choose _Last 30 days_, _Last 60 days_, or _Last 90 days_.

---

## Tutorial: run a Win/Loss report and export it

### Step 1 — Open the report

1. Click **Reports** in the navigation.
2. Select the **Win/Loss** tab.

### Step 2 — Set the date range

1. In the **Date range** selector, choose _This quarter_ (or set a custom range).
2. The headline numbers update automatically.

### Step 3 — Switch to Team View

1. Click **Team View** at the top of the report.
2. The per-rep breakdown table now shows all reps.
3. Use the **Owner** dropdown to zoom in on a specific rep if needed.

---

## Custom Reports

> **Feature flag:** Custom Reports also require the **Reporting & Dashboards** flag.

The **Custom Reports** tab lets you build ad-hoc queries against any CRM entity, save
them for later, and optionally share them with your team.

---

## Tutorial: build and save a custom report

### Step 1 — Open the builder

1. Click **Reports → Custom Reports**.
2. Click **New report** to open a blank builder.

### Step 2 — Choose a data source

In the **Data source** dropdown, select one of:

| Option     | Data it queries          |
| ---------- | ------------------------ |
| Contacts   | All contact records      |
| Accounts   | All account records      |
| Deals      | All deal records         |
| Leads      | All lead records         |
| Activities | All activity log entries |

### Step 3 — Pick your fields

Under **Fields to show**, check the columns you want in your results table. The order you
select them becomes the column order.

### Step 4 — Add filters (optional)

Click **+ Add filter** to narrow the results. Each filter has three parts:

| Part     | Description                                           |
| -------- | ----------------------------------------------------- |
| Field    | The column to filter on (e.g. _Stage_, _Owner_)       |
| Operator | How to compare (equals, contains, greater than, etc.) |
| Value    | The value to compare against                          |

You can add multiple filters; all conditions must match (AND logic).

**Available operators:**

| Operator     | Meaning                      |
| ------------ | ---------------------------- |
| equals       | Exact match                  |
| not equals   | Any value except this        |
| greater than | Numeric or date comparison   |
| less than    | Numeric or date comparison   |
| at least     | Inclusive numeric comparison |
| at most      | Inclusive numeric comparison |
| contains     | Text substring match         |
| is empty     | Field has no value           |
| is not empty | Field has any value          |

### Step 5 — Group and aggregate (optional)

- **Group by** — collapse rows that share the same value in a field (e.g. group deals
  by _Stage_).
- **Aggregate** — choose _Count_ (number of matching rows) or _Sum_ (total of a numeric
  field). When aggregating, each group becomes one row.

### Step 6 — Sort results (optional)

Choose a field to **Sort by** and pick **Ascending** or **Descending**.

### Step 7 — Add a chart (optional)

Choose **Bar chart** or **Line chart** in the **Chart type** dropdown. The first selected
field is used as the X-axis label; remaining fields become data series. Charts require at
least two fields and at least one row of results.

### Step 8 — Run the report

Click **Run report**. Results appear in the table below the builder. The row count is
shown above the table.

### Step 9 — Save the report

1. Click **Save report**.
2. Enter a **Report name**.
3. Choose a **Visibility**:

| Visibility         | Who can see it                                    |
| ------------------ | ------------------------------------------------- |
| Private            | Only you                                          |
| Public – Read Only | All users can run it; only you can edit or delete |
| Public             | All users can run, edit, and delete it            |

1. Click **Save**.

The report appears in the **Saved reports** list on the left. Click it to reload the
builder with your saved configuration.

### Updating a saved report

After running a saved report, click **Update report** to save any changes you have made
to the configuration, or **Save as new** to create a new copy.

---

## Reference

### Exporting results

The results table can be exported as a CSV or PDF file using the **Export CSV** or
**Export PDF** button (visible after running a saved report). Requires the
**CSV Export** feature flag to be enabled.

### Sharing reports

Set a saved report to _Public_ or _Public – Read Only_ so other team members can find
and run it from their own **Saved reports** list.

### AI Win/Loss Pattern Analysis

> **Feature flag:** `ai_win_loss_insights`. This is a separate page from the Win/Loss
> Report above — currently reached by navigating directly to `/insights/win-loss`
> rather than from the Reports navigation item.

The built-in **Win/Loss Report** described above shows live counts and totals for a
date range you choose. **Win/Loss Pattern Insights**, at `/insights/win-loss`, is a
different, AI-narrated view: instead of totals, it looks for behavioral patterns that
correlate with winning or losing, refreshed automatically overnight.

Once your organisation has enough closed deal history, the page shows three sections:

- **Win Patterns** — behaviors more common in won deals (for example, a demo held in
  the first week, or high activity volume), each with a plain-language observation and
  a win-rate comparison (e.g. "65% vs 28% · 47 deals").
- **Loss Patterns** — the same comparison for behaviors more common in lost deals.
- **Loss Reason Trends** — commentary on how recorded loss reasons are trending over
  time.

If your organisation does not yet have enough closed deals, the page shows how many
more are needed instead of any patterns.

Use **Export CSV** or **Export PDF** at the top of the page to download the current set
of insights.

> **AI-generated observations, not statistical proof.** These patterns are correlations
> found in your historical data and narrated by AI — they are not a controlled
> experiment and do not imply that one behavior _causes_ deals to win or lose. Use them
> as a starting point for coaching conversations, not as a rulebook.

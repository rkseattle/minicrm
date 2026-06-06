# Deals

> **Feature flags:** Custom Fields on deals and CSV export from the deals list require
> the **Custom Fields** and **CSV Export** feature flags respectively. If either is
> missing, contact your admin.

Deals track sales opportunities as they move through your pipeline from first contact
to close. The pipeline board gives you a Kanban view of every open deal by stage.

---

## Tutorial: create a deal and close it

### Step 1 — Create the deal

1. Click **Deals** in the navigation, then click **New Deal** (top-right).
   Alternatively, open a contact or account and click **New deal** there — the
   contact or account will be pre-linked.
2. Enter a **Deal name** (required) and **Value** (the expected revenue amount).
3. Choose a **Currency** if your organisation works in multiple currencies.
4. Select a **Stage** — this is where the deal sits on the pipeline board.
5. Optionally set an **Owner**, link an **Account** and one or more **Contacts**,
   and add a **Close date**.
6. Click **Save**.

### Step 2 — Move the deal through the pipeline

**From the board view:**

1. Click **Deals** to open the pipeline board.
2. Find your deal card and drag it to the next stage column.
   The deal's stage updates immediately.

**From the deal detail page:**

1. Open the deal.
2. Click **Edit**.
3. Change the **Stage** dropdown.
4. Click **Save**.

### Step 3 — Record a close (Won or Lost)

When the deal reaches a terminal stage:

- **Closed Won** — drag or set the stage to _Closed Won_. The deal's probability
  becomes 100% automatically.
- **Closed Lost** — drag or set the stage to _Closed Lost_. You will be prompted
  to enter a **Loss reason** (optional but useful for reporting). Probability
  becomes 0%.

---

## Reference

### Fields

| Field       | Notes                                                                                  |
| ----------- | -------------------------------------------------------------------------------------- |
| Deal name   | Required                                                                               |
| Value       | Numeric amount; e.g. `12500`                                                           |
| Currency    | 3-letter code; defaults to the org default (set by admin)                              |
| Stage       | Current position in the pipeline                                                       |
| Probability | 0–100 % chance of winning; defaults to the stage's default; can be overridden manually |
| Close date  | Expected or actual close date                                                          |
| Owner       | The rep responsible; defaults to the creator                                           |
| Account     | The company this deal is with                                                          |
| Contacts    | One or more contacts involved in this deal                                             |
| Pipeline    | Which pipeline this deal belongs to (admins can create multiple pipelines)             |

### Pipeline stages

Stages are configured by your admin (see the Admin Guide). Each stage has a default
probability. Common stages:

| Stage         | Default probability |
| ------------- | ------------------- |
| Prospecting   | 10%                 |
| Qualification | 25%                 |
| Proposal      | 50%                 |
| Negotiation   | 75%                 |
| Closed Won    | 100%                |
| Closed Lost   | 0%                  |

_Closed Won_ and _Closed Lost_ are fixed stages that cannot be renamed or deleted.

### Probability

- Each stage has a default probability (set by your admin).
- You can override it manually on any deal by editing the **Probability** field.
- A manual override is preserved when you move the deal to a new stage.
- Setting the stage to _Closed Won_ or _Closed Lost_ always forces probability to
  100% or 0% respectively.

### Multi-currency

- Each deal stores its own currency.
- Dashboard totals convert all deal values to the org default currency for display.
- Conversion rates are informational — MiniCRM does not fetch live exchange rates.

### Loss reason

When closing a deal as _Lost_ you can optionally record why. This appears in the
deal's audit history and can help identify patterns across lost deals.

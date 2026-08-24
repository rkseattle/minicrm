# Accounts

> **Feature flags:** Custom Fields on accounts and CSV/PDF export from the accounts
> list require the **Custom Fields** and **CSV Export** feature flags respectively. If
> either is missing, contact your admin.

Accounts represent companies or organisations. Linking contacts and deals to an account
gives you a full picture of your relationship with that company.

---

## Tutorial: create an account and link your contacts

### Step 1 — Create the account

1. Click **Accounts** in the navigation.
2. Click **New Account** (top-right).
3. Enter the **Company name** (required).
4. Optionally add industry, website, employee count, and revenue range — and use the
   **Contacts** field to link contacts right away, which saves doing Step 2 separately.
5. Click **Save**.

> **Account type** and **Parent account** appear on this form but are not saved when
> creating. Set them afterwards: open the account, click **Edit**, choose them there, and
> click **Save changes**.

### Step 2 — Link a contact to the account

Contacts are linked through a form on either side. The account's **Linked Contacts** list
is a read-only view of the result.

**From the account** — good for attaching several contacts at once:

1. Open the account's detail page and click **Edit**.
2. In the **Contacts** field, search by name or email and select each contact.
3. Click **Save changes**. They now appear under **Linked Contacts**.

**From the contact** — the only way to _move_ a contact between accounts:

1. Open the contact and click **Edit**.
2. Choose the account in the **Account** dropdown, then save.

> The account-side **Contacts** field only picks up contacts that are unlinked or already
> on this account. Selecting one that belongs to a different account does nothing, with no
> error — reassign it from the contact's own **Account** field instead. Removing a contact
> from this field unlinks it, so keep the existing selections unless you mean to detach
> them.

### Step 3 — Link a deal to the account

Deals are created from the Deals page and pointed at the account:

1. Click **Deals** in the navigation, then **New Deal**.
2. Fill in the deal details, choosing this account in the **Account** field.
3. Save. The deal appears on the pipeline board. To see an account's deals, open one of
   its contacts — the contact detail page lists the deals it is linked to.

### Step 4 — Set a parent account (subsidiaries)

If this account is a subsidiary of a larger company:

1. Open the account and click **Edit**.
2. In the **Parent account** field, search for and select the parent.
3. Click **Save changes**. The parent account's detail page now lists this account under
   **Subsidiary Accounts**.

---

## Reference

### Fields

| Field          | Notes                                                              |
| -------------- | ------------------------------------------------------------------ |
| Company name   | Required                                                           |
| Account type   | Optional; see type list below. Set it after creating, via **Edit** |
| Industry       | Optional free-text                                                 |
| Website        | Optional                                                           |
| Employee count | Optional free-text; e.g. `51-200`                                  |
| Revenue range  | Optional free-text; e.g. `10M-50M`                                 |
| Owner          | The rep responsible; defaults to the creator                       |
| Parent account | Links this account as a subsidiary of another                      |

### Account types

| Type       | When to use                                                |
| ---------- | ---------------------------------------------------------- |
| Prospect   | A company you are actively trying to win as a customer     |
| Customer   | A company that has bought from you                         |
| Partner    | A company you work with (reseller, referral partner, etc.) |
| Vendor     | A supplier or service provider                             |
| Competitor | A company you compete with                                 |
| Other      | Any other relationship                                     |

Account type is optional — you can leave it blank if it does not apply.

### AI duplicate detection explanation

> **Feature flag:** `ai_duplicate_explanation`.

When creating an account with a name that matches an existing record (case-insensitive),
you'll see a warning with **Go to existing account** and **Create anyway** actions.
Click **Explain** to get a 2-4 sentence, plain-language explanation of why the two
records look like duplicates. The explanation is generated on demand and appears
inline — no popup. See
[Contacts — AI duplicate detection explanation](contacts.md#ai-duplicate-detection-explanation)
for the equivalent feature on contact records.

> The explanation is **AI-generated** — use it to help decide whether to merge or
> dismiss, not as a final answer on its own.

### Parent/child hierarchy

- An account can have one parent and any number of children.
- The parent account's detail page shows all subsidiaries.
- There is no limit on hierarchy depth, but circular relationships are not allowed.

### AI Churn/Expansion Detection

> **Feature flag:** `ai_churn_expansion_detection`. Signals are computed by a nightly
> job, not on demand — there is nothing to click to trigger this.

For accounts with at least one Closed Won deal and some activity history, MiniCRM
periodically scans recent activity notes for signs of churn risk (declining activity,
negative sentiment, missed check-ins, rep silence, a competitor mentioned) or expansion
opportunity (new teams or use cases mentioned, growing headcount, more frequent
engagement, inbound contact from a new stakeholder).

If a clear signal is found, a banner appears at the top of the account's detail page:

- An amber **Churn risk detected** banner, or
- A green **Expansion signal detected** banner,

each listing the one or two contributing factors the AI found and the date the signal
was detected. A signal clears automatically the next time the account shows new,
contradicting activity — there is nothing to dismiss manually.

For an org-wide view, admins and reps with access can browse every account currently
flagged at `/insights/churn-expansion`, split into **At-Risk Accounts** and **Expansion
Opportunities**, each showing a confidence percentage.

> Churn/expansion signals are AI-generated from recent notes and activity patterns —
> treat the confidence percentage and contributing factors as a prompt to check in with
> the account, not as a guaranteed outcome.

### AI sentiment tracking

> **Feature flag:** `ai_sentiment_tracking`.

Once the account has at least two scored activities across all of its contacts in the
last 90 days, a **Warming**, **Stable**, or **Cooling** trend badge with a sparkline
appears next to the account name — an aggregate view of the same per-activity sentiment
scoring described on the [contacts page](contacts.md#ai-sentiment-tracking). A rep
flagging an individual activity's sentiment as inaccurate excludes it from this
aggregate too.

### AI relationship health scoring

> **Feature flag:** `ai_relationship_health_score`. Scores are computed by a nightly
> job, not on demand — there is nothing to click to trigger this.

Once an account has at least 3 logged activities, MiniCRM computes a relationship
health score from five factors: how often you're communicating, how recently you last
connected, the seniority of the contacts you're engaging, the account's sentiment
trend, and how many distinct contacts are involved. The result is shown as a badge
next to the account name:

- **Strong** or **Healthy** — the relationship is in good shape.
- **Cooling** — engagement is starting to decline.
- **At Risk** or **Dormant** — the account needs attention soon.

Click **Why?** next to the badge to see the top 2-3 factors driving the score in plain
language (for example, "No contact in 45 days"). If only one contact at the account has
been engaged in the last 90 days, an additional **Single-threaded risk** badge appears
regardless of the overall score — a reminder to build relationships with more
stakeholders before a single departure puts the account at risk.

The account detail page also shows a 6-month sparkline of the score history, and the
account list view has a **Show At Risk or Dormant accounts** filter to quickly surface
every account that needs a check-in.

> Relationship health scores are AI-computed from communication patterns — treat a
> Cooling or At Risk score as a prompt to check in, not as a definitive judgment of the
> relationship.

### Notifications

When a churn risk signal is detected with high confidence, MiniCRM sends the account's
owner an in-app notification. Click the bell icon in the navigation header to see your
notifications — a red badge shows how many are unread. Click a notification to jump
straight to the account it concerns; click **Mark all as read** to clear the unread
count. As of this release, churn/expansion detection is the only feature that generates
in-app notifications.

# Data Hygiene

> **Feature flag:** `ai_data_hygiene_assistant`. With the flag off the page reads
> _This feature is not available._ The nightly scan still runs — the flag hides the
> queue, it does not stop detection.

Every night MiniCRM checks your records for data quality problems —
missing phone numbers, deals with no contact, duplicates — and collects what it finds
into a queue. This page is that queue, filtered to the records you own.

> **The page has no navigation entry.** Reach it by typing `/hygiene` after your MiniCRM
> address. Admins have a separate org-wide view at `/admin/hygiene`, covered in
> [Admin guide — Data Hygiene](../admin-guide.md#21-data-hygiene).

---

## Tutorial: clear your queue

### Step 1 — Open the queue

Go to `/hygiene`. Each row names the record, the problem found, and a suggested action.
Click the record name to open it.

Use the **All**, **Contacts**, **Accounts**, and **Opportunities** chips to narrow the
list to one kind of record.

### Step 2 — Fix what is worth fixing

**Update** opens the record so you can correct it. It does not change the finding —
the problem disappears from the queue after the next nightly scan, once the record no
longer matches.

### Step 3 — Merge a duplicate

**Merge** appears on rows flagged **Possible duplicate contact** where the matching
contact is still on file. Clicking it opens
**Merge duplicate contacts**, where you pick which contact to keep. The other one's data
is merged into it and the loser is deleted.

### Step 4 — Clear what is not

**Archive** clears the findings listed against that record immediately, with no
confirmation step — not just the row you clicked. It does not delete or change the record
itself, only its rows in this queue.

**Dismiss** silences one finding. It opens **Dismiss this finding?** and requires a
**Reason** — the confirm button stays disabled until you type one. The finding is
suppressed for 90 days by default, a window your admin can change, then returns if the
record still matches.

---

## Reference

### What the nightly scan looks for

| Record      | What it checks for                                   |
| ----------- | ---------------------------------------------------- |
| Contact     | No logged activity for a long time                   |
| Contact     | A missing email address or phone number              |
| Contact     | A job title that has not been updated in a long time |
| Contact     | An email domain that no longer accepts mail          |
| Contact     | Another contact that looks like the same person      |
| Account     | No contacts linked to it                             |
| Account     | No logged activity for a long time                   |
| Account     | A website that does not respond                      |
| Account     | A missing industry or company size                   |
| Opportunity | No logged activity recently                          |
| Opportunity | A close date that has already passed                 |
| Opportunity | No contact linked to it                              |
| Opportunity | A value of zero                                      |

The time spans in the four inactivity and staleness labels are fixed text, but the
thresholds behind them are set by your admin. If your organization uses a six-month
inactivity window, a contact is flagged after six months even though the label still
reads _No activity in over a year_. The other checks have no threshold to configure — a
close date has passed or it has not.

### Archive clears the record's rows, not just the one you clicked

This is the one that surprises people. A contact flagged for both a missing phone number
and a stale job title loses both findings when you archive either one.

Two limits are worth knowing:

- The record itself is untouched. Nothing is deleted or edited — only the queue rows.
- A duplicate pair is flagged from both sides. Archiving one contact's row leaves the
  other contact's **Possible duplicate contact** row in place, still naming the one you
  archived.

Use **Dismiss** when you want to silence a single finding.

### What you see, and what admins see

This page shows findings on records **you own**. Admins have a separate page at
`/admin/hygiene` covering the whole organization.

### Empty and error states

| What you see                                       | When                                  |
| -------------------------------------------------- | ------------------------------------- |
| _Nothing to review_                                | Nothing is flagged on records you own |
| _Failed to load the data hygiene queue._           | The queue could not be fetched        |
| _Failed to complete the action. Please try again._ | An archive, merge, or dismiss failed  |
| _This feature is not available._                   | The feature flag is off               |

### Nothing here is scored

The queue is a list ordered by when each problem was detected. There is no hygiene
score, no ranking, and no weighting — a missing phone number and a stale job title sit
side by side in the order they were found.

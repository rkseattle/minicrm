# Leads

> **Feature flag:** The **Notes** section on a lead requires the **Notes** feature flag.

Leads are potential customers who have not yet been qualified. When a lead is ready,
you convert them into a contact, account, and deal in one step — no copy-pasting required.

---

## Tutorial: capture a lead, qualify it, and convert it

### Step 1 — Create a lead

1. Click **Leads** in the navigation.
2. Click **New Lead** (top-right).
3. Enter the lead's **First name** and **Email address** — both are required. Last name is
   optional here, unlike on a contact, because inbound leads often arrive without one — but
   you will have to supply one before the lead can be converted.
4. Optionally add phone, company, territory, industry, and company size.
5. Choose a **Lead source** so you can track where your leads come from.
6. Click **Save**. The form is inline on the Leads list, so the new lead simply appears
   there, with status _New_ — there is no status field on the form. If the email matches an
   existing lead you are warned first and must confirm with **Create anyway**.

### Step 2 — Work the lead (Contacted → Qualified)

As you reach out and learn more:

1. Open the **Leads** list.
2. Click the status badge on the lead's row and pick the new status. It saves immediately —
   there is no status field on the lead's own edit form. This works on leads you own; an
   admin can change any lead's status.
   - _Contacted_ — you have reached out.
   - _Qualified_ — the lead meets your criteria and is ready to convert.
   - _Disqualified_ — the lead is not a fit.
3. Record what you learn in the lead's **Notes** field, or in the **Notes** section on its
   detail page. Leads have no activity timeline; calls and meetings are logged against a
   contact, account, or deal.

### Step 3 — Convert the lead

Any lead that has not been converted or disqualified can be converted, though normally you
would qualify it first:

1. Open the lead detail page.
2. Click **Convert Lead** (top-right button).
3. A conversion dialog appears. All three records are created — there is no way to skip
   one:
   - **Contact** — pre-filled from the lead's data; you can edit the fields. A **Last name**
     is required here even though the lead itself did not need one.
   - **Account** — choose **Create new** and give it a name, or **Link existing** and search
     for one.
   - **Deal** — a **Deal name** is required; value and close date are optional.
4. Click **Convert**. MiniCRM creates the three records and marks the lead as converted.
5. You are redirected to the new contact's detail page.

> The lead record is kept for reference after conversion, along with its notes and status
> history. Leads never had activities of their own — calls and meetings logged after
> conversion belong to the new contact, account, or deal.

---

## Reference

### Fields

| Field                   | Notes                                                          |
| ----------------------- | -------------------------------------------------------------- |
| First name              | Required                                                       |
| Last name               | Optional, but required to convert the lead                     |
| Email                   | Required                                                       |
| Phone                   | Optional                                                       |
| Company name            | Optional; pre-fills the account name on conversion             |
| Territory               | Optional free-text; feeds AI lead routing (admin, flagged)     |
| Industry                | Optional free-text; feeds AI lead routing (admin, flagged)     |
| Company size            | Optional free-text; e.g. `51-200`                              |
| Lead source             | Where this lead came from (see source list below)              |
| Status                  | Current stage in the lead lifecycle; starts at _New_           |
| Disqualification reason | Shown on the detail page when set, but no screen collects it   |
| Owner                   | Defaults to the creator; its owner or an admin can reassign it |

### Lead sources

| Source        |                                    |
| ------------- | ---------------------------------- |
| Web           | Filled in a form on your website   |
| Referral      | Introduced by someone              |
| Trade Show    | Met at an event                    |
| Cold Outreach | Proactively contacted by your team |
| Other         | Any other source                   |

### Lead statuses

| Status       | Meaning                               |
| ------------ | ------------------------------------- |
| New          | Just created; not yet contacted       |
| Contacted    | At least one outreach attempt made    |
| Qualified    | Meets your criteria; ready to convert |
| Disqualified | Not a fit; record kept for reference  |

### Conversion rules

- Converting a lead always creates a contact, an account, and a deal together.
- Further deals are created from the Deals page and linked to the account there.
- After conversion the lead's status becomes _Qualified_ and the lead is badged
  **Converted** on its detail page. It cannot be converted a second time.
- The source lead ID is stored on the new contact and deal for traceability.

### GDPR erasure

- Only admins can erase a lead.
- After erasure the lead record remains, with its personal fields — name, email, phone,
  company, and notes — replaced or cleared. The title and body of every note linked to the
  lead are cleared too, so anything captured there does not survive.
- An erasure event is written to the audit log with the requesting admin's name.
- References to the lead in AI chat history are redacted separately, shortly after the
  erasure. There is no screen for this; confirming it completed is an API check
  described in the [GDPR guide](../gdpr.md).

### AI lead score and narrative explanation

> **Feature flags:** `ai_lead_scoring` (the score badge) and
> `ai_lead_score_narrative` (the explanation).

A quality score (0-100) appears next to the status badge on the lead detail page,
computed from lead source, status progression, how recently the lead was updated, and —
once converted — the linked contact's activity history. The score is recalculated every
time you view the lead; nothing is stored.

Click **Why this score?** below the badge for a 3-5 sentence, plain-English narrative
explaining the factors behind the score, generated on demand. If there isn't enough
activity yet to explain the score meaningfully, MiniCRM says "Not enough activity data
to explain this score yet" rather than guessing.

> The score and its explanation are **rule-based and AI-generated** respectively — use
> them to help prioritize outreach, not as a substitute for your own judgment.

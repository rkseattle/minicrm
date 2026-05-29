# Leads

Leads are potential customers who have not yet been qualified. When a lead is ready,
you convert them into a contact, account, and deal in one step — no copy-pasting required.

---

## Tutorial: capture a lead, qualify it, and convert it

### Step 1 — Create a lead

1. Click **Leads** in the navigation.
2. Click **New Lead** (top-right).
3. Enter the lead's **First name** (required) and optionally last name, email, phone,
   company name, and job title.
4. Choose a **Lead source** so you can track where your leads come from.
5. The **Status** defaults to _New_.
6. Click **Save**.

### Step 2 — Work the lead (Contacted → Qualified)

As you reach out and learn more:

1. Open the lead and click **Edit**.
2. Update the **Status**:
   - _Contacted_ — you have reached out.
   - _Qualified_ — the lead meets your criteria and is ready to convert.
   - _Disqualified_ — the lead is not a fit; enter a **Disqualification reason**.
3. Use the **Activities** timeline on the lead to log calls, emails, and notes as you go.
4. Click **Save**.

### Step 3 — Convert the lead

Once the lead is qualified:

1. Open the lead detail page.
2. Click **Convert lead** (top-right button).
3. A conversion dialog appears. Choose what to create:
   - **Contact** — always created; pre-filled from the lead's data; you can edit the fields.
   - **Account** — optional; create a new company or link to an existing one.
   - **Deal** — optional; pre-fill a deal name, value, and stage.
4. Click **Convert**. MiniCRM creates the selected records and marks the lead as _Converted_.
5. You are redirected to the new contact's detail page.

> All activities and notes on the lead are accessible from the lead's history even after
> conversion. The lead record is kept for reference.

---

## Reference

### Fields

| Field                   | Notes                                                     |
| ----------------------- | --------------------------------------------------------- |
| First name              | Required                                                  |
| Last name               | Optional                                                  |
| Email                   | Optional but recommended                                  |
| Phone                   | Optional                                                  |
| Company name            | Optional; pre-fills the account name on conversion        |
| Job title               | Optional; pre-fills the contact's job title on conversion |
| Lead source             | Where this lead came from (see source list below)         |
| Status                  | Current stage in the lead lifecycle                       |
| Disqualification reason | Required when status is _Disqualified_                    |
| Owner                   | The rep responsible; defaults to the creator              |

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

- Converting a lead creates a contact and optionally an account and a deal.
- If you choose not to create a deal at conversion time, you can always add one later
  from the contact or account detail page.
- After conversion the lead's status is locked as _Converted_ and cannot be edited.
- The source lead ID is stored on the new contact and deal for traceability.

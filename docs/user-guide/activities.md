# Activities

> **Feature flags:** Activities and Tasks can be independently disabled by your admin.
> If the activity timeline or task list is missing, contact your admin to check the
> **Activities** and **Tasks** feature flags.

Activities are records of interactions with contacts — calls, emails, meetings, and
tasks. They build up a timeline on each contact, account, and deal so everyone on the
team can see the history at a glance.

---

## Tutorial: log a call and create a follow-up task

### Step 1 — Log a call

1. Open the contact, account, or deal the call was about.
2. In the **Activities** timeline, click **Log activity**.
3. Set **Type** to _Call_.
4. Set **Direction** to _Outbound_ (you called them) or _Inbound_ (they called you).
5. Set **Status** to _Complete_ — the call already happened.
6. Optionally add an **Outcome** summary (e.g. "Left voicemail") and link to a deal.
7. Click **Save**. The call appears in the timeline immediately.

### Step 2 — Create a follow-up task

1. In the same Activities timeline, click **Log activity** again.
2. Set **Type** to _Task_.
3. Give it a **Subject** (e.g. "Send pricing proposal").
4. Set **Status** to _Open_ — this task still needs to be done.
5. Set a **Due date** so it appears in your task list and triggers overdue reminders.
6. Click **Save**.

### Step 3 — Complete the task

When you finish the follow-up:

1. Open the activity from the timeline, or find it in **My Tasks** on the dashboard.
2. Click **Mark complete** (or edit the activity and set **Status** to _Complete_).

---

## Reference

### Activity types

| Type    | Use for                                                                     |
| ------- | --------------------------------------------------------------------------- |
| Note    | A quick logged note (see also the dedicated Notes feature for richer notes) |
| Call    | Phone or video call                                                         |
| Email   | An email sent or received                                                   |
| Meeting | In-person or virtual meeting                                                |
| Task    | A to-do item with a due date                                                |

### Fields

| Field                    | Notes                                                  |
| ------------------------ | ------------------------------------------------------ |
| Type                     | Required; see table above                              |
| Subject                  | Short description of the activity                      |
| Status                   | _Open_ (to do) or _Complete_ (done)                    |
| Direction                | _Inbound_ or _Outbound_; relevant for calls and emails |
| Outcome                  | Free-text result summary                               |
| Due date                 | For tasks; triggers overdue notifications              |
| Owner                    | The rep responsible; defaults to the creator           |
| Contact / Account / Deal | At least one must be linked                            |

### My Tasks

The **My Tasks** section on the dashboard shows all open Task-type activities
assigned to you, ordered by due date. Overdue tasks are highlighted.

### Overdue notifications

If your admin has enabled email notifications, you will receive a daily digest of
overdue tasks (tasks past their due date that are still open). You can control this
in your notification preferences (see the profile menu → Notification preferences).

### AI Objection Pattern Matching

> **Feature flag:** `ai_objection_pattern_matching`.

When an activity has note text, MiniCRM automatically checks whether the note logs a
sales objection and, if so, shows a small category badge next to it in the timeline:
**Price**, **Timing**, **Competitor**, **Product Fit**, **Authority**, **Risk**, or
**Other**. Hover the badge to see a reminder that the category is AI-inferred. Not
every note is classified — only ones that clearly describe an objection the contact
raised.

Click **How was this handled before?** below the badge to see up to three similar
objections from past deals your team won, each showing:

- The deal it came from (click through to view it).
- A quote of the past objection.
- What the rep did next (the following logged activity on that deal).
- How many days later the deal closed.

If your organisation does not yet have enough won-deal history, the panel tells you how
many more closed-won deals are needed before precedents can be shown.

> The category and matched precedents are **AI-inferred** — use them as a quick
> reference for how similar pushback has been handled before, not as a guarantee that
> the same approach will work again.

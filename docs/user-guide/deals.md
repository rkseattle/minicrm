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

### AI Deal Health Check

> **Feature flag:** `ai_deal_health_check`. If the **Deal Health** section is missing
> from the deal detail page, contact your admin.

The **Deal Health** section on the deal detail page runs an on-demand AI assessment
of a single deal's risk signals — no activity in a while, an outbound email that never
got a reply, a close date that has passed, or no open follow-up tasks.

1. Open a deal you own (or any deal, if you are an admin).
2. Scroll to the **Deal Health** section.
3. Click **Check health**.

The assessment returns:

- A status badge — **On Track**, **At Risk**, or **Stalled**.
- A short narrative explaining the specific signals the AI found.
- One or two suggested next actions.

> **AI-identified, not guaranteed.** The health check is generated fresh every time you
> click **Check health** — nothing is saved between runs, so re-running it can produce a
> different result if new activity has been logged. Treat the status and narrative as a
> starting point for your own judgment, not a definitive fact about the deal.

### AI Stage Advancement

> **Feature flag:** `ai_stage_advancement`.

When you open a deal, MiniCRM automatically checks whether it looks ready to move to
its next pipeline stage — you do not need to click anything. If the AI finds clear
evidence in recent activity (for example, a proposal was sent and acknowledged, or a
decision maker confirmed next steps), a banner appears near the top of the deal:

> **Ready to advance to _{next stage}_?**
> _(short rationale citing the specific signal found)_

Click the banner to open the deal for editing with the suggested stage pre-filled in
the **Stage** dropdown — you still need to review and click **Save** to apply it.
Nothing changes automatically.

If the data is thin, ambiguous, or the next pipeline stage has required fields the deal
is still missing, no banner appears at all. The check re-runs automatically whenever you
reload the deal or after you save an edit.

### AI Champion/Blocker Detection

> **Feature flag:** `ai_champion_blocker_detection`.

MiniCRM continuously looks for signs of internal advocacy or resistance in the notes you
log against a deal's contacts — for example, "I've shared this with my manager" (a
champion signal) versus "we're also evaluating a competitor" (a blocker signal). This
runs automatically each time you log an activity with a linked contact; there is nothing
to trigger manually.

Each contact linked to a deal can show a badge next to their name in the **Linked
Contacts** list:

| Badge           | Meaning                                                   |
| --------------- | --------------------------------------------------------- |
| Champion        | Multiple clear signals of internal advocacy               |
| Likely Champion | One signal of internal advocacy                           |
| _(no badge)_    | Neutral — no clear signals either way (the default state) |
| Likely Blocker  | One signal of resistance or a competing preference        |
| Blocker         | Multiple clear signals of resistance                      |

On a contact's own detail page, click **Why?** next to the badge to see the specific
signals the AI used, and click **Not accurate** to dismiss the classification if it
looks wrong — a fresh classification will reappear only once new activity is logged.

> Champion/Blocker status is **AI-inferred, not factual**. It is never shown to the
> contact — only to your team — and should be treated as a conversation-starter, not a
> confirmed fact about how someone feels.

#### Stakeholder Map

The **Stakeholder Map** panel on the deal detail page summarizes how many linked
contacts are engaged, and how many are currently classified as champions or blockers.
If only one contact is linked to a deal above a value your admin has configured
(defaults to $10,000), a **single-threaded risk** warning appears — a reminder that
your relationship with this account depends on a single point of contact.

### AI Proposal Draft Generation

> **Feature flag:** `ai_proposal_draft_generation`. Generating a draft consumes AI
> tokens against your monthly budget (see the [AI Assistant guide](ai-assistant.md)) —
> if you are over budget, the button will return an error instead of a draft.

The **Proposal Draft** section on the deal detail page uses AI to produce a first-pass
proposal document from the deal's context (account, contacts, notes, and recent
activity) that you can edit before sending.

#### Tutorial: generate, edit, and export a proposal draft

##### Step 1 — Generate the draft

1. Open the deal and scroll to the **Proposal Draft** section.
2. Click **Generate Proposal Draft**.

A full-screen editor opens with a draft pre-filled across several sections: **Prepared
for** / **Prepared by**, **Executive Summary**, **Problem Statement**, **Proposed
Solution**, **Proposed Investment** (editable pricing line items), and **Next Steps**.

##### Step 2 — Edit the draft

Every text section is a rich-text field — use the toolbar to apply **bold**, _italic_,
underline, or bullet/numbered lists. Edit the **Prepared for** / **Prepared by** fields
directly, and add, edit, or remove pricing line items as needed.

> Wherever the AI could not fill in a specific detail, it marks the spot clearly (for
> example, `[rep to fill in]`) — review the whole draft and replace these before sending.

##### Step 3 — Regenerate with a focus (optional)

If the first draft is not the right angle, click **Regenerate**, enter a short focus
note (for example, "ROI, executive audience, technical detail"), and click **Regenerate**
again. This replaces the entire draft with a new AI-generated version built around your
focus note — any manual edits you made to the previous version are lost.

##### Step 4 — Export

Use one of the three export options in the editor header:

| Option                   | What it does                                   |
| ------------------------ | ---------------------------------------------- |
| **Copy to clipboard**    | Copies the draft as Markdown text              |
| **Download as Markdown** | Downloads a `.md` file of the draft            |
| **Download as DOCX**     | Downloads a Word document version of the draft |

Click **Close** to dismiss the editor. The draft is **not saved** anywhere in MiniCRM —
export it first if you want to keep it.

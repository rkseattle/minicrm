# Contacts

> **Feature flags:** Tags and Custom Fields on contacts can be disabled by your admin.
> If the Tags section or custom field inputs are missing, contact your admin to check the
> **Tags** and **Custom Fields** feature flags. CSV/PDF export from the contacts list
> also requires the **CSV Export** feature flag to be enabled.

Contacts are individual people — prospects, customers, or anyone else you interact with.
Every contact can be linked to an account, a deal, activities, and notes.

![The contacts list, with search and owner filters above a table of names, emails, job titles, owners, and tags, sortable by name and email](../screenshots/02-contacts.png)

---

## Tutorial: your first contact end-to-end

This walkthrough takes you from creating a brand-new contact through tagging, attaching
a file, and (if needed) erasing their data.

### Step 1 — Create the contact

1. Click **Contacts** in the navigation.
2. Click **New Contact** (top-right).
3. Fill in **First name**, **Last name**, and **Email** — all three are required, and
   the email must be unique across all contacts.
4. Optionally add: phone, job title, department, and account. LinkedIn, Twitter/X, and
   other links are under **Social Profiles**, which starts collapsed — click it to expand.
5. Click **Save**. You are taken to the new contact's detail page.

> Two fields are not on the create form. **Owner** appears only when you edit an existing
> contact — a new contact is always owned by whoever created it. **Addresses** are added
> after saving, via **Add address** while editing the contact.

### Step 2 — Add a tag

Tags let you group contacts by any label you choose (e.g. "VIP", "Newsletter", "Partner").

1. On the contact detail page, find the **Tags** section.
2. Click the tag input and type a new tag name, or select an existing one from the dropdown.
3. Press **Enter** or click the tag suggestion to apply it.
4. Remove a tag by clicking the **×** next to it.

### Step 3 — Attach a file

1. On the contact detail page, scroll to the **Attachments** section.
2. Click the upload area — **Click or drag and drop a file here** — and choose a file,
   or drag one onto it.
3. The file appears in the list once uploaded. Click **Download** to retrieve it.
4. To remove an attachment, click **Delete** next to it, then confirm in the dialog.

### Step 4 — Erase a contact's data (GDPR)

If a contact requests erasure of their personal data under GDPR (the "right to be
forgotten"):

1. Open the contact's detail page.
2. Scroll down the detail page to the **GDPR & Privacy** section, below **Change History**.
3. Click **Erase personal data**.
4. The dialog lists exactly what will be erased and what is preserved. Type `ERASE` to
   confirm, optionally recording a reference note (e.g. a request number), then click
   **Erase personal data**.

Erasure reaches further than the contact's own record. Along with their name, email,
phone, department, and social links, it **deletes every address and every custom field
value** on the contact, and clears the **subject and notes of every linked activity** and
the **title and body of every linked note**. Meeting write-ups, call notes, and anything
captured in a custom field do not survive — export what you need before erasing.

> **Note:** Erasure is irreversible. The contact record remains (with a placeholder name)
> so that linked deals and activities retain their history. Only an admin can trigger
> erasure, and the **GDPR & Privacy** section is visible only to admins.

The same section offers **Download data export**, which produces a complete export of the
personal data held for the record — the GDPR right of access. It downloads a JSON file
named after the record, containing the contact's own fields plus every linked activity,
deal, note, and custom field value, and the record's full change history.

Two things about it are easy to miss. The export stays available after a record has been
erased, so you can still answer a request about what was held. And in an erased record's
change history, the before-and-after values read `[GDPR deleted]` rather than the original
text.

---

## Reference

![A contact's detail page, with the record's fields above its tags and activity sections, and Send Email and Merge actions](../screenshots/03-contact-detail.png)

### Fields

| Field       | Notes                                                                 |
| ----------- | --------------------------------------------------------------------- |
| First name  | Required                                                              |
| Last name   | Required                                                              |
| Email       | Required; must be unique across all contacts                          |
| Phone       | Optional                                                              |
| Job title   | Optional                                                              |
| Department  | Optional                                                              |
| Account     | Optional; links the contact to a company record                       |
| Owner       | The rep responsible; set to the creator, editable afterwards¹         |
| Address     | Street, city, state/region, postal code, country; added while editing |
| Source lead | Read-only; set automatically when a lead is converted                 |

¹ Admins can reassign a contact to anyone. A **manager** can only reassign to members of
their own team, or to themselves; a manager belonging to no team cannot reassign at all.
The save fails with a generic error when this happens.

### AI contact enrichment from pasted text

> **Feature flag:** `ai_contact_enrichment`.

On the contact create or edit form, click **Enrich from text** and paste a LinkedIn
bio, email signature, vCard text, or business card text. MiniCRM extracts first name,
last name, job title, company, email, phone, LinkedIn URL, and location where present,
and pre-fills the form fields as an editable overlay — review and adjust before saving.
Fields it couldn't find are left blank rather than guessed. If the extracted company
name matches an existing account, that account is pre-selected. The pasted text itself
is never stored. If too little can be extracted, MiniCRM tells you to fill the form in
manually instead of guessing.

### Tags

- Tags are free-text labels shared across all contacts.
- Any user can add or remove tags.
- Contacts can have multiple tags.
- You can filter the contacts list by tag.

### Attachments

- Six file types are accepted: PDF, `.docx`, `.xlsx`, `.png`, `.jpg`, and `.txt`.
- Each file may be up to **25 MB**, and one record may hold **100 MB** of attachments in
  total. Past that, uploads are refused with "The record has reached the 100 MB attachment
  limit."
- These limits are fixed in the application — an admin cannot raise them. What an admin
  does configure is where files are stored; until that is set up, the section reads
  "File attachments are not configured — contact your admin."
- Files are stored securely; only authenticated users can download them.

### Merging duplicates

If you have two contact records for the same person, an admin — or the contact's own
owner — can merge them. Click **Merge with another contact** on the contact detail page,
search for the duplicate, then choose which value to keep for each conflicting field.
The surviving contact keeps the data you choose, the other record is deleted, and its
linked deals, activities, notes, attachments, and addresses all move to the winner
automatically. Custom fields move too, except where both records had a value for the same
field — there the winner's own value is kept.

#### AI duplicate detection explanation

> **Feature flag:** `ai_duplicate_explanation`.

When creating a contact with an email address that matches an existing record, you'll
see a warning with **Go to existing contact** and **Create anyway** actions. Click
**Explain** to get a 2-4 sentence, plain-language explanation of why the two records
look like duplicates (for example, matching email, similar names, or the same
company). The explanation is generated on demand and appears inline — no popup. If
there isn't enough of a meaningful match to explain, MiniCRM says so rather than
guessing. The same action is available for accounts — see
[Accounts — AI duplicate detection explanation](accounts.md#ai-duplicate-detection-explanation).

> The explanation is **AI-generated** from the two records' field data — use it to help
> decide whether to merge or dismiss, not as a final answer on its own.

### GDPR erasure

- Only admins can erase a contact.
- After erasure the contact still appears in lists (with a placeholder name) so that
  historical deal and activity records are not orphaned.
- An erasure event is written to the audit log with the requesting admin's name.
- References to the contact in AI chat history are redacted separately, shortly after
  the erasure. There is no screen for this; confirming it completed is an API check
  described in the [GDPR guide](../gdpr.md).

### Change History

The detail page sidebar carries a **Change History** panel listing who changed what and
when, newest first. It covers the record being created and deleted, field edits with
their before and after values, ownership reassignments, notes being added, edited, or
removed, and records merged into this one. An empty field reads _(empty)_ rather than
being left blank.

It shows the twenty most recent entries, with **Show all** to load the full history and
**Show less** to collapse it again. Timestamps are relative for the first week — "2 hours ago" — and switch to
an absolute date after that; hovering any entry shows the exact date and time.

Contacts, accounts, and deals all have this panel. Leads do not.

### Send Email

When a contact has an email address, the Email row on their detail page has a
**Send Email** button. It opens a small composer with the address pre-filled, and sending
both delivers the message and logs it as an Email activity on the contact.

> **Check the confirmation.** If your admin has not configured outgoing mail, the send
> still succeeds and the activity is still logged, but nothing is delivered. The
> confirmation says which happened: _Email sent to_ the contact means it went out, while
> _Email logged (SMTP not configured)_ means only the activity was recorded.

### AI Champion/Blocker badge

> **Feature flag:** `ai_champion_blocker_detection`.

If this contact is linked to a deal, a **Champion**, **Likely Champion**, **Likely
Blocker**, or **Blocker** badge may appear next to their name at the top of the contact
detail page — an AI-inferred read on whether their recent activity notes show signs of
internal advocacy or resistance. Click **Why?** to see the specific signals behind the
classification, or **Not accurate** to dismiss it. See
[Deals — AI Champion/Blocker Detection](deals.md#ai-championblocker-detection) for the
full explanation of how this is determined. The badge is internal only — it is never
shown to the contact.

### AI Draft Email

> **Feature flag:** `ai_email_draft`.

Click **Draft Email** on the contact detail page (or from a contact-linked activity) to
generate a first-draft follow-up email. MiniCRM uses the contact's name, company, role,
recent activity, last interaction date, and any open opportunities to write a subject
line and body, shown in a sidebar panel. Choose a tone — **Professional**, **Friendly**,
or **Concise** — to regenerate, edit the draft inline, and use **Copy to clipboard** to
paste it into your email client. If the contact has no recent activity, the draft falls
back to a generic introduction based on their fields alone. Nothing is sent
automatically and the draft is not saved — dismiss the panel or copy it yourself.

### AI sentiment tracking

> **Feature flag:** `ai_sentiment_tracking`.

Every activity note and call summary is scored for sentiment (Positive, Neutral,
Negative) shortly after you save it — this happens in the background, so there's no
wait when logging an activity. Once a contact has at least two scored interactions, a
**Warming**, **Stable**, or **Cooling** trend badge with a small sparkline appears next
to their name, based on their last 10 interactions. Each activity in the timeline shows
its own sentiment alongside a **Flag as inaccurate** link — flagged scores are excluded
from the trend but not deleted. The equivalent aggregate trend for an account (across
all its contacts, over the last 90 days) appears on the
[account detail page](accounts.md#ai-sentiment-tracking).

### AI warm introduction paths

> **Feature flag:** `ai_warm_intro_path`.

Click **Find warm path** on a contact's detail page to see whether anyone in your own
contact network could introduce you. MiniCRM looks for contacts you've actually worked
with (own or have logged activity against) who share an account, a hierarchy-linked
parent/child account, or a deal with the target contact — or whose notes mention the
target by name. Each result shows the path (**You → Known Contact → Target Contact**)
and a suggested introduction message you can send to the intermediary yourself; MiniCRM
never sends anything automatically. Paths are capped at one hop through your network
(no speculative third-degree connections), and if no path exists the panel says so
rather than guessing. The same lookup is available via the AI assistant — try
"Who do I know that could introduce me to \<name\>?"

### AI smart follow-up timing suggestions

> **Feature flag:** `ai_followup_timing_suggestions`.

Once you've logged at least 5 interactions with a contact, MiniCRM looks at when
they've historically responded or engaged and suggests the best day and time to reach
them — for example, "Best time to reach Sarah: Tuesday mornings, based on past
engagement." The suggestion updates automatically as new interactions accumulate, and
is shown in the org's configured display timezone (set by an admin under
[Workspace settings](../admin-guide.md#default-timezone)).

Click **Schedule follow-up** to open a Task creation form pre-populated with the
suggested date and a subject line noting the suggested time — you can edit anything
before saving. The same suggestion also appears in the
[pre-meeting brief](activities.md#ai-pre-meeting-brief) for this contact,
and via the AI assistant — try "When should I follow up with \<name\>?" If there isn't
enough interaction history yet, the section simply doesn't appear rather than showing a
low-confidence guess.

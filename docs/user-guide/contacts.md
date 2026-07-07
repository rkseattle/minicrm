# Contacts

> **Feature flags:** Tags and Custom Fields on contacts can be disabled by your admin.
> If the Tags section or custom field inputs are missing, contact your admin to check the
> **Tags** and **Custom Fields** feature flags. CSV/PDF export from the contacts list
> also requires the **CSV Export** feature flag to be enabled.

Contacts are individual people — prospects, customers, or anyone else you interact with.
Every contact can be linked to an account, a deal, activities, and notes.

---

## Tutorial: your first contact end-to-end

This walkthrough takes you from creating a brand-new contact through tagging, attaching
a file, and (if needed) erasing their data.

### Step 1 — Create the contact

1. Click **Contacts** in the navigation.
2. Click **New Contact** (top-right).
3. Fill in at minimum a **First name** and **Email** — email must be unique across all contacts.
4. Optionally add: last name, phone, job title, account, owner, and address.
5. Click **Save**. You are taken to the new contact's detail page.

### Step 2 — Add a tag

Tags let you group contacts by any label you choose (e.g. "VIP", "Newsletter", "Partner").

1. On the contact detail page, find the **Tags** section.
2. Click the tag input and type a new tag name, or select an existing one from the dropdown.
3. Press **Enter** or click the tag suggestion to apply it.
4. Remove a tag by clicking the **×** next to it.

### Step 3 — Attach a file

1. On the contact detail page, scroll to the **Attachments** section.
2. Click **Upload file** and choose a file from your computer.
3. The file appears in the list once uploaded. Click its name to download it.
4. To remove an attachment, click the trash icon next to it.

### Step 4 — Erase a contact's data (GDPR)

If a contact requests erasure of their personal data under GDPR (the "right to be
forgotten"):

1. Open the contact's detail page.
2. Click the **⋯ More actions** menu (top-right of the detail panel).
3. Choose **Erase personal data**.
4. Confirm the dialog. The contact's personal fields (name, email, phone, address) are
   blanked and an erasure record is written to the audit log.

> **Note:** Erasure is irreversible. The contact record remains (with a placeholder name)
> so that linked deals and activities retain their history. Only an admin can trigger erasure.

---

## Reference

### Fields

| Field       | Notes                                                         |
| ----------- | ------------------------------------------------------------- |
| First name  | Required                                                      |
| Last name   | Optional                                                      |
| Email       | Required; must be unique across all contacts                  |
| Phone       | Optional                                                      |
| Job title   | Optional                                                      |
| Account     | Links the contact to a company record                         |
| Owner       | The rep responsible for this contact; defaults to the creator |
| Address     | Street, city, state/region, postal code, country              |
| Source lead | Read-only; set automatically when a lead is converted         |

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

- Supported file types and size limits are set by your admin.
- Files are stored securely; only authenticated users can download them.

### Merging duplicates

If you have two contact records for the same person, an admin can merge them.
The surviving contact keeps the data you choose for each field, and all linked
deals, activities, and notes are moved to the winner automatically.

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

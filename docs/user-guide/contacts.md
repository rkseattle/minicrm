# Contacts

> **Feature flags:** Tags and Custom Fields on contacts can be disabled by your admin.
> If the Tags section or custom field inputs are missing, contact your admin to check the
> **Tags** and **Custom Fields** feature flags. CSV export from the contacts list also
> requires the **CSV Export** feature flag to be enabled.

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

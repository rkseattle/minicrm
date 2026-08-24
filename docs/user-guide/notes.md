# Notes

> **Feature flag:** Notes can be disabled by your admin. If the Notes section does not
> appear on record pages, contact your admin to enable the **Notes** feature flag.

Notes are rich-text comments attached to a contact, account, deal, or lead. Unlike
activity log entries, notes are designed for longer contextual commentary — background
on a relationship, meeting summaries, or internal team discussions. No note is sent to a
customer, and **Private** holds across the AI features too — but a data subject's GDPR
export includes them. See **Where notes can be disclosed** before writing anything you
would not want quoted back.

---

## Tutorial: add a note and adjust its visibility

### Step 1 — Add a note

1. Open a contact, account, deal, or lead.
2. Scroll to the **Notes** section and click **Add note**.
3. Optionally give the note a title, then write it in the editor. You can use basic
   formatting (bold, lists, links) and add tags — press Enter or comma to commit each tag,
   or it is discarded when you save.
4. Choose a **Visibility** level (see reference below). It defaults to **Team**.
5. Click **Save note**.

The note appears in the Notes section with your name, the timestamp, and a visibility
badge.

### Step 2 — Edit or change visibility

1. Find the note you want to change.
2. Click **Edit** — shown only to the note's author and to admins.
3. Update the text. **Only the note's author can change its visibility level.** If an
   admin editing someone else's note submits a changed **Visibility**, the save is
   refused and the text edit is not applied either — leave the dropdown alone to save
   the text.
4. Click **Save note**.

### Step 3 — Delete a note

1. Click **Delete** on the note.
2. Confirm the dialog. The note is removed.

> Only the note's author or an admin can edit or delete a note — and a note set to
> **Private** shows neither button to anyone but its author.

---

## Reference

### Visibility levels

New notes default to **Team**.

| Level       | Who can read it                               |
| ----------- | --------------------------------------------- |
| **Team**    | Every logged-in user — the default            |
| **Private** | Only the note's author; admins are not exempt |
| **Public**  | Every logged-in user                          |

**Team and Public behave identically today.** Both are readable by every logged-in user
and neither is restricted to your team. Choose between them as a signal to colleagues
about the nature of the note, not as an access control.

**Private** is the only level that restricts anything, and it restricts the note's text
rather than its existence — see **Where notes can be disclosed** for the one path that
reads it anyway. Other users still see that the note exists, but in place of its
content they get a single line — "Private note by \<author\>" with a relative time — and no
**Edit** or **Delete** buttons. This applies to admins too: the check is authorship, with
no role exemption.

Use **Private** for sensitive information (e.g. internal negotiation notes) that should not
be visible to other reps. Use **Team** for everyday commentary — it is the default and the
right choice for most notes. Use **Public** for information you would be comfortable
sharing more widely.

### Where notes can be disclosed

**Private** withholds a note's text everywhere a rep can read notes, and from the AI
features that read them: proposal drafting and warm-introduction matching both skip
private notes written by anyone else, so nothing you mark private reaches a customer
document or surfaces you as an introduction route.

One deliberate exception: a **GDPR data export** includes every note on the record,
private ones included. That export exists to answer a data subject's right-of-access
request, and the law entitles them to all personal data held about them — an internal
visibility setting does not change that. Write notes about a person on the assumption they
could one day read them.

### Searching notes

The Notes section within a record shows all notes for that record. To find notes
across all records, use the global search or filter by tag/owner on the respective
list page.

### Notes vs. Activities

- Use **Notes** for longer, contextual commentary — relationship background, meeting
  summaries, detailed observations.
- Use **Activities** (type: Note) for brief timeline log entries — "Called, left voicemail."
- Both appear in their respective sections on the record detail page.
